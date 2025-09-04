import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type AnalyticsAdapter,
	ErrorCodes,
	MemoryKeyStore,
	usefulkey,
} from "../../../src";
import { configureCryptoProvider, hashSha256 } from "../../../src/utils/crypto";

class ThrowingAnalytics implements AnalyticsAdapter {
	async track(_e: string, _p: Record<string, unknown>): Promise<void> {
		throw new Error("analytics_down");
	}
}

beforeEach(() => {
	let seed = 12345;
	const nextByte = () => (seed = (seed * 1664525 + 1013904223) >>> 0) & 0xff;
	configureCryptoProvider({
		getRandomValues: (arr: Uint8Array) => {
			for (let i = 0; i < arr.length; i++) arr[i] = nextByte();
			return arr;
		},
		randomUUID: () => "00000000-0000-4000-8000-000000000000",
	} as any);
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
});

describe("UsefulKey error and edge paths", () => {
	it("plugin beforeVerify reject short-circuits with custom reason", async () => {
		const uk = usefulkey(
			{},
			{
				plugins: [
					() => ({
						name: "rejector",
						async beforeVerify() {
							return { reject: true, reason: "blocked_custom" } as any;
						},
					}),
				],
			},
		);

		const res = await uk.verifyKey({ key: "uk_something" });
		expect(res.error).toBeFalsy();
		expect(res.result?.valid).toBe(false);
		expect(res.result?.reason).toBe("blocked_custom");
	});

	it("plugin onKeyRecordLoaded reject blocks after record load", async () => {
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey(
			{ adapters: { keyStore } },
			{
				plugins: [
					() => ({
						name: "reject-after-load",
						async onKeyRecordLoaded() {
							return { reject: true, reason: "post_load_block" } as any;
						},
					}),
				],
			},
		);

		const created = await uk.createKey();
		const res = await uk.verifyKey({ key: created.result!.key });
		expect(res.error).toBeFalsy();
		expect(res.result?.valid).toBe(false);
		expect(res.result?.reason).toBe("post_load_block");
	});

	it("analytics failures are non-fatal in create/verify/revoke", async () => {
		const analytics = new ThrowingAnalytics();
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey({
			adapters: { keyStore, analytics },
		});

		const created = await uk.createKey();
		expect(created.error).toBeFalsy();

		const verified = await uk.verifyKey({ key: created.result!.key });
		expect(verified.error).toBeFalsy();
		expect(verified.result?.valid).toBe(true);

		const revoked = await uk.revokeKey(created.result!.id);
		expect(revoked.error).toBeFalsy();
	});

	it("createKey returns KEY_GENERATION_FAILED when custom generateKey throws", async () => {
		const uk = usefulkey({
			customGenerateKey() {
				throw new Error("bad_spec");
			},
		});

		const res = await uk.createKey();
		expect(res.error).toBeTruthy();
		expect(res.error?.code).toBe(ErrorCodes.KEY_GENERATION_FAILED);
	});

	it("keystore write/read/revoke failures map to specific error codes", async () => {
		const throwingWrite = {
			async createKey() {
				throw new Error("write_failed");
			},
			async findKeyByHash() {
				return null;
			},
			async findKeyById() {
				return null;
			},
			async updateKey() {},
			async revokeKeyById() {},
		} as any;
		const ukW = usefulkey({
			adapters: { keyStore: throwingWrite },
		});
		const rW = await ukW.createKey();
		expect(rW.error?.code).toBe(ErrorCodes.KEYSTORE_WRITE_FAILED);

		const throwingRead = {
			async createKey() {},
			async findKeyByHash() {
				throw new Error("read_failed");
			},
			async findKeyById() {
				throw new Error("read_failed");
			},
			async updateKey() {},
			async revokeKeyById() {},
		} as any;
		const ukR = usefulkey({
			adapters: { keyStore: throwingRead },
		});
		const rR1 = await ukR.getKey("uk_x");
		expect(rR1.error?.code).toBe(ErrorCodes.KEYSTORE_READ_FAILED);
		const rR2 = await ukR.getKeyById("id");
		expect(rR2.error?.code).toBe(ErrorCodes.KEYSTORE_READ_FAILED);

		const throwingRevoke = {
			async createKey() {},
			async findKeyByHash() {
				return null;
			},
			async findKeyById() {
				return null;
			},
			async updateKey() {},
			async revokeKeyById() {
				throw new Error("revoke_failed");
			},
		} as any;
		const ukV = usefulkey({
			adapters: { keyStore: throwingRevoke },
		});
		const rV = await ukV.revokeKey("id");
		expect(rV.error?.code).toBe(ErrorCodes.KEYSTORE_REVOKE_FAILED);
	});

	it("expiresAt exactly now() is considered expired", async () => {
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey({ adapters: { keyStore } });
		const nowTs = Date.now();
		const created = await uk.createKey({ expiresAt: nowTs });
		const res = await uk.verifyKey({ key: created.result!.key });
		expect(res.error).toBeFalsy();
		expect(res.result?.valid).toBe(false);
		expect(res.result?.reason).toBe("expired");
	});

	it("usesRemaining negative is treated as usage_exceeded", async () => {
		const uk = usefulkey({});
		const created = await uk.createKey({ usesRemaining: -1 });
		const res = await uk.verifyKey({ key: created.result!.key });
		expect(res.error).toBeFalsy();
		expect(res.result?.valid).toBe(false);
		expect(res.result?.reason).toBe("usage_exceeded");
	});

	it("custom hashKey function is used in create and lookup", async () => {
		let calls = 0;
		const customHash = (s: string) => {
			calls++;
			return `x:${hashSha256(s)}`;
		};
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey({
			customHashKey: customHash,
			adapters: { keyStore },
		});

		const created = await uk.createKey();
		const getRes = await uk.getKey(created.result!.key);
		expect(getRes.error).toBeFalsy();
		expect(getRes.result?.id).toBeTruthy();

		expect(calls).toBeGreaterThanOrEqual(2);
	});

	it("when secret is provided, HMAC-SHA256 is used for create/verify/getKey", async () => {
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey({
			adapters: { keyStore },
			secret: "pepper",
		});

		const created = await uk.createKey();
		expect(created.error).toBeFalsy();
		const plaintext = created.result!.key;

		const verified = await uk.verifyKey({ key: plaintext });
		expect(verified.error).toBeFalsy();
		expect(verified.result?.valid).toBe(true);

		const expected = crypto
			.createHmac("sha256", "pepper")
			.update(plaintext)
			.digest("hex");
		const stored = await keyStore.findKeyByHash(expected);
		expect(stored?.id).toBe(created.result!.id);

		const looked = await uk.getKey(plaintext);
		expect(looked.result?.id).toBe(created.result!.id);
	});

	it("customHashKey takes precedence over secret", async () => {
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey({
			adapters: { keyStore },
			secret: "pepper",
			customHashKey: (k: string) => `x:${hashSha256(k)}`,
		});

		const created = await uk.createKey();
		const plaintext = created.result!.key;

		const expectedCustom = `x:${hashSha256(plaintext)}`;
		const rec = await keyStore.findKeyByHash(expectedCustom);
		expect(rec?.id).toBe(created.result!.id);
	});

	it("customGenerateKey is used verbatim (no prefix added)", async () => {
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey({
			adapters: { keyStore },
			customGenerateKey: () => "CUSTOM_PLAINTEXT",
		});

		const created = await uk.createKey();
		expect(created.error).toBeFalsy();
		expect(created.result?.key).toBe("CUSTOM_PLAINTEXT");

		const verified = await uk.verifyKey({ key: "CUSTOM_PLAINTEXT" });
		expect(verified.error).toBeFalsy();
		expect(verified.result?.valid).toBe(true);
	});

	it("customIdGenerator provides id when not specified, and explicit id overrides", async () => {
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey({
			adapters: { keyStore },
			customIdGenerator: () => "custom_id_001",
		});

		const created1 = await uk.createKey();
		expect(created1.error).toBeFalsy();
		expect(created1.result?.id).toBe("custom_id_001");

		const created2 = await uk.createKey({ id: "explicit_id_999" });
		expect(created2.error).toBeFalsy();
		expect(created2.result?.id).toBe("explicit_id_999");
	});
});

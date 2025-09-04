import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type AnalyticsAdapter,
	KEY,
	MemoryKeyStore,
	UsefulKey,
	usefulkey,
} from "../../../src";
import { configureCryptoProvider, hashSha256 } from "../../../src/utils/crypto";

class InMemoryAnalytics implements AnalyticsAdapter {
	public events: { event: string; payload: Record<string, unknown> }[] = [];
	async track(event: string, payload: Record<string, unknown>): Promise<void> {
		this.events.push({ event, payload });
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

describe("UsefulKey core", () => {
	it("createKey produces prefixed keys and respects kind", async () => {
		const uk = new UsefulKey({}, []);

		const created1 = await uk.createKey({
			keyKind: KEY.URLSafe(10, "acme"),
		});
		expect(created1.error).toBeFalsy();
		expect(created1.result!.key.startsWith("acme_")).toBe(true);

		const created2 = await uk.createKey({ keyKind: KEY.HEX(8) });
		expect(created2.error).toBeFalsy();
		const body2 = created2.result!.key.split("_")[1];
		expect(body2).toHaveLength(8);
	});

	it("applies defaults for keyPrefix and defaultKeyKind", async () => {
		const uk = usefulkey({});
		const created = await uk.createKey();
		expect(created.error).toBeFalsy();
		const key = created.result!.key;
		expect(key.startsWith("uk_")).toBe(true);
		const body = key.slice(3); // 'uk_'
		expect(body).toHaveLength(40);
	});

	it("creates and verifies a key, tracking analytics", async () => {
		const analytics = new InMemoryAnalytics();
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey(
			{
				adapters: { keyStore, analytics },
			},
			{},
		);

		const created = await uk.createKey();
		expect(created.error).toBeFalsy();
		expect(created.result?.key.startsWith("uk_")).toBe(true);
		expect(created.result?.id).toBeTruthy();

		const res = await uk.verifyKey({
			key: created.result!.key,
		});

		expect(res.error).toBeFalsy();
		expect(res.result?.valid).toBe(true);
		expect(res.result?.keyId).toBe(created.result?.id);

		const events = analytics.events.map((e) => e.event);
		expect(events).toContain("key.created");
		expect(events).toContain("key.verified");
	});

	it("verifyKey auto-deletes expired keys when configured", async () => {
		const analytics = new InMemoryAnalytics();
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey({
			adapters: { keyStore, analytics },
			autoDeleteExpiredKeys: true,
		});

		const created = await uk.createKey({ expiresAt: Date.now() - 1 });
		const key = created.result!.key;
		const id = created.result!.id;

		const res = await uk.verifyKey({ key });
		expect(res.error).toBeFalsy();
		expect(res.result?.valid).toBe(false);
		expect(res.result?.reason).toBe("expired");

		const stillThere = await keyStore.findKeyById(id);
		expect(stillThere).toBeNull();
	});

	it("verifies a pre-inserted key (not created via API)", async () => {
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey({ adapters: { keyStore } });

		const plaintext = "uk_manual_aaaaaaaaaaaaaaaa";
		await keyStore.createKey({
			id: "key_manual",
			userId: "user_manual",
			prefix: "uk",
			keyHash: hashSha256(plaintext),
			createdAt: Date.now(),
			expiresAt: null,
			metadata: {},
			usesRemaining: null,
			revokedAt: null,
		});

		const verified = await uk.verifyKey({
			key: plaintext,
		});

		expect(verified.error).toBeFalsy();
		expect(verified.result?.valid).toBe(true);
		expect(verified.result?.keyId).toBe("key_manual");
		expect(verified.result?.userId).toBe("user_manual");
	});

	it("verify returns not_found for unknown key", async () => {
		const uk = usefulkey({});
		const bogus = "uk_aaaaaaaaaaaaaaaa";
		const res = await uk.verifyKey({ key: bogus });
		expect(res.error).toBeFalsy();
		expect(res.result?.valid).toBe(false);
		expect(res.result?.reason).toBe("not_found");
	});

	it("respects expiration and revoked states", async () => {
		const analytics = new InMemoryAnalytics();
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey({ adapters: { keyStore, analytics } }, {});

		// expired
		const created3 = await uk.createKey({
			expiresAt: Date.now() - 1,
		});
		const expired = await uk.verifyKey({ key: created3.result!.key });
		expect(expired.error).toBeFalsy();
		expect(expired.result?.valid).toBe(false);
		expect(expired.result?.reason).toBe("expired");

		// revoke
		const created4 = await uk.createKey();
		await uk.revokeKey(created4.result!.id);
		const revoked = await uk.verifyKey({ key: created4.result!.key });
		expect(revoked.error).toBeFalsy();
		expect(revoked.result?.valid).toBe(false);
		expect(revoked.result?.reason).toBe("revoked");
	});

	it("core usage limit check blocks when usesRemaining <= 0 without plugin", async () => {
		const uk = usefulkey({});
		const created5 = await uk.createKey({ usesRemaining: 0 });
		const res3 = await uk.verifyKey({ key: created5.result!.key });
		expect(res3.error).toBeFalsy();
		expect(res3.result?.valid).toBe(false);
		expect(res3.result?.reason).toBe("usage_exceeded");
	});
});

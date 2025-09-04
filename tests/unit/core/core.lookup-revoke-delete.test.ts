import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryKeyStore, usefulkey } from "../../../src";
import { configureCryptoProvider } from "../../../src/utils/crypto";

class InMemoryAnalytics {
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

describe("UsefulKey getKey/getKeyById and metadata", () => {
	it("stores metadata at creation and returns it via getKey and getKeyById", async () => {
		const analytics = new InMemoryAnalytics();
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey({
			adapters: { keyStore, analytics },
		});

		const metadata = {
			role: "admin",
			plan: "pro",
			flags: { beta: true },
		} as const;
		const created = await uk.createKey({ userId: "user_meta", metadata });
		expect(created.error).toBeFalsy();
		const key = created.result!.key;
		const id = created.result!.id;

		const byKey = await uk.getKey(key);
		expect(byKey.error).toBeFalsy();
		expect(byKey.result?.id).toBe(id);
		expect(byKey.result?.userId).toBe("user_meta");
		expect(byKey.result?.metadata).toEqual(metadata);
		expect(byKey.result?.revokedAt).toBeNull();

		const byId = await uk.getKeyById(id);
		expect(byId.error).toBeFalsy();
		expect(byId.result?.id).toBe(id);
		expect(byId.result?.metadata).toEqual(metadata);
	});

	it("returns null for unknown key or id", async () => {
		const uk = usefulkey({});

		const resKey = await uk.getKey("uk_unknown_token_aaaaaaaa");
		expect(resKey.error).toBeFalsy();
		expect(resKey.result).toBeNull();

		const resId = await uk.getKeyById("nonexistent_id");
		expect(resId.error).toBeFalsy();
		expect(resId.result).toBeNull();
	});

	it("revokeKey marks the record revoked and verifyKey reports revoked", async () => {
		const analytics = new InMemoryAnalytics();
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey({
			adapters: { keyStore, analytics },
		});

		const created = await uk.createKey({ userId: "u" });
		const key = created.result!.key;
		const id = created.result!.id;

		const before = await uk.getKey(key);
		expect(before.error).toBeFalsy();
		expect(before.result?.revokedAt).toBeNull();

		const revoked = await uk.revokeKey(id);
		expect(revoked.error).toBeFalsy();

		const after = await uk.getKey(key);
		expect(after.error).toBeFalsy();
		expect(after.result?.revokedAt).not.toBeNull();

		const verified = await uk.verifyKey({ key });
		expect(verified.error).toBeFalsy();
		expect(verified.result?.valid).toBe(false);
		expect(verified.result?.reason).toBe("revoked");
	});

	it("autoDeleteExpiredKeys hard-deletes expired keys on access (getKey and getKeyById)", async () => {
		const analytics = new InMemoryAnalytics();
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey({
			adapters: { keyStore, analytics },
			autoDeleteExpiredKeys: true,
		});

		const expired1 = await uk.createKey({
			userId: "u",
			expiresAt: Date.now() - 1,
		});
		const expired2 = await uk.createKey({
			userId: "u",
			expiresAt: Date.now() - 1,
		});
		expect(expired1.error).toBeFalsy();
		expect(expired2.error).toBeFalsy();

		const byKey = await uk.getKey(expired1.result!.key);
		expect(byKey.error).toBeFalsy();
		expect(byKey.result).toBeNull();
		const stillThere1 = await keyStore.findKeyById(expired1.result!.id);
		expect(stillThere1).toBeNull();

		const byId = await uk.getKeyById(expired2.result!.id);
		expect(byId.error).toBeFalsy();
		expect(byId.result).toBeNull();
		const stillThere2 = await keyStore.findKeyById(expired2.result!.id);
		expect(stillThere2).toBeNull();
	});

	it("expired keys still returned by getKey/getKeyById when autoDeleteExpiredKeys is false", async () => {
		const analytics = new InMemoryAnalytics();
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey({
			adapters: { keyStore, analytics },
			autoDeleteExpiredKeys: false,
		});

		const created = await uk.createKey({
			userId: "u",
			expiresAt: Date.now() - 1,
		});
		expect(created.error).toBeFalsy();

		const byKey = await uk.getKey(created.result!.key);
		expect(byKey.error).toBeFalsy();
		expect(byKey.result?.id).toBe(created.result!.id);
		expect(byKey.result?.expiresAt).not.toBeNull();

		const byId = await uk.getKeyById(created.result!.id);
		expect(byId.error).toBeFalsy();
		expect(byId.result?.id).toBe(created.result!.id);
		expect(byId.result?.expiresAt).not.toBeNull();
	});

	it("hardRemoveKey permanently deletes and emits analytics", async () => {
		class InMemoryAnalytics {
			public events: { event: string; payload: Record<string, unknown> }[] = [];
			async track(
				event: string,
				payload: Record<string, unknown>,
			): Promise<void> {
				this.events.push({ event, payload });
			}
		}
		const analytics = new InMemoryAnalytics();
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey({ adapters: { keyStore, analytics } });

		const created = await uk.createKey();
		const id = created.result!.id;

		const res = await uk.hardRemoveKey(id);
		expect(res.error).toBeFalsy();
		const after = await keyStore.findKeyById(id);
		expect(after).toBeNull();

		const events = analytics.events.map((e) => e.event);
		expect(events).toContain("key.hard_removed");
	});

	it("extendKeyExpiry adds time relative to current or now() and emits analytics", async () => {
		const analytics = new InMemoryAnalytics();
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey({ adapters: { keyStore, analytics } });

		const created = await uk.createKey({ userId: "u" });
		expect(created.error).toBeFalsy();
		const id = created.result!.id;
		const before = await uk.getKeyById(id);
		expect(before.result?.expiresAt).toBeNull();

		const delta = 7 * 24 * 60 * 60 * 1000;
		const ext1 = await uk.extendKeyExpiry(id, delta);
		expect(ext1.error).toBeFalsy();
		expect(typeof ext1.result?.expiresAt).toBe("number");
		const after1 = await uk.getKeyById(id);
		expect(after1.result?.expiresAt).toBe(ext1.result?.expiresAt);

		const ext2 = await uk.extendKeyExpiry(id, delta);
		expect(ext2.error).toBeFalsy();
		expect(ext2.result!.expiresAt).toBe(ext1.result!.expiresAt + delta);

		const events = analytics.events.map((e) => e.event);
		expect(events).toContain("key.expiry_extended");
	});

	it("sweepExpired removes expired keys", async () => {
		const analytics = new InMemoryAnalytics();
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey({ adapters: { keyStore, analytics } });

		const expiredA = await uk.createKey({
			id: "exA",
			userId: "u",
			expiresAt: Date.now() - 1000,
		});
		const expiredB = await uk.createKey({
			id: "exB",
			userId: "u",
			expiresAt: Date.now() - 5000,
		});
		const valid = await uk.createKey({
			id: "okC",
			userId: "u",
			expiresAt: Date.now() + 1000,
		});

		const res = await uk.sweepExpired({
			batchSize: 10,
			olderThan: Date.now(),
		});
		expect(res.error).toBeFalsy();

		const a = await keyStore.findKeyById(expiredA.result!.id);
		const b = await keyStore.findKeyById(expiredB.result!.id);
		expect(a).toBeNull();
		expect(b).toBeNull();

		const v = await keyStore.findKeyById(valid.result!.id);
		expect(v).not.toBeNull();

		const events = analytics.events.map((e) => e.event);
		expect(events).toContain("keys.expired_swept");
	});

	it("revokeKey emits analytics event", async () => {
		class InMemoryAnalytics {
			public events: { event: string; payload: Record<string, unknown> }[] = [];
			async track(
				event: string,
				payload: Record<string, unknown>,
			): Promise<void> {
				this.events.push({ event, payload });
			}
		}
		const analytics = new InMemoryAnalytics();
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey({ adapters: { keyStore, analytics } });

		const created = await uk.createKey({ userId: "u" });
		const id = created.result!.id;
		const revoked = await uk.revokeKey(id);
		expect(revoked.error).toBeFalsy();

		const events = analytics.events.map((e) => e.event);
		expect(events).toContain("key.revoked");
	});
});

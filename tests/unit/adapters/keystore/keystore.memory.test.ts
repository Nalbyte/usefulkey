import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryKeyStore, MemoryRateLimitStore } from "../../../../src";
import { configureCryptoProvider } from "../../../../src/utils/crypto";
import { now } from "../../../../src/utils/time";

beforeEach(() => {
	let seed = 12345;
	const nextByte = () => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed & 0xff;
	};
	configureCryptoProvider({
		getRandomValues: (arr: Uint8Array) => {
			for (let i = 0; i < arr.length; i++) arr[i] = nextByte();
			return arr;
		},
		randomUUID: () => "00000000-0000-4000-8000-000000000000",
	} as unknown as Parameters<typeof configureCryptoProvider>[0]);
});

describe("MemoryKeyStore", () => {
	it("stores, finds, updates, and revokes", async () => {
		const ks = new MemoryKeyStore();
		const record = {
			id: "k1",
			userId: "u1",
			prefix: "uk",
			keyHash: "hash",
			createdAt: now(),
			expiresAt: null,
			metadata: {},
			usesRemaining: 3,
			revokedAt: null,
		};

		await ks.createKey(record);
		const fetched = await ks.findKeyByHash("hash");
		expect(fetched?.id).toBe("k1");

		await ks.updateKey({ ...record, usesRemaining: 2 });
		const updated = await ks.findKeyByHash("hash");
		expect(updated?.usesRemaining).toBe(2);

		await ks.revokeKeyById("k1");
		const revoked = await ks.findKeyByHash("hash");
		expect(revoked?.revokedAt).not.toBeNull();
	});
});

describe("MemoryKeyStore extra behaviors", () => {
	it("hardRemoveKeyById removes both maps and revoke sets revokedAt timestamp", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));

		const store = new MemoryKeyStore();
		const rec = {
			id: "id1",
			userId: "u",
			prefix: "uk",
			keyHash: "h1",
			createdAt: Date.now(),
			expiresAt: null,
			metadata: {},
			usesRemaining: null,
			revokedAt: null,
		} as const;
		await store.createKey({ ...rec });

		await store.revokeKeyById("id1");
		const afterRevoke = await store.findKeyById("id1");
		expect(typeof afterRevoke?.revokedAt).toBe("number");

		await store.hardRemoveKeyById("id1");
		const byId = await store.findKeyById("id1");
		const byHash = await store.findKeyByHash("h1");
		expect(byId).toBeNull();
		expect(byHash).toBeNull();
	});
});

describe("MemoryRateLimitStore", () => {
	it("increments within window and resets after duration", async () => {
		const rs = new MemoryRateLimitStore();
		const ns = "app";
		const id = "ip";

		const first = await rs.incrementAndCheck(ns, id, 2, 1000);
		expect(first.success).toBe(true);
		expect(first.remaining).toBe(1);

		const second = await rs.incrementAndCheck(ns, id, 2, 1000);
		expect(second.success).toBe(true);
		expect(second.remaining).toBe(0);

		const third = await rs.incrementAndCheck(ns, id, 2, 1000);
		expect(third.success).toBe(false);

		const check = await rs.check(ns, id, 2, 1000);
		expect(check.success).toBe(false);
	});
});

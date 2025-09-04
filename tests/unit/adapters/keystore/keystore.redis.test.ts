import { describe, expect, it } from "vitest";
import { RedisKeyStore } from "../../../../src";

describe("RedisKeyStore adapter edge cases", () => {
	it("throws when hSet/hset missing on createKey", async () => {
		const ks = new RedisKeyStore({} as unknown as Record<string, unknown>);
		await expect(
			ks.createKey({
				id: "id",
				userId: "u",
				prefix: "uk",
				keyHash: "hash",
				createdAt: 1,
				expiresAt: null,
				metadata: {},
				usesRemaining: null,
				revokedAt: null,
			}),
		).rejects.toThrow(/hSet\/hset/i);
	});

	it("throws when get missing on findKeyByHash", async () => {
		const ks = new RedisKeyStore({ hSet: async () => {} } as unknown as Record<
			string,
			unknown
		>);
		await expect(ks.findKeyByHash("h")).rejects.toThrow(/must support get/i);
	});

	it("throws when hGetAll missing on findKeyById", async () => {
		const ks = new RedisKeyStore({ get: async () => "id" } as unknown as Record<
			string,
			unknown
		>);
		await expect(ks.findKeyById("id")).rejects.toThrow(/hGetAll\/hgetall/i);
	});

	it("deserialize handles invalid JSON metadata gracefully", async () => {
		const client = {
			async hGetAll() {
				return {
					id: "id",
					userId: "u",
					prefix: "uk",
					keyHash: "hash",
					createdAt: "1",
					expiresAt: "",
					metadata: "{invalid}",
					usesRemaining: "",
					revokedAt: "",
				} as Record<string, unknown>;
			},
		} as Record<string, unknown>;
		const ks = new RedisKeyStore(client);
		const rec = await ks.findKeyById("id");
		expect(rec?.metadata).toBeUndefined();
		expect(rec?.usesRemaining).toBeNull();
		expect(rec?.revokedAt).toBeNull();
	});

	it("updateKey maintains hash->id mapping via set", async () => {
		let setCalled = false;
		const client = {
			async hSet() {},
			async set() {
				setCalled = true;
			},
		} as Record<string, unknown>;
		const ks = new RedisKeyStore(client);
		await ks.updateKey({
			id: "id",
			userId: "u",
			prefix: "uk",
			keyHash: "hash2",
			createdAt: 1,
			expiresAt: null,
			metadata: {},
			usesRemaining: null,
			revokedAt: null,
		});
		expect(setCalled).toBe(true);
	});

	it("revokeKeyById sets revokedAt using hset", async () => {
		let payload: Record<string, unknown> | null = null;
		const client = {
			async hSet(_key: string, data: Record<string, unknown>) {
				payload = data;
			},
		} as Record<string, unknown>;
		const ks = new RedisKeyStore(client);
		await ks.revokeKeyById("id");
		// hset helper stringifies values; ensure string convertible to number
		expect(payload).not.toBeNull();
		expect(typeof payload!.revokedAt).toBe("string");
		expect(Number(payload!.revokedAt)).toBeGreaterThan(0);
	});

	it("hardRemoveKeyById removes id and hash mapping; throws if del missing", async () => {
		const calls: string[] = [];
		const clientHappy = {
			async hSet() {},
			async set() {},
			async get(key: string) {
				if (key.includes("khash:")) return "rid";
				return null;
			},
			async hGetAll(_key: string) {
				return {
					id: "rid",
					userId: "u",
					prefix: "uk",
					keyHash: "hash",
					createdAt: "1",
					expiresAt: "",
					metadata: "",
					usesRemaining: "",
					revokedAt: "",
				} as any;
			},
			async del(key: string) {
				calls.push(key);
			},
		} as Record<string, unknown>;
		const ksHappy = new RedisKeyStore(clientHappy as any);
		await ksHappy.hardRemoveKeyById("rid");
		expect(calls.some((k) => k.includes(":key:rid"))).toBe(true);
		expect(calls.some((k) => k.includes(":khash:"))).toBe(true);

		const clientNoDel = {
			async hSet() {},
			async set() {},
			async hGetAll() {
				return {
					id: "rid",
					keyHash: "hash",
					prefix: "uk",
					userId: "u",
					createdAt: "1",
					expiresAt: "",
					metadata: "",
					usesRemaining: "",
					revokedAt: "",
				} as any;
			},
		} as Record<string, unknown>;
		const ksNoDel = new RedisKeyStore(clientNoDel as any);
		await expect(ksNoDel.hardRemoveKeyById("rid")).rejects.toThrow(/del/);

		let setCalled = false;
		const clientLower = {
			async hset() {},
			async set() {
				setCalled = true;
			},
		} as Record<string, unknown>;
		const ksLower = new RedisKeyStore(clientLower as any);
		await ksLower.createKey({
			id: "id",
			userId: "u",
			prefix: "uk",
			keyHash: "hash",
			createdAt: 1,
			expiresAt: null,
			metadata: {},
			usesRemaining: null,
			revokedAt: null,
		});
		expect(setCalled).toBe(true);
	});
});

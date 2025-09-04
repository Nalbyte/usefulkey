import { describe, expect, it } from "vitest";
import { SqliteKeyStore } from "../../../../src";

type Row = {
	id: string;
	user_id: string;
	prefix: string;
	key_hash: string;
	created_at: number;
	expires_at: number | null;
	metadata: string | null;
	uses_remaining: number | null;
	revoked_at: number | null;
};

function makeDb(withExec: boolean) {
	const byId = new Map<string, Row>();
	const byHash = new Map<string, string>();
	const db: any = {
		exec: withExec ? (_sql: string) => {} : undefined,
		prepare(sql: string) {
			const isInsert = /INSERT INTO/.test(sql);
			const isSelectByHash = /WHERE key_hash = \?/.test(sql);
			const isSelectById = /WHERE id = \?/.test(sql);
			const isUpdate = /^UPDATE/.test(sql);
			const isDelete = /^DELETE FROM/.test(sql);
			return {
				run(...args: unknown[]) {
					if (isInsert) {
						const [
							id,
							user_id,
							prefix,
							key_hash,
							created_at,
							expires_at,
							metadata,
							uses_remaining,
							revoked_at,
						] = args as any[];
						const row: Row = {
							id: String(id),
							user_id: String(user_id),
							prefix: String(prefix),
							key_hash: String(key_hash),
							created_at: Number(created_at),
							expires_at: expires_at == null ? null : Number(expires_at),
							metadata: metadata == null ? null : String(metadata),
							uses_remaining:
								uses_remaining == null ? null : Number(uses_remaining),
							revoked_at: revoked_at == null ? null : Number(revoked_at),
						};
						byId.set(row.id, row);
						byHash.set(row.key_hash, row.id);
					} else if (isUpdate) {
						if (/SET user_id/.test(sql)) {
							const [
								user_id,
								prefix,
								key_hash,
								created_at,
								expires_at,
								metadata,
								uses_remaining,
								revoked_at,
								id,
							] = args as any[];
							const row = byId.get(String(id))!;
							row.user_id = String(user_id);
							row.prefix = String(prefix);
							row.key_hash = String(key_hash);
							row.created_at = Number(created_at);
							row.expires_at = expires_at == null ? null : Number(expires_at);
							row.metadata = metadata == null ? null : String(metadata);
							row.uses_remaining =
								uses_remaining == null ? null : Number(uses_remaining);
							row.revoked_at = revoked_at == null ? null : Number(revoked_at);
							byHash.set(row.key_hash, row.id);
						} else if (/SET revoked_at/.test(sql)) {
							const [revoked_at, id] = args as any[];
							const row = byId.get(String(id))!;
							row.revoked_at = Number(revoked_at);
						}
					} else if (isDelete) {
						const [id] = args as any[];
						const row = byId.get(String(id));
						if (row) {
							byId.delete(row.id);
							byHash.delete(row.key_hash);
						}
					}
					return {};
				},
				get(...args: unknown[]) {
					if (isSelectByHash) {
						const [key_hash] = args as any[];
						const id = byHash.get(String(key_hash));
						if (!id) return undefined as any;
						return byId.get(id);
					}
					if (isSelectById) {
						const [id] = args as any[];
						return byId.get(String(id));
					}
					return undefined as any;
				},
			};
		},
	};
	return { db, byId, byHash };
}

describe("SqliteKeyStore adapter", () => {
	it("initializes with exec and performs CRUD correctly", async () => {
		const { db } = makeDb(true);
		const ks = new SqliteKeyStore(db as any);

		const record = {
			id: "k1",
			userId: "u1",
			prefix: "uk",
			keyHash: "h1",
			createdAt: 1,
			expiresAt: null,
			metadata: { a: 1 },
			usesRemaining: 5,
			revokedAt: null,
		} as const;
		await ks.createKey({ ...record });

		const byHash = await ks.findKeyByHash("h1");
		expect(byHash?.id).toBe("k1");
		expect(byHash?.metadata).toEqual({ a: 1 });

		const byId = await ks.findKeyById("k1");
		expect(byId?.userId).toBe("u1");

		await ks.updateKey({ ...record, usesRemaining: 3, metadata: { b: 2 } });
		const afterUpdate = await ks.findKeyById("k1");
		expect(afterUpdate?.usesRemaining).toBe(3);
		expect(afterUpdate?.metadata).toEqual({ b: 2 });

		await ks.revokeKeyById("k1");
		const revoked = await ks.findKeyById("k1");
		expect(typeof revoked?.revokedAt).toBe("number");
	});

	it("initializes without exec (split statements) and parses invalid metadata as undefined", async () => {
		const { db, byId } = makeDb(false);
		const ks = new SqliteKeyStore(db as any);

		byId.set("k2", {
			id: "k2",
			user_id: "u2",
			prefix: "uk",
			key_hash: "h2",
			created_at: 2,
			expires_at: null,
			metadata: "{invalid}",
			uses_remaining: null,
			revoked_at: null,
		});
		const rec = await ks.findKeyById("k2");
		expect(rec?.metadata).toBeUndefined();
	});

	it("hardRemoveKeyById deletes the row and breaks lookups", async () => {
		const { db } = makeDb(true);
		const ks = new SqliteKeyStore(db as any);
		await ks.createKey({
			id: "del1",
			userId: "u",
			prefix: "uk",
			keyHash: "hdel",
			createdAt: 1,
			expiresAt: null,
			metadata: {},
			usesRemaining: null,
			revokedAt: null,
		});
		const exist = await ks.findKeyByHash("hdel");
		expect(exist?.id).toBe("del1");
		await ks.hardRemoveKeyById("del1");
		const goneById = await ks.findKeyById("del1");
		expect(goneById).toBeNull();
		const goneByHash = await ks.findKeyByHash("hdel");
		expect(goneByHash).toBeNull();
	});
});

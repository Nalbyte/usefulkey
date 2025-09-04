import { describe, expect, it } from "vitest";
import { D1KeyStore } from "../../../../src";

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

function makeD1(withExec: boolean) {
	const byId = new Map<string, Row>();
	const byHash = new Map<string, string>();

	const d1: any = {
		exec: withExec ? async (_sql: string) => {} : undefined,
		prepare(sql: string) {
			const isInsert = /INSERT INTO/.test(sql);
			const isSelectByHash = /WHERE key_hash = \?/.test(sql);
			const isSelectById = /WHERE id = \?/.test(sql);
			const isUpdateFull = /^UPDATE/.test(sql) && /SET user_id/.test(sql);
			const isUpdateRevoke = /^UPDATE/.test(sql) && /SET revoked_at/.test(sql);
			const isDelete = /^DELETE FROM/.test(sql);

			return {
				bind(...args: unknown[]) {
					const boundArgs = args;
					return {
						async run() {
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
								] = boundArgs as any[];
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
							} else if (isUpdateFull) {
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
								] = boundArgs as any[];
								const row = byId.get(String(id));
								if (row) {
									row.user_id = String(user_id);
									row.prefix = String(prefix);

									byHash.delete(row.key_hash);
									row.key_hash = String(key_hash);
									byHash.set(row.key_hash, row.id);
									row.created_at = Number(created_at);
									row.expires_at =
										expires_at == null ? null : Number(expires_at);
									row.metadata = metadata == null ? null : String(metadata);
									row.uses_remaining =
										uses_remaining == null ? null : Number(uses_remaining);
									row.revoked_at =
										revoked_at == null ? null : Number(revoked_at);
								}
							} else if (isUpdateRevoke) {
								const [revoked_at, id] = boundArgs as any[];
								const row = byId.get(String(id));
								if (row) row.revoked_at = Number(revoked_at);
							} else if (isDelete) {
								const [id] = boundArgs as any[];
								const row = byId.get(String(id));
								if (row) {
									byId.delete(row.id);
									byHash.delete(row.key_hash);
								}
							}
							return {};
						},
						async first<T = Record<string, unknown>>() {
							if (isSelectByHash) {
								const [hash] = boundArgs as any[];
								const id = byHash.get(String(hash));
								const r = id
									? (byId.get(id) as any as T | undefined)
									: undefined;
								return (r ?? null) as T | null;
							}
							if (isSelectById) {
								const [id] = boundArgs as any[];
								return ((byId.get(String(id)) as any) ?? null) as T | null;
							}
							return null as T | null;
						},
						async all<T = Record<string, unknown>>() {
							const first = (await (this as any).first()) as T | null;
							return { results: first ? [first] : [] } as { results?: T[] };
						},
					};
				},
			};
		},
	};
	return { d1, byId, byHash };
}

describe("D1KeyStore adapter", () => {
	it("initializes (with or without exec) and performs CRUD including hard removal", async () => {
		const { d1 } = makeD1(false);
		const ks = new D1KeyStore(d1 as any);

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

		await ks.hardRemoveKeyById("k1");
		const gone = await ks.findKeyById("k1");
		expect(gone).toBeNull();
	});

	it("parses invalid metadata as undefined when reading", async () => {
		const { d1, byId } = makeD1(true);
		const ks = new D1KeyStore(d1 as any);
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

	it("read path works when driver exposes only all() (no first())", async () => {
		const byId = new Map<string, Row>();
		const byHash = new Map<string, string>();
		const d1AllOnly: any = {
			prepare(sql: string) {
				const isSelectByHash = /WHERE key_hash = \?/.test(sql);
				const isSelectById = /WHERE id = \?/.test(sql);
				return {
					bind(...args: unknown[]) {
						const boundArgs = args;
						return {
							async run() {
								return {};
							},
							async all<T = Record<string, unknown>>() {
								if (isSelectByHash) {
									const [hash] = boundArgs as any[];
									const id = byHash.get(String(hash));
									const r = id
										? (byId.get(id) as any as T | undefined)
										: undefined;
									return { results: r ? [r] : [] } as { results?: T[] };
								}
								if (isSelectById) {
									const [id] = boundArgs as any[];
									const r = byId.get(String(id));
									return { results: r ? [r as any as T] : [] } as {
										results?: T[];
									};
								}
								return { results: [] } as { results?: T[] };
							},
						};
					},
				};
			},
		};

		byId.set("k3", {
			id: "k3",
			user_id: "u3",
			prefix: "uk",
			key_hash: "h3",
			created_at: 3,
			expires_at: null,
			metadata: null,
			uses_remaining: null,
			revoked_at: null,
		});
		byHash.set("h3", "k3");

		const ks = new D1KeyStore(d1AllOnly as any);
		const recById = await ks.findKeyById("k3");
		expect(recById?.id).toBe("k3");
		const recByHash = await ks.findKeyByHash("h3");
		expect(recByHash?.id).toBe("k3");
	});
});

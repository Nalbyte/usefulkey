import { describe, expect, it } from "vitest";
import { PostgresKeyStore } from "../../../../src";

describe("PostgresKeyStore adapter (unit, fake client)", () => {
	function createFakePg(useJsonb: boolean) {
		type Row = {
			id: string;
			user_id: string | null;
			prefix: string;
			key_hash: string;
			created_at: number;
			expires_at: number | null;
			metadata: string | null | Record<string, unknown>;
			uses_remaining: number | null;
			revoked_at: number | null;
		};
		const byId = new Map<string, Row>();
		const byHash = new Map<string, string>();

		const client = {
			async query(text: string, values?: any[]) {
				if (/^CREATE /i.test(text)) return { rows: [], rowCount: 0 } as any;
				if (/^INSERT /i.test(text)) {
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
					] = values as any[];
					const row: Row = {
						id: String(id),
						user_id: user_id == null ? null : String(user_id),
						prefix: String(prefix),
						key_hash: String(key_hash),
						created_at: Number(created_at),
						expires_at: expires_at == null ? null : Number(expires_at),
						metadata: useJsonb
							? metadata == null
								? null
								: JSON.parse(String(metadata))
							: metadata == null
								? null
								: String(metadata),
						uses_remaining:
							uses_remaining == null ? null : Number(uses_remaining),
						revoked_at: revoked_at == null ? null : Number(revoked_at),
					};
					byId.set(row.id, row);
					byHash.set(row.key_hash, row.id);
					return { rows: [], rowCount: 1 } as any;
				}
				if (/^SELECT /i.test(text)) {
					if (/WHERE key_hash = \$1/i.test(text)) {
						const id = byHash.get(String(values?.[0])) ?? null;
						const r = id ? byId.get(id) : null;
						return { rows: r ? [r] : [], rowCount: r ? 1 : 0 } as any;
					}
					if (/WHERE id = \$1/i.test(text)) {
						const r = byId.get(String(values?.[0])) ?? null;
						return { rows: r ? [r] : [], rowCount: r ? 1 : 0 } as any;
					}
					return { rows: [], rowCount: 0 } as any;
				}
				if (/^UPDATE /i.test(text) && /SET user_id/i.test(text)) {
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
					] = values as any[];
					const row = byId.get(String(id));
					if (row) {
						row.user_id = user_id == null ? null : String(user_id);
						row.prefix = String(prefix);
						// maintain hash mapping
						byHash.delete(row.key_hash);
						row.key_hash = String(key_hash);
						byHash.set(row.key_hash, row.id);
						row.created_at = Number(created_at);
						row.expires_at = expires_at == null ? null : Number(expires_at);
						row.metadata = useJsonb
							? metadata == null
								? null
								: JSON.parse(String(metadata))
							: metadata == null
								? null
								: String(metadata);
						row.uses_remaining =
							uses_remaining == null ? null : Number(uses_remaining);
						row.revoked_at = revoked_at == null ? null : Number(revoked_at);
					}
					return { rows: [], rowCount: row ? 1 : 0 } as any;
				}
				if (/^UPDATE /i.test(text) && /SET revoked_at/i.test(text)) {
					const [revoked_at, id] = values as any[];
					const row = byId.get(String(id));
					if (row) row.revoked_at = Number(revoked_at);
					return { rows: [], rowCount: row ? 1 : 0 } as any;
				}
				if (/^DELETE /i.test(text)) {
					const [id] = values as any[];
					const row = byId.get(String(id));
					if (row) {
						byId.delete(row.id);
						byHash.delete(row.key_hash);
					}
					return { rows: [], rowCount: row ? 1 : 0 } as any;
				}
				return { rows: [], rowCount: 0 } as any;
			},
		} as unknown as {
			query: (
				text: string,
				values?: unknown[],
			) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>;
		};

		return { client, byId, byHash } as const;
	}

	it("full CRUD with text metadata and invalid parse returns undefined", async () => {
		const { client, byId } = createFakePg(false);
		const ks = new PostgresKeyStore(client, { useJsonbMetadata: false });
		const rec = {
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
		await ks.createKey({ ...rec });
		const byHash = await ks.findKeyByHash("h1");
		expect(byHash?.id).toBe("k1");
		const byIdRec = await ks.findKeyById("k1");
		expect(byIdRec?.userId).toBe("u1");
		await ks.updateKey({ ...rec, usesRemaining: 3, metadata: { b: 2 } });
		const afterUpd = await ks.findKeyById("k1");
		expect(afterUpd?.usesRemaining).toBe(3);
		expect(afterUpd?.metadata).toEqual({ b: 2 });
		await ks.revokeKeyById("k1");
		const revoked = await ks.findKeyById("k1");
		expect(typeof revoked?.revokedAt).toBe("number");

		const row = byId.get("k1")!;
		(row as any).metadata = "{invalid}";
		const afterParse = await ks.findKeyById("k1");
		expect(afterParse?.metadata).toBeUndefined();
		await ks.hardRemoveKeyById("k1");
		const gone = await ks.findKeyById("k1");
		expect(gone).toBeNull();
	});

	it("JSONB metadata mode serializes and parses JSON correctly", async () => {
		const { client } = createFakePg(true);
		const ks = new PostgresKeyStore(client, { useJsonbMetadata: true });
		await ks.createKey({
			id: "k2",
			userId: null,
			prefix: "uk",
			keyHash: "h2",
			createdAt: 2,
			expiresAt: null,
			metadata: { ok: true },
			usesRemaining: null,
			revokedAt: null,
		});
		const rec = await ks.findKeyByHash("h2");
		expect(rec?.metadata).toEqual({ ok: true });
	});
});

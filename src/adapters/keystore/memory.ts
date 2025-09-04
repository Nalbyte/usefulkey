/**
 * In‑memory keystore adapter.
 *
 * Intended for tests, examples, and ephemeral environments. Stores `KeyRecord`s
 * in local `Map`s keyed by hash and by id.
 */
import type { KeyId, KeyRecord, KeyStoreAdapter } from "../../types/common";
import { now } from "../../utils/time";

export class MemoryKeyStore implements KeyStoreAdapter {
	readonly ready?: Promise<void>;
	private readonly keyHashToRecord = new Map<string, KeyRecord>();
	private readonly idToRecord = new Map<string, KeyRecord>();

	/** Persist a new record in both maps. */
	async createKey(record: KeyRecord): Promise<void> {
		this.keyHashToRecord.set(record.keyHash, record);
		this.idToRecord.set(record.id, record);
	}

	/** Retrieve a record by its key hash. */
	async findKeyByHash(keyHash: string): Promise<KeyRecord | null> {
		return this.keyHashToRecord.get(keyHash) ?? null;
	}

	/** Retrieve a record by its id. */
	async findKeyById(id: KeyId): Promise<KeyRecord | null> {
		return this.idToRecord.get(id) ?? null;
	}

	/** Upsert the record in both maps. */
	async updateKey(record: KeyRecord): Promise<void> {
		this.keyHashToRecord.set(record.keyHash, record);
		this.idToRecord.set(record.id, record);
	}

	/** Mark a record as revoked with current timestamp. */
	async revokeKeyById(id: KeyId): Promise<void> {
		const record = this.idToRecord.get(id);
		if (record) {
			record.revokedAt = now();
			this.idToRecord.set(id, record);
			this.keyHashToRecord.set(record.keyHash, record);
		}
	}

	/** Remove a record from both maps. */
	async hardRemoveKeyById(id: KeyId): Promise<void> {
		const record = this.idToRecord.get(id);
		if (!record) return;
		this.idToRecord.delete(id);
		this.keyHashToRecord.delete(record.keyHash);
	}

	/**
	 * Return up to `limit` ids that are expired at or before `olderThan`.
	 */
	async findExpiredIds(olderThan: number, limit: number): Promise<KeyId[]> {
		const out: KeyId[] = [];
		for (const r of Array.from(this.idToRecord.values())) {
			if (r.expiresAt != null && r.expiresAt <= olderThan) {
				out.push(r.id);
				if (out.length >= limit) break;
			}
		}
		return out;
	}
}

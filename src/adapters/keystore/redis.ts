/**
 * Redis-backed keystore adapter.
 *
 * Stores records in a Redis hash keyed by id and maintains a secondary mapping
 * from key hash to id for efficient lookups by plaintext key.
 */
import type { KeyId, KeyRecord, KeyStoreAdapter } from "../../types/common";
import { now } from "../../utils/time";

export class RedisKeyStore implements KeyStoreAdapter {
	private readonly keyPrefix: string;
	readonly ready?: Promise<void>;

	constructor(
		private readonly client: any,
		options?: { keyPrefix?: string },
	) {
		this.keyPrefix = options?.keyPrefix ?? "usefulkey";
		this.ready = this.initialize();
	}

	private async initialize(): Promise<void> {
		if (this.client.ping) {
			await this.client.ping();
			return;
		}
		if (this.client.set && this.client.get) {
			const k = `${this.keyPrefix}:__uk_ping__`;
			await this.client.set(k, "1");
			await this.client.get(k);
			return;
		}
	}

	private recordKey(id: string): string {
		return `${this.keyPrefix}:key:${id}`;
	}

	private hashToIdKey(keyHash: string): string {
		return `${this.keyPrefix}:khash:${keyHash}`;
	}

	private async hset(
		key: string,
		data: Record<string, unknown>,
	): Promise<void> {
		const entries: [string, string][] = Object.entries(data).map(([k, v]) => [
			k,
			v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v),
		]);
		if (this.client.hSet) {
			await this.client.hSet(key, Object.fromEntries(entries));
			return;
		}
		if (this.client.hset) {
			await this.client.hset(key, Object.fromEntries(entries));
			return;
		}
		throw new Error("Redis client must support hSet/hset");
	}

	private async hgetall(key: string): Promise<Record<string, string>> {
		if (this.client.hGetAll) {
			return ((await this.client.hGetAll(key)) ?? {}) as Record<string, string>;
		}
		if (this.client.hgetall) {
			return ((await this.client.hgetall(key)) ?? {}) as Record<string, string>;
		}
		throw new Error("Redis client must support hGetAll/hgetall");
	}

	async createKey(record: KeyRecord): Promise<void> {
		const idKey = this.recordKey(record.id);
		const hashKey = this.hashToIdKey(record.keyHash);
		await this.hset(idKey, {
			id: record.id,
			userId: record.userId,
			prefix: record.prefix,
			keyHash: record.keyHash,
			createdAt: record.createdAt,
			expiresAt: record.expiresAt ?? "",
			metadata: record.metadata ? JSON.stringify(record.metadata) : "",
			usesRemaining: record.usesRemaining ?? "",
			revokedAt: record.revokedAt ?? "",
		});
		if (!this.client.set) {
			throw new Error("Redis client must support set");
		}
		await this.client.set(hashKey, record.id);
	}

	async findKeyByHash(keyHash: string): Promise<KeyRecord | null> {
		if (!this.client.get) {
			throw new Error("Redis client must support get");
		}
		const id = await this.client.get(this.hashToIdKey(keyHash));
		if (!id) return null;
		return this.findKeyById(String(id));
	}

	async findKeyById(id: KeyId): Promise<KeyRecord | null> {
		const raw = await this.hgetall(this.recordKey(id));
		if (!raw || Object.keys(raw).length === 0) return null;
		return this.deserialize(raw);
	}

	async updateKey(record: KeyRecord): Promise<void> {
		const idKey = this.recordKey(record.id);
		await this.hset(idKey, {
			id: record.id,
			userId: record.userId,
			prefix: record.prefix,
			keyHash: record.keyHash,
			createdAt: record.createdAt,
			expiresAt: record.expiresAt ?? "",
			metadata: record.metadata ? JSON.stringify(record.metadata) : "",
			usesRemaining: record.usesRemaining ?? "",
			revokedAt: record.revokedAt ?? "",
		});
		if (!this.client.set) {
			throw new Error("Redis client must support set");
		}
		await this.client.set(this.hashToIdKey(record.keyHash), record.id);
	}

	async revokeKeyById(id: KeyId): Promise<void> {
		const idKey = this.recordKey(id);
		await this.hset(idKey, { revokedAt: now() });
	}

	async hardRemoveKeyById(id: KeyId): Promise<void> {
		const idKey = this.recordKey(id);
		const record = await this.hgetall(idKey);
		const keyHash = record?.keyHash as string | undefined;
		if (keyHash && this.client.del) {
			await this.client.del(this.hashToIdKey(keyHash));
		}
		if (!this.client.del) {
			throw new Error("Redis client must support del for hard removal");
		}
		await this.client.del(idKey);
	}

	async findExpiredIds(olderThan: number, limit: number): Promise<KeyId[]> {
		const ids: KeyId[] = [];
		const prefix = `${this.keyPrefix}:key:`;
		const keysCmd = (this.client as any).keys;
		if (!keysCmd) return ids;
		const keys = await keysCmd(`${prefix}*`);
		for (const k of keys) {
			const raw = await this.hgetall(k);
			const exp = raw?.expiresAt ? Number(raw.expiresAt) : NaN;
			if (!Number.isNaN(exp) && exp <= olderThan) {
				const id = String(raw.id ?? k.slice(prefix.length));
				ids.push(id);
				if (ids.length >= limit) break;
			}
		}
		return ids;
	}

	private deserialize(raw: Record<string, string>): KeyRecord {
		const parseMaybeNumber = (v: string | undefined): number | null => {
			if (v == null || v === "") return null;
			const n = Number(v);
			return Number.isNaN(n) ? null : n;
		};
		const parseMaybeString = (v: string | undefined): string | null => {
			return v == null || v === "" ? null : String(v);
		};
		const parseMaybeJson = (
			v: string | undefined,
		): Record<string, unknown> | undefined => {
			if (!v) return undefined;
			try {
				const parsed = JSON.parse(v);
				return typeof parsed === "object" && parsed != null
					? parsed
					: undefined;
			} catch {
				return undefined;
			}
		};
		return {
			id: String(raw.id),
			userId: parseMaybeString(raw.userId),
			prefix: String(raw.prefix),
			keyHash: String(raw.keyHash),
			createdAt: Number(raw.createdAt),
			expiresAt: parseMaybeNumber(raw.expiresAt),
			metadata: parseMaybeJson(raw.metadata),
			usesRemaining: parseMaybeNumber(raw.usesRemaining),
			revokedAt: parseMaybeNumber(raw.revokedAt),
		};
	}
}

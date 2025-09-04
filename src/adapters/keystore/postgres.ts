/**
 * Postgres-backed keystore adapter.
 *
 * Stores `KeyRecord`s in a single table with optional JSONB metadata. Creates
 * the table and indexes if they do not exist.
 */
import type { PgLikeClient } from "../../types/adapters";
import type { KeyId, KeyRecord, KeyStoreAdapter } from "../../types/common";
import { now } from "../../utils/time";

export class PostgresKeyStore implements KeyStoreAdapter {
	private readonly tableName: string;
	private readonly useJsonbMetadata: boolean;
	readonly ready?: Promise<void>;

	constructor(
		private readonly client: PgLikeClient,
		options?: { tableName?: string; useJsonbMetadata?: boolean },
	) {
		this.tableName = options?.tableName ?? "usefulkey_keys";
		this.useJsonbMetadata = options?.useJsonbMetadata ?? false;
		this.ready = this.initialize();
	}

	private async initialize(): Promise<void> {
		await this.client.query("SELECT 1");

		await this.client.query(
			`CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        prefix TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        created_at BIGINT NOT NULL,
        expires_at BIGINT,
        metadata ${this.useJsonbMetadata ? "JSONB" : "TEXT"},
        uses_remaining INTEGER,
        revoked_at BIGINT
      )`,
		);
		await this.client.query(
			`CREATE INDEX IF NOT EXISTS idx_${this.tableName}_user_id ON ${this.tableName}(user_id)`,
		);
		await this.client.query(
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_${this.tableName}_key_hash ON ${this.tableName}(key_hash)`,
		);
	}

	async createKey(record: KeyRecord): Promise<void> {
		await this.client.query(
			`INSERT INTO ${this.tableName} (
        id, user_id, prefix, key_hash, created_at, expires_at, metadata, uses_remaining, revoked_at
      ) VALUES ($1, $2, $3, $4, $5, $6, ${this.useJsonbMetadata ? "$7::jsonb" : "$7"}, $8, $9)`,
			[
				record.id,
				record.userId,
				record.prefix,
				record.keyHash,
				record.createdAt,
				record.expiresAt ?? null,
				record.metadata ? JSON.stringify(record.metadata) : null,
				record.usesRemaining ?? null,
				record.revokedAt ?? null,
			],
		);
	}

	async findKeyByHash(keyHash: string): Promise<KeyRecord | null> {
		const res = (await this.client.query(
			`SELECT id, user_id, prefix, key_hash, created_at, expires_at, metadata, uses_remaining, revoked_at
       FROM ${this.tableName} WHERE key_hash = $1 LIMIT 1`,
			[keyHash],
		)) as { rows?: Array<Record<string, unknown>> };
		const row = res.rows?.[0];
		if (!row) return null;
		return this.rowToRecord(row);
	}

	async findKeyById(id: KeyId): Promise<KeyRecord | null> {
		const res = (await this.client.query(
			`SELECT id, user_id, prefix, key_hash, created_at, expires_at, metadata, uses_remaining, revoked_at
       FROM ${this.tableName} WHERE id = $1 LIMIT 1`,
			[id],
		)) as { rows?: Array<Record<string, unknown>> };
		const row = res.rows?.[0];
		if (!row) return null;
		return this.rowToRecord(row);
	}

	async updateKey(record: KeyRecord): Promise<void> {
		await this.client.query(
			`UPDATE ${this.tableName}
       SET user_id = $1, prefix = $2, key_hash = $3, created_at = $4, expires_at = $5, metadata = ${this.useJsonbMetadata ? "$6::jsonb" : "$6"}, uses_remaining = $7, revoked_at = $8
       WHERE id = $9`,
			[
				record.userId,
				record.prefix,
				record.keyHash,
				record.createdAt,
				record.expiresAt ?? null,
				record.metadata ? JSON.stringify(record.metadata) : null,
				record.usesRemaining ?? null,
				record.revokedAt ?? null,
				record.id,
			],
		);
	}

	async revokeKeyById(id: KeyId): Promise<void> {
		const revokedAt = now();
		await this.client.query(
			`UPDATE ${this.tableName} SET revoked_at = $1 WHERE id = $2`,
			[revokedAt, id],
		);
	}

	async hardRemoveKeyById(id: KeyId): Promise<void> {
		await this.client.query(`DELETE FROM ${this.tableName} WHERE id = $1`, [
			id,
		]);
	}

	async findExpiredIds(olderThan: number, limit: number): Promise<KeyId[]> {
		const res = (await this.client.query(
			`SELECT id FROM ${this.tableName} WHERE expires_at IS NOT NULL AND expires_at <= $1 LIMIT $2`,
			[olderThan, limit],
		)) as { rows?: Array<Record<string, unknown>> };
		return (res.rows ?? []).map((r) => String(r.id as string));
	}

	private rowToRecord(row: Record<string, unknown>): KeyRecord {
		const rawMeta = row.metadata as unknown;
		let metadata: Record<string, unknown> | undefined;
		if (rawMeta == null) {
			metadata = undefined;
		} else if (typeof rawMeta === "object") {
			metadata = rawMeta as Record<string, unknown>;
		} else if (typeof rawMeta === "string") {
			metadata = this.safeParseJsonString(rawMeta);
		}

		return {
			id: String(row.id as string),
			userId:
				(row.user_id as string | null | undefined) == null
					? null
					: String(row.user_id as string),
			prefix: String(row.prefix as string),
			keyHash: String(row.key_hash as string),
			createdAt: Number(row.created_at as number),
			expiresAt:
				(row.expires_at as number | null | undefined) == null
					? null
					: Number(row.expires_at as number),
			metadata,
			usesRemaining:
				(row.uses_remaining as number | null | undefined) == null
					? null
					: Number(row.uses_remaining as number),
			revokedAt:
				(row.revoked_at as number | null | undefined) == null
					? null
					: Number(row.revoked_at as number),
		};
	}

	private safeParseJsonString(
		input: string,
	): Record<string, unknown> | undefined {
		try {
			const parsed = JSON.parse(input);
			return typeof parsed === "object" && parsed != null ? parsed : undefined;
		} catch {
			return undefined;
		}
	}
}

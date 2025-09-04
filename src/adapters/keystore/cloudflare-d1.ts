/**
 * Cloudflare D1-backed keystore adapter.
 *
 * Uses the D1 `prepare().bind().run()/first()/all()` API at runtime without a
 * compile-time dependency. Performs basic DDL on first initialization.
 */

import type { D1LikeClient } from "../../types/adapters";
import type { KeyId, KeyRecord, KeyStoreAdapter } from "../../types/common";
import { now } from "../../utils/time";

/**
 * Cloudflare D1-backed keystore adapter.
 *
 * This targets the D1 `prepare().bind().run()/first()/all()` API without
 * taking a hard dependency on Cloudflare types. Can accept either the generic
 * interface or native D1Database objects directly.
 */
export class D1KeyStore implements KeyStoreAdapter {
	private readonly tableName: string;
	readonly ready?: Promise<void>;

	constructor(
		private readonly db: D1LikeClient,
		options?: { tableName?: string },
	) {
		this.tableName = options?.tableName ?? "usefulkey_keys";
		this.ready = this.initialize();
	}

	private async initialize(): Promise<void> {
		await this.db.prepare("SELECT 1").bind().run();

		const statements = [
			`CREATE TABLE IF NOT EXISTS ${this.tableName} (
				id TEXT PRIMARY KEY,
				user_id TEXT,
				prefix TEXT NOT NULL,
				key_hash TEXT NOT NULL UNIQUE,
				created_at INTEGER NOT NULL,
				expires_at INTEGER,
				metadata TEXT,
				uses_remaining INTEGER,
				revoked_at INTEGER
			)`,
			`CREATE INDEX IF NOT EXISTS idx_${this.tableName}_user_id ON ${this.tableName}(user_id)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_${this.tableName}_key_hash ON ${this.tableName}(key_hash)`,
		];

		for (const stmt of statements) {
			await this.db.prepare(stmt).bind().run();
		}
	}

	async createKey(record: KeyRecord): Promise<void> {
		const stmt = this.db.prepare(
			`INSERT INTO ${this.tableName} (
        id, user_id, prefix, key_hash, created_at, expires_at, metadata, uses_remaining, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		await stmt
			.bind(
				record.id,
				record.userId,
				record.prefix,
				record.keyHash,
				record.createdAt,
				record.expiresAt ?? null,
				record.metadata ? JSON.stringify(record.metadata) : null,
				record.usesRemaining ?? null,
				record.revokedAt ?? null,
			)
			.run();
	}

	async findKeyByHash(keyHash: string): Promise<KeyRecord | null> {
		const stmt = this.db.prepare(
			`SELECT id, user_id, prefix, key_hash, created_at, expires_at, metadata, uses_remaining, revoked_at
       FROM ${this.tableName} WHERE key_hash = ? LIMIT 1`,
		);
		const row = await this.firstOrFirstResult(stmt.bind(keyHash));
		if (!row) return null;
		return this.rowToRecord(row);
	}

	async findKeyById(id: KeyId): Promise<KeyRecord | null> {
		const stmt = this.db.prepare(
			`SELECT id, user_id, prefix, key_hash, created_at, expires_at, metadata, uses_remaining, revoked_at
       FROM ${this.tableName} WHERE id = ? LIMIT 1`,
		);
		const row = await this.firstOrFirstResult(stmt.bind(id));
		if (!row) return null;
		return this.rowToRecord(row);
	}

	async updateKey(record: KeyRecord): Promise<void> {
		const stmt = this.db.prepare(
			`UPDATE ${this.tableName}
       SET user_id = ?, prefix = ?, key_hash = ?, created_at = ?, expires_at = ?, metadata = ?, uses_remaining = ?, revoked_at = ?
       WHERE id = ?`,
		);
		await stmt
			.bind(
				record.userId,
				record.prefix,
				record.keyHash,
				record.createdAt,
				record.expiresAt ?? null,
				record.metadata ? JSON.stringify(record.metadata) : null,
				record.usesRemaining ?? null,
				record.revokedAt ?? null,
				record.id,
			)
			.run();
	}

	async revokeKeyById(id: KeyId): Promise<void> {
		const revokedAt = now();
		const stmt = this.db.prepare(
			`UPDATE ${this.tableName} SET revoked_at = ? WHERE id = ?`,
		);
		await stmt.bind(revokedAt, id).run();
	}

	async hardRemoveKeyById(id: KeyId): Promise<void> {
		const stmt = this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`);
		await stmt.bind(id).run();
	}

	async findExpiredIds(olderThan: number, limit: number): Promise<KeyId[]> {
		const stmt = this.db.prepare(
			`SELECT id FROM ${this.tableName} WHERE expires_at IS NOT NULL AND expires_at <= ? LIMIT ?`,
		);
		const res = await stmt.bind(olderThan, limit).all?.();
		const rows =
			(res as { results?: Record<string, unknown>[] } | undefined)?.results ??
			[];
		return rows.map((r) => String((r as Record<string, unknown>).id as string));
	}

	private async firstOrFirstResult(bound: {
		run: () => Promise<unknown>;
		first?: <T = Record<string, unknown>>() => Promise<T | null>;
		all?: <T = Record<string, unknown>>() => Promise<
			{ results?: T[] } | undefined
		>;
	}): Promise<Record<string, unknown> | null> {
		if (typeof bound.first === "function") {
			const row = await bound.first<Record<string, unknown>>();
			return row ?? null;
		}
		if (typeof bound.all === "function") {
			const res = await bound.all<Record<string, unknown>>();
			const row = res?.results?.[0];
			return row ?? null;
		}
		return null;
	}

	private rowToRecord(row: Record<string, unknown>): KeyRecord {
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
			metadata: row.metadata
				? this.safeParseJson(String(row.metadata as string))
				: undefined,
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

	private safeParseJson(input: string): Record<string, unknown> | undefined {
		try {
			const parsed = JSON.parse(input);
			return typeof parsed === "object" && parsed != null ? parsed : undefined;
		} catch {
			return undefined;
		}
	}
}

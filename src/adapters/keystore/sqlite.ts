/**
 * SQLite-backed keystore adapter.
 *
 * Targets a `better-sqlite3`-like API and handles basic DDL creation on first
 * use. Stores metadata as JSON text for portability.
 */
import type { KeyId, KeyRecord, KeyStoreAdapter } from "../../types/common";
import { now } from "../../utils/time";

/**
 * Basic SQLite adapter for the UsefulKey keystore.
 *
 * This implementation targets a `better-sqlite3`-like API (synchronous `prepare().get()/run()`),
 * but avoids a hard dependency. Pass in any DB object exposing `prepare(sql)` that returns
 * an object with `run(...args)` and `get(...args)`/`all(...args)` methods.
 */
export class SqliteKeyStore implements KeyStoreAdapter {
	private readonly tableName: string;
	readonly ready?: Promise<void>;

	constructor(
		private readonly db: any,
		options?: { tableName?: string },
	) {
		this.tableName = options?.tableName ?? "usefulkey_keys";
		this.ready = Promise.resolve().then(() => {
			this.connectivityProbe();
			this.initialize();
		});
	}

	private initialize(): void {
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

		if (this.db.exec) {
			this.db.exec(statements.join("; "));
		} else {
			for (const stmt of statements) {
				this.db.prepare(stmt).run();
			}
		}
	}

	private connectivityProbe(): void {
		this.db.prepare("PRAGMA schema_version").get();
	}

	async createKey(record: KeyRecord): Promise<void> {
		const stmt = this.db.prepare(
			`INSERT INTO ${this.tableName} (
        id, user_id, prefix, key_hash, created_at, expires_at, metadata, uses_remaining, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		stmt.run(
			record.id,
			record.userId,
			record.prefix,
			record.keyHash,
			record.createdAt,
			record.expiresAt ?? null,
			record.metadata ? JSON.stringify(record.metadata) : null,
			record.usesRemaining ?? null,
			record.revokedAt ?? null,
		);
	}

	async findKeyByHash(keyHash: string): Promise<KeyRecord | null> {
		const row = this.db
			.prepare(
				`SELECT id, user_id, prefix, key_hash, created_at, expires_at, metadata, uses_remaining, revoked_at
         FROM ${this.tableName} WHERE key_hash = ?`,
			)
			.get(keyHash);
		if (!row) return null;
		return this.rowToRecord(row as Record<string, unknown>);
	}

	async findKeyById(id: KeyId): Promise<KeyRecord | null> {
		const row = this.db
			.prepare(
				`SELECT id, user_id, prefix, key_hash, created_at, expires_at, metadata, uses_remaining, revoked_at
         FROM ${this.tableName} WHERE id = ?`,
			)
			.get(id);
		if (!row) return null;
		return this.rowToRecord(row as Record<string, unknown>);
	}

	async updateKey(record: KeyRecord): Promise<void> {
		const stmt = this.db.prepare(
			`UPDATE ${this.tableName}
       SET user_id = ?, prefix = ?, key_hash = ?, created_at = ?, expires_at = ?, metadata = ?, uses_remaining = ?, revoked_at = ?
       WHERE id = ?`,
		);
		stmt.run(
			record.userId,
			record.prefix,
			record.keyHash,
			record.createdAt,
			record.expiresAt ?? null,
			record.metadata ? JSON.stringify(record.metadata) : null,
			record.usesRemaining ?? null,
			record.revokedAt ?? null,
			record.id,
		);
	}

	async revokeKeyById(id: KeyId): Promise<void> {
		const revokedAt = now();
		const stmt = this.db.prepare(
			`UPDATE ${this.tableName} SET revoked_at = ? WHERE id = ?`,
		);
		stmt.run(revokedAt, id);
	}

	async hardRemoveKeyById(id: KeyId): Promise<void> {
		const stmt = this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`);
		stmt.run(id);
	}

	async findExpiredIds(olderThan: number, limit: number): Promise<KeyId[]> {
		const stmt = this.db.prepare(
			`SELECT id FROM ${this.tableName} WHERE expires_at IS NOT NULL AND expires_at <= ? LIMIT ?`,
		);
		const rows = (
			stmt.all ? (stmt.all(olderThan, limit) as unknown[]) : []
		) as Array<Record<string, unknown>>;
		return rows.map((r) => String(r.id as string));
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

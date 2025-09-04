/**
 * SQLite-backed rate limit store.
 *
 * Implements fixed window counters and a rolling token bucket. Targets a
 * `better-sqlite3`-like API, but remains dependency-free by expecting a minimal
 * `prepare().get()/run()` surface.
 */
import type { SqliteLikeClient } from "../../types/adapters";
import type { Milliseconds, RateLimitStoreAdapter } from "../../types/common";
import { now } from "../../utils/time";

/**
 * Basic SQLite adapter for rate limiting using fixed windows per (namespace, identifier).
 *
 * Schema:
 *   - namespace TEXT
 *   - identifier TEXT
 *   - count INTEGER
 *   - reset INTEGER (epoch ms when window ends)
 *   PRIMARY KEY(namespace, identifier)
 */
export class SqliteRateLimitStore implements RateLimitStoreAdapter {
	private readonly tableName: string;
	private readonly bucketTableName: string;
	private readonly db: SqliteLikeClient;
	readonly ready?: Promise<void>;

	constructor(db: any, options?: { tableName?: string }) {
		this.tableName = options?.tableName ?? "usefulkey_rate_limits";
		this.bucketTableName = `${this.tableName}_buckets`;
		this.db = this.adaptSqliteClient(db);
		this.ready = Promise.resolve().then(() => {
			this.connectivityProbe();
			this.initialize();
		});
	}

	private adaptSqliteClient(client: any): SqliteLikeClient {
		return {
			prepare: (sql: string) => {
				const stmt = client.prepare(sql);
				return {
					run: (...args: unknown[]) => stmt.run(...args),
					get: (...args: unknown[]) => stmt.get(...args),
					all: stmt.all ? (...args: unknown[]) => stmt.all(...args) : undefined,
				};
			},
			exec: client.exec ? (sql: string) => client.exec(sql) : undefined,
		};
	}

	private initialize(): void {
		const ddl = `
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        namespace TEXT NOT NULL,
        identifier TEXT NOT NULL,
        count INTEGER NOT NULL,
        reset INTEGER NOT NULL,
        PRIMARY KEY(namespace, identifier)
      );
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_reset ON ${this.tableName}(reset);

      CREATE TABLE IF NOT EXISTS ${this.bucketTableName} (
        namespace TEXT NOT NULL,
        identifier TEXT NOT NULL,
        tokens REAL NOT NULL,
        lastRefill INTEGER NOT NULL,
        capacity INTEGER NOT NULL,
        refillTokens REAL NOT NULL,
        refillIntervalMs INTEGER NOT NULL,
        PRIMARY KEY(namespace, identifier)
      );
      CREATE INDEX IF NOT EXISTS idx_${this.bucketTableName}_lastRefill ON ${this.bucketTableName}(lastRefill);
    `;
		if (this.db.exec) {
			this.db.exec(ddl);
		} else {
			for (const stmt of ddl
				.split(";")
				.map((s) => s.trim())
				.filter(Boolean)) {
				this.db.prepare(stmt).run();
			}
		}
	}

	private connectivityProbe(): void {
		this.db.prepare("PRAGMA schema_version").get();
	}

	async incrementAndCheck(
		namespace: string,
		identifier: string,
		limit: number,
		durationMs: Milliseconds,
	): Promise<{ success: boolean; remaining: number; reset: number }> {
		const kNow = now();
		const row = this.db
			.prepare(
				`SELECT count, reset FROM ${this.tableName} WHERE namespace = ? AND identifier = ?`,
			)
			.get(namespace, identifier);

		if (!row || Number((row as Record<string, unknown>).reset) <= kNow) {
			const reset = kNow + durationMs;
			this.db
				.prepare(
					`INSERT INTO ${this.tableName} (namespace, identifier, count, reset)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(namespace, identifier) DO UPDATE SET count = excluded.count, reset = excluded.reset`,
				)
				.run(namespace, identifier, 1, reset);
			return { success: true, remaining: Math.max(0, limit - 1), reset };
		}

		const currentCount = Number((row as Record<string, unknown>).count);
		if (currentCount < limit) {
			const newCount = currentCount + 1;
			this.db
				.prepare(
					`UPDATE ${this.tableName} SET count = ? WHERE namespace = ? AND identifier = ?`,
				)
				.run(newCount, namespace, identifier);
			return {
				success: true,
				remaining: Math.max(0, limit - newCount),
				reset: Number((row as Record<string, unknown>).reset),
			};
		}

		return {
			success: false,
			remaining: 0,
			reset: Number((row as Record<string, unknown>).reset),
		};
	}

	async check(
		namespace: string,
		identifier: string,
		limit: number,
		durationMs: Milliseconds,
	): Promise<{ success: boolean; remaining: number; reset: number }> {
		const kNow = now();
		const row = this.db
			.prepare(
				`SELECT count, reset FROM ${this.tableName} WHERE namespace = ? AND identifier = ?`,
			)
			.get(namespace, identifier);

		if (!row || Number((row as Record<string, unknown>).reset) <= kNow) {
			const reset = kNow + durationMs;
			return { success: true, remaining: Math.max(0, limit), reset };
		}

		const currentCount = Number((row as Record<string, unknown>).count);
		if (currentCount < limit) {
			return {
				success: true,
				remaining: Math.max(0, limit - currentCount),
				reset: Number((row as Record<string, unknown>).reset),
			};
		}

		return {
			success: false,
			remaining: 0,
			reset: Number((row as Record<string, unknown>).reset),
		};
	}

	async consumeTokenBucket(
		namespace: string,
		identifier: string,
		capacity: number,
		refillTokens: number,
		refillIntervalMs: number,
		cost: number = 1,
	): Promise<{ success: boolean; remaining: number; reset: number }> {
		const kNow = now();
		const row = this.db
			.prepare(
				`SELECT tokens, lastRefill, capacity, refillTokens, refillIntervalMs FROM ${this.bucketTableName} WHERE namespace = ? AND identifier = ?`,
			)
			.get(namespace, identifier) as
			| {
					tokens: number;
					lastRefill: number;
					capacity: number;
					refillTokens: number;
					refillIntervalMs: number;
			  }
			| undefined;

		let tokens = capacity;
		let lastRefill = kNow;
		if (row) {
			tokens = Number((row as any).tokens);
			lastRefill = Number((row as any).lastRefill);
		}

		const elapsed = Math.max(0, kNow - lastRefill);
		if (elapsed > 0) {
			const add = (elapsed / refillIntervalMs) * refillTokens;
			tokens = Math.min(capacity, tokens + add);
			lastRefill = kNow;
		}

		if (tokens >= cost) {
			tokens -= cost;
			const remaining = Math.floor(tokens);
			const missing = capacity - tokens;
			const reset =
				kNow + Math.ceil((missing / refillTokens) * refillIntervalMs);
			this.db
				.prepare(
					`INSERT INTO ${this.bucketTableName} (namespace, identifier, tokens, lastRefill, capacity, refillTokens, refillIntervalMs)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(namespace, identifier) DO UPDATE SET tokens = excluded.tokens, lastRefill = excluded.lastRefill,
             capacity = excluded.capacity, refillTokens = excluded.refillTokens, refillIntervalMs = excluded.refillIntervalMs`,
				)
				.run(
					namespace,
					identifier,
					tokens,
					lastRefill,
					capacity,
					refillTokens,
					refillIntervalMs,
				);
			return { success: true, remaining, reset };
		}

		const needed = cost - tokens;
		const reset = kNow + Math.ceil((needed / refillTokens) * refillIntervalMs);
		this.db
			.prepare(
				`INSERT INTO ${this.bucketTableName} (namespace, identifier, tokens, lastRefill, capacity, refillTokens, refillIntervalMs)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(namespace, identifier) DO UPDATE SET tokens = excluded.tokens, lastRefill = excluded.lastRefill,
           capacity = excluded.capacity, refillTokens = excluded.refillTokens, refillIntervalMs = excluded.refillIntervalMs`,
			)
			.run(
				namespace,
				identifier,
				tokens,
				lastRefill,
				capacity,
				refillTokens,
				refillIntervalMs,
			);
		return {
			success: false,
			remaining: Math.floor(Math.max(0, tokens)),
			reset,
		};
	}

	async reset(namespace: string, identifier: string): Promise<void> {
		this.db
			.prepare(
				`DELETE FROM ${this.tableName} WHERE namespace = ? AND identifier = ?`,
			)
			.run(namespace, identifier);
		this.db
			.prepare(
				`DELETE FROM ${this.bucketTableName} WHERE namespace = ? AND identifier = ?`,
			)
			.run(namespace, identifier);
	}
}

/**
 * Postgres-backed rate limit store.
 *
 * Provides fixed window counters and a rolling token bucket using standard SQL
 * operations. Creates required tables and indexes on first use.
 */
import type { PgLikeClient } from "../../types/adapters";
import type { Milliseconds, RateLimitStoreAdapter } from "../../types/common";
import { now } from "../../utils/time";

export class PostgresRateLimitStore implements RateLimitStoreAdapter {
	private readonly tableName: string;
	private readonly bucketTableName: string;
	readonly ready?: Promise<void>;

	constructor(
		private readonly client: PgLikeClient,
		options?: { tableName?: string },
	) {
		this.tableName = options?.tableName ?? "usefulkey_rate_limits";
		this.bucketTableName = `${this.tableName}_buckets`;
		this.ready = this.initialize();
	}

	private async initialize(): Promise<void> {
		await this.client.query("SELECT 1");
		await this.client.query(
			`CREATE TABLE IF NOT EXISTS ${this.tableName} (
        namespace TEXT NOT NULL,
        identifier TEXT NOT NULL,
        count INTEGER NOT NULL,
        reset BIGINT NOT NULL,
        PRIMARY KEY(namespace, identifier)
      )`,
		);
		await this.client.query(
			`CREATE INDEX IF NOT EXISTS idx_${this.tableName}_reset ON ${this.tableName}(reset)`,
		);

		await this.client.query(
			`CREATE TABLE IF NOT EXISTS ${this.bucketTableName} (
        namespace TEXT NOT NULL,
        identifier TEXT NOT NULL,
        tokens DOUBLE PRECISION NOT NULL,
        lastRefill BIGINT NOT NULL,
        capacity INTEGER NOT NULL,
        refillTokens DOUBLE PRECISION NOT NULL,
        refillIntervalMs BIGINT NOT NULL,
        PRIMARY KEY(namespace, identifier)
      )`,
		);
		await this.client.query(
			`CREATE INDEX IF NOT EXISTS idx_${this.bucketTableName}_lastRefill ON ${this.bucketTableName}(lastRefill)`,
		);
	}

	async incrementAndCheck(
		namespace: string,
		identifier: string,
		limit: number,
		durationMs: Milliseconds,
	): Promise<{ success: boolean; remaining: number; reset: number }> {
		const kNow = now();
		const res = (await this.client.query(
			`SELECT count, reset FROM ${this.tableName} WHERE namespace = $1 AND identifier = $2`,
			[namespace, identifier],
		)) as { rows?: Array<Record<string, unknown>> };
		const row = res.rows?.[0];

		if (!row || Number(row.reset) <= kNow) {
			const reset = kNow + durationMs;
			await this.client.query(
				`INSERT INTO ${this.tableName} (namespace, identifier, count, reset)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (namespace, identifier)
         DO UPDATE SET count = EXCLUDED.count, reset = EXCLUDED.reset`,
				[namespace, identifier, 1, reset],
			);
			return { success: true, remaining: Math.max(0, limit - 1), reset };
		}

		const currentCount = Number(row.count);
		if (currentCount < limit) {
			const newCount = currentCount + 1;
			await this.client.query(
				`UPDATE ${this.tableName} SET count = $1 WHERE namespace = $2 AND identifier = $3`,
				[newCount, namespace, identifier],
			);
			return {
				success: true,
				remaining: Math.max(0, limit - newCount),
				reset: Number(row.reset),
			};
		}

		return { success: false, remaining: 0, reset: Number(row.reset) };
	}

	async check(
		namespace: string,
		identifier: string,
		limit: number,
		durationMs: Milliseconds,
	): Promise<{ success: boolean; remaining: number; reset: number }> {
		const kNow = now();
		const res = (await this.client.query(
			`SELECT count, reset FROM ${this.tableName} WHERE namespace = $1 AND identifier = $2`,
			[namespace, identifier],
		)) as { rows?: Array<Record<string, unknown>> };
		const row = res.rows?.[0];
		if (!row || Number(row.reset) <= kNow) {
			const reset = kNow + durationMs;
			return { success: true, remaining: Math.max(0, limit), reset };
		}

		const currentCount = Number(row.count);
		if (currentCount < limit) {
			return {
				success: true,
				remaining: Math.max(0, limit - currentCount),
				reset: Number(row.reset),
			};
		}
		return { success: false, remaining: 0, reset: Number(row.reset) };
	}

	async consumeTokenBucket(
		namespace: string,
		identifier: string,
		capacity: number,
		refillTokens: number,
		refillIntervalMs: Milliseconds,
		cost: number = 1,
	): Promise<{ success: boolean; remaining: number; reset: number }> {
		const kNow = now();
		const res = (await this.client.query(
			`SELECT tokens, lastRefill FROM ${this.bucketTableName} WHERE namespace = $1 AND identifier = $2`,
			[namespace, identifier],
		)) as { rows?: Array<Record<string, unknown>> };
		const row = res.rows?.[0];

		let tokens = capacity;
		let lastRefill = kNow;
		if (row) {
			tokens = Number(row.tokens);
			lastRefill = Number(row.lastRefill);
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
			const reset =
				kNow +
				Math.ceil(((capacity - tokens) / refillTokens) * refillIntervalMs);
			await this.client.query(
				`INSERT INTO ${this.bucketTableName} (namespace, identifier, tokens, lastRefill, capacity, refillTokens, refillIntervalMs)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (namespace, identifier) DO UPDATE SET tokens = EXCLUDED.tokens, lastRefill = EXCLUDED.lastRefill,
           capacity = EXCLUDED.capacity, refillTokens = EXCLUDED.refillTokens, refillIntervalMs = EXCLUDED.refillIntervalMs`,
				[
					namespace,
					identifier,
					tokens,
					lastRefill,
					capacity,
					refillTokens,
					refillIntervalMs,
				],
			);
			return { success: true, remaining, reset };
		}

		const needed = cost - tokens;
		const reset = kNow + Math.ceil((needed / refillTokens) * refillIntervalMs);
		await this.client.query(
			`INSERT INTO ${this.bucketTableName} (namespace, identifier, tokens, lastRefill, capacity, refillTokens, refillIntervalMs)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (namespace, identifier) DO UPDATE SET tokens = EXCLUDED.tokens, lastRefill = EXCLUDED.lastRefill,
         capacity = EXCLUDED.capacity, refillTokens = EXCLUDED.refillTokens, refillIntervalMs = EXCLUDED.refillIntervalMs`,
			[
				namespace,
				identifier,
				tokens,
				lastRefill,
				capacity,
				refillTokens,
				refillIntervalMs,
			],
		);
		return {
			success: false,
			remaining: Math.floor(Math.max(0, tokens)),
			reset,
		};
	}

	async reset(namespace: string, identifier: string): Promise<void> {
		await this.client.query(
			`DELETE FROM ${this.tableName} WHERE namespace = $1 AND identifier = $2`,
			[namespace, identifier],
		);
		await this.client.query(
			`DELETE FROM ${this.bucketTableName} WHERE namespace = $1 AND identifier = $2`,
			[namespace, identifier],
		);
	}
}

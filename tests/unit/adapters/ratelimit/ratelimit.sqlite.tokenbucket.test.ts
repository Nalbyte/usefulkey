import { beforeEach, describe, expect, it, vi } from "vitest";
import { SqliteRateLimitStore } from "../../../../src";

describe("SqliteRateLimitStore token bucket", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
	});

	function makeDb() {
		const tables: Record<string, any[]> = {};
		return {
			exec(_sql: string) {},
			prepare(sql: string) {
				return {
					run: (...args: any[]) => {
						if (/INSERT INTO .*_buckets/.test(sql)) {
							const m = sql.match(/INTO (\w+)_buckets/);
							const base = m
								? `${m[1]}_buckets`
								: "usefulkey_rate_limits_buckets";
							tables[base] = tables[base] || [];
							const row = {
								namespace: args[0],
								identifier: args[1],
								tokens: args[2],
								lastRefill: args[3],
								capacity: args[4],
								refillTokens: args[5],
								refillIntervalMs: args[6],
							};
							const idx = tables[base].findIndex(
								(r) =>
									r.namespace === row.namespace &&
									r.identifier === row.identifier,
							);
							if (idx >= 0) tables[base][idx] = row;
							else tables[base].push(row);
						}
					},
					get: (...args: any[]) => {
						if (/FROM .*_buckets/.test(sql)) {
							const m = sql.match(/FROM (\w+)_buckets/);
							const base = m
								? `${m[1]}_buckets`
								: "usefulkey_rate_limits_buckets";
							const list = tables[base] || [];
							return list.find(
								(r) => r.namespace === args[0] && r.identifier === args[1],
							);
						}
						return undefined;
					},
				} as any;
			},
		};
	}

	it("consumes tokens and computes reset; blocks when depleted then refills over time", async () => {
		const db = makeDb();
		const SqliteRateLimitStoreCtor = SqliteRateLimitStore as any;
		const store = new SqliteRateLimitStoreCtor(db, { tableName: "uk_rl" });

		const ns = "svc";
		const id = "id";
		const capacity = 3;
		const refill = 1;
		const interval = 1000;

		const r1 = await store.consumeTokenBucket(
			ns,
			id,
			capacity,
			refill,
			interval,
			1,
		);
		expect(r1.success).toBe(true);
		const r2 = await store.consumeTokenBucket(
			ns,
			id,
			capacity,
			refill,
			interval,
			1,
		);
		expect(r2.success).toBe(true);
		const r3 = await store.consumeTokenBucket(
			ns,
			id,
			capacity,
			refill,
			interval,
			1,
		);
		expect(r3.success).toBe(true);

		const r4 = await store.consumeTokenBucket(
			ns,
			id,
			capacity,
			refill,
			interval,
			1,
		);
		expect(r4.success).toBe(false);
		expect(r4.remaining).toBe(0);

		await vi.advanceTimersByTimeAsync(2000);
		const r5 = await store.consumeTokenBucket(
			ns,
			id,
			capacity,
			refill,
			interval,
			2,
		);
		expect(r5.success).toBe(true);
		expect(r5.remaining).toBeGreaterThanOrEqual(0);
	});
});

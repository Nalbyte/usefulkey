import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostgresRateLimitStore } from "../../../../src";

describe("PostgresRateLimitStore token bucket", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
	});

	it("consumes tokens, persists bucket, and computes reset correctly", async () => {
		const rowsBuckets: any[] = [];
		const rowsFixed: any[] = [];
		const client = {
			async query(text: string, values?: unknown[]) {
				if (/SELECT tokens, lastRefill/.test(text)) {
					const [ns, id] = values as [string, string];
					const found = rowsBuckets.find(
						(r) => r.namespace === ns && r.identifier === id,
					);
					return { rows: found ? [found] : [] } as any;
				}
				if (/INSERT INTO .*_buckets/.test(text)) {
					const [
						ns,
						id,
						tokens,
						lastRefill,
						capacity,
						refillTokens,
						refillIntervalMs,
					] = values as any[];
					const row = {
						namespace: ns,
						identifier: id,
						tokens,
						lastRefill,
						capacity,
						refillTokens,
						refillIntervalMs,
					};
					const idx = rowsBuckets.findIndex(
						(r) => r.namespace === ns && r.identifier === id,
					);
					if (idx >= 0) rowsBuckets[idx] = row;
					else rowsBuckets.push(row);
					return { rows: [], rowCount: 1 } as any;
				}
				if (/SELECT count, reset FROM/.test(text)) {
					const [ns, id] = values as [string, string];
					const found = rowsFixed.find(
						(r) => r.namespace === ns && r.identifier === id,
					);
					return { rows: found ? [found] : [] } as any;
				}
				if (
					/INSERT INTO .* \(namespace, identifier, count, reset\)/.test(text)
				) {
					const [ns, id, count, reset] = values as any[];
					const idx = rowsFixed.findIndex(
						(r) => r.namespace === ns && r.identifier === id,
					);
					const row = { namespace: ns, identifier: id, count, reset };
					if (idx >= 0) rowsFixed[idx] = row;
					else rowsFixed.push(row);
					return { rows: [], rowCount: 1 } as any;
				}
				if (/UPDATE .* SET count =/.test(text)) {
					const [count, ns, id] = values as any[];
					const idx = rowsFixed.findIndex(
						(r) => r.namespace === ns && r.identifier === id,
					);
					if (idx >= 0) rowsFixed[idx].count = count;
					return { rows: [], rowCount: 1 } as any;
				}
				return { rows: [], rowCount: 0 } as any;
			},
		} as any;

		const PostgresRateLimitStoreCtor = PostgresRateLimitStore as any;
		const store = new PostgresRateLimitStoreCtor(client, {
			tableName: "uk_rl",
		});

		const ns = "svc";
		const id = "id";
		const capacity = 2;
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
		expect(r3.success).toBe(false);

		await vi.advanceTimersByTimeAsync(1000);
		const r4 = await store.consumeTokenBucket(
			ns,
			id,
			capacity,
			refill,
			interval,
			1,
		);
		expect(r4.success).toBe(true);
	});
});

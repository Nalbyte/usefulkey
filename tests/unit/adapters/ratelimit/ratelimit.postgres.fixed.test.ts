import { describe, expect, it, vi } from "vitest";
import { PostgresRateLimitStore } from "../../../../src";

describe("PostgresRateLimitStore fixed-window", () => {
	it("first hit initializes window, increments within window, then blocks over limit", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));

		const rowsFixed: Array<{
			namespace: string;
			identifier: string;
			count: number;
			reset: number;
		}> = [];
		const client = {
			async query(text: string, values?: unknown[]) {
				if (/SELECT count, reset FROM /.test(text)) {
					const [ns, id] = values as [string, string];
					const found = rowsFixed.find(
						(r) => r.namespace === ns && r.identifier === id,
					);
					return { rows: found ? [found] : [] } as any;
				}
				if (
					/INSERT INTO .* \(namespace, identifier, count, reset\)/.test(text)
				) {
					const [ns, id, count, reset] = values as [
						string,
						string,
						number,
						number,
					];
					const idx = rowsFixed.findIndex(
						(r) => r.namespace === ns && r.identifier === id,
					);
					const row = { namespace: ns, identifier: id, count, reset };
					if (idx >= 0) rowsFixed[idx] = row;
					else rowsFixed.push(row);
					return { rows: [], rowCount: 1 } as any;
				}
				if (/UPDATE .* SET count = /.test(text)) {
					const [count, ns, id] = values as [number, string, string];
					const idx = rowsFixed.findIndex(
						(r) => r.namespace === ns && r.identifier === id,
					);
					if (idx >= 0) rowsFixed[idx].count = count;
					return { rows: [], rowCount: 1 } as any;
				}
				return { rows: [], rowCount: 0 } as any;
			},
		} as any;

		const StoreCtor = PostgresRateLimitStore as any;
		const store = new StoreCtor(client, { tableName: "uk_rl" });
		const ns = "svc",
			id = "id";
		const dur = 1000;

		const r1 = await store.incrementAndCheck(ns, id, 2, dur);
		expect(r1.success).toBe(true);
		expect(r1.remaining).toBe(1);
		const r2 = await store.incrementAndCheck(ns, id, 2, dur);
		expect(r2.success).toBe(true);
		expect(r2.remaining).toBe(0);
		const r3 = await store.incrementAndCheck(ns, id, 2, dur);
		expect(r3.success).toBe(false);
	});
});

import { describe, expect, it } from "vitest";
import { SqliteRateLimitStore } from "../../../../src";

type RLRow = {
	namespace: string;
	identifier: string;
	count: number;
	reset: number;
};

function makeDb(withExec: boolean) {
	const rows = new Map<string, RLRow>();
	const key = (ns: string, id: string) => `${ns}:${id}`;
	const db: {
		exec?: (sql: string) => void;
		prepare: (sql: string) => {
			run: (...args: unknown[]) => Record<string, unknown>;
			get: (...args: unknown[]) => unknown;
		};
	} = {
		exec: withExec ? (_sql: string) => {} : undefined,
		prepare(sql: string) {
			const isSelect = /SELECT count, reset/.test(sql);
			const isInsert = /INSERT INTO/.test(sql);
			const isUpdate = /^UPDATE/.test(sql);
			return {
				run(...args: unknown[]) {
					if (isInsert) {
						const [ns, id, count, reset] = args as [
							unknown,
							unknown,
							unknown,
							unknown,
						];
						rows.set(key(String(ns), String(id)), {
							namespace: String(ns),
							identifier: String(id),
							count: Number(count),
							reset: Number(reset),
						});
					} else if (isUpdate) {
						if (/SET count = \?/.test(sql)) {
							const [count, ns, id] = args as [unknown, unknown, unknown];
							const k = key(String(ns), String(id));
							const row = rows.get(k);
							if (row) row.count = Number(count);
						}
					}
					return {};
				},
				get(...args: unknown[]) {
					if (isSelect) {
						const [ns, id] = args as [unknown, unknown];
						return rows.get(key(String(ns), String(id)));
					}
					return undefined as unknown;
				},
			};
		},
	};
	return { db, rows };
}

describe("SqliteRateLimitStore adapter", () => {
	it("initializes with exec and enforces limit/reset correctly", async () => {
		const { db } = makeDb(true);
		const rl = new SqliteRateLimitStore(db as any);
		const ns = "app",
			id = "u1";
		const dur = 1000;
		const r1 = await rl.incrementAndCheck(ns, id, 2, dur);
		expect(r1.success).toBe(true);
		expect(r1.remaining).toBe(1);
		const r2 = await rl.incrementAndCheck(ns, id, 2, dur);
		expect(r2.success).toBe(true);
		expect(r2.remaining).toBe(0);
		const r3 = await rl.incrementAndCheck(ns, id, 2, dur);
		expect(r3.success).toBe(false);
	});

	it("initializes without exec and check() returns remaining correctly", async () => {
		const { db, rows } = makeDb(false);
		const rl = new SqliteRateLimitStore(db as any);
		const ns = "app",
			id = "u2";

		rows.set(`${ns}:${id}`, {
			namespace: ns,
			identifier: id,
			count: 1,
			reset: Date.now() + 10_000,
		});
		const c = await rl.check(ns, id, 3, 5_000);
		expect(c.success).toBe(true);
		expect(c.remaining).toBe(2);
	});
});

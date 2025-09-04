import { describe, expect, it } from "vitest";
import {
	PostgresRateLimitStore,
	RedisRateLimitStore,
	SqliteRateLimitStore,
} from "../../../../src";

describe("RateLimit adapters connectivity", () => {
	it("PostgresRateLimitStore: ready rejects on failed SELECT 1", async () => {
		const client = {
			async query(sql: string) {
				if (/^SELECT 1$/i.test(sql)) throw new Error("pg rl down");
				return { rows: [], rowCount: 0 } as any;
			},
		} as any;
		const store = new PostgresRateLimitStore(client);
		await expect(store.ready).rejects.toThrow(/pg rl down/i);
	});

	it("SqliteRateLimitStore: ready rejects when PRAGMA fails", async () => {
		const db = {
			prepare(_sql: string) {
				throw new Error("sqlite rl down");
			},
		} as any;
		const store = new SqliteRateLimitStore(db as any);
		await expect(store.ready).rejects.toThrow(/rl down/i);
	});

	it("RedisRateLimitStore: ready resolves when ping succeeds and skips when not available", async () => {
		const ok = new RedisRateLimitStore({ async ping() {} } as any);
		await expect(ok.ready).resolves.toBeUndefined();

		const minimal = new RedisRateLimitStore({} as any);
		await expect(minimal.ready).resolves.toBeUndefined();
	});
});

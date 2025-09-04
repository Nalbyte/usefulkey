import { describe, expect, it } from "vitest";
import {
	D1KeyStore,
	PostgresKeyStore,
	RedisKeyStore,
	SqliteKeyStore,
} from "../../../../src";

describe("Keystore adapters connectivity", () => {
	it("PostgresKeyStore: ready rejects on failed SELECT 1 and runs DDL on success", async () => {
		const failClient = {
			async query(text: string) {
				if (/^SELECT 1$/i.test(text)) throw new Error("pg connect fail");
				return { rows: [], rowCount: 0 } as any;
			},
		} as any;
		const ksFail = new PostgresKeyStore(failClient);
		await expect(ksFail.ready).rejects.toThrow(/connect fail/i);

		const executed: string[] = [];
		const okClient = {
			async query(text: string) {
				executed.push(text);
				return { rows: [], rowCount: 0 } as any;
			},
		} as any;
		const ksOk = new PostgresKeyStore(okClient);
		await expect(ksOk.ready).resolves.toBeUndefined();
		expect(executed.some((q) => /SELECT 1/i.test(q))).toBe(true);
		expect(executed.some((q) => /CREATE TABLE IF NOT EXISTS/i.test(q))).toBe(
			true,
		);
	});

	it("SqliteKeyStore: ready rejects when PRAGMA probe fails", async () => {
		const db = {
			prepare(_sql: string) {
				throw new Error("sqlite prepare failed");
			},
		} as any;
		const ks = new SqliteKeyStore(db);
		await expect(ks.ready).rejects.toThrow(/prepare failed/i);
	});

	it("D1KeyStore: ready rejects when SELECT 1 fails", async () => {
		const db = {
			prepare(_sql: string) {
				return {
					bind() {
						return {
							async run() {
								throw new Error("d1 connect fail");
							},
						};
					},
				};
			},
		} as any;
		const ks = new D1KeyStore(db);
		await expect(ks.ready).rejects.toThrow(/connect fail/i);
	});

	it("RedisKeyStore: ready resolves when ping succeeds, rejects when ping fails", async () => {
		const ok = new RedisKeyStore({ async ping() {} } as any);
		await expect(ok.ready).resolves.toBeUndefined();

		const bad = new RedisKeyStore({
			async ping() {
				throw new Error("redis down");
			},
		} as any);
		await expect(bad.ready).rejects.toThrow(/redis down/i);
	});
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { RedisRateLimitStore } from "../../../../src";
import { now as nowFn } from "../../../../src/utils/time";

describe("RedisRateLimitStore", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
	});

	it("uses eval for atomic path and maps tuple correctly (first hit and over limit)", async () => {
		let calls = 0;
		const client = {
			async eval(
				_script: string,
				_numKeys: number,
				_k: string,
				limit: string,
				ttl: string,
				now: string,
			) {
				calls++;
				if (calls === 1) {
					return [1, Number(limit) - 1, Number(now) + Number(ttl)];
				}

				return [0, 0, Number(now) + Number(ttl)];
			},
		} as any;
		const store = new RedisRateLimitStore(client);
		const r1 = await store.incrementAndCheck("ns", "id", 2, 60_000);
		expect(r1.success).toBe(true);
		expect(r1.remaining).toBe(1);
		const r2 = await store.incrementAndCheck("ns", "id", 2, 60_000);
		expect(r2.success).toBe(false);
		expect(r2.remaining).toBe(0);
	});

	it("token bucket via eval: consumes then blocks then refills (tuple mapping)", async () => {
		let calls = 0;
		const client = {
			async eval(
				_script: string,
				_num: number,
				_k: string,
				_cap: string,
				_ref: string,
				interval: string,
				_cost: string,
				now: string,
			) {
				calls++;
				if (calls === 1) return [1, 1, Number(now) + 1000];
				if (calls === 2) return [1, 0, Number(now) + 1000];
				return [0, 0, Number(now) + Number(interval)];
			},
		} as any;
		const store = new RedisRateLimitStore(client);
		const ns = "ns",
			id = "tb";
		const a = await store.consumeTokenBucket(ns, id, 2, 1, 1000, 1);
		expect(a.success).toBe(true);
		const b = await store.consumeTokenBucket(ns, id, 2, 1, 1000, 1);
		expect(b.success).toBe(true);
		const c = await store.consumeTokenBucket(ns, id, 2, 1, 1000, 1);
		expect(c.success).toBe(false);
	});

	it("fallback non-atomic path uses incr and pExpire/pttl", async () => {
		let _value = 0;
		let ttlMs = -1;
		const keyValues: Record<string, string> = {};
		const client = {
			async incr(k: string) {
				const next = (Number(keyValues[k] ?? 0) + 1).toString();
				keyValues[k] = next;
				_value = Number(next);
				return next;
			},
			async pExpire(_k: string, ms: number) {
				ttlMs = ms;
			},
			async pTtl(_k: string) {
				return ttlMs;
			},
		} as any;
		const store = new RedisRateLimitStore(client);
		const r1 = await store.incrementAndCheck("ns", "id", 2, 1000);
		expect(r1.success).toBe(true);
		expect(r1.remaining).toBe(1);
		expect(ttlMs).toBe(1000);
		const r2 = await store.incrementAndCheck("ns", "id", 2, 1000);
		expect(r2.success).toBe(true);
		expect(r2.remaining).toBe(0);
		const r3 = await store.incrementAndCheck("ns", "id", 2, 1000);
		expect(r3.success).toBe(false);
	});

	it("pexpire falls back to set PX when pExpire/pexpire missing", async () => {
		const kv: Record<string, string> = {};
		const client = {
			async incr(k: string) {
				kv[k] = ((Number(kv[k] ?? 0) + 1) as any).toString();
				return kv[k];
			},
			async get(k: string) {
				return kv[k] ?? "0";
			},
			async set(k: string, v: string, opt: string, px: number) {
				expect(opt).toBe("PX");
				expect(px).toBeGreaterThan(0);
				kv[k] = v;
			},
			async pttl(_k: string) {
				return -1;
			},
		} as any;
		const store = new RedisRateLimitStore(client);
		const r1 = await store.incrementAndCheck("ns", "id", 1, 500);
		expect(r1.success).toBe(true);
	});

	it("pttl prefers pTtl/pttl over ttl and converts seconds in ttl path", async () => {
		const client1 = {
			async ttl() {
				return 2;
			},
		} as any; // seconds
		const s1 = new RedisRateLimitStore(client1);
		const c1 = await s1.check("ns", "id", 10, 1000);

		expect(c1.reset).toBeGreaterThanOrEqual(Number(new Date(nowFn())));

		const client2 = {
			async pttl() {
				return 1500;
			},
			async get() {
				return "1";
			},
		} as any;
		const s2 = new RedisRateLimitStore(client2);
		const c2 = await s2.check("ns", "id", 2, 2000);
		expect(c2.success).toBe(true);
		expect(c2.remaining).toBe(1);
	});

	it("token bucket fallback via get/set when eval missing", async () => {
		const store: Record<string, string> = {};
		const client = {
			async get(k: string) {
				return store[k] ?? null;
			},
			async set(k: string, v: string) {
				store[k] = v;
			},
		} as any;
		const s = new RedisRateLimitStore(client);
		const ns = "ns",
			id = "tb_fallback";
		const a = await s.consumeTokenBucket(ns, id, 2, 1, 1000, 1);
		expect(a.success).toBe(true);
		const b = await s.consumeTokenBucket(ns, id, 2, 1, 1000, 1);
		expect(b.success).toBe(true);
		const c = await s.consumeTokenBucket(ns, id, 2, 1, 1000, 1);
		expect(c.success).toBe(false);
	});

	it("check allows when get missing or value missing/NaN", async () => {
		const clientA = {} as any;
		const sA = new RedisRateLimitStore(clientA);
		const a = await sA.check("ns", "id", 3, 1000);
		expect(a.success).toBe(true);
		expect(a.remaining).toBe(3);

		const clientB = {
			async get() {
				return undefined;
			},
			async pttl() {
				return -1;
			},
		} as any;
		const sB = new RedisRateLimitStore(clientB);
		const b = await sB.check("ns", "id", 4, 1000);
		expect(b.success).toBe(true);
		expect(b.remaining).toBe(4);
	});

	it("throws when neither eval nor incr is supported", async () => {
		const client = {} as any;
		const store = new RedisRateLimitStore(client);
		await expect(store.incrementAndCheck("ns", "id", 1, 1000)).rejects.toThrow(
			/eval or incr/i,
		);
	});

	it("pexpire throws when set is also missing", async () => {
		const client = {
			async incr() {
				return 1;
			},
			async pttl() {
				return -1;
			},
		} as any;
		const store = new RedisRateLimitStore(client);
		await expect(store.incrementAndCheck("ns", "id", 1, 1000)).rejects.toThrow(
			/pExpire\/pexpire or set PX/i,
		);
	});
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloudflareKvRateLimitStore } from "../../../../src";

describe("CloudflareKvRateLimitStore", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
	});

	it("fixed-window: first hit initializes with TTL and over limit blocks (approx reset)", async () => {
		const kv: Record<string, { value: string; exp?: number }> = {};
		const ns = "app",
			id = "u1";
		const dur = 60_000;
		const store = new CloudflareKvRateLimitStore({
			async get(k: string) {
				return kv[k]?.value ?? null;
			},
			async put(k: string, v: string, opt?: { expirationTtl?: number }) {
				const exp = opt?.expirationTtl
					? Date.now() + opt.expirationTtl * 1000
					: undefined;
				kv[k] = { value: v, exp };
			},
		} as any);

		const r1 = await store.incrementAndCheck(ns, id, 1, dur);
		expect(r1.success).toBe(true);
		const r2 = await store.incrementAndCheck(ns, id, 1, dur);
		expect(r2.success).toBe(false);
	});

	it("fixed-window: TTL seconds uses ceil(durationMs/1000)", async () => {
		const puts: Array<{
			key: string;
			value: string;
			opt?: { expirationTtl?: number };
		}> = [];
		const store = new CloudflareKvRateLimitStore({
			async get() {
				return null;
			},
			async put(k: string, v: string, opt?: { expirationTtl?: number }) {
				puts.push({ key: k, value: v, opt });
			},
		} as any);
		await store.incrementAndCheck("ns", "id", 10, 1500);
		expect(puts[0].opt?.expirationTtl).toBe(2);
	});

	it("check: allows when empty and returns remaining when under limit", async () => {
		const kv: Record<string, string> = {};
		const store = new CloudflareKvRateLimitStore({
			async get(k: string) {
				return kv[k] ?? null;
			},
			async put(k: string, v: string) {
				kv[k] = v;
			},
		} as any);
		const a = await store.check("ns", "id", 3, 1000);
		expect(a.success).toBe(true);
		expect(a.remaining).toBe(3);
		// seed 2 hits
		await store.incrementAndCheck("ns", "id", 10, 1000);
		await store.incrementAndCheck("ns", "id", 10, 1000);
		const b = await store.check("ns", "id", 10, 1000);
		expect(b.success).toBe(true);
		expect(b.remaining).toBeGreaterThanOrEqual(8);
	});

	it("check: treats NaN value as zero and returns remaining=limit", async () => {
		const kv: Record<string, string> = {};
		const store = new CloudflareKvRateLimitStore({
			async get(k: string) {
				return kv[k] ?? null;
			},
			async put(k: string, v: string) {
				kv[k] = v;
			},
		} as any);
		kv["usefulkey:rl:ns:id"] = "NaN";
		const c = await store.check("ns", "id", 5, 1000);
		expect(c.success).toBe(true);
		expect(c.remaining).toBe(5);
	});

	it("token bucket: consumes and computes reset; writes back state", async () => {
		const kv: Record<string, string> = {};
		const store = new CloudflareKvRateLimitStore({
			async get(k: string) {
				return kv[k] ?? null;
			},
			async put(k: string, v: string) {
				kv[k] = v;
			},
		} as any);
		const r1 = await store.consumeTokenBucket("ns", "idtb", 3, 1, 1000, 1);
		expect(r1.success).toBe(true);
		expect(r1.remaining).toBe(2);
		const state = kv["usefulkey:rl:ns:idtb"];
		expect(state).toMatch(/\d+(\.\d+)?:\d+/);
	});

	it("token bucket: handles invalid stored values (NaN tokens/lastRefill)", async () => {
		const kv: Record<string, string> = {};
		const store = new CloudflareKvRateLimitStore({
			async get(k: string) {
				return kv[k] ?? null;
			},
			async put(k: string, v: string) {
				kv[k] = v;
			},
		} as any);
		kv["usefulkey:rl:ns:idbad"] = "NaN:not_a_number";
		const r = await store.consumeTokenBucket("ns", "idbad", 2, 1, 1000, 1);
		expect(r.success).toBe(true);
		expect(kv["usefulkey:rl:ns:idbad"]).toMatch(/^\d+(?:\.\d+)?:\d+$/);
	});

	it("reset: uses delete when available and falls back to short TTL otherwise", async () => {
		const kv1: any = {
			store: {} as Record<string, string>,
			async get(k: string) {
				return this.store[k] ?? null;
			},
			async put(k: string, v: string) {
				this.store[k] = v;
			},
			async delete(k: string) {
				delete this.store[k];
			},
		};
		const s1 = new CloudflareKvRateLimitStore(kv1);
		await s1.incrementAndCheck("ns", "id", 10, 1000);
		await s1.reset("ns", "id");
		expect(await kv1.get("usefulkey:rl:ns:id")).toBeNull();

		const writes: { key: string; opt?: { expirationTtl?: number } }[] = [];
		const s2 = new CloudflareKvRateLimitStore({
			async get() {
				return null;
			},
			async put(_k: string, _v: string, opt?: { expirationTtl?: number }) {
				writes.push({ key: _k, opt });
			},
		} as any);
		await s2.reset("ns", "id");
		expect(writes[0].opt?.expirationTtl).toBe(1);
	});
});

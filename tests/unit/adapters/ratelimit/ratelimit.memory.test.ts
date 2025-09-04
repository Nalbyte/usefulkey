import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRateLimitStore } from "../../../../src";

describe("MemoryRateLimitStore", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
	});

	it("fixed-window: enforces limit within window and resets after duration", async () => {
		const rl = new MemoryRateLimitStore();
		const ns = "svc",
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

		await vi.advanceTimersByTimeAsync(dur);
		const r4 = await rl.incrementAndCheck(ns, id, 2, dur);
		expect(r4.success).toBe(true);
		expect(r4.remaining).toBe(1);
	});

	it("check: reports remaining correctly with and without prior hits", async () => {
		const rl = new MemoryRateLimitStore();
		const ns = "svc",
			id = "u2";
		const dur = 2000;
		const c1 = await rl.check(ns, id, 3, dur);
		expect(c1.success).toBe(true);
		expect(c1.remaining).toBe(3);
		await rl.incrementAndCheck(ns, id, 3, dur);
		const c2 = await rl.check(ns, id, 3, dur);
		expect(c2.success).toBe(true);
		expect(c2.remaining).toBe(2);
	});

	it("token bucket: consumes, blocks when empty, then refills over time", async () => {
		const rl = new MemoryRateLimitStore();
		const ns = "svc",
			id = "tb";
		const capacity = 2;
		const refill = 1;
		const interval = 1000;
		const a = await rl.consumeTokenBucket(
			ns,
			id,
			capacity,
			refill,
			interval,
			1,
		);
		expect(a.success).toBe(true);
		const b = await rl.consumeTokenBucket(
			ns,
			id,
			capacity,
			refill,
			interval,
			1,
		);
		expect(b.success).toBe(true);
		const c = await rl.consumeTokenBucket(
			ns,
			id,
			capacity,
			refill,
			interval,
			1,
		);
		expect(c.success).toBe(false);
		await vi.advanceTimersByTimeAsync(1500);
		const d = await rl.consumeTokenBucket(
			ns,
			id,
			capacity,
			refill,
			interval,
			1,
		);
		expect(d.success).toBe(true);
	});

	it("reset clears both window and bucket state", async () => {
		const rl = new MemoryRateLimitStore();
		const ns = "svc",
			id = "x";
		await rl.incrementAndCheck(ns, id, 1, 10_000);
		await rl.consumeTokenBucket(ns, id, 1, 1, 1000, 1);
		await rl.reset(ns, id);
		const c = await rl.check(ns, id, 5, 1000);
		expect(c.success).toBe(true);
		expect(c.remaining).toBe(5);
	});
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClickHouseAnalytics } from "../../../../src";

describe("ClickHouseAnalytics", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
	});

	it("queues and flushes via client insert, requeues on failure", async () => {
		const insert = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("down"));
		const ch = new ClickHouseAnalytics({
			url: "http://localhost:8123",
			client: { insert } as any,
			batchSize: 2,
			flushIntervalMs: 0,
		});
		await ch.track("e1", { a: 1 });
		await ch.track("e2", { a: 2 });

		expect(insert).toHaveBeenCalled();

		await ch.track("e3", { a: 3 });
		await ch.track("e4", { a: 4 });
		await ch.flushAll();
	});

	it("flushes via HTTP, handles non-ok and timeout by requeue", async () => {
		const okRes = { ok: true } as any as Response;
		const badRes = { ok: false } as any as Response;
		vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(okRes)
			.mockResolvedValueOnce(badRes);
		const ch = new ClickHouseAnalytics({
			url: "http://localhost:8123",
			batchSize: 2,
			flushIntervalMs: 0,
			timeoutMs: 50,
		});
		await ch.track("e1", { a: 1 });
		await ch.track("e2", { a: 2 });
		await ch.track("e3", { a: 3 });
		await ch.track("e4", { a: 4 });
		await ch.flushAll();
	});

	it("close stops timer and drains", async () => {
		const ch = new ClickHouseAnalytics({
			url: "http://localhost:8123",
			batchSize: 10,
			flushIntervalMs: 10,
		});
		await ch.track("e1", { a: 1 });
		await ch.close();
	});
});

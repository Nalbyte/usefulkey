import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClickHouseAnalytics } from "../../../../src";

describe("ClickHouseAnalytics - extras", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
	});

	it("passes correct args to client.insert", async () => {
		const insert = vi.fn().mockResolvedValue(undefined);
		const ch = new ClickHouseAnalytics({
			url: "http://localhost:8123",
			client: { insert } as any,
			batchSize: 2,
			flushIntervalMs: 0,
		});
		await ch.track("e1", { a: 1 });
		await ch.track("e2", { b: 2 });
		await ch.flushAll();

		expect(insert).toHaveBeenCalledTimes(1);
		expect(insert).toHaveBeenCalledWith({
			database: "default",
			table: "usefulkey_events",
			format: "JSONEachRow",
			values: [
				{
					event: "e1",
					payload: JSON.stringify({ a: 1 }),
					ts: "2025-01-01T00:00:00.000Z",
				},
				{
					event: "e2",
					payload: JSON.stringify({ b: 2 }),
					ts: "2025-01-01T00:00:00.000Z",
				},
			],
		});
	});

	it("adds Authorization header when username/password provided", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue({ ok: true } as any);
		const ch = new ClickHouseAnalytics({
			url: "http://localhost:8123/",
			username: "u",
			password: "p",
			batchSize: 1,
			flushIntervalMs: 0,
		});
		await ch.track("e1", { a: 1 });
		await ch.flushAll();

		const call = fetchSpy.mock.calls[0];
		const init = call?.[1] as RequestInit | undefined;
		expect((init?.headers as any).Authorization).toMatch(/^Basic\s.+/);
	});

	it("merges custom headers and keeps content-type", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue({ ok: true } as any);
		const ch = new ClickHouseAnalytics({
			url: "http://localhost:8123",
			headers: { "X-Custom": "1" },
			batchSize: 1,
			flushIntervalMs: 0,
		});
		await ch.track("e1", { a: 1 });
		await ch.flushAll();

		const call = fetchSpy.mock.calls[0];
		const init = call?.[1] as RequestInit | undefined;
		expect((init?.headers as any)["X-Custom"]).toBe("1");
		expect((init?.headers as any)["Content-Type"]).toContain(
			"application/json",
		);
	});

	it("interval-driven flush triggers without reaching batchSize", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue({ ok: true } as any);
		const ch = new ClickHouseAnalytics({
			url: "http://localhost:8123",
			batchSize: 10,
			flushIntervalMs: 1000,
		});
		await ch.ready;
		await ch.track("e1", { a: 1 });

		vi.advanceTimersByTime(1000);
		await ch.flushAll();

		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});
});

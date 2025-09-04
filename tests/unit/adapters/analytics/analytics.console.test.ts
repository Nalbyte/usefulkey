import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsoleAnalytics } from "../../../../src";

describe("ConsoleAnalytics", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("logs event name and payload", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		const analytics = new ConsoleAnalytics();
		await analytics.track("evt", { x: 1 });
		expect(spy).toHaveBeenCalledWith("[usefulkey:analytics] evt", { x: 1 });
		spy.mockRestore();
	});
});

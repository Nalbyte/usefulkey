import { describe, it } from "vitest";
import { NoopAnalytics } from "../../../../src";

describe("NoopAnalytics", () => {
	it("track resolves and does nothing", async () => {
		const analytics = new NoopAnalytics();
		await analytics.track("evt1", { a: 1 });
		await analytics.track("evt2", { b: 2 });
	});
});

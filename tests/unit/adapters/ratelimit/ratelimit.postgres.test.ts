import { describe, expect, it } from "vitest";
import { PostgresRateLimitStore } from "../../../../src";

const hasPgRateLimit = Boolean(PostgresRateLimitStore);
const d = hasPgRateLimit ? describe : describe.skip;

d("PostgresRateLimitStore adapter (unit)", () => {
	it("exposes incrementAndCheck and check methods and can be constructed with a pg-like client", async () => {
		const PostgresRateLimitStoreCtor = PostgresRateLimitStore as any;

		const executed: { text: string; values?: unknown[] }[] = [];
		const client = {
			async query(text: string, values?: unknown[]) {
				executed.push({ text, values });
				return { rows: [], rowCount: 0 } as any;
			},
		} as any;

		const store = new PostgresRateLimitStoreCtor(client, {
			tableName: "usefulkey_rate_limits",
		});
		expect(typeof store.incrementAndCheck).toBe("function");
		expect(typeof store.check).toBe("function");

		const res = await store.check("svc", "id", 10, 1000);
		expect(res).toHaveProperty("success");
		expect(res).toHaveProperty("remaining");
		expect(res).toHaveProperty("reset");

		expect(executed.length).toBeGreaterThan(0);
	});
});

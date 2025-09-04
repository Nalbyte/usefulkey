import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryKeyStore, type UsefulKey, usefulkey } from "../../../src";
import { usageLimitsPerKey } from "../../../src/plugins/usage-limits-per-key";

describe("usage-limits-per-key plugin extensions", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
	});

	it("setUsesRemaining, getUsesRemaining, clearUsageLimit operate on store and emit analytics", async () => {
		const keyStore = new MemoryKeyStore();
		const analyticsEvents: Array<{ event: string; payload: any }> = [];
		const analytics = {
			async track(e: string, p: any) {
				analyticsEvents.push({ event: e, payload: p });
			},
		} as any;

		const uk = usefulkey(
			{ adapters: { keyStore, analytics } },
			{ plugins: [usageLimitsPerKey()] },
		) satisfies UsefulKey;

		const created = await uk.createKey({ usesRemaining: 5 });
		const id = created.result!.id;

		// getUsesRemaining
		const get1 = await (uk as any).getUsesRemaining(id);
		expect(get1).toBe(5);

		// setUsesRemaining
		await (uk as any).setUsesRemaining(id, 2);
		const get2 = await (uk as any).getUsesRemaining(id);
		expect(get2).toBe(2);
		expect(analyticsEvents.some((e) => e.event === "usage.set")).toBe(true);

		// clearUsageLimit -> null
		await (uk as any).clearUsageLimit(id);
		const get3 = await (uk as any).getUsesRemaining(id);
		expect(get3).toBeNull();
		expect(analyticsEvents.some((e) => e.event === "usage.cleared")).toBe(true);
	});

	it("topUpUses validates amount and returns updated remaining; initializes from null", async () => {
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey(
			{ adapters: { keyStore } },
			{ plugins: [usageLimitsPerKey()] },
		);

		const created = await uk.createKey();
		const id = created.result!.id;

		// invalid amounts
		await expect((uk as any).topUpUses(id, 0)).rejects.toMatchObject({
			code: "INVALID_ARGUMENT",
		});
		await expect((uk as any).topUpUses(id, -1)).rejects.toMatchObject({
			code: "INVALID_ARGUMENT",
		});

		// initialize from null -> treat as 0 and add
		const after = await (uk as any).topUpUses(id, 3);
		expect(after).toBe(3);
		const get = await (uk as any).getUsesRemaining(id);
		expect(get).toBe(3);
	});

	it("exposes extension flag and getUsesRemaining returns null for unknown id", async () => {
		const uk = usefulkey({}, { plugins: [usageLimitsPerKey()] }) as any;
		expect(uk.__hasUsageLimits).toBe(true);
		const missing = await uk.getUsesRemaining("missing");
		expect(missing).toBeNull();
	});

	it("verify decrements until zero then blocks with analytics", async () => {
		const keyStore = new MemoryKeyStore();
		const analyticsEvents: Array<{ event: string; payload: any }> = [];
		const analytics = {
			async track(e: string, p: any) {
				analyticsEvents.push({ event: e, payload: p });
			},
		} as any;

		const uk = usefulkey(
			{ adapters: { keyStore, analytics } },
			{ plugins: [usageLimitsPerKey()] },
		);

		const created = await uk.createKey({ usesRemaining: 2 });
		const key = created.result!.key as string;
		const id = created.result!.id as string;

		const v1 = await uk.verifyKey({ key });
		expect(v1.result?.valid).toBe(true);
		let remaining = await (uk as any).getUsesRemaining(id);
		expect(remaining).toBe(1);
		expect(
			analyticsEvents.some(
				(e) => e.event === "usage.decremented" && e.payload.remaining === 1,
			),
		).toBe(true);

		const v2 = await uk.verifyKey({ key });
		expect(v2.result?.valid).toBe(true);
		remaining = await (uk as any).getUsesRemaining(id);
		expect(remaining).toBe(0);
		expect(
			analyticsEvents.some(
				(e) => e.event === "usage.decremented" && e.payload.remaining === 0,
			),
		).toBe(true);

		const v3 = await uk.verifyKey({ key });
		expect(v3.result?.valid).toBe(false);
		expect(v3.result?.reason).toBe("usage_exceeded");
		expect(
			analyticsEvents.some(
				(e) => e.event === "usage.blocked" && e.payload.remaining === 0,
			),
		).toBe(true);
	});

	it("methods throw KEY_NOT_FOUND when id is missing", async () => {
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey(
			{ adapters: { keyStore } },
			{ plugins: [usageLimitsPerKey()] },
		);

		await expect(
			(uk as any).setUsesRemaining("missing", 1),
		).rejects.toMatchObject({ code: "KEY_NOT_FOUND" });
		await expect((uk as any).topUpUses("missing", 1)).rejects.toMatchObject({
			code: "KEY_NOT_FOUND",
		});
		await expect((uk as any).clearUsageLimit("missing")).rejects.toMatchObject({
			code: "KEY_NOT_FOUND",
		});
	});
});

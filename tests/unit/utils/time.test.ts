import { describe, expect, it, vi } from "vitest";
import { now, parseDuration } from "../../../src/utils/time";

describe("parseDuration", () => {
	it("parses numeric milliseconds", () => {
		expect(parseDuration(1500)).toBe(1500);
	});

	it("parses with units", () => {
		expect(parseDuration("1ms")).toBe(1);
		expect(parseDuration("2s")).toBe(2000);
		expect(parseDuration("3m")).toBe(180000);
		expect(parseDuration("4h")).toBe(14400000);
		expect(parseDuration("5d")).toBe(432000000);
	});

	it("throws on invalid", () => {
		expect(() => parseDuration("10" as unknown as string)).toThrowError();
		expect(() => parseDuration("1w" as unknown as string)).toThrowError();
	});

	it("supports decimals, uppercase, trimming, zero, and rejects non-finite numbers", () => {
		expect(parseDuration("1.5s")).toBe(1500);
		expect(parseDuration("1.4ms")).toBe(1);
		expect(parseDuration("1.6ms")).toBe(2);
		expect(parseDuration("2S")).toBe(2000);
		expect(parseDuration(" 3M ")).toBe(180000);
		expect(parseDuration("0ms")).toBe(0);
		expect(() => parseDuration(Number.NaN as unknown as number)).toThrowError();
		expect(() =>
			parseDuration(Number.POSITIVE_INFINITY as unknown as number),
		).toThrowError();
		expect(() => parseDuration("1 w" as unknown as string)).toThrowError();
	});
});

describe("now", () => {
	it("returns Date.now() value", () => {
		const spy = vi.spyOn(Date, "now").mockReturnValue(123456);
		try {
			expect(now()).toBe(123456);
		} finally {
			spy.mockRestore();
		}
	});
});

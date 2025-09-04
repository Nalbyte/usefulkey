/** Time helpers used across the project. */
import type { Milliseconds } from "../types/common";

/** Current epoch milliseconds. */
export function now(): number {
	return Date.now();
}

/**
 * Parse a duration like "1m" or "250ms" into milliseconds.
 *
 * Accepts a number (treated as already in milliseconds) or a shorthand string
 * with one of the following units: ms, s, m, h, d.
 * Throws a descriptive error for invalid input.
 */
export function parseDuration(input: string | number): Milliseconds {
	if (typeof input === "number" && Number.isFinite(input)) return input;

	if (typeof input !== "string") {
		throw new Error(`Invalid duration type: ${typeof input}`);
	}

	const match = input.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/i);
	if (!match) {
		throw new Error(
			`Invalid duration: "${input}". Expected formats like "250ms", "1s", "5m", "2h", "1d".`,
		);
	}
	const value = parseFloat(match[1]);
	const unit = match[2].toLowerCase();

	const multipliers: Record<string, number> = {
		ms: 1,
		s: 1000,
		m: 60_000,
		h: 3_600_000,
		d: 86_400_000,
	};

	if (!(unit in multipliers)) {
		throw new Error(`Unsupported duration unit: "${unit}"`);
	}

	return Math.round(value * multipliers[unit]);
}

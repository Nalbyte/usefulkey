/**
 * In‑memory rate limit store adapter.
 *
 * Implements fixed window counters and a token bucket with linear
 * refill. Suitable for tests and single‑process development servers.
 */
import type { RateLimitStoreAdapter } from "../../types/common";
import { now } from "../../utils/time";

export class MemoryRateLimitStore implements RateLimitStoreAdapter {
	readonly ready?: Promise<void>;
	private windows = new Map<string, { count: number; reset: number }>();
	private buckets = new Map<
		string,
		{
			tokens: number;
			lastRefill: number;
			capacity: number;
			refillTokens: number;
			refillIntervalMs: number;
		}
	>();

	/** Compose a unique key per namespace+identifier. */
	private key(namespace: string, identifier: string): string {
		return `${namespace}:${identifier}`;
	}

	/** Increment and check a fixed-window counter in one step. */
	async incrementAndCheck(
		namespace: string,
		identifier: string,
		limit: number,
		durationMs: number,
	): Promise<{ success: boolean; remaining: number; reset: number }> {
		const k = this.key(namespace, identifier);
		const nowMs = now();
		const entry = this.windows.get(k);
		if (!entry || entry.reset <= nowMs) {
			const reset = nowMs + durationMs;
			this.windows.set(k, { count: 1, reset });
			return { success: true, remaining: Math.max(0, limit - 1), reset };
		}
		if (entry.count < limit) {
			entry.count += 1;
			return {
				success: true,
				remaining: Math.max(0, limit - entry.count),
				reset: entry.reset,
			};
		}
		return { success: false, remaining: 0, reset: entry.reset };
	}

	/** Check current usage without incrementing the window counter. */
	async check(
		namespace: string,
		identifier: string,
		limit: number,
		durationMs: number,
	): Promise<{ success: boolean; remaining: number; reset: number }> {
		const k = this.key(namespace, identifier);
		const nowMs = now();
		const entry = this.windows.get(k);
		if (!entry || entry.reset <= nowMs) {
			const reset = nowMs + durationMs;
			return { success: true, remaining: Math.max(0, limit), reset };
		}
		if (entry.count < limit) {
			return {
				success: true,
				remaining: Math.max(0, limit - entry.count),
				reset: entry.reset,
			};
		}
		return { success: false, remaining: 0, reset: entry.reset };
	}

	/** Consume tokens from a rolling token bucket with linear refill. */
	async consumeTokenBucket(
		namespace: string,
		identifier: string,
		capacity: number,
		refillTokens: number,
		refillIntervalMs: number,
		cost: number = 1,
	): Promise<{ success: boolean; remaining: number; reset: number }> {
		const key = `${namespace}:${identifier}`;
		const nowMs = now();
		let bucket = this.buckets.get(key);
		if (!bucket) {
			bucket = {
				tokens: capacity,
				lastRefill: nowMs,
				capacity,
				refillTokens,
				refillIntervalMs,
			};
			this.buckets.set(key, bucket);
		}

		const elapsed = Math.max(0, nowMs - bucket.lastRefill);
		if (elapsed > 0) {
			const tokensToAdd = (elapsed / refillIntervalMs) * refillTokens;
			bucket.tokens = Math.min(bucket.capacity, bucket.tokens + tokensToAdd);

			bucket.lastRefill = nowMs;
		}

		if (bucket.tokens >= cost) {
			bucket.tokens -= cost;
			const remaining = Math.floor(bucket.tokens);

			const missing = bucket.capacity - bucket.tokens;
			const intervalsNeeded = missing / refillTokens;
			const reset = nowMs + Math.ceil(intervalsNeeded * refillIntervalMs);
			return { success: true, remaining, reset };
		}

		const needed = cost - bucket.tokens;
		const intervalsNeeded = needed / refillTokens;
		const wait = Math.ceil(intervalsNeeded * refillIntervalMs);
		const reset = nowMs + wait;
		return {
			success: false,
			remaining: Math.floor(Math.max(0, bucket.tokens)),
			reset,
		};
	}

	/** Clear both window and token bucket state for the identifier. */
	async reset(namespace: string, identifier: string): Promise<void> {
		const k = this.key(namespace, identifier);
		this.windows.delete(k);
		this.buckets.delete(k);
	}
}

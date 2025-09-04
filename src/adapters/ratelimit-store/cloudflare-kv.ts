import type { KvLikeClient } from "../../types/adapters";
import type { Milliseconds, RateLimitStoreAdapter } from "../../types/common";
import { now } from "../../utils/time";

/**
 * Cloudflare KV-backed rate limit store.
 *
 * Implements fixed-window via a single key with expiration and a numeric count
 * encoded in the value. Implements token bucket via a single key storing
 * "tokens:lastRefill" with no intrinsic TTL. Can accept either the generic
 * interface or native KVNamespace objects directly.
 */
export class CloudflareKvRateLimitStore implements RateLimitStoreAdapter {
	readonly ready?: Promise<void>;

	constructor(
		private readonly kv: KvLikeClient,
		private readonly options: { keyPrefix?: string } = {},
	) {}

	private key(namespace: string, identifier: string): string {
		const prefix = this.options.keyPrefix ?? "usefulkey:rl";
		return `${prefix}:${namespace}:${identifier}`;
	}

	async incrementAndCheck(
		namespace: string,
		identifier: string,
		limit: number,
		durationMs: Milliseconds,
	): Promise<{ success: boolean; remaining: number; reset: number }> {
		const k = this.key(namespace, identifier);
		const kNow = now();
		const ttlSeconds = Math.ceil(durationMs / 1000);

		const raw = await this.kv.get(k, "text");
		if (!raw) {
			await this.kv.put(k, "1", { expirationTtl: ttlSeconds });
			return {
				success: true,
				remaining: Math.max(0, limit - 1),
				reset: kNow + durationMs,
			};
		}

		const current = Number(raw);
		const next = Number.isNaN(current) ? 1 : current + 1;
		await this.kv.put(k, String(next), { expirationTtl: ttlSeconds });
		if (next <= limit) {
			return {
				success: true,
				remaining: Math.max(0, limit - next),
				reset: kNow + durationMs,
			};
		}
		return { success: false, remaining: 0, reset: kNow + durationMs };
	}

	async check(
		namespace: string,
		identifier: string,
		limit: number,
		durationMs: Milliseconds,
	): Promise<{ success: boolean; remaining: number; reset: number }> {
		const kNow = now();
		const raw = await this.kv.get(this.key(namespace, identifier), "text");
		if (!raw) {
			return { success: true, remaining: limit, reset: kNow + durationMs };
		}
		const current = Number(raw);
		if (Number.isNaN(current) || current < limit) {
			return {
				success: true,
				remaining: Math.max(0, limit - (Number.isNaN(current) ? 0 : current)),
				reset: kNow + durationMs,
			};
		}
		return { success: false, remaining: 0, reset: kNow + durationMs };
	}

	async consumeTokenBucket(
		namespace: string,
		identifier: string,
		capacity: number,
		refillTokens: number,
		refillIntervalMs: number,
		cost: number = 1,
	): Promise<{ success: boolean; remaining: number; reset: number }> {
		const k = this.key(namespace, identifier);
		const kNow = now();

		const raw = await this.kv.get(k, "text");
		let tokens = capacity;
		let lastRefill = kNow;
		if (raw?.includes(":")) {
			const sep = raw.indexOf(":");
			tokens = Number(raw.slice(0, sep));
			lastRefill = Number(raw.slice(sep + 1));
			if (Number.isNaN(tokens)) tokens = capacity;
			if (Number.isNaN(lastRefill)) lastRefill = kNow;
		}

		const elapsed = Math.max(0, kNow - lastRefill);
		if (elapsed > 0) {
			const add = (elapsed / refillIntervalMs) * refillTokens;
			tokens = Math.min(capacity, tokens + add);
			lastRefill = kNow;
		}

		if (tokens >= cost) {
			tokens -= cost;
			const remaining = Math.floor(tokens);
			const missing = capacity - tokens;
			const intervalsNeeded = missing / refillTokens;
			const reset = kNow + Math.ceil(intervalsNeeded * refillIntervalMs);
			await this.kv.put(k, `${tokens}:${lastRefill}`);
			return { success: true, remaining, reset };
		}

		const needed = cost - tokens;
		const reset = kNow + Math.ceil((needed / refillTokens) * refillIntervalMs);
		await this.kv.put(k, `${tokens}:${lastRefill}`);
		return {
			success: false,
			remaining: Math.floor(Math.max(0, tokens)),
			reset,
		};
	}

	async reset(namespace: string, identifier: string): Promise<void> {
		if (typeof this.kv.delete === "function") {
			await this.kv.delete(this.key(namespace, identifier));
		} else {
			await this.kv.put(this.key(namespace, identifier), "0", {
				expirationTtl: 1,
			});
		}
	}
}

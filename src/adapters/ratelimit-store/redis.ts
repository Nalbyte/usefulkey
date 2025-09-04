/**
 * Redis-backed rate limit store.
 *
 * Supports fixed window counters and a rolling token bucket using Lua scripts
 * for atomic operations when available. Falls back to simpler commands when
 * EVAL is not supported, with a note on potential race conditions.
 */
import type { RedisCommand } from "../../types/adapters";
import type { Milliseconds, RateLimitStoreAdapter } from "../../types/common";
import { now } from "../../utils/time";

/**
 * Fixed-window rate limiter backed by Redis.
 * Uses a single key per (namespace, identifier) with a TTL matching the window duration.
 */
export class RedisRateLimitStore implements RateLimitStoreAdapter {
	readonly ready?: Promise<void>;

	constructor(
		private readonly client: any,
		private readonly options: { keyPrefix?: string } = {},
	) {
		this.ready = this.initialize();
	}

	private async initialize(): Promise<void> {
		if (this.client.ping) {
			await this.client.ping();
			return;
		}
		if (this.client.get) {
			const k = `${this.options.keyPrefix ?? "usefulkey:rl"}:__uk_ping__`;
			await this.client.get(k);
			return;
		}
	}

	private key(namespace: string, identifier: string): string {
		const prefix = this.options.keyPrefix ?? "usefulkey:rl";
		return `${prefix}:${namespace}:${identifier}`;
	}

	private async pexpire(key: string, ttlMs: number): Promise<void> {
		if (this.client.pExpire) {
			await this.client.pExpire(key, ttlMs);
			return;
		}
		if (this.client.pexpire) {
			await this.client.pexpire(key, ttlMs);
			return;
		}
		if (this.client.set) {
			const current = (await this.client.get?.(key)) ?? "0";
			await this.client.set(key, current, "PX", ttlMs);
			return;
		}
		throw new Error("Redis client must support pExpire/pexpire or set PX");
	}

	private async pttl(key: string): Promise<number> {
		if (this.client.pTtl) {
			return Number(await this.client.pTtl(key));
		}
		if (this.client.pttl) {
			return Number(await this.client.pttl(key));
		}
		if (this.client.ttl) {
			const seconds = Number(await this.client.ttl(key));
			return seconds > 0 ? seconds * 1000 : -1;
		}
		return -1;
	}

	async incrementAndCheck(
		namespace: string,
		identifier: string,
		limit: number,
		durationMs: Milliseconds,
	): Promise<{ success: boolean; remaining: number; reset: number }> {
		const k = this.key(namespace, identifier);

		const script = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl_ms = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])

local current = redis.call('INCR', key)
if current == 1 then
  redis.call('PEXPIRE', key, ttl_ms)
  return {1, limit - 1, now_ms + ttl_ms}
end

local remaining = limit - current
local pttl = redis.call('PTTL', key)
local reset = now_ms + (pttl > 0 and pttl or ttl_ms)
if current <= limit then
  return {1, math.max(0, remaining), reset}
else
  return {0, 0, reset}
end`;

		if (this.client.eval) {
			const res = (await this.client.eval(
				script,
				1,
				k,
				String(limit),
				String(durationMs),
				String(now()),
			)) as [number, number, number];
			const success = res[0] === 1;
			return { success, remaining: res[1], reset: res[2] };
		}

		if (!(this.client as { incr?: RedisCommand }).incr) {
			throw new Error("Redis client must support eval or incr");
		}
		const count = Number(
			await (this.client as { incr?: RedisCommand }).incr?.(k),
		);
		let pttl = await this.pttl(k);
		if (count === 1 || pttl < 0) {
			await this.pexpire(k, durationMs);
			pttl = durationMs;
		}
		const resetTs = now() + (pttl > 0 ? pttl : durationMs);
		if (count <= limit) {
			return {
				success: true,
				remaining: Math.max(0, limit - count),
				reset: resetTs,
			};
		}
		return { success: false, remaining: 0, reset: resetTs };
	}

	async check(
		namespace: string,
		identifier: string,
		limit: number,
		durationMs: Milliseconds,
	): Promise<{ success: boolean; remaining: number; reset: number }> {
		const k = this.key(namespace, identifier);
		const pttl = await this.pttl(k);
		const resetTs = now() + (pttl > 0 ? pttl : durationMs);

		if ((this.client as { get?: RedisCommand }).get) {
			const v = await (this.client as { get?: RedisCommand }).get?.(k);
			const count = Number(v ?? 0);
			if (!v || Number.isNaN(count) || pttl <= 0) {
				return { success: true, remaining: limit, reset: resetTs };
			}
			if (count < limit) {
				return {
					success: true,
					remaining: Math.max(0, limit - count),
					reset: resetTs,
				};
			}
			return { success: false, remaining: 0, reset: resetTs };
		}

		return { success: true, remaining: limit, reset: resetTs };
	}
	//TODO Simplify this haha
	async consumeTokenBucket(
		namespace: string,
		identifier: string,
		capacity: number,
		refillTokens: number,
		refillIntervalMs: Milliseconds,
		cost: number = 1,
	): Promise<{ success: boolean; remaining: number; reset: number }> {
		const k = this.key(namespace, identifier);
		const script = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillTokens = tonumber(ARGV[2])
local refillIntervalMs = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local nowMs = tonumber(ARGV[5])

local data = redis.call('GET', key)
local tokens
local lastRefill
if data then
  local sep = string.find(data, ':')
  tokens = tonumber(string.sub(data, 1, sep - 1))
  lastRefill = tonumber(string.sub(data, sep + 1))
else
  tokens = capacity
  lastRefill = nowMs
end

local elapsed = math.max(0, nowMs - lastRefill)
if elapsed > 0 then
  local add = (elapsed / refillIntervalMs) * refillTokens
  tokens = math.min(capacity, tokens + add)
  lastRefill = nowMs
end

if tokens >= cost then
  tokens = tokens - cost
  local remaining = math.floor(tokens)
  local missing = capacity - tokens
  local intervalsNeeded = missing / refillTokens
  local reset = nowMs + math.ceil(intervalsNeeded * refillIntervalMs)
  redis.call('SET', key, tostring(tokens)..':'..tostring(lastRefill))
  return {1, remaining, reset}
else
  local needed = cost - tokens
  local intervalsNeeded = needed / refillTokens
  local wait = math.ceil(intervalsNeeded * refillIntervalMs)
  local reset = nowMs + wait
  redis.call('SET', key, tostring(tokens)..':'..tostring(lastRefill))
  return {0, math.floor(math.max(0, tokens)), reset}
end`;

		if (this.client.eval) {
			const res = (await this.client.eval(
				script,
				1,
				k,
				String(capacity),
				String(refillTokens),
				String(refillIntervalMs),
				String(cost),
				String(now()),
			)) as [number, number, number];
			const success = res[0] === 1;
			return { success, remaining: res[1], reset: res[2] };
		}

		if (
			!(this.client as { get?: RedisCommand }).get ||
			!(this.client as { set?: RedisCommand }).set
		) {
			throw new Error(
				"Redis client must support eval or get/set for token bucket",
			);
		}
		const nowMs = now();
		const raw = (await (this.client as { get?: RedisCommand }).get?.(k)) as
			| string
			| undefined;
		let tokens = capacity;
		let lastRefill = nowMs;
		if (raw?.includes(":")) {
			const sep = raw.indexOf(":");
			tokens = Number(raw.slice(0, sep));
			lastRefill = Number(raw.slice(sep + 1));
		}
		const elapsed = Math.max(0, nowMs - lastRefill);
		if (elapsed > 0) {
			const add = (elapsed / refillIntervalMs) * refillTokens;
			tokens = Math.min(capacity, tokens + add);
			lastRefill = nowMs;
		}
		if (tokens >= cost) {
			tokens -= cost;
			const remaining = Math.floor(tokens);
			const missing = capacity - tokens;
			const reset =
				nowMs + Math.ceil((missing / refillTokens) * refillIntervalMs);
			await (this.client as { set?: RedisCommand }).set?.(
				k,
				`${tokens}:${lastRefill}`,
			);
			return { success: true, remaining, reset };
		}
		const needed = cost - tokens;
		const reset = nowMs + Math.ceil((needed / refillTokens) * refillIntervalMs);
		await (this.client as { set?: RedisCommand }).set?.(
			k,
			`${tokens}:${lastRefill}`,
		);
		return {
			success: false,
			remaining: Math.floor(Math.max(0, tokens)),
			reset,
		};
	}

	async reset(namespace: string, identifier: string): Promise<void> {
		const kFixed = this.key(namespace, identifier);
		if (this.client.del) {
			await this.client.del(kFixed);
		}
		if (this.client.del) {
			await this.client.del(kFixed);
		}
	}
}

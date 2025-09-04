/**
 * Rate limiting configuration types.
 *
 * These define different ways to limit how often API keys can be used,
 * helping prevent abuse and control usage costs.
 */
/** Rate limiting that resets at fixed time intervals (like "100 requests per hour"). */
export type RateLimitFixedWindow = {
	kind: "fixed";
	/** Maximum number of requests allowed in the time window. */
	limit: number;
	/** How long each time window lasts (like "1h" for 1 hour, or 3600000 for milliseconds). */
	duration: string | number;
};

/** Rate limiting using a "token bucket" - allows bursts but smooths out usage over time. */
export type RateLimitTokenBucket = {
	kind: "tokenBucket";
	/** Maximum number of tokens the bucket can hold (controls burst capacity). */
	capacity: number;
	/** How tokens are added back over time. */
	refill: { tokens: number; interval: string | number };
	/** How many tokens this request costs (usually 1). */
	cost?: number;
};

/** Either a fixed window or token bucket rate limiting configuration. */
export type RateLimitRequest = RateLimitFixedWindow | RateLimitTokenBucket;

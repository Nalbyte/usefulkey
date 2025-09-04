import type { VerifyOptions } from "../../types/common";
import type { RatelimitArgs, UsefulKeyPlugin } from "../../types/plugins";
import type { RateLimitRequest } from "../../types/ratelimit";
import { now, parseDuration } from "../../utils/time";

export function ratelimit(args?: RatelimitArgs): UsefulKeyPlugin<{
	__hasRateLimit: true;
}> {
	const identify = (
		args && typeof (args as any).identify === "function"
			? (args as any).identify
			: (i: VerifyOptions) => i.identifier ?? i.ip ?? i.key ?? null
	) as (i: VerifyOptions) => string | null;
	const defaults: RateLimitRequest | undefined =
		args && (args as any).default
			? (args as any).default
			: args && typeof (args as any).limit === "number"
				? ({
						kind: "fixed",
						limit: (args as any).limit,
						duration: (args as any).duration,
					} as RateLimitRequest)
				: undefined;
	const reason = (args && (args as any).reason) ?? "rate_limited";
	const analyticsKind = args && (args as any).analyticsKind;

	return (ctx) => ({
		name: "ratelimit",
		async beforeVerify(_uk, { key, ip, identifier, namespace, rateLimit }) {
			const id = identify({ key, ip, identifier } as any);

			if (!namespace) {
				return { reject: true, reason: "namespace_required" };
			}

			if (!id) return;
			const cfg: RateLimitRequest | undefined = rateLimit ?? defaults;
			if (!cfg) return;

			let result: { success: boolean; remaining: number; reset: number };
			if (cfg.kind === "fixed") {
				const windowMs = parseDuration(cfg.duration);
				result = await ctx.rateLimitStore.incrementAndCheck(
					namespace,
					id,
					cfg.limit,
					windowMs,
				);
			} else if (cfg.kind === "tokenBucket") {
				const refillMs = parseDuration(cfg.refill.interval);
				result = await ctx.rateLimitStore.consumeTokenBucket(
					namespace,
					id,
					cfg.capacity,
					cfg.refill.tokens,
					refillMs,
					cfg.cost ?? 1,
				);
			} else {
				return;
			}
			if (!result.success) {
				try {
					await ctx.analytics.track("ratelimit.blocked", {
						kind: analyticsKind ?? (cfg.kind === "fixed" ? "fixed" : cfg.kind),
						namespace,
						identifier: id,
						reset: result.reset,
						limit: (cfg as any).limit,
						capacity: (cfg as any).capacity,
						remaining: 0,
						ts: now(),
					});
				} catch {}
				return { reject: true, reason };
			}
		},
		extend: { __hasRateLimit: true as const },
	});
}

import type { IpAccessControlArgs } from "../../types/common";
import { ErrorCodes } from "../../types/common";
import type { UsefulKeyPlugin } from "../../types/plugins";
import { toError } from "../../utils/error";
import { now } from "../../utils/time";

// Static (hardcoded) IP access control. Lists are captured at startup.
export function ipAccessControlStatic(
	args: IpAccessControlArgs = {},
): UsefulKeyPlugin<{ __hasIpAccessControlStatic: true }> {
	const allow = new Set(args.allow ?? []);
	const deny = new Set(args.deny ?? []);
	return (ctx) => ({
		name: "ip-access-control:static",
		async beforeVerify(_ctx, { ip }) {
			if (!ip) return;
			if (deny.size > 0 && deny.has(ip)) {
				try {
					await ctx.analytics.track("ip_access.blocked", {
						ip,
						rule: "deny",
						plugin: "ip-access-control:static",
						ts: now(),
					});
				} catch (err) {
					console.error(
						`Error tracking ip_access.blocked event`,
						toError(err, ErrorCodes.ANALYTICS_TRACK_FAILED, {
							op: "ip_access.blocked",
							ip,
						}),
					);
				}
				return { reject: true, reason: "ip_denied" };
			}
			if (allow.size > 0 && !allow.has(ip)) {
				try {
					await ctx.analytics.track("ip_access.blocked", {
						ip,
						rule: "allow_list_missing",
						plugin: "ip-access-control:static",
						ts: now(),
					});
				} catch (err) {
					console.error(
						`Error tracking ip_access.blocked event`,
						toError(err, ErrorCodes.ANALYTICS_TRACK_FAILED, {
							op: "ip_access.blocked",
							ip,
						}),
					);
				}
				return { reject: true, reason: "ip_not_allowed" };
			}
			// Allowed path
			try {
				await ctx.analytics.track("ip_access.allowed", {
					ip,
					rule: allow.size > 0 ? "allow" : "no_rule",
					plugin: "ip-access-control:static",
					ts: now(),
				});
			} catch (err) {
				console.error(
					`Error tracking ip_access.allowed event`,
					toError(err, ErrorCodes.ANALYTICS_TRACK_FAILED, {
						op: "ip_access.allowed",
						ip,
					}),
				);
			}
		},
		extend: { __hasIpAccessControlStatic: true as const },
	});
}

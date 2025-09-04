import type { IpAccessControlArgs } from "../../types/common";
import type { UsefulKeyPlugin } from "../../types/plugins";
import { now } from "../../utils/time";

// In-memory (mutable) IP access control. Lists can be changed at runtime.
export function ipAccessControlMemory(
	initial: IpAccessControlArgs = {},
): UsefulKeyPlugin<{
	ipAccessControl: {
		addAllow: (ip: string) => void;
		removeAllow: (ip: string) => void;
		clearAllow: () => void;
		addDeny: (ip: string) => void;
		removeDeny: (ip: string) => void;
		clearDeny: () => void;
		getAllow: () => string[];
		getDeny: () => string[];
	};
}> {
	const allow = new Set(initial.allow ?? []);
	const deny = new Set(initial.deny ?? []);

	return (ctx) => ({
		name: "ip-access-control:memory",
		async beforeVerify(_ctx, { ip }) {
			if (!ip) return;
			if (deny.size > 0 && deny.has(ip)) {
				try {
					await ctx.analytics.track("ip_access.blocked", {
						ip,
						rule: "deny",
						plugin: "ip-access-control:memory",
						ts: now(),
					});
				} catch {}
				return { reject: true, reason: "ip_denied" };
			}
			if (allow.size > 0 && !allow.has(ip)) {
				try {
					await ctx.analytics.track("ip_access.blocked", {
						ip,
						rule: "allow_list_missing",
						plugin: "ip-access-control:memory",
						ts: now(),
					});
				} catch {}
				return { reject: true, reason: "ip_not_allowed" };
			}

			try {
				await ctx.analytics.track("ip_access.allowed", {
					ip,
					rule: allow.size > 0 ? "allow" : "no_rule",
					plugin: "ip-access-control:memory",
					ts: now(),
				});
			} catch {}
		},
		extend: {
			ipAccessControl: {
				addAllow(ip: string) {
					allow.add(ip);
					void ctx.analytics.track("ip_access.allow_added", {
						ip,
						plugin: "ip-access-control:memory",
						ts: now(),
					});
				},
				removeAllow(ip: string) {
					allow.delete(ip);
					void ctx.analytics.track("ip_access.allow_removed", {
						ip,
						plugin: "ip-access-control:memory",
						ts: now(),
					});
				},
				clearAllow() {
					allow.clear();
					void ctx.analytics.track("ip_access.allow_cleared", {
						plugin: "ip-access-control:memory",
						ts: now(),
					});
				},
				addDeny(ip: string) {
					deny.add(ip);
					void ctx.analytics.track("ip_access.deny_added", {
						ip,
						plugin: "ip-access-control:memory",
						ts: now(),
					});
				},
				removeDeny(ip: string) {
					deny.delete(ip);
					void ctx.analytics.track("ip_access.deny_removed", {
						ip,
						plugin: "ip-access-control:memory",
						ts: now(),
					});
				},
				clearDeny() {
					deny.clear();
					void ctx.analytics.track("ip_access.deny_cleared", {
						plugin: "ip-access-control:memory",
						ts: now(),
					});
				},
				getAllow: () => Array.from(allow),
				getDeny: () => Array.from(deny),
			},
		},
	});
}

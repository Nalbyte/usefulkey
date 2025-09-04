import type { IpAccessControlArgs } from "../../types/common";
import { ErrorCodes, type KeyRecord } from "../../types/common";
import type { UsefulKeyPlugin } from "../../types/plugins";
import { toError } from "../../utils/error";
import { now } from "../../utils/time";

/**
 * Keystore-backed (persistent) IP access control.
 *
 * Stores allow/deny lists in a reserved record's metadata in the configured
 * KeyStoreAdapter. Lists can be changed at runtime and persist across restarts.
 */
export function ipAccessControlKeystore(
	initial: IpAccessControlArgs & { recordId?: string } = {},
): UsefulKeyPlugin<{
	ipAccessControlStore: {
		addAllow: (ip: string) => Promise<void>;
		removeAllow: (ip: string) => Promise<void>;
		clearAllow: () => Promise<void>;
		addDeny: (ip: string) => Promise<void>;
		removeDeny: (ip: string) => Promise<void>;
		clearDeny: () => Promise<void>;
		getAllow: () => Promise<string[]>;
		getDeny: () => Promise<string[]>;
		refresh: () => Promise<void>;
	};
}> {
	const recordId = initial.recordId ?? "__uk_ip_acl__";
	const allow = new Set<string>(initial.allow ?? []);
	const deny = new Set<string>(initial.deny ?? []);
	let loaded = false;

	async function loadFromStore(ctx: {
		keyStore: { findKeyById: (id: string) => Promise<KeyRecord | null> };
	}): Promise<void> {
		const existing = await ctx.keyStore.findKeyById(recordId);
		if (existing?.metadata && typeof existing.metadata === "object") {
			const metaAllow = Array.isArray((existing.metadata as any).allow)
				? ((existing.metadata as any).allow as string[])
				: [];
			const metaDeny = Array.isArray((existing.metadata as any).deny)
				? ((existing.metadata as any).deny as string[])
				: [];
			allow.clear();
			deny.clear();
			for (const ip of metaAllow) allow.add(ip);
			for (const ip of metaDeny) deny.add(ip);
		}
		loaded = true;
	}

	async function ensureLoaded(ctx: {
		keyStore: { findKeyById: (id: string) => Promise<KeyRecord | null> };
	}): Promise<void> {
		if (!loaded) await loadFromStore(ctx);
	}

	async function ensureExists(ctx: {
		keyStore: {
			findKeyById: (id: string) => Promise<KeyRecord | null>;
			createKey: (record: KeyRecord) => Promise<void>;
		};
	}): Promise<void> {
		const existing = await ctx.keyStore.findKeyById(recordId);
		if (existing) return;
		const record: KeyRecord = {
			id: recordId,
			userId: null,
			prefix: "",
			keyHash: "__meta_ip_acl__",
			createdAt: now(),
			expiresAt: null,
			metadata: { allow: Array.from(allow), deny: Array.from(deny) },
			revokedAt: null,
			usesRemaining: null,
		};
		await ctx.keyStore.createKey(record);
	}

	async function saveToStore(ctx: {
		keyStore: {
			findKeyById: (id: string) => Promise<KeyRecord | null>;
			updateKey: (record: KeyRecord) => Promise<void>;
			createKey: (record: KeyRecord) => Promise<void>;
		};
	}): Promise<void> {
		const existing = await ctx.keyStore.findKeyById(recordId);
		if (!existing) {
			await ensureExists(ctx);
			return;
		}
		const updated: KeyRecord = {
			...existing,
			metadata: {
				...(existing.metadata ?? {}),
				allow: Array.from(allow),
				deny: Array.from(deny),
			},
		};
		await ctx.keyStore.updateKey(updated);
	}

	return (ctx) => ({
		name: "ip-access-control:keystore",
		async setup() {
			try {
				await ensureExists(ctx);
			} catch {}
			try {
				await loadFromStore(ctx);
			} catch {}
		},
		async beforeVerify(_ctx, { ip }) {
			await ensureLoaded(ctx);
			if (!ip) return;
			if (deny.size > 0 && deny.has(ip)) {
				try {
					await ctx.analytics.track("ip_access.blocked", {
						ip,
						rule: "deny",
						plugin: "ip-access-control:keystore",
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
						plugin: "ip-access-control:keystore",
						ts: now(),
					});
				} catch {}
				return { reject: true, reason: "ip_not_allowed" };
			}

			try {
				await ctx.analytics.track("ip_access.allowed", {
					ip,
					rule: allow.size > 0 ? "allow" : "no_rule",
					plugin: "ip-access-control:keystore",
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
		extend: {
			ipAccessControlStore: {
				async addAllow(ip: string) {
					await ensureLoaded(ctx);
					allow.add(ip);
					await saveToStore(ctx);
					void ctx.analytics.track("ip_access.allow_added", {
						ip,
						plugin: "ip-access-control:keystore",
						ts: now(),
					});
				},
				async removeAllow(ip: string) {
					await ensureLoaded(ctx);
					allow.delete(ip);
					await saveToStore(ctx);
					void ctx.analytics.track("ip_access.allow_removed", {
						ip,
						plugin: "ip-access-control:keystore",
						ts: now(),
					});
				},
				async clearAllow() {
					await ensureLoaded(ctx);
					allow.clear();
					await saveToStore(ctx);
					void ctx.analytics.track("ip_access.allow_cleared", {
						plugin: "ip-access-control:keystore",
						ts: now(),
					});
				},
				async addDeny(ip: string) {
					await ensureLoaded(ctx);
					deny.add(ip);
					await saveToStore(ctx);
					void ctx.analytics.track("ip_access.deny_added", {
						ip,
						plugin: "ip-access-control:keystore",
						ts: now(),
					});
				},
				async removeDeny(ip: string) {
					await ensureLoaded(ctx);
					deny.delete(ip);
					await saveToStore(ctx);
					void ctx.analytics.track("ip_access.deny_removed", {
						ip,
						plugin: "ip-access-control:keystore",
						ts: now(),
					});
				},
				async clearDeny() {
					await ensureLoaded(ctx);
					deny.clear();
					await saveToStore(ctx);
					void ctx.analytics.track("ip_access.deny_cleared", {
						plugin: "ip-access-control:keystore",
						ts: now(),
					});
				},
				async getAllow() {
					await ensureLoaded(ctx);
					return Array.from(allow);
				},
				async getDeny() {
					await ensureLoaded(ctx);
					return Array.from(deny);
				},
				async refresh() {
					await loadFromStore(ctx);
				},
			},
		},
	});
}

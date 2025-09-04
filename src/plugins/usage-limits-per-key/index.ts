import { ErrorCodes, type KeyId } from "../../types/common";
import type { UsefulKeyPlugin } from "../../types/plugins";
import { toError } from "../../utils/error";
import { now } from "../../utils/time";

export function usageLimitsPerKey(): UsefulKeyPlugin<{
	__hasUsageLimits: true;
	setUsesRemaining: (id: KeyId, remaining: number | null) => Promise<void>;
	topUpUses: (id: KeyId, amount: number) => Promise<number | null>;
	getUsesRemaining: (id: KeyId) => Promise<number | null>;
	clearUsageLimit: (id: KeyId) => Promise<void>;
}> {
	return (ctx) => ({
		name: "usage-limits-per-key",
		async onKeyRecordLoaded(_ctx, { record }) {
			if (
				typeof record.usesRemaining === "number" &&
				record.usesRemaining <= 0
			) {
				try {
					await ctx.analytics.track("usage.blocked", {
						keyId: record.id,
						userId: record.userId,
						remaining: 0,
						ts: now(),
					});
				} catch (err) {
					console.error(
						`Error tracking usage.blocked event`,
						toError(err, ErrorCodes.ANALYTICS_TRACK_FAILED, {
							op: "usage.blocked",
							keyId: record.id,
						}),
					);
				}
				return { reject: true, reason: "usage_exceeded" };
			}
		},
		async onVerifySuccess(ctx, { record }) {
			if (
				typeof record.usesRemaining === "number" &&
				record.usesRemaining > 0
			) {
				const updated = { ...record, usesRemaining: record.usesRemaining - 1 };
				await ctx.keyStore.updateKey(updated);
				try {
					await ctx.analytics.track("usage.decremented", {
						keyId: record.id,
						userId: record.userId,
						remaining: updated.usesRemaining,
						ts: now(),
					});
				} catch (err) {
					console.error(
						`Error tracking usage.decremented event`,
						toError(err, ErrorCodes.ANALYTICS_TRACK_FAILED, {
							op: "usage.decremented",
							keyId: record.id,
						}),
					);
				}
			}
		},
		extend: {
			__hasUsageLimits: true as const,
			async setUsesRemaining(id: KeyId, remaining: number | null) {
				const record = await ctx.keyStore.findKeyById(id);
				if (!record) {
					const normalized = toError(
						new Error("key not found"),
						"KEY_NOT_FOUND",
						{
							plugin: "usage-limits-per-key",
							op: "setUsesRemaining",
							keyId: id,
						},
					);
					const err = Object.assign(new Error(normalized.message), normalized);
					throw err;
				}
				const updated = { ...record, usesRemaining: remaining ?? null };
				await ctx.keyStore.updateKey(updated);
				try {
					await ctx.analytics.track("usage.set", {
						keyId: id,
						userId: record.userId,
						remaining: updated.usesRemaining ?? null,
						ts: now(),
					});
				} catch (err) {
					console.error(
						`Error tracking usage.set event`,
						toError(err, ErrorCodes.ANALYTICS_TRACK_FAILED, {
							op: "usage.set",
							keyId: id,
						}),
					);
				}
			},
			async topUpUses(id: KeyId, amount: number) {
				if (
					typeof amount !== "number" ||
					!Number.isFinite(amount) ||
					amount <= 0
				) {
					const normalized = toError(
						new Error("amount must be > 0"),
						"INVALID_ARGUMENT",
						{
							plugin: "usage-limits-per-key",
							op: "topUpUses",
							keyId: id,
							amount,
						},
					);
					const err = Object.assign(new Error(normalized.message), normalized);
					throw err;
				}
				const record = await ctx.keyStore.findKeyById(id);
				if (!record) {
					const normalized = toError(
						new Error("key not found"),
						"KEY_NOT_FOUND",
						{
							plugin: "usage-limits-per-key",
							op: "topUpUses",
							keyId: id,
						},
					);
					const err = Object.assign(new Error(normalized.message), normalized);
					throw err;
				}
				const current =
					typeof record.usesRemaining === "number" ? record.usesRemaining : 0;
				const updatedRemaining = current + amount;
				const updated = { ...record, usesRemaining: updatedRemaining };
				await ctx.keyStore.updateKey(updated);
				try {
					await ctx.analytics.track("usage.topped_up", {
						keyId: id,
						userId: record.userId,
						added: amount,
						remaining: updatedRemaining,
						ts: now(),
					});
				} catch (err) {
					console.error(
						`Error tracking usage.topped_up event`,
						toError(err, ErrorCodes.ANALYTICS_TRACK_FAILED, {
							op: "usage.topped_up",
							keyId: id,
						}),
					);
				}
				return updatedRemaining;
			},
			async getUsesRemaining(id: KeyId) {
				const record = await ctx.keyStore.findKeyById(id);
				if (!record) return null;
				return typeof record.usesRemaining === "number"
					? record.usesRemaining
					: null;
			},
			async clearUsageLimit(id: KeyId) {
				const record = await ctx.keyStore.findKeyById(id);
				if (!record) {
					const normalized = toError(
						new Error("key not found"),
						"KEY_NOT_FOUND",
						{
							plugin: "usage-limits-per-key",
							op: "clearUsageLimit",
							keyId: id,
						},
					);
					const err = Object.assign(new Error(normalized.message), normalized);
					throw err;
				}
				const updated = { ...record, usesRemaining: null };
				await ctx.keyStore.updateKey(updated);
				try {
					await ctx.analytics.track("usage.cleared", {
						keyId: id,
						userId: record.userId,
						ts: now(),
					});
				} catch (err) {
					console.error(
						`Error tracking usage.cleared event`,
						toError(err, ErrorCodes.ANALYTICS_TRACK_FAILED, {
							op: "usage.cleared",
							keyId: id,
						}),
					);
				}
			},
		},
	});
}

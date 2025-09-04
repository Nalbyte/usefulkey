import { ErrorCodes, type KeyId } from "../../types/common";
import type { UsefulKeyPlugin } from "../../types/plugins";
import { toError } from "../../utils/error";

export function enableDisable(): UsefulKeyPlugin<{
	disableKey: (id: KeyId) => Promise<void>;
	enableKey: (id: KeyId) => Promise<void>;
	__hasEnableDisable: true;
}> {
	return (ctx) => ({
		name: "enable-disable",
		async onKeyRecordLoaded(_ctx, { record }) {
			const disabled =
				(record.metadata as Record<string, unknown> | undefined)?.disabled ===
				true;
			if (disabled) return { reject: true, reason: "disabled" };
		},
		extend: {
			__hasEnableDisable: true as const,
			async disableKey(id: KeyId) {
				const record = await ctx.keyStore.findKeyById(id);
				if (!record) {
					const normalized = toError(
						new Error("key not found"),
						"KEY_NOT_FOUND",
						{
							plugin: "enable-disable",
							op: "disableKey",
							keyId: id,
						},
					);
					const err = Object.assign(new Error(normalized.message), normalized);
					throw err;
				}
				const metadata = { ...(record.metadata ?? {}), disabled: true };
				await ctx.keyStore.updateKey({ ...record, metadata });
				try {
					await ctx.analytics.track("key.disabled", {
						keyId: id,
						ts: Date.now(),
					});
				} catch (err) {
					console.error(
						`Error tracking key.disabled event`,
						toError(err, ErrorCodes.ANALYTICS_TRACK_FAILED, {
							op: "key.disabled",
							keyId: id,
						}),
					);
				}
			},
			async enableKey(id: KeyId) {
				const record = await ctx.keyStore.findKeyById(id);
				if (!record) {
					const normalized = toError(
						new Error("key not found"),
						"KEY_NOT_FOUND",
						{
							plugin: "enable-disable",
							op: "enableKey",
							keyId: id,
						},
					);
					const err = Object.assign(new Error(normalized.message), normalized);
					throw err;
				}
				const metadata = { ...(record.metadata ?? {}), disabled: false };
				await ctx.keyStore.updateKey({ ...record, metadata });
				try {
					await ctx.analytics.track("key.enabled", {
						keyId: id,
						ts: Date.now(),
					});
				} catch (err) {
					console.error(
						`Error tracking key.enabled event`,
						toError(err, ErrorCodes.ANALYTICS_TRACK_FAILED, {
							op: "key.enabled",
							keyId: id,
						}),
					);
				}
			},
		},
	});
}

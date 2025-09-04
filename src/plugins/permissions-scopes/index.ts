import type { KeyId } from "../../types/common";
import type {
	PermissionsScopesArgs,
	UsefulKeyPlugin,
} from "../../types/plugins";
import { now } from "../../utils/time";

function toArray(scopes: string | string[] | undefined | null): string[] {
	if (!scopes) return [];
	return Array.isArray(scopes) ? scopes : [scopes];
}

function unique(values: string[]): string[] {
	return Array.from(new Set(values));
}

function includesAll(have: Set<string>, required: string[]): boolean {
	for (const r of required) if (!have.has(r)) return false;
	return true;
}

export function permissionsScopes(
	args: PermissionsScopesArgs = {},
): UsefulKeyPlugin<{
	__hasPermissionsScopes: true;
	grantScopes: (id: KeyId, scopes: string[] | string) => Promise<void>;
	revokeScopes: (id: KeyId, scopes: string[] | string) => Promise<void>;
	setScopes: (id: KeyId, scopes: string[] | string) => Promise<void>;
	getScopes: (id: KeyId) => Promise<string[]>;
}> {
	const metadataKey = args.metadataKey ?? "scopes";

	return (ctx) => ({
		name: "permissions-scopes",
		async onKeyRecordLoaded(_uk, { input, record }) {
			const keyScopes = toArray(
				(record.metadata as Record<string, unknown> | undefined)?.[
					metadataKey
				] as string[] | string | undefined,
			);

			const required = unique(toArray(input.scopes ?? []));

			if (required.length === 0) return;

			const have = new Set(keyScopes);
			const ok = includesAll(have, required);
			if (!ok) {
				try {
					await ctx.analytics.track("scopes.blocked", {
						keyId: record.id,
						userId: record.userId,
						required,
						have: keyScopes,
						ts: now(),
					});
				} catch {}
				return { reject: true, reason: "insufficient_scope" };
			}
		},
		extend: {
			__hasPermissionsScopes: true as const,
			async grantScopes(id: KeyId, scopes: string[] | string) {
				const record = await ctx.keyStore.findKeyById(id);
				if (!record) return;
				const current = toArray(
					(record.metadata as Record<string, unknown> | undefined)?.[
						metadataKey
					] as string[] | string | undefined,
				);
				const updatedScopes = unique([...current, ...toArray(scopes)]);
				const metadata = {
					...(record.metadata ?? {}),
					[metadataKey]: updatedScopes,
				} as Record<string, unknown>;
				await ctx.keyStore.updateKey({ ...record, metadata });
				try {
					await ctx.analytics.track("scopes.granted", {
						keyId: id,
						added: toArray(scopes),
						result: updatedScopes,
						ts: now(),
					});
				} catch {}
			},
			async revokeScopes(id: KeyId, scopes: string[] | string) {
				const record = await ctx.keyStore.findKeyById(id);
				if (!record) return;
				const current = new Set(
					toArray(
						(record.metadata as Record<string, unknown> | undefined)?.[
							metadataKey
						] as string[] | string | undefined,
					),
				);
				for (const s of toArray(scopes)) current.delete(s);
				const updatedScopes = Array.from(current);
				const metadata = {
					...(record.metadata ?? {}),
					[metadataKey]: updatedScopes,
				} as Record<string, unknown>;
				await ctx.keyStore.updateKey({ ...record, metadata });
				try {
					await ctx.analytics.track("scopes.revoked", {
						keyId: id,
						removed: toArray(scopes),
						result: updatedScopes,
						ts: now(),
					});
				} catch {}
			},
			async setScopes(id: KeyId, scopes: string[] | string) {
				const record = await ctx.keyStore.findKeyById(id);
				if (!record) return;
				const updatedScopes = unique(toArray(scopes));
				const metadata = {
					...(record.metadata ?? {}),
					[metadataKey]: updatedScopes,
				} as Record<string, unknown>;
				await ctx.keyStore.updateKey({ ...record, metadata });
				try {
					await ctx.analytics.track("scopes.set", {
						keyId: id,
						result: updatedScopes,
						ts: now(),
					});
				} catch {}
			},
			async getScopes(id: KeyId): Promise<string[]> {
				const record = await ctx.keyStore.findKeyById(id);
				if (!record) return [];
				return toArray(
					(record.metadata as Record<string, unknown> | undefined)?.[
						metadataKey
					] as string[] | string | undefined,
				);
			},
		},
	});
}

export type { VerifyOptions } from "../../types/common";

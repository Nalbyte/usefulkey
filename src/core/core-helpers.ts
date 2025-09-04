import type { CreateKeyInput, KeyRecord } from "../types/common";
import { type AnalyticsAdapter, ErrorCodes } from "../types/common";
import type { UsefulKeyPluginHooks } from "../types/plugins";
import { toError } from "../utils/error";
import { hashKeyWithConfig } from "../utils/key";
import { now } from "../utils/time";

/**
 * Safely track analytics events with error handling
 */
export async function safeTrackAnalytics(
	analytics: AnalyticsAdapter,
	event: string,
	data: Record<string, any>,
): Promise<void> {
	try {
		await analytics.track(event, data);
	} catch (err) {
		console.error(
			`Error tracking ${event} event`,
			toError(err, ErrorCodes.ANALYTICS_TRACK_FAILED, { op: event }),
		);
	}
}

/**
 * Execute plugin hooks with error handling
 */
export async function executePluginHooks(
	pluginHooks: UsefulKeyPluginHooks[],
	hookName: keyof UsefulKeyPluginHooks,
	...args: any[]
): Promise<{ rejected?: boolean; reason?: string }> {
	for (const hook of pluginHooks) {
		const hookFn = hook[hookName] as ((...args: any[]) => any) | undefined;
		if (!hookFn) continue;

		try {
			const result = await hookFn.call(hook, ...args);
			if (result && typeof result === "object" && "reject" in result) {
				return { rejected: true, reason: result.reason };
			}
		} catch (hookErr) {
			console.error(
				`Plugin ${String(hookName)} error`,
				toError(hookErr, ErrorCodes.UNKNOWN, {
					op: String(hookName),
					plugin: (hook as any).name,
				}),
			);
		}
	}
	return {};
}

/**
 * Validate positive number input
 */
export function validatePositiveNumber(
	value: any,
	_fieldName: string,
): boolean {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Create a key record from input parameters
 */
export function createKeyRecord(
	id: string,
	plaintext: string,
	input: CreateKeyInput,
	config: { disablePrefix?: boolean; keyPrefix: string; [key: string]: any },
): KeyRecord {
	return {
		id,
		userId: input.userId ?? null,
		prefix: (config.disablePrefix
			? ""
			: (input.prefix ?? config.keyPrefix)) as string,
		keyHash: hashKeyWithConfig(plaintext, config),
		createdAt: now(),
		expiresAt: input.expiresAt ?? null,
		metadata: input.metadata ?? {},
		usesRemaining: input.usesRemaining ?? null,
		revokedAt: null,
	};
}

import type { UsefulKey } from "../core/usefulkey";
import type { CreateKeyInput, KeyRecord, VerifyOptions } from "./common";
import type { RateLimitRequest } from "./ratelimit";

/**
 * Plugin system types for UsefulKey.
 *
 * These types define how plugins work with the library - they let you add
 * custom behavior like rate limiting, permissions, and analytics.
 */

/** Defines what a plugin can do and when it gets called. */
export interface UsefulKeyPluginHooks {
	/** A short name for this plugin. */
	name: string;
	/** Called when the plugin is first loaded. */
	setup?: (ctx: UsefulKey) => void | Promise<void>;

	/** Called before checking if a key is valid. Can block the request. */
	beforeVerify?: (
		ctx: UsefulKey,
		args: {
			key: string;
			ip?: string;
			identifier?: string | null;
			namespace?: string | null;
			rateLimit?: RateLimitRequest;
		},
	) => Promise<{ reject: boolean; reason?: string } | undefined>;

	/** Called after loading a key from storage. Can still block the request. */
	onKeyRecordLoaded?: (
		ctx: UsefulKey,
		args: { input: VerifyOptions; record: KeyRecord },
	) => Promise<{ reject: boolean; reason?: string } | undefined>;

	/** Called when a key verification succeeds (good for logging/analytics). */
	onVerifySuccess?: (
		ctx: UsefulKey,
		args: { input: VerifyOptions; record: KeyRecord },
	) => Promise<void>;

	/** Called before creating a new key. Can prevent key creation. */
	beforeCreateKey?: (
		ctx: UsefulKey,
		args: { input: CreateKeyInput },
	) => Promise<{ reject: boolean; reason?: string } | undefined>;

	/** Called after a key is successfully created. */
	onKeyCreated?: (ctx: UsefulKey, args: { record: KeyRecord }) => Promise<void>;

	/** Extra methods or properties this plugin adds to the main library. */
	extend?: PluginExtensions;
}

/** A flexible type for any extra functionality a plugin might add. */
export type PluginExtensions = Record<string, unknown>;

/** A function that creates a plugin with optional extra features. */
export type UsefulKeyPlugin<
	Ext extends PluginExtensions = Record<string, never>,
> = (ctx: UsefulKey) => Omit<UsefulKeyPluginHooks, "extend"> & { extend?: Ext };

/** Helper types for combining multiple plugin extensions together. */
export type UnionToIntersection<U> = (
	U extends unknown
		? (x: U) => unknown
		: never
) extends (x: infer I) => unknown
	? I
	: never;

export type Identity<T> = T extends object ? { [K in keyof T]: T[K] } : T;

/** Figures out what extensions a list of plugins will add. */
export type InferPluginExtensions<
	P extends readonly UsefulKeyPlugin<PluginExtensions>[],
> = [P[number]] extends [never]
	? Record<string, never>
	: Identity<
			UnionToIntersection<
				P[number] extends UsefulKeyPlugin<infer E extends PluginExtensions>
					? E
					: Record<string, never>
			>
		>;

/** Settings for the rate limiting plugin (prevents abuse by limiting how often keys can be used). */
export type RatelimitArgs =
	| { limit: number; duration: string | number }
	| {
			default?: RateLimitRequest;
			identify?: (i: VerifyOptions) => string | null;
			reason?: string;
			analyticsKind?: string;
	  };

/** Settings for the permissions plugin (controls what each API key is allowed to do). */
export type PermissionsScopesArgs = {
	/** Which field in the key's metadata should store the permission list. */
	metadataKey?: string; // default: "scopes"
};

/*
 * Core UsefulKey implementation.
 *
 * This module exposes the `UsefulKey` class and a small factory `usefulkey`.
 * The class provides APIs to generate keys, create/store them, verify usage,
 * and revoke them. Behavior is extensible via a lightweight plugin system
 * (hooks that can observe and optionally block operations) and pluggable
 * adapters for storage, rate limiting, and analytics.
 */

import { ConsoleAnalytics } from "../adapters/analytics/console";
import { MemoryKeyStore } from "../adapters/keystore/memory";
import { MemoryRateLimitStore } from "../adapters/ratelimit-store/memory";
import type {
	AnalyticsAdapter,
	CreateKeyInput,
	CreateKeyResult,
	KeyId,
	KeyKind,
	KeyRecord,
	KeyStoreAdapter,
	RateLimitStoreAdapter,
	Result,
	UsefulKeyConfig,
	VerifyOptions,
	VerifyResult,
} from "../types/common";
import { ErrorCodes } from "../types/common";
import type {
	InferPluginExtensions,
	PluginExtensions,
	UsefulKeyPlugin,
	UsefulKeyPluginHooks,
} from "../types/plugins";
import { configureCryptoProvider, uuid } from "../utils/crypto";
import { toError } from "../utils/error";
import { hashKeyWithConfig, KEY, renderKey } from "../utils/key";
import { now } from "../utils/time";
import {
	DEFAULT_BATCH_SIZE,
	DEFAULT_KEY_LENGTH,
	DEFAULT_KEY_PREFIX,
	MAX_BATCH_SIZE,
} from "./constants";
import {
	createKeyRecord,
	executePluginHooks,
	safeTrackAnalytics,
	validatePositiveNumber,
} from "./core-helpers";

/**
 *
 * Provides operations to create, verify, revoke, and delete keys with optional
 * plugin extensibility and pluggable adapters for storage, rate limiting, and
 * analytics.
 *
 * Configuration is normalized to ensure sensible defaults:
 * - Ensures a `keyPrefix` (default: "uk") if not provided in config
 * - Ensures a `defaultKeyKind` derived via `KEY.URLSafe(40)` if not provided in config
 * - Accepts custom crypto provider, id generator, key generator and hasher optionally
 *
 * The instance exposes a `ready` promise that resolves once all plugin
 * `setup` hooks and adapter readiness have completed.
 */
export class UsefulKey {
	/**
	 * Normalized configuration with sensible defaults applied.
	 *
	 * This includes the resolved `keyPrefix` and `defaultKeyKind` values,
	 * along with all other configuration options. The object is frozen
	 * to prevent runtime modification.
	 */
	readonly config: UsefulKeyConfig & {
		keyPrefix: string;
		defaultKeyKind: KeyKind;
	};

	/**
	 * Adapter for key storage operations.
	 *
	 * Handles creating, reading, updating, and deleting key records.
	 * Defaults to an in-memory implementation if not provided in config.
	 */
	readonly keyStore: KeyStoreAdapter;

	/**
	 * Adapter for rate limiting operations.
	 *
	 * Manages rate limiting state and enforcement. Defaults to an
	 * in-memory implementation if not provided in config.
	 */
	readonly rateLimitStore: RateLimitStoreAdapter;

	/**
	 * Adapter for analytics and event tracking.
	 *
	 * Handles tracking of key operations and usage metrics. Defaults to
	 * a console implementation if not provided in config.
	 */
	readonly analytics: AnalyticsAdapter;

	/**
	 * Promise that resolves when all plugin setup hooks and adapter
	 * initialization have completed.
	 *
	 * Consumers should await this promise before performing operations
	 * to ensure the instance is fully initialized.
	 */
	readonly ready: Promise<void>;

	/**
	 * Internal collection of plugin hooks for this instance.
	 *
	 * Contains all registered plugin hooks that can observe and optionally
	 * block operations. This is used internally by the verification and
	 * creation methods.
	 */
	private readonly pluginHooks: UsefulKeyPluginHooks[] = [];

	/**
	 * Construct a `UsefulKey` instance with the specified configuration and plugins.
	 *
	 * The constructor performs the following setup:
	 * - Normalizes configuration with sensible defaults
	 * - Initializes adapters (with in-memory fallbacks)
	 * - Configures the crypto provider if specified
	 * - Registers and initializes all plugins
	 * - Sets up the `ready` promise for initialization tracking
	 *
	 * @param cfg - Configuration for this instance. See `UsefulKeyConfig` for
	 *              supported options, including adapters, key generation, hashing,
	 *              default key kind/prefix, crypto provider and housekeeping flags.
	 * @param plugins - Optional list of plugin factories to extend behavior. Each
	 *                  plugin may register hooks and optionally expose extension
	 *                  methods/properties via `extend`.
	 */
	constructor(cfg: UsefulKeyConfig, plugins: UsefulKeyPlugin[] = []) {
		const keyPrefix = cfg.keyPrefix ?? DEFAULT_KEY_PREFIX;
		const defaultKeyKind =
			cfg.defaultKeyKind ?? KEY.URLSafe(DEFAULT_KEY_LENGTH, keyPrefix);

		this.config = { ...cfg, keyPrefix, defaultKeyKind } as UsefulKey["config"];
		Object.freeze(this.config);
		if (this.config.adapters && typeof this.config.adapters === "object") {
			Object.freeze(this.config.adapters);
		}
		if (
			this.config.defaultKeyKind &&
			typeof this.config.defaultKeyKind === "object"
		) {
			Object.freeze(this.config.defaultKeyKind);
		}
		this.keyStore = cfg.adapters?.keyStore ?? new MemoryKeyStore();
		this.rateLimitStore =
			cfg.adapters?.rateLimitStore ?? new MemoryRateLimitStore();
		this.analytics = cfg.adapters?.analytics ?? new ConsoleAnalytics();

		if (cfg.crypto) configureCryptoProvider(cfg.crypto);

		const allExtensions: Record<string, unknown> = {};
		for (const p of plugins) {
			try {
				const hooks = p(this);
				this.pluginHooks.push(hooks);
				if (hooks && typeof hooks.extend === "object") {
					Object.assign(allExtensions, hooks.extend);
				}
			} catch (pluginFactoryErr) {
				console.error(
					"Error initializing plugin",
					toError(pluginFactoryErr, ErrorCodes.PLUGIN_SETUP_FAILED, {
						op: "pluginFactory",
					}),
				);
			}
		}

		Object.defineProperty(this, "_pluginExtensions", {
			value: allExtensions as PluginExtensions,
			writable: false,
			enumerable: false,
		});

		/*
		 * Prepare `ready` to resolve after all plugin setup hooks and any adapter readiness settle.
		 */
		const pluginSetups = this.pluginHooks
			.map((h) => h.setup)
			.filter(
				(fn): fn is NonNullable<UsefulKeyPluginHooks["setup"]> =>
					typeof fn === "function",
			)
			.map(async (fn) => {
				try {
					await fn(this);
				} catch (setupErr) {
					console.error(
						"Plugin setup error",
						toError(setupErr, ErrorCodes.PLUGIN_SETUP_FAILED, {
							op: "pluginSetup",
						}),
					);
				}
			});

		const adapterReadiness: Array<Promise<unknown>> = [];
		if (
			this.keyStore &&
			typeof (this.keyStore as { ready?: Promise<void> }).ready !== "undefined"
		) {
			adapterReadiness.push(
				(this.keyStore as { ready?: Promise<void> }).ready as Promise<unknown>,
			);
		}
		if (
			this.rateLimitStore &&
			typeof (this.rateLimitStore as { ready?: Promise<void> }).ready !==
				"undefined"
		) {
			adapterReadiness.push(
				(this.rateLimitStore as { ready?: Promise<void> })
					.ready as Promise<unknown>,
			);
		}
		if (
			this.analytics &&
			typeof (this.analytics as { ready?: Promise<void> }).ready !== "undefined"
		) {
			adapterReadiness.push(
				(this.analytics as { ready?: Promise<void> }).ready as Promise<unknown>,
			);
		}

		this.ready = Promise.allSettled([
			...pluginSetups,
			...adapterReadiness,
		]).then(() => undefined);
	}

	// ===== Key lookup ======================================================

	/**
	 * Look up a key by its plaintext value.
	 *
	 * Hashes the input with the configured hasher and queries the keystore. If
	 * the key is expired and `autoDeleteExpiredKeys` is enabled, performs a
	 * best-effort hard removal and returns `null`.
	 *
	 * @param key - Plaintext key value to look up. This will be hashed using
	 *              the configured hasher before querying the keystore.
	 * @returns A `Result` containing the matching `KeyRecord` or `null` if not found/expired.
	 *          If the key is expired and auto-deletion is enabled, the expired key
	 *          will be removed from storage and `null` will be returned.
	 */
	async getKey(key: string): Promise<Result<KeyRecord | null>> {
		try {
			const keyHash = hashKeyWithConfig(key, this.config);
			const record = await this.keyStore.findKeyByHash(keyHash);
			if (
				record?.expiresAt &&
				record.expiresAt <= now() &&
				this.config.autoDeleteExpiredKeys
			) {
				try {
					await this.keyStore.hardRemoveKeyById(record.id);
				} catch (_storeErr) {
					// best-effort cleanup; ignore deletion failures
				}
				return { result: null };
			}
			return { result: record };
		} catch (err) {
			return {
				error: toError(err, ErrorCodes.KEYSTORE_READ_FAILED, {
					op: "getKey",
				}),
			};
		}
	}

	/**
	 * Look up a key by its stable identifier.
	 *
	 * If the key is expired and `autoDeleteExpiredKeys` is enabled, performs a
	 * best-effort hard removal and returns `null`.
	 *
	 * @param id - Key identifier. This is the stable, unique identifier for the key
	 *            that was generated during creation.
	 * @returns A `Result` containing the matching `KeyRecord` or `null` if not found.
	 *          If the key is expired and auto-deletion is enabled, the expired key
	 *          will be removed from storage and `null` will be returned.
	 */
	async getKeyById(id: KeyId): Promise<Result<KeyRecord | null>> {
		try {
			const record = await this.keyStore.findKeyById(id);
			if (
				record?.expiresAt &&
				record.expiresAt <= now() &&
				this.config.autoDeleteExpiredKeys
			) {
				try {
					await this.keyStore.hardRemoveKeyById(record.id);
				} catch (_storeErr) {}
				return { result: null };
			}
			return { result: record };
		} catch (err) {
			return {
				error: toError(err, ErrorCodes.KEYSTORE_READ_FAILED, {
					op: "getKeyById",
				}),
			};
		}
	}

	// ===== Verification ====================================================

	/**
	 * Verify whether a key is currently valid.
	 *
	 * Runs plugin hooks (`beforeVerify`, `onKeyRecordLoaded`, `onVerifySuccess`),
	 * checks revocation, expiry, and usage limits, and emits an analytics event
	 * on successful verification.
	 *
	 * @param input - Verification parameters (key, optional ip, identifier, namespace, rateLimit).
	 * @param returnMetadata - When `true`, includes the key's stored `metadata` in the result.
	 * @returns A `Result` with `VerifyResult` indicating validity and optional metadata.
	 */

	/**
	 * Verify a key with rate limiting support.
	 *
	 * This overload is available when the rate limit plugin is present.
	 * The `namespace` parameter is required for rate limiting functionality.
	 *
	 * @param input - Verification parameters including required namespace for rate limiting.
	 * @param returnMetadata - When `true`, includes the key's stored `metadata` in the result.
	 * @returns A `Result` with `VerifyResult` indicating validity and optional metadata.
	 */
	// When ratelimit plugin is present, require `namespace`
	verifyKey(
		this: UsefulKey & { __hasRateLimit: true },
		input: VerifyOptions & { namespace: string },
		returnMetadata?: boolean,
	): Promise<Result<VerifyResult>>;

	/**
	 * Verify a key without rate limiting support.
	 *
	 * This overload is used when no rate limit plugin is present.
	 * The `namespace`, `rateLimit`, and `identifier` parameters are not allowed.
	 *
	 * @param input - Verification parameters (key and optional ip only).
	 * @param returnMetadata - When `true`, includes the key's stored `metadata` in the result.
	 * @returns A `Result` with `VerifyResult` indicating validity and optional metadata.
	 */
	// Without ratelimit plugin, `namespace` and `rateLimit` should not be allowed
	verifyKey(
		this: UsefulKey,
		input: Omit<VerifyOptions, "rateLimit" | "namespace" | "identifier"> & {
			rateLimit?: never;
			namespace?: never;
			identifier?: never;
		},
		returnMetadata?: boolean,
	): Promise<Result<VerifyResult>>;

	async verifyKey(
		input: VerifyOptions,
		returnMetadata: boolean = false,
	): Promise<Result<VerifyResult>> {
		try {
			const beforeVerifyResult = await executePluginHooks(
				this.pluginHooks,
				"beforeVerify",
				this,
				{
					key: input.key,
					ip: input.ip ?? undefined,
					identifier: input.identifier ?? null,
					namespace: input.namespace ?? null,
					rateLimit: input.rateLimit ?? undefined,
				},
			);
			if (beforeVerifyResult.rejected) {
				return {
					result: {
						valid: false,
						reason: beforeVerifyResult.reason ?? "blocked_by_plugin",
					},
				};
			}

			const keyHash = hashKeyWithConfig(input.key, this.config);
			const record = await this.keyStore.findKeyByHash(keyHash);

			if (!record) return { result: { valid: false, reason: "not_found" } };

			if (record.revokedAt)
				return { result: { valid: false, reason: "revoked" } };

			const onKeyRecordLoadedResult = await executePluginHooks(
				this.pluginHooks,
				"onKeyRecordLoaded",
				this,
				{ input, record },
			);
			if (onKeyRecordLoadedResult.rejected) {
				return {
					result: {
						valid: false,
						reason: onKeyRecordLoadedResult.reason ?? "blocked_by_plugin",
					},
				};
			}

			if (record.expiresAt && record.expiresAt <= now()) {
				if (this.config.autoDeleteExpiredKeys) {
					try {
						await this.keyStore.hardRemoveKeyById(record.id);
					} catch (_storeErr) {
						console.error("Error deleting expired key", _storeErr);
					}
				}
				return { result: { valid: false, reason: "expired" } };
			}

			if (
				typeof record.usesRemaining === "number" &&
				record.usesRemaining <= 0
			) {
				return { result: { valid: false, reason: "usage_exceeded" } };
			}

			await safeTrackAnalytics(this.analytics, "key.verified", {
				keyId: record.id,
				userId: record.userId,
				identifier: input.identifier ?? null,
				ts: now(),
			});

			await executePluginHooks(this.pluginHooks, "onVerifySuccess", this, {
				input,
				record,
			});

			return {
				result: {
					valid: true,
					keyId: record.id,
					userId: record.userId ?? undefined,
					metadata: returnMetadata ? record.metadata : undefined,
				},
			};
		} catch (err) {
			return {
				error: toError(err, ErrorCodes.UNKNOWN, { op: "verifyKey" }),
			};
		}
	}

	// ===== Creation ========================================================

	/**
	 * Create and persist a new key.
	 *
	 * Plugins may block creation via `beforeCreateKey`. The plaintext key is
	 * generated using `config.customGenerateKey` (when provided) or by rendering
	 * the configured `KeyKind` with the resolved prefix. The record is stored,
	 * analytics are emitted, and `onKeyCreated` hooks are invoked.
	 *
	 * @param input - Creation parameters including optional id, userId, prefix,
	 *                expiry, metadata, uses remaining, and key kind override.
	 * @returns A `Result` containing `{ id, key, metadata }` on success.
	 */
	/**
	 * Create a key using default configuration.
	 *
	 * This overload creates a key with all default settings:
	 * - Uses the configured `keyPrefix` and `defaultKeyKind`
	 * - No custom expiry, metadata, or usage limits
	 * - Auto-generated ID
	 *
	 * @returns A `Result` containing `{ id, key, metadata }` on success.
	 */
	// Overload: allow calling with no arguments so it uses the default key prefix, key kind
	async createKey(): Promise<Result<CreateKeyResult>>;
	/**
	 * Create a key with custom configuration.
	 *
	 * This overload allows full customization of the key creation process,
	 * including custom ID, user ID, prefix, expiry, metadata, usage limits,
	 * and key kind.
	 *
	 * @param input - Creation parameters including optional id, userId, prefix,
	 *                expiry, metadata, uses remaining, and key kind override.
	 * @returns A `Result` containing `{ id, key, metadata }` on success.
	 */
	async createKey(input: CreateKeyInput): Promise<Result<CreateKeyResult>>;
	async createKey(inputArg?: CreateKeyInput): Promise<Result<CreateKeyResult>> {
		try {
			const input: CreateKeyInput = inputArg ?? {};
			const beforeCreateKeyResult = await executePluginHooks(
				this.pluginHooks,
				"beforeCreateKey",
				this,
				{ input },
			);
			if (beforeCreateKeyResult.rejected) {
				return {
					error: toError(
						{
							code: beforeCreateKeyResult.reason ?? "blocked_by_plugin",
							message: beforeCreateKeyResult.reason ?? "blocked_by_plugin",
						},
						ErrorCodes.PLUGIN_BLOCKED,
						{ op: "createKey" },
					),
				};
			}

			let plaintext: string;
			try {
				const kind = input.keyKind ?? this.config.defaultKeyKind;
				const prefix = input.prefix ?? this.config.keyPrefix;

				const generated =
					typeof this.config.customGenerateKey === "function"
						? this.config.customGenerateKey()
						: renderKey(kind, prefix, !this.config.disablePrefix);

				plaintext = generated;
			} catch (genErr) {
				return {
					error: toError(genErr, ErrorCodes.KEY_GENERATION_FAILED, {
						op: "createKey",
					}),
				};
			}

			const id =
				input.id ??
				(typeof this.config.customIdGenerator === "function"
					? this.config.customIdGenerator()
					: uuid());

			const record = createKeyRecord(id, plaintext, input, this.config);

			try {
				await this.keyStore.createKey(record);
			} catch (storeErr) {
				return {
					error: toError(storeErr, ErrorCodes.KEYSTORE_WRITE_FAILED, {
						op: "createKey",
					}),
				};
			}

			await safeTrackAnalytics(this.analytics, "key.created", {
				keyId: record.id,
				userId: record.userId,
				ts: now(),
			});

			await executePluginHooks(this.pluginHooks, "onKeyCreated", this, {
				record,
			});

			return {
				result: { id: record.id, key: plaintext, metadata: record.metadata },
			};
		} catch (err) {
			return {
				error: toError(err, ErrorCodes.UNKNOWN, { op: "createKey" }),
			};
		}
	}

	// ===== Revocation & Deletion ==========================================

	/**
	 * Revoke a key by its id.
	 *
	 * Marks the key as revoked in the keystore and emits a `key.revoked`
	 * analytics event. A revoked key will fail verification with reason "revoked"
	 * but remains in storage for audit purposes.
	 *
	 * @param id - Key identifier to revoke. The key must exist in the keystore.
	 * @returns A `Result<void>` indicating success or failure of the revocation operation.
	 *          If the key doesn't exist, the operation will fail.
	 */
	async revokeKey(id: KeyId): Promise<Result<void>> {
		try {
			try {
				await this.keyStore.revokeKeyById(id);
			} catch (storeErr) {
				return {
					error: toError(storeErr, ErrorCodes.KEYSTORE_REVOKE_FAILED, {
						op: "revokeKey",
					}),
				};
			}
			await safeTrackAnalytics(this.analytics, "key.revoked", {
				keyId: id,
				ts: now(),
			});
			return { result: undefined };
		} catch (err) {
			return {
				error: toError(err, ErrorCodes.UNKNOWN, { op: "revokeKey" }),
			};
		}
	}

	/**
	 * Extend a key's expiry by the provided duration in milliseconds.
	 *
	 * If the key currently has no expiry (`expiresAt` is null/undefined), the
	 * new expiry is computed as `now() + additionalMs`.
	 *
	 * This method does not revive revoked keys for verification purposes, but it
	 * will still update the stored record's `expiresAt` field.
	 *
	 * @param id Key identifier whose expiry should be extended.
	 * @param additionalMs Positive number of milliseconds to add to the current expiry.
	 * @returns A `Result` with the updated `{ expiresAt }` or `null` when not found.
	 */
	async extendKeyExpiry(
		id: KeyId,
		additionalMs: number,
	): Promise<Result<{ expiresAt: number } | null>> {
		try {
			if (!validatePositiveNumber(additionalMs, "additionalMs")) {
				return {
					error: toError(
						{
							code: "INVALID_INPUT",
							message: "additionalMs must be a positive finite number",
						},
						ErrorCodes.EXTEND_KEY_EXPIRY_FAILED,
						{ op: "extendKeyExpiry" },
					),
				};
			}

			let record: KeyRecord | null = null;
			try {
				record = await this.keyStore.findKeyById(id);
			} catch (storeErr) {
				return {
					error: toError(storeErr, ErrorCodes.KEYSTORE_READ_FAILED, {
						op: "extendKeyExpiry",
					}),
				};
			}

			if (!record) return { result: null };

			const from = record.expiresAt ?? now();
			const toTs = from + additionalMs;
			const updated: KeyRecord = { ...record, expiresAt: toTs };

			try {
				await this.keyStore.updateKey(updated);
			} catch (storeErr) {
				return {
					error: toError(storeErr, ErrorCodes.KEYSTORE_WRITE_FAILED, {
						op: "extendKeyExpiry",
					}),
				};
			}

			await safeTrackAnalytics(this.analytics, "key.expiry_extended", {
				keyId: updated.id,
				from: record.expiresAt ?? null,
				to: toTs,
				deltaMs: additionalMs,
				ts: now(),
			});

			return { result: { expiresAt: toTs } };
		} catch (err) {
			return {
				error: toError(err, ErrorCodes.UNKNOWN, { op: "extendKeyExpiry" }),
			};
		}
	}

	/**
	 * Permanently delete a key by its id.
	 *
	 * Performs a hard removal from the underlying store (if supported) and
	 * emits a `key.hard_removed` analytics event. This operation permanently
	 * deletes the key record from storage and cannot be undone.
	 *
	 * @param id - Key identifier to hard-remove. The key must exist in the keystore.
	 * @returns A `Result<void>` indicating success or failure of the hard removal operation.
	 *          If the key doesn't exist or the keystore doesn't support hard removal,
	 *          the operation will fail.
	 */
	async hardRemoveKey(id: KeyId): Promise<Result<void>> {
		try {
			try {
				await this.keyStore.hardRemoveKeyById(id);
			} catch (storeErr) {
				return {
					error: toError(storeErr, ErrorCodes.KEYSTORE_WRITE_FAILED, {
						op: "hardRemoveKey",
					}),
				};
			}

			await safeTrackAnalytics(this.analytics, "key.hard_removed", {
				keyId: id,
				ts: now(),
			});

			return { result: undefined };
		} catch (err) {
			return {
				error: toError(err, ErrorCodes.UNKNOWN, { op: "hardRemoveKey" }),
			};
		}
	}

	/**
	 * Sweep expired keys in batches.
	 *
	 * This function performs hard removal of expired keys. It requires the keystore to implement
	 * `findExpiredIds`. If not available, returns an error with code `KEYSTORE_SWEEP_UNSUPPORTED`.
	 *
	 * @param input - Sweep configuration options.
	 * @param input.batchSize - Maximum number of keys to process in this batch (1-1000, default: 100).
	 * @param input.olderThan - Timestamp threshold for expired keys (default: current time).
	 * @returns A `Result` containing sweep statistics including processed count, hard removed count,
	 *          and a hint about remaining keys to process.
	 */

	async sweepExpired(input: {
		batchSize?: number;
		olderThan?: number; // default: now()
	}): Promise<
		Result<{
			processed: number;
			hardRemoved: number;
			revoked: number;
			remainingHint?: number;
		}>
	> {
		try {
			const batchSize = Math.max(
				1,
				Math.min(MAX_BATCH_SIZE, input.batchSize ?? DEFAULT_BATCH_SIZE),
			);
			const olderThanTs = input.olderThan ?? now();
			const finder = (
				this.keyStore as KeyStoreAdapter & {
					findExpiredIds?: (
						olderThan: number,
						limit: number,
					) => Promise<string[]>;
				}
			).findExpiredIds;
			if (typeof finder !== "function") {
				return {
					error: toError(
						{
							code: ErrorCodes.KEYSTORE_SWEEP_UNSUPPORTED,
							message: "Keystore does not support sweeping",
						},
						ErrorCodes.KEYSTORE_SWEEP_UNSUPPORTED,
						{ op: "sweepExpired" },
					),
				};
			}

			let ids: string[] = [];
			try {
				ids = await finder.call(this.keyStore, olderThanTs, batchSize);
			} catch (storeErr) {
				return {
					error: toError(storeErr, ErrorCodes.KEYSTORE_READ_FAILED, {
						op: "sweepExpired",
					}),
				};
			}

			let hardRemoved = 0;
			const revoked = 0;
			for (const id of ids) {
				try {
					await this.keyStore.hardRemoveKeyById(id);
					hardRemoved++;
				} catch {}
			}

			await safeTrackAnalytics(this.analytics, "keys.expired_swept", {
				processed: ids.length,
				revoked,
				hardRemoved,
				olderThan: olderThanTs,
				ts: now(),
			});

			return {
				result: {
					processed: ids.length,
					revoked,
					hardRemoved,
					remainingHint: ids.length === batchSize ? -1 : 0,
				},
			};
		} catch (err) {
			return {
				error: toError(err, ErrorCodes.UNKNOWN, { op: "sweepExpired" }),
			};
		}
	}
}

export function usefulkey<
	const P extends readonly UsefulKeyPlugin<PluginExtensions>[],
>(
	config: UsefulKeyConfig,
	options?: { plugins?: P },
): UsefulKey & InferPluginExtensions<P> {
	/**
	 * Factory for constructing a `UsefulKey` instance with strongly-typed
	 * plugin extensions merged into the returned object.
	 *
	 * @param config Instance configuration.
	 * @param options Optional plugin list to apply.
	 * @returns A `UsefulKey` instance augmented with any plugin `extend` surface.
	 */
	const plugins = (options?.plugins ?? []) as UsefulKeyPlugin[];
	const instance = new UsefulKey(config, plugins);

	const extensions = (
		instance as unknown as {
			_pluginExtensions: InferPluginExtensions<P>;
		}
	)._pluginExtensions;

	Object.assign(instance as unknown as Record<string, unknown>, extensions);

	return instance as UsefulKey & InferPluginExtensions<P>;
}

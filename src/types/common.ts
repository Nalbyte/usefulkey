/*
 * Shared types and interfaces for UsefulKey.
 *
 * This file contains all the common building blocks used throughout the library:
 * - Basic ID types and time measurements
 * - Data structures for API keys and verification
 * - Interfaces for different storage and tracking systems
 * - Configuration options for customizing behavior
 */

/** A number representing time in milliseconds (for durations and timestamps). */
export type Milliseconds = number;

import type { RateLimitRequest } from "./ratelimit";

/** A unique identifier for an API key. */
export type KeyId = string;
/** A unique identifier for a user who owns or uses API keys. */
export type UserId = string;

/**
 * Defines how API keys should be generated and formatted.
 *
 * Choose from different key formats:
 * - uuid: Standard UUID format (like "123e4567-e89b-12d3-a456-426614174000")
 * - urlsafe: Safe for use in URLs (letters, numbers, hyphens, underscores)
 * - hex: Hexadecimal format (0-9, A-F)
 * - base32: Base32 format (A-Z, 2-7)
 *
 * You can optionally specify a length and/or prefix for customization.
 */
export type KeyKind =
	| { type: "uuid"; prefix?: string }
	| { type: "urlsafe"; length?: number; prefix?: string }
	| { type: "hex"; length?: number; prefix?: string }
	| { type: "base32"; length?: number; prefix?: string };

/**
 * The stored information about an API key.
 *
 * For security, we only store a hash of the actual key value (never the key itself).
 * The real key is only shown once when it's first created.
 */
export interface KeyRecord {
	/** Unique identifier for this key. */
	id: KeyId;
	/** Which user this key belongs to (optional). */
	userId?: UserId | null;
	/** Text that appears at the beginning of the key (like "sk-" or "pk-"). */
	prefix: string;
	/** Secure hash of the actual key value for verification. */
	keyHash: string;
	/** When this key was created (timestamp in milliseconds). */
	createdAt: number;
	/** When this key expires (optional, timestamp in milliseconds). */
	expiresAt?: number | null;
	/** Any extra information you want to store with this key. */
	metadata?: Record<string, unknown>;
	/** How many times this key can still be used (optional, null means unlimited). */
	usesRemaining?: number | null;
	/** When this key was disabled/revoked (optional). */
	revokedAt?: number | null;
}

/**
 * Options for checking if an API key is valid and allowed to be used.
 *
 * This includes the key itself plus optional settings for additional checks
 * like rate limiting or permission scopes (if those features are enabled).
 */
export interface VerifyOptions {
	/** The API key you want to check. */
	key: string;
	/** IP address of the person making the request (for rate limiting). */
	ip?: string;
	/** A unique identifier for this request (like user ID or session ID). */
	identifier?: string | null;
	/** Group name for rate limiting (lets you have separate limits for different parts of your app). */
	namespace?: string | null;
	/** What permissions this key needs to have. */
	scopes?: string | string[];
	/** Custom rate limit rules for this specific check. */
	rateLimit?: RateLimitRequest;
}

/** The result of checking if an API key is valid. */
export interface VerifyResult {
	/** Whether the key is valid and can be used. */
	valid: boolean;
	/** If the key is invalid, this explains why (like "not_found" or "expired"). */
	reason?: string;
	/** The unique ID of the key (only included if valid). */
	keyId?: KeyId;
	/** The user who owns this key (only included if valid and set on the key). */
	userId?: UserId;
	/** Any extra information stored with the key (only included if requested). */
	metadata?: Record<string, unknown>;
}

/**
 * Standard error format used throughout the library.
 *
 * All errors include a code and message. Some errors can be retried (like temporary connection issues),
 * while others cannot (like invalid API keys).
 */
export interface UsefulKeyError {
	/** Short error code (like "KEY_NOT_FOUND" or "RATE_LIMITED"). */
	code: string;
	/** Human-readable description of what went wrong. */
	message: string;
	/** Whether this error might be fixed by trying again later. */
	retryable?: boolean;
	/** The original error that caused this one (if any). */
	cause?: unknown;
	/** Extra information about the error. */
	meta?: Record<string, unknown>;
}

/** Wrapper that contains either a successful result or an error (but not both). */
export type Result<T> = {
	result?: T;
	error?: UsefulKeyError;
};

/**
 * Common error codes used by the core library.
 *
 * These help identify what went wrong in a consistent way. Additional codes
 * can be added by plugins as needed.
 */
export const ErrorCodes = {
	UNKNOWN: "UNKNOWN",
	KEYSTORE_READ_FAILED: "KEYSTORE_READ_FAILED",
	KEYSTORE_WRITE_FAILED: "KEYSTORE_WRITE_FAILED",
	KEYSTORE_REVOKE_FAILED: "KEYSTORE_REVOKE_FAILED",
	KEYSTORE_SWEEP_UNSUPPORTED: "KEYSTORE_SWEEP_UNSUPPORTED",
	ANALYTICS_TRACK_FAILED: "ANALYTICS_TRACK_FAILED",
	KEY_GENERATION_FAILED: "KEY_GENERATION_FAILED",
	EXTEND_KEY_EXPIRY_FAILED: "EXTEND_KEY_EXPIRY_FAILED",
	PLUGIN_BLOCKED: "PLUGIN_BLOCKED",
	PLUGIN_SETUP_FAILED: "PLUGIN_SETUP_FAILED",
} as const;

/** All possible error codes from the core library. */
export type UsefulKeyErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Options for creating a new API key.
 *
 * You can customize various aspects of the key, or leave most fields blank
 * to use sensible defaults.
 */
export interface CreateKeyInput {
	/** Custom ID for the key (if not provided, one will be generated). */
	id?: KeyId;
	/** Which user should own this key. */
	userId?: UserId | null;
	/** Custom prefix for the key (like "sk-" or "pk-"). */
	prefix?: string;
	/** When the key should expire (timestamp in milliseconds). */
	expiresAt?: number | null;
	/** Any extra information you want to store with the key. */
	metadata?: Record<string, unknown>;
	/** How many times the key can be used (null means unlimited). */
	usesRemaining?: number | null;
	/** What format the key should use. */
	keyKind?: KeyKind;
}

/** Information returned when a key is successfully created. */
export interface CreateKeyResult {
	id: KeyId;
	/** The actual API key (this is only shown once for security). */
	key: string;
	metadata?: Record<string, unknown>;
}

/**
 * Interface for storing and retrieving API key data.
 *
 * This defines how to save keys to a database, find them later, and manage their lifecycle.
 * You can implement this for any storage system (database, Redis, etc.).
 */
export interface KeyStoreAdapter {
	/** Promise that resolves when the storage system is ready to use. */
	readonly ready?: Promise<void>;
	/** Save a new API key to storage. */
	createKey(record: KeyRecord): Promise<void>;
	/** Find a key by its unique ID. */
	findKeyById(id: KeyId): Promise<KeyRecord | null>;
	/** Find a key by its secure hash (used for verification). */
	findKeyByHash(keyHash: string): Promise<KeyRecord | null>;
	/** Update an existing key's information. */
	updateKey(record: KeyRecord): Promise<void>;
	/** Disable a key so it can no longer be used. */
	revokeKeyById(id: KeyId): Promise<void>;
	/** Permanently delete a key from storage. */
	hardRemoveKeyById(id: KeyId): Promise<void>;
	/** Find keys that have expired (optional, for cleanup tasks). */
	findExpiredIds?(olderThan: number, limit: number): Promise<KeyId[]>;
}

/**
 * Interface for managing rate limits (preventing abuse by limiting requests).
 *
 * Supports different rate limiting strategies like fixed time windows and token buckets.
 * This helps control how often API keys can be used.
 */
export interface RateLimitStoreAdapter {
	/** Promise that resolves when the rate limiting system is ready. */
	readonly ready?: Promise<void>;
	/** Count a request and check if it's within the allowed limit. */
	incrementAndCheck(
		namespace: string,
		identifier: string,
		limit: number,
		durationMs: Milliseconds,
	): Promise<{ success: boolean; remaining: number; reset: number }>;
	/** Check current usage without counting a new request. */
	check(
		namespace: string,
		identifier: string,
		limit: number,
		durationMs: Milliseconds,
	): Promise<{ success: boolean; remaining: number; reset: number }>;
	/** Use tokens from a bucket (refills over time). */
	consumeTokenBucket(
		namespace: string,
		identifier: string,
		capacity: number,
		refillTokens: number,
		refillIntervalMs: Milliseconds,
		cost?: number,
	): Promise<{ success: boolean; remaining: number; reset: number }>;
	/** Reset all counters for this identifier to start fresh. */
	reset(namespace: string, identifier: string): Promise<void>;
}

/** Interface for sending usage data to analytics systems. */
export interface AnalyticsAdapter {
	/** Promise that resolves when the analytics system is ready. */
	readonly ready?: Promise<void>;
	/** Record an event with any additional data you want to track. */
	track(event: string, payload: Record<string, unknown>): Promise<void>;
}

/** Re-export rate limit types from the ratelimit module. */
export type {
	RateLimitFixedWindow,
	RateLimitRequest,
	RateLimitTokenBucket,
} from "./ratelimit";

/**
 * Interface for cryptographic operations (encryption, hashing, random numbers).
 *
 * The library provides a default implementation, but you can customize these
 * functions if needed for your specific environment or security requirements.
 */
export interface CryptoProvider {
	hashSha256(input: string): string;
	/** Create a secure signature using a secret key. */
	hmacSha256(message: string, key: string | Uint8Array): string;
	getRandomValues(array: Uint8Array): Uint8Array;
	randomUUID(): string;
}

/** Web Crypto API interface for browsers and edge environments. */
export interface CryptoLike {
	getRandomValues(array: Uint8Array): Uint8Array;
	randomUUID?: () => string;
}

/**
 * Node.js crypto module interface.
 *
 * Accepts both the classic Node crypto and the newer webcrypto implementations.
 */
export interface NodeCryptoLike {
	createHash: (algorithm: string) => {
		update(input: string | Uint8Array): unknown;
		digest(encoding: "hex" | "base64" | "binary"): string | Uint8Array;
	};
	createHmac?: (
		algorithm: string,
		key: string | Uint8Array | Buffer | DataView,
	) => {
		update(input: string | Uint8Array): unknown;
		digest(encoding: "hex" | "base64" | "binary"): string | Uint8Array;
	};
	randomUUID?: () => string;
	randomBytes?: (size: number) => Uint8Array | Buffer;
	webcrypto?: CryptoLike;
}

/**
 * Main configuration options for setting up UsefulKey.
 *
 * Most settings are optional - the library will work with sensible defaults.
 * You can customize storage, security, and behavior through these options.
 */
export interface UsefulKeyConfig {
	/** Default text that appears at the start of generated keys (default: "uk"). */
	keyPrefix?: string;
	/** Set to true if you don't want any prefix on your keys. */
	disablePrefix?: boolean;
	/** What format to use for generating new keys. */
	defaultKeyKind?: KeyKind;
	/**
	 * Connect to your own storage systems.
	 *
	 * By default, everything is stored in memory (temporary). For production,
	 * you'll want to connect to a real database and analytics system.
	 */
	adapters?: {
		keyStore?: KeyStoreAdapter;
		rateLimitStore?: RateLimitStoreAdapter;
		analytics?: AnalyticsAdapter;
	};
	/** Automatically delete expired keys when they're accessed (default: false). */
	autoDeleteExpiredKeys?: boolean;
	/** Custom encryption/hashing functions for your environment. */
	crypto?: Partial<CryptoProvider> | CryptoLike | NodeCryptoLike;
	/** Custom function for hashing keys (advanced security option). */
	customHashKey?: (key: string) => string;
	/**
	 * Secret key for extra security when hashing.
	 *
	 * When provided, keys are hashed with this secret, making them much harder
	 * to guess even if your database is compromised. This secret is never stored.
	 */
	secret?: string | Uint8Array;
	/** Custom function to generate your own key format. */
	customGenerateKey?: () => string;
	/** Custom function to generate unique IDs for keys. */
	customIdGenerator?: () => string;
}

/** Settings for controlling which IP addresses can use API keys. */
export type IpAccessControlArgs = { allow?: string[]; deny?: string[] };

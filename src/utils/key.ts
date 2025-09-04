/**
 * Key generation and rendering utilities.
 *
 * Provides declarative `KEY.*` helpers to describe a key kind, a `renderKey`
 * function to materialize a plaintext key (optionally with a prefix), and a
 * `hashKey` helper that maps to the configured SHA‑256 implementation.
 */
import type { KeyKind, UsefulKeyConfig } from "../types/common";
import { hashSha256, hmacSha256, randomString, uuid } from "./crypto";

const ALPHABET_URLSAFE =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const ALPHABET_HEX = "0123456789abcdef";
const ALPHABET_BASE32_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Declarative helpers to construct `KeyKind` values. */
export const KEY = {
	UUID(prefix?: string): KeyKind {
		return { type: "uuid", prefix };
	},
	URLSafe(length = 32, prefix?: string): KeyKind {
		return { type: "urlsafe", length, prefix };
	},
	HEX(length = 64, prefix?: string): KeyKind {
		return { type: "hex", length, prefix };
	},
	Base32(length = 26, prefix?: string): KeyKind {
		return { type: "base32", length, prefix };
	},
} as const;

/** Render a plaintext key from a `KeyKind` and optional prefix controls. */
export function renderKey(
	kind: KeyKind,
	defaultPrefix = "uk",
	includePrefix: boolean = true,
): string {
	let body: string;
	switch (kind.type) {
		case "uuid":
			body = uuid();
			break;
		case "urlsafe": {
			const len = kind.length ?? 32;
			body = randomString(len, ALPHABET_URLSAFE);
			break;
		}
		case "hex": {
			const len = kind.length ?? 64;
			body = randomString(len, ALPHABET_HEX);
			break;
		}
		case "base32": {
			const len = kind.length ?? 26;
			body = randomString(len, ALPHABET_BASE32_CROCKFORD);
			break;
		}
	}
	if (!includePrefix) return body;
	const prefix = kind.prefix ?? defaultPrefix;
	return `${prefix}_${body}`;
}

/** Hash a plaintext key with the configured hashing implementation. */
/**
 * Hash a plaintext key using either HMAC-SHA256 (when a secret is present on
 * the instance config) or plain SHA-256. Callers that need instance-aware
 * hashing should prefer using the overload that accepts the config.
 */
export function hashKey(key: string): string {
	return hashSha256(key);
}

/** Instance-aware hashing that respects `config.secret` when present. */
export function hashKeyWithConfig(
	key: string,
	config: UsefulKeyConfig,
): string {
	if (typeof config.customHashKey === "function")
		return config.customHashKey(key);
	if (config.secret !== undefined && config.secret !== null)
		return hmacSha256(key, config.secret);
	return hashSha256(key);
}

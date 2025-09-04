/**
 * Crypto utilities for secure operations.
 *
 * This module handles password hashing, secure random number generation, and
 * unique ID creation. It works in different environments (browsers, Node.js, etc.)
 * and can be customized with your own crypto functions if needed.
 */
import { sha256 } from "js-sha256";
import type {
	CryptoLike,
	CryptoProvider,
	NodeCryptoLike,
} from "../types/common";

// Default crypto provider - works in most environments with basic fallbacks
let provider: CryptoProvider = {
	hashSha256: (input: string) => sha256(input),
	hmacSha256: (message: string, key: string | Uint8Array): string => {
		const k: string | Uint8Array = key;
		const anySha: any = sha256 as unknown as {
			hmac?: (k: any, m: any) => string;
		};
		if (anySha && typeof anySha.hmac === "function") {
			return anySha.hmac(k as any, message);
		}

		try {
			const nodeCrypto = require("node:crypto");
			const bufKey = typeof k === "string" ? k : Buffer.from(k);
			const h = nodeCrypto.createHmac("sha256", bufKey);
			h.update(message);
			return h.digest("hex");
		} catch (_e) {
			// Basic fallback if HMAC isn't available
			return sha256(
				message + (typeof k === "string" ? k : Array.from(k).join(",")),
			);
		}
	},
	getRandomValues: (array: Uint8Array) => {
		const g = globalThis as unknown as {
			crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array };
		};
		if (g.crypto?.getRandomValues) return g.crypto.getRandomValues(array);
		const nodeEnv: string | undefined = (() => {
			try {
				return (
					globalThis as unknown as { process?: { env?: { NODE_ENV?: string } } }
				).process?.env?.NODE_ENV;
			} catch {
				return undefined;
			}
		})();
		if (nodeEnv === "production") {
			throw new Error(
				"Secure random number generation not available in production. Please configure a crypto provider or ensure Web Crypto is available.",
			);
		}
		// Basic fallback for development only (not secure for production)
		for (let i = 0; i < array.length; i++)
			array[i] = Math.floor(Math.random() * 256);
		return array;
	},
	randomUUID: () => {
		const g = globalThis as unknown as {
			crypto?: { randomUUID?: () => string };
		};
		if (g.crypto?.randomUUID) return g.crypto.randomUUID();
		const bytes = provider.getRandomValues(new Uint8Array(16));
		bytes[6] = (bytes[6] & 0x0f) | 0x40;
		bytes[8] = (bytes[8] & 0x3f) | 0x80;
		const toHex = (n: number) => n.toString(16).padStart(2, "0");
		const b = Array.from(bytes, (n) => toHex(n));
		return (
			b[0] +
			b[1] +
			b[2] +
			b[3] +
			"-" +
			b[4] +
			b[5] +
			"-" +
			b[6] +
			b[7] +
			"-" +
			b[8] +
			b[9] +
			"-" +
			b[10] +
			b[11] +
			b[12] +
			b[13] +
			b[14] +
			b[15]
		);
	},
};

/** Set up custom crypto functions (useful for different environments or security requirements). */
export function configureCryptoProvider(
	custom: Partial<CryptoProvider> | CryptoLike | NodeCryptoLike,
): void {
	if (isNodeCryptoLike(custom)) {
		const nodeCrypto = custom as NodeCryptoLike;
		provider = {
			...provider,
			hashSha256: (input: string) => nodeSha256(nodeCrypto, input),
			hmacSha256: (message: string, key: string | Uint8Array) => {
				if (typeof nodeCrypto.createHmac === "function") {
					const bufKey =
						typeof key === "string" ? key : Buffer.from(key as Uint8Array);
					const hasher = nodeCrypto.createHmac?.("sha256", bufKey);
					hasher.update(message);
					const out = hasher.digest("hex");
					return typeof out === "string"
						? out
						: Buffer.from(out as unknown as Uint8Array).toString("hex");
				}
				// Use the default implementation if HMAC isn't available
				return provider.hmacSha256(message, key);
			},
			getRandomValues: (arr: Uint8Array) =>
				nodeCrypto.webcrypto?.getRandomValues
					? nodeCrypto.webcrypto.getRandomValues(arr)
					: provider.getRandomValues(arr),
			randomUUID: () =>
				nodeCrypto.randomUUID
					? nodeCrypto.randomUUID()
					: providerFallbackRandomUUID(),
		};
	} else if (isCryptoLike(custom)) {
		provider = {
			...provider,
			getRandomValues: (arr: Uint8Array) => custom.getRandomValues(arr),
			randomUUID: () =>
				custom.randomUUID ? custom.randomUUID() : providerFallbackRandomUUID(),
		};
	} else {
		// Merge custom functions with the default provider
		provider = {
			...provider,
			...(custom as Partial<CryptoProvider>),
		};
	}
}

function isCryptoLike(value: unknown): value is CryptoLike {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { getRandomValues?: unknown }).getRandomValues ===
			"function"
	);
}

function isNodeCryptoLike(value: unknown): value is NodeCryptoLike {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { createHash?: unknown }).createHash === "function"
	);
}

function nodeSha256(nodeCrypto: NodeCryptoLike, input: string): string {
	const hasher = nodeCrypto.createHash("sha256");
	hasher.update(input);
	const out = hasher.digest("hex");
	return typeof out === "string"
		? out
		: Buffer.from(out as unknown as Uint8Array).toString("hex");
}

function providerFallbackRandomUUID(): string {
	const bytes = provider.getRandomValues(new Uint8Array(16));
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const toHex = (n: number) => n.toString(16).padStart(2, "0");
	const b = Array.from(bytes, (n) => toHex(n));
	return (
		b[0] +
		b[1] +
		b[2] +
		b[3] +
		"-" +
		b[4] +
		b[5] +
		"-" +
		b[6] +
		b[7] +
		"-" +
		b[8] +
		b[9] +
		"-" +
		b[10] +
		b[11] +
		b[12] +
		b[13] +
		b[14] +
		b[15]
	);
}

/** Create a SHA-256 hash of the input string. */
export function hashSha256(input: string): string {
	return provider.hashSha256(input);
}

/** Create a secure signature using HMAC-SHA256. */
export function hmacSha256(message: string, key: string | Uint8Array): string {
	return provider.hmacSha256(message, key);
}

/** Generate a unique identifier (UUID format). */
export function uuid(): string {
	return provider.randomUUID();
}

/** Generate a random string using only characters from the provided alphabet. */
export function randomString(length: number, alphabet: string): string {
	if (length <= 0) return "";
	const output: string[] = [];
	const bytes = provider.getRandomValues(new Uint8Array(length));
	const base = alphabet.length;
	for (let i = 0; i < length; i++) {
		output.push(alphabet[bytes[i] % base]);
	}
	return output.join("");
}

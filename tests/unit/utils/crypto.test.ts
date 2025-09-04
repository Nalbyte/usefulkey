import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
	configureCryptoProvider,
	hashSha256,
	hmacSha256,
	randomString,
	uuid,
} from "../../../src/utils/crypto";

describe("crypto utils", () => {
	beforeEach(() => {
		let seed = 1;
		const nextByte = () => {
			seed = (seed * 1103515245 + 12345) >>> 0;
			return seed & 0xff;
		};
		configureCryptoProvider({
			getRandomValues: (arr: Uint8Array) => {
				for (let i = 0; i < arr.length; i++) arr[i] = nextByte();
				return arr;
			},
			randomUUID: () => "11111111-1111-4111-8111-111111111111",
		});
	});

	it("hashSha256 delegates to provider", () => {
		configureCryptoProvider({ hashSha256: (s: string) => `sha256:${s}` });
		expect(hashSha256("abc")).toBe("sha256:abc");
	});

	it("hmacSha256 (default provider) matches Node createHmac output", () => {
		const msg = "hello world";
		const key = "top_secret";
		const expected = crypto.createHmac("sha256", key).update(msg).digest("hex");
		const got = hmacSha256(msg, key);
		expect(got).toBe(expected);
	});

	it("uuid delegates to provider", () => {
		expect(uuid()).toBe("11111111-1111-4111-8111-111111111111");
	});

	it("randomString respects length and alphabet", () => {
		const out = randomString(8, "AB");
		expect(out).toMatch(/^[AB]{8}$/);
	});

	it("randomString returns empty for non-positive length", () => {
		expect(randomString(0, "ABC")).toBe("");
		expect(randomString(-5, "ABC")).toBe("");
	});

	it("configureCryptoProvider accepts Web Crypto-like object", () => {
		let idx = 0;
		const bytes: number[] = [
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
		];
		configureCryptoProvider({
			getRandomValues: (arr: Uint8Array) => {
				for (let i = 0; i < arr.length; i++)
					arr[i] = bytes[idx++ % bytes.length];
				return arr;
			},
		});

		const id = uuid();
		expect(id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
		);
	});

	it("randomString works with single-character alphabet", () => {
		const s = randomString(5, "X");
		expect(s).toBe("XXXXX");
	});
});

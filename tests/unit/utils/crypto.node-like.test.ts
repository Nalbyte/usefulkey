import { describe, expect, it } from "vitest";
import {
	configureCryptoProvider,
	hashSha256,
	hmacSha256,
	uuid,
} from "../../../src/utils/crypto";

describe("crypto utils - NodeCrypto-like provider", () => {
	it("uses node createHash digest for hashSha256 and node randomUUID when provided", () => {
		const digests: string[] = [];
		const mock = {
			createHash(alg: string) {
				expect(alg).toBe("sha256");
				return {
					_buf: "",
					update(this: { _buf: string }, s: string) {
						this._buf += s;
					},
					digest(this: { _buf: string }, fmt: string) {
						expect(fmt).toBe("hex");
						const out = `deadbeef${this._buf}`;
						digests.push(out);
						return out;
					},
				} as {
					_buf: string;
					update(s: string): void;
					digest(fmt: string): string;
				};
			},
			randomUUID() {
				return "22222222-2222-4222-8222-222222222222";
			},
			webcrypto: {
				getRandomValues(arr: Uint8Array) {
					for (let i = 0; i < arr.length; i++) arr[i] = (i * 7) & 0xff;
					return arr;
				},
			},
		} as {
			createHash(alg: string): {
				_buf: string;
				update(s: string): void;
				digest(fmt: string): string;
			};
			randomUUID(): string;
			webcrypto: { getRandomValues(arr: Uint8Array): Uint8Array };
		};

		configureCryptoProvider(mock);
		expect(hashSha256("x")).toMatch(/^deadbeefx$/);
		expect(uuid()).toBe("22222222-2222-4222-8222-222222222222");
	});

	it("uses node createHmac for hmacSha256 when provided", () => {
		const mock = {
			createHash(_alg: string) {
				return {
					update() {},
					digest() {
						return "";
					},
				} as any;
			},
			createHmac(alg: string, key: string) {
				expect(alg).toBe("sha256");
				expect(key).toBe("k");
				return {
					_buf: "",
					update(this: { _buf: string }, s: string) {
						this._buf += s;
					},
					digest(this: { _buf: string }, fmt: string) {
						expect(fmt).toBe("hex");
						return `hm_${this._buf}`;
					},
				} as any;
			},
			webcrypto: {
				getRandomValues(arr: Uint8Array) {
					return arr;
				},
			},
		} as any;

		configureCryptoProvider(mock);
		const out = hmacSha256("m", "k");
		expect(out).toBe("hm_m");
	});
});

import { describe, expect, it } from "vitest";
import {
	configureCryptoProvider,
	hashSha256,
	randomString,
	uuid,
} from "../../../src/utils/crypto";

describe("utils/crypto edge paths", () => {
	it("hashSha256 works via default and node-like provider override", () => {
		const h1 = hashSha256("abc");
		expect(typeof h1).toBe("string");
		const digests: string[] = [];
		const nodeLike = {
			createHash() {
				const chunks: any[] = [];
				return {
					update(data: any) {
						chunks.push(data);
					},
					digest() {
						const out = Buffer.from("deadbeef", "hex");
						digests.push(out.toString("hex"));
						return out;
					},
				} as any;
			},
			randomUUID() {
				return "11111111-1111-4111-8111-111111111111";
			},
		} as any;
		configureCryptoProvider(nodeLike);
		const h2 = hashSha256("x");
		expect(h2).toBe("deadbeef");
		expect(digests.length).toBeGreaterThan(0);
	});

	it("uuid falls back when provider lacks randomUUID and randomString respects alphabet", () => {
		configureCryptoProvider({
			getRandomValues: (arr: Uint8Array) => {
				for (let i = 0; i < arr.length; i++) arr[i] = i;
				return arr;
			},
		} as any);
		const id = uuid();
		expect(id).toMatch(/[0-9a-f-]{36}/);
		const s = randomString(5, "ab");
		expect(s).toHaveLength(5);
		expect(/^[ab]+$/.test(s)).toBe(true);
	});
});

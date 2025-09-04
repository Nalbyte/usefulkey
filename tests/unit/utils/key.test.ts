import { beforeEach, describe, expect, it } from "vitest";
import { configureCryptoProvider } from "../../../src/utils/crypto";
import { hashKey, KEY, renderKey } from "../../../src/utils/key";

beforeEach(() => {
	let seed = 12345;
	const nextByte = () => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed & 0xff;
	};
	configureCryptoProvider({
		getRandomValues: (arr: Uint8Array) => {
			for (let i = 0; i < arr.length; i++) arr[i] = nextByte();
			return arr;
		},
		randomUUID: () => "00000000-0000-4000-8000-000000000000",
	} as unknown as Parameters<typeof configureCryptoProvider>[0]);
});

describe("KEY and renderKey", () => {
	it("renders UUID with prefix", () => {
		const t = renderKey(KEY.UUID(), "uk");
		expect(t).toMatch(/^uk_00000000-0000-4000-8000-000000000000$/);
	});

	it("renders URLSafe of given length", () => {
		const t = renderKey(KEY.URLSafe(10), "uk");
		expect(t.startsWith("uk_")).toBe(true);
		const body = t.slice(3);
		expect(body).toHaveLength(10);
	});

	it("renders HEX of given length", () => {
		const t = renderKey(KEY.HEX(8), "uk");
		expect(t.startsWith("uk_")).toBe(true);
		const hex = t.split("_")[1];
		expect(hex).toMatch(/^[0-9a-f]{8}$/);
	});

	it("renders Base32", () => {
		const t = renderKey(KEY.Base32(12), "uk");
		expect(t.startsWith("uk_")).toBe(true);
		const body = t.split("_")[1];
		expect(body).toHaveLength(12);
	});

	it("supports includePrefix=false and prefix overrides", () => {
		const noPref = renderKey(KEY.URLSafe(4), "uk", false);
		expect(noPref).toHaveLength(4);

		const defaultPref = renderKey(KEY.URLSafe(4), "df");
		expect(defaultPref.startsWith("df_")).toBe(true);

		const explicitKindPref = renderKey(KEY.URLSafe(4, "kp"), "df");
		expect(explicitKindPref.startsWith("kp_")).toBe(true);
	});

	it("handles zero-length kinds producing empty body (prefix only when included)", () => {
		const url = renderKey(KEY.URLSafe(0), "pfx");
		expect(url).toBe("pfx_");
		const hex = renderKey(KEY.HEX(0), "pfx");
		expect(hex).toBe("pfx_");
		const b32 = renderKey(KEY.Base32(0), "pfx");
		expect(b32).toBe("pfx_");
	});
});

describe("hashKey", () => {
	it("delegates to configured hashSha256", () => {
		configureCryptoProvider({ hashSha256: (s: string) => `sha256:${s}` });
		expect(hashKey("abc")).toBe("sha256:abc");
	});
});

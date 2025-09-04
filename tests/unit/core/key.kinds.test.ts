import { beforeEach, describe, expect, it } from "vitest";
import { KEY, MemoryKeyStore, usefulkey } from "../../../src";
import { configureCryptoProvider, hashSha256 } from "../../../src/utils/crypto";
import { renderKey } from "../../../src/utils/key";

beforeEach(() => {
	let seed = 12345;
	const nextByte = () => {
		seed = (seed * 1664525 + 5013904223) >>> 0;
		return seed & 0xff;
	};
	configureCryptoProvider({
		getRandomValues: (arr: Uint8Array) => {
			for (let i = 0; i < arr.length; i++) arr[i] = nextByte();
			return arr;
		},
		randomUUID: () => "00000000-0000-4000-8000-000000000000",
	} as any);
});

describe("KEY kinds: create + verify", () => {
	it("UUID: create and verify", async () => {
		const uk = usefulkey({});
		const created = await uk.createKey({
			userId: "u",
			keyKind: KEY.UUID("acme"),
		});
		expect(created.error).toBeFalsy();
		expect(created.result!.key.startsWith("acme_")).toBe(true);

		const v = await uk.verifyKey({ key: created.result!.key });
		expect(v.error).toBeFalsy();
		expect(v.result?.valid).toBe(true);
	});

	it("Base32: create and verify", async () => {
		const uk = usefulkey({});
		const created = await uk.createKey({
			userId: "u",
			keyKind: KEY.Base32(12),
		});
		expect(created.error).toBeFalsy();
		const body = created.result!.key.split("_")[1];
		expect(body).toHaveLength(12);

		const v = await uk.verifyKey({ key: created.result!.key });
		expect(v.error).toBeFalsy();
		expect(v.result?.valid).toBe(true);
	});
});

describe("KEY kinds: alphabets and lengths", () => {
	it("URLSafe uses URL-safe alphabet", () => {
		const t = renderKey(KEY.URLSafe(64), "uk");
		const body = t.slice("uk_".length);
		expect(body).toMatch(/^[A-Za-z0-9\-_]{64}$/);
	});

	it("HEX uses lowercase hex alphabet", () => {
		const t = renderKey(KEY.HEX(64), "uk");
		const body = t.split("_")[1];
		expect(body).toMatch(/^[0-9a-f]{64}$/);
	});

	it("Base32 uses Crockford alphabet (no I, L, O, U)", () => {
		const t = renderKey(KEY.Base32(32), "uk");
		const body = t.split("_")[1];
		expect(body).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{32}$/);
		expect(body).not.toMatch(/[ILOU]/);
	});

	it("boundary lengths render correctly", () => {
		const u1 = renderKey(KEY.URLSafe(1), "uk");
		expect(u1.slice("uk_".length)).toHaveLength(1);
		const u128 = renderKey(KEY.URLSafe(128), "uk");
		expect(u128.slice("uk_".length)).toHaveLength(128);

		const h1 = renderKey(KEY.HEX(1), "uk");
		expect(h1.split("_")[1]).toHaveLength(1);
		const b1 = renderKey(KEY.Base32(1), "uk");
		expect(b1.split("_")[1]).toHaveLength(1);
	});
});

describe("KEY kinds: prefix behavior", () => {
	it("keyKind.prefix takes precedence over CreateKeyInput.prefix", async () => {
		const uk = usefulkey({ keyPrefix: "uk" });
		const created = await uk.createKey({
			userId: "u",
			keyKind: KEY.URLSafe(50, "kindpref"),
			prefix: "inputpref",
		});
		expect(created.error).toBeFalsy();
		expect(created.result!.key.startsWith("kindpref_")).toBe(true);
	});

	it("CreateKeyInput.prefix used when kind has no prefix", async () => {
		const uk = usefulkey({ keyPrefix: "uk" });
		const created = await uk.createKey({
			userId: "u",
			keyKind: KEY.URLSafe(50),
			prefix: "inputpref",
		});
		expect(created.error).toBeFalsy();
		expect(created.result!.key.startsWith("inputpref_")).toBe(true);
	});

	it("falls back to config.keyPrefix when neither provided", async () => {
		const uk = usefulkey({ keyPrefix: "acme" });
		const created = await uk.createKey({
			userId: "u",
			keyKind: KEY.URLSafe(50),
		});
		expect(created.error).toBeFalsy();
		expect(created.result!.key.startsWith("acme_")).toBe(true);
	});
});

describe("KEY kinds: disablePrefix behavior", () => {
	it("omits prefix in plaintext and stores empty prefix when disabled", async () => {
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey({ disablePrefix: true, adapters: { keyStore } });
		const created = await uk.createKey({
			userId: "u",
			keyKind: KEY.URLSafe(50),
		});
		expect(created.error).toBeFalsy();

		const plaintext = created.result!.key;
		const rec = await keyStore.findKeyByHash(hashSha256(plaintext));
		expect(rec).toBeTruthy();
		expect(rec!.prefix).toBe("");
		const v = await uk.verifyKey({ key: plaintext });
		expect(v.error).toBeFalsy();
		expect(v.result?.valid).toBe(true);
	});
});

describe("KEY kinds: defaultKeyKind override", () => {
	it("uses provided defaultKeyKind when no override passed", async () => {
		const uk = usefulkey({ defaultKeyKind: KEY.Base32(16) });
		const created = await uk.createKey({ userId: "u" });
		expect(created.error).toBeFalsy();

		const body = created.result!.key.split("_")[1];
		expect(body).toHaveLength(16);
		expect(body).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{16}$/);
	});
});

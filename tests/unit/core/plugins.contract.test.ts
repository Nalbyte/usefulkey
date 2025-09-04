import { beforeEach, describe, expect, it, vi } from "vitest";
import { usefulkey } from "../../../src/core/usefulkey";
import type { UsefulKeyPluginHooks } from "../../../src/types/plugins";
import { configureCryptoProvider } from "../../../src/utils/crypto";

function createDummyPlugin(
	opts: {
		blockCreate?: boolean;
		blockBeforeVerify?: boolean;
		blockOnLoaded?: boolean;
	},
	calls: string[],
): () => UsefulKeyPluginHooks {
	return () => ({
		name: "dummy",
		async setup() {
			calls.push("setup");
		},
		async beforeCreateKey() {
			calls.push("beforeCreateKey");
			if (opts.blockCreate)
				return { reject: true, reason: "dummy_block_create" };
		},
		async onKeyCreated() {
			calls.push("onKeyCreated");
		},
		async beforeVerify(_ctx, _args) {
			calls.push("beforeVerify");
			if (opts.blockBeforeVerify)
				return { reject: true, reason: "dummy_before" };
		},
		async onKeyRecordLoaded(_ctx, _args) {
			calls.push("onKeyRecordLoaded");
			if (opts.blockOnLoaded) return { reject: true, reason: "dummy_loaded" };
		},
		async onVerifySuccess() {
			calls.push("onVerifySuccess");
		},
		extend: {
			__dummy: true,
			ping: () => 42,
		},
	});
}

beforeEach(() => {
	let seed = 12345;
	const nextByte = () => (seed = (seed * 1664525 + 1013904223) >>> 0) & 0xff;
	configureCryptoProvider({
		getRandomValues: (arr: Uint8Array) => {
			for (let i = 0; i < arr.length; i++) arr[i] = nextByte();
			return arr;
		},
		randomUUID: () => "00000000-0000-4000-8000-000000000000",
	} as any);

	vi.useFakeTimers();
	vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
});

describe("Core plugin contract", () => {
	it("wires setup, extend surface, and propagates hook decisions", async () => {
		const calls: string[] = [];
		const opts = {
			blockCreate: false,
			blockBeforeVerify: false,
			blockOnLoaded: false,
		};
		const uk = usefulkey(
			{},
			{ plugins: [createDummyPlugin(opts, calls)] },
		) as any;

		await uk.ready;
		expect(calls).toContain("setup");

		expect(uk.__dummy).toBe(true);
		expect(typeof uk.ping).toBe("function");
		expect(uk.ping()).toBe(42);

		const created = await uk.createKey({ userId: "u" });
		expect(created.error).toBeFalsy();
		expect(calls).toContain("beforeCreateKey");
		expect(calls).toContain("onKeyCreated");

		calls.length = 0;
		const ok = await uk.verifyKey({ key: created.result!.key });
		expect(ok.result?.valid).toBe(true);
		expect(calls).toEqual(
			expect.arrayContaining([
				"beforeVerify",
				"onKeyRecordLoaded",
				"onVerifySuccess",
			]),
		);

		calls.length = 0;
		opts.blockBeforeVerify = true;
		const blocked1 = await uk.verifyKey({ key: created.result!.key });
		expect(blocked1.result?.valid).toBe(false);
		expect(blocked1.result?.reason).toBe("dummy_before");
		expect(calls).toContain("beforeVerify");
		expect(calls).not.toContain("onVerifySuccess");

		calls.length = 0;
		opts.blockBeforeVerify = false;
		opts.blockOnLoaded = true;
		const blocked2 = await uk.verifyKey({ key: created.result!.key });
		expect(blocked2.result?.valid).toBe(false);
		expect(blocked2.result?.reason).toBe("dummy_loaded");
		expect(calls).toContain("onKeyRecordLoaded");
	});
});

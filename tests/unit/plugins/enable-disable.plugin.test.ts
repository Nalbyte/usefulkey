import { beforeEach, describe, expect, it } from "vitest";
import { MemoryKeyStore, type UsefulKey, usefulkey } from "../../../src";
import { enableDisable } from "../../../src/plugins/enable-disable";
import { configureCryptoProvider } from "../../../src/utils/crypto";

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
});

describe("enableDisablePlugin", () => {
	it("extends UsefulKey with enable/disable and blocks disabled keys", async () => {
		const uk = usefulkey(
			{ keyPrefix: "acme" },
			{ plugins: [enableDisable()] },
		) satisfies UsefulKey;

		expect(uk.__hasEnableDisable).toBe(true);
		expect(typeof uk.disableKey).toBe("function");
		expect(typeof uk.enableKey).toBe("function");

		const created = await uk.createKey();
		const key = created.result!.key as string;
		const id = (await uk.verifyKey({ key })).result!.keyId as string;

		// Disable
		await uk.disableKey(id);
		const vAfterDisable = await uk.verifyKey({ key });
		expect(vAfterDisable.result?.valid).toBe(false);
		expect(vAfterDisable.result?.reason).toBe("disabled");

		// Enable
		await uk.enableKey(id);
		const vAfterEnable = await uk.verifyKey({ key });
		expect(vAfterEnable.result?.valid).toBe(true);
	});

	it("emits analytics on disable and enable", async () => {
		class InMemoryAnalytics {
			public events: { event: string; payload: Record<string, unknown> }[] = [];
			async track(
				event: string,
				payload: Record<string, unknown>,
			): Promise<void> {
				this.events.push({ event, payload });
			}
		}

		const analytics = new InMemoryAnalytics();
		const uk = usefulkey(
			{ adapters: { analytics } },
			{ plugins: [enableDisable()] },
		) satisfies UsefulKey;

		const created = await uk.createKey();
		const key = created.result!.key as string;
		const id = (await uk.verifyKey({ key })).result!.keyId as string;

		await uk.disableKey(id);
		await uk.enableKey(id);

		const events = analytics.events.map((e) => e.event);
		expect(events).toContain("key.disabled");
		expect(events).toContain("key.enabled");
	});

	it("ignores analytics failures on disable/enable while still toggling state", async () => {
		class ThrowingAnalytics {
			async track(): Promise<void> {
				throw new Error("analytics_down");
			}
		}

		const analytics = new ThrowingAnalytics();
		const uk = usefulkey(
			{ adapters: { analytics } },
			{ plugins: [enableDisable()] },
		) satisfies UsefulKey;

		const created = await uk.createKey();
		const key = created.result!.key as string;
		const id = (await uk.verifyKey({ key })).result!.keyId as string;

		await expect(uk.disableKey(id)).resolves.toBeUndefined();
		const afterDisable = await uk.verifyKey({ key });
		expect(afterDisable.result?.valid).toBe(false);
		expect(afterDisable.result?.reason).toBe("disabled");

		await expect(uk.enableKey(id)).resolves.toBeUndefined();
		const afterEnable = await uk.verifyKey({ key });
		expect(afterEnable.result?.valid).toBe(true);
	});
});

describe("enable-disable plugin error paths", () => {
	it("throws KEY_NOT_FOUND for missing ids on disable/enable", async () => {
		const uk = usefulkey(
			{ adapters: { keyStore: new MemoryKeyStore() } },
			{ plugins: [enableDisable()] },
		);
		await expect((uk as any).disableKey("missing")).rejects.toMatchObject({
			code: "KEY_NOT_FOUND",
		});
		await expect((uk as any).enableKey("missing")).rejects.toMatchObject({
			code: "KEY_NOT_FOUND",
		});
	});
});

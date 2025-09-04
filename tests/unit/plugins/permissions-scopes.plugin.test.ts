import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ConsoleAnalytics,
	MemoryKeyStore,
	MemoryRateLimitStore,
	type UsefulKey,
	usefulkey,
} from "../../../src";
import { permissionsScopes } from "../../../src/plugins/permissions-scopes";

function createBK(opts?: { metadataKey?: string }) {
	return usefulkey(
		{
			adapters: {
				keyStore: new MemoryKeyStore(),
				rateLimitStore: new MemoryRateLimitStore(),
				analytics: new ConsoleAnalytics(),
			},
		},
		{
			plugins: [permissionsScopes({ metadataKey: opts?.metadataKey })],
		},
	);
}

describe("permissions-scopes plugin", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
	});

	it("allows when no required scopes configured or passed", async () => {
		const uk = createBK();
		const created = await uk.createKey();
		const key = created.result?.key ?? "";
		const verified = await uk.verifyKey({ key });
		expect(verified.result?.valid).toBe(true);
	});

	it("blocks when verifyKey passes scopes that are missing from key metadata", async () => {
		const uk = createBK();
		const created = await uk.createKey({ metadata: { scopes: ["a"] } });
		const key = created.result?.key ?? "";
		const verified = await uk.verifyKey({ key, scopes: ["a", "b"] });
		expect(verified.result?.valid).toBe(false);
		expect(verified.result?.reason).toBe("insufficient_scope");
	});

	it("passes when key has all scopes requested in verifyKey", async () => {
		const uk = createBK();
		const created = await uk.createKey({ metadata: { scopes: ["a", "y"] } });
		const key = created.result?.key ?? "";
		const verified = await uk.verifyKey({ key, scopes: ["y"] });
		expect(verified.result?.valid).toBe(true);
	});

	it("respects metadataKey override", async () => {
		const uk = createBK({ metadataKey: "perm" });
		const created = await uk.createKey({ metadata: { perm: ["p"] } });
		const key = created.result?.key ?? "";
		const verified = await uk.verifyKey({ key, scopes: ["p"] });
		expect(verified.result?.valid).toBe(true);
	});

	it("grantScopes / revokeScopes / setScopes / getScopes work", async () => {
		const uk = createBK({ metadataKey: "perm" });
		const created = await uk.createKey();
		const id = created.result?.id as string;

		await (uk as any).grantScopes(id, ["a", "b"]);
		let scopes = await (uk as any).getScopes(id);
		expect(scopes.sort()).toEqual(["a", "b"]);

		await (uk as any).revokeScopes(id, "a");
		scopes = await (uk as any).getScopes(id);
		expect(scopes).toEqual(["b"]);

		await (uk as any).setScopes(id, ["x", "y", "y"]);
		scopes = await (uk as any).getScopes(id);
		expect(scopes.sort()).toEqual(["x", "y"]);
	});

	it("emits analytics for blocked/granted/revoked/set and ignores failures", async () => {
		class InMemoryAnalytics {
			public events: { event: string; payload: Record<string, unknown> }[] = [];
			async track(
				event: string,
				payload: Record<string, unknown>,
			): Promise<void> {
				this.events.push({ event, payload });
			}
		}
		class ThrowingAnalytics {
			async track(): Promise<void> {
				throw new Error("analytics_down");
			}
		}

		// Blocked analytics (InMemoryAnalytics)
		const analytics1 = new InMemoryAnalytics();
		const uk1 = usefulkey(
			{
				adapters: {
					keyStore: new MemoryKeyStore(),
					rateLimitStore: new MemoryRateLimitStore(),
					analytics: analytics1 as any,
				},
			},
			{ plugins: [permissionsScopes()] },
		);
		const c1 = await uk1.createKey({ metadata: { scopes: ["a"] } });
		await uk1.verifyKey({ key: c1.result!.key, scopes: ["a", "b"] });
		const blocked = analytics1.events.find((e) => e.event === "scopes.blocked");
		expect(blocked).toBeTruthy();

		// granted/revoked/set analytics (InMemoryAnalytics)
		const analytics2 = new InMemoryAnalytics();
		const uk2 = usefulkey(
			{
				adapters: {
					keyStore: new MemoryKeyStore(),
					analytics: analytics2 as any,
				},
			},
			{ plugins: [permissionsScopes({ metadataKey: "perm" })] },
		) satisfies UsefulKey;
		const c2 = await uk2.createKey();
		const id2 = c2.result!.id as string;
		await uk2.grantScopes(id2, ["a"]);
		await uk2.revokeScopes(id2, ["z"]);
		await uk2.setScopes(id2, ["x", "y"]);
		const evNames = analytics2.events.map((e) => e.event);
		expect(evNames).toContain("scopes.granted");
		expect(evNames).toContain("scopes.revoked");
		expect(evNames).toContain("scopes.set");

		// Ignore analytics failures for all surfaces
		const uk3 = usefulkey(
			{
				adapters: {
					keyStore: new MemoryKeyStore(),
					analytics: new ThrowingAnalytics() as any,
				},
			},
			{ plugins: [permissionsScopes()] },
		) satisfies UsefulKey;
		const c3 = await uk3.createKey({ metadata: { scopes: ["a"] } });
		await uk3.verifyKey({ key: c3.result!.key, scopes: ["a", "b"] });
		await uk3.grantScopes(c3.result!.id, "b");
		await uk3.revokeScopes(c3.result!.id, "a");
		await uk3.setScopes(c3.result!.id, ["m", "n"]);
		const final = await uk3.verifyKey({ key: c3.result!.key, scopes: ["m"] });
		expect(final.result?.valid).toBe(true);
	});

	it("exposes extension flag and getScopes returns [] for unknown id", async () => {
		const uk = usefulkey(
			{ adapters: { keyStore: new MemoryKeyStore() } },
			{ plugins: [permissionsScopes()] },
		) satisfies UsefulKey;
		expect(uk.__hasPermissionsScopes).toBe(true);
		const scopes = await uk.getScopes("missing");
		expect(scopes).toEqual([]);
	});
});

import { beforeEach, describe, expect, it } from "vitest";
import { usefulkey } from "../../../src";
import {
	ipAccessControlMemory,
	ipAccessControlStatic,
} from "../../../src/plugins";
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

describe("ipAccessControl plugin edge cases", () => {
	it("allows when allow contains IP and deny is empty", async () => {
		const uk = usefulkey(
			{},
			{ plugins: [ipAccessControlStatic({ allow: ["1.1.1.1"] })] },
		);
		const created = await uk.createKey({ userId: "u" });
		const res = await uk.verifyKey({ key: created.result!.key, ip: "1.1.1.1" });
		expect(res.error).toBeFalsy();
		expect(res.result?.valid).toBe(true);
	});

	it("denies when deny contains IP even if allow also contains it (deny precedence)", async () => {
		const uk = usefulkey(
			{},
			{
				plugins: [
					ipAccessControlStatic({
						allow: ["2.2.2.2"],
						deny: ["2.2.2.2"],
					}),
				],
			},
		);
		const created = await uk.createKey();
		const res = await uk.verifyKey({ key: created.result!.key, ip: "2.2.2.2" });
		expect(res.error).toBeFalsy();
		expect(res.result?.valid).toBe(false);
		expect(res.result?.reason).toBe("ip_denied");
	});

	it("denies when allow is set but IP not in allow (ip_not_allowed)", async () => {
		const uk = usefulkey(
			{},
			{ plugins: [ipAccessControlStatic({ allow: ["3.3.3.3"] })] },
		);
		const created = await uk.createKey();
		const res = await uk.verifyKey({ key: created.result!.key, ip: "4.4.4.4" });
		expect(res.error).toBeFalsy();
		expect(res.result?.valid).toBe(false);
		expect(res.result?.reason).toBe("ip_not_allowed");
	});

	it("no-op when ip is not provided (no blocking)", async () => {
		const uk = usefulkey(
			{},
			{ plugins: [ipAccessControlStatic({ allow: ["5.5.5.5"] })] },
		);
		const created = await uk.createKey();
		const res = await uk.verifyKey({ key: created.result!.key });
		expect(res.error).toBeFalsy();
		expect(res.result?.valid).toBe(true);
	});

	it("allows all when both allow and deny empty", async () => {
		const uk = usefulkey({}, { plugins: [ipAccessControlStatic()] });
		const created = await uk.createKey();
		const res = await uk.verifyKey({ key: created.result!.key, ip: "9.9.9.9" });
		expect(res.error).toBeFalsy();
		expect(res.result?.valid).toBe(true);
	});
	it("memory variant can be edited at runtime via exposed API", async () => {
		const uk = usefulkey({}, { plugins: [ipAccessControlMemory()] }) as any;

		const created = await uk.createKey();
		let res = await uk.verifyKey({ key: created.result!.key, ip: "7.7.7.7" });
		expect(res.result?.valid).toBe(true);

		uk.ipAccessControl.addDeny("7.7.7.7");
		res = await uk.verifyKey({ key: created.result!.key, ip: "7.7.7.7" });
		expect(res.result?.valid).toBe(false);
		expect(res.result?.reason).toBe("ip_denied");

		uk.ipAccessControl.removeDeny("7.7.7.7");
		uk.ipAccessControl.addAllow("1.2.3.4");
		res = await uk.verifyKey({ key: created.result!.key, ip: "7.7.7.7" });
		expect(res.result?.valid).toBe(false);
		expect(res.result?.reason).toBe("ip_not_allowed");

		uk.ipAccessControl.addAllow("7.7.7.7");
		res = await uk.verifyKey({ key: created.result!.key, ip: "7.7.7.7" });
		expect(res.result?.valid).toBe(true);

		expect(uk.ipAccessControl.getAllow()).toContain("7.7.7.7");
		expect(uk.ipAccessControl.getDeny()).not.toContain("7.7.7.7");
	});

	it("static plugin emits analytics for deny and allow_list_missing rules", async () => {
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
			{
				plugins: [
					ipAccessControlStatic({ allow: ["1.2.3.4"], deny: ["9.9.9.9"] }),
				],
			},
		);
		const created = await uk.createKey({ userId: "u" });
		const key = created.result!.key;

		const denied = await uk.verifyKey({ key, ip: "9.9.9.9" });
		expect(denied.result?.valid).toBe(false);
		expect(denied.result?.reason).toBe("ip_denied");

		const notAllowed = await uk.verifyKey({ key, ip: "5.6.7.8" });
		expect(notAllowed.result?.valid).toBe(false);
		expect(notAllowed.result?.reason).toBe("ip_not_allowed");

		const blockedEvents = analytics.events.filter(
			(e) => e.event === "ip_access.blocked",
		);
		expect(blockedEvents.length).toBeGreaterThanOrEqual(2);
		const rules = blockedEvents.map((e) => e.payload.rule);
		expect(rules).toContain("deny");
		expect(rules).toContain("allow_list_missing");
		const plugins = blockedEvents.map((e) => e.payload.plugin);
		expect(plugins).toContain("ip-access-control:static");
	});

	it("static plugin ignores analytics failures but still blocks", async () => {
		class ThrowingAnalytics {
			async track(): Promise<void> {
				throw new Error("analytics_down");
			}
		}
		const analytics = new ThrowingAnalytics();
		const uk = usefulkey(
			{ adapters: { analytics } },
			{
				plugins: [
					ipAccessControlStatic({ allow: ["1.1.1.1"], deny: ["2.2.2.2"] }),
				],
			},
		);
		const created = await uk.createKey({ userId: "u" });
		const key = created.result!.key;
		const denied = await uk.verifyKey({ key, ip: "2.2.2.2" });
		expect(denied.result?.valid).toBe(false);
		expect(denied.result?.reason).toBe("ip_denied");
		const notAllowed = await uk.verifyKey({ key, ip: "3.3.3.3" });
		expect(notAllowed.result?.valid).toBe(false);
		expect(notAllowed.result?.reason).toBe("ip_not_allowed");
	});

	it("memory plugin emits analytics and supports clearAllow/clearDeny", async () => {
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
		const uk = usefulkey({}, { plugins: [ipAccessControlMemory()] }) as any;
		(uk as any).analytics = analytics;

		const created = await uk.createKey({ userId: "u" });
		const key = created.result!.key;

		uk.ipAccessControl.addDeny("8.8.8.8");
		const denied = await uk.verifyKey({ key, ip: "8.8.8.8" });
		expect(denied.result?.valid).toBe(false);
		expect(denied.result?.reason).toBe("ip_denied");

		uk.ipAccessControl.clearDeny();

		uk.ipAccessControl.addAllow("1.2.3.4");
		const notAllowed = await uk.verifyKey({ key, ip: "8.8.8.8" });
		expect(notAllowed.result?.valid).toBe(false);
		expect(notAllowed.result?.reason).toBe("ip_not_allowed");

		uk.ipAccessControl.clearAllow();
		const allowed = await uk.verifyKey({ key, ip: "8.8.8.8" });
		expect(allowed.result?.valid).toBe(true);

		const blockedEvents = analytics.events.filter(
			(e) => e.event === "ip_access.blocked",
		);
		const rules = blockedEvents.map((e) => e.payload.rule);
		expect(rules).toContain("deny");
		expect(rules).toContain("allow_list_missing");
		const plugins = blockedEvents.map((e) => e.payload.plugin);
		expect(plugins).toContain("ip-access-control:memory");
	});

	it("static plugin exposes extension flag", async () => {
		const uk = usefulkey({}, { plugins: [ipAccessControlStatic()] }) as any;
		expect(uk.__hasIpAccessControlStatic).toBe(true);
	});
});

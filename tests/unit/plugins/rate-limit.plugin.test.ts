import { beforeEach, describe, expect, it } from "vitest";
import {
	ConsoleAnalytics,
	MemoryKeyStore,
	MemoryRateLimitStore,
	usefulkey,
} from "../../../src";
import { ratelimit } from "../../../src/plugins/rate-limit";
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

describe("ratelimit plugin", () => {
	it("limits by namespace+identifier and emits analytics when blocked", async () => {
		const analyticsEvents: any[] = [];
		const analytics = {
			async track(_e: string, p: any) {
				analyticsEvents.push(p);
			},
		} as any;
		const rateStore = new MemoryRateLimitStore();

		const uk = usefulkey(
			{
				adapters: { rateLimitStore: rateStore, analytics },
			},
			{
				plugins: [
					ratelimit({
						limit: 2,
						duration: "1m",
					}),
				],
			},
		);

		const created = await uk.createKey();

		const id = "1.2.3.4";
		const v1 = await uk.verifyKey({
			key: created.result!.key,
			identifier: id,
			namespace: "ns",
		});
		const v2 = await uk.verifyKey({
			key: created.result!.key,
			identifier: id,
			namespace: "ns",
		});
		const v3 = await uk.verifyKey({
			key: created.result!.key,
			identifier: id,
			namespace: "ns",
		});

		expect(v1.error).toBeFalsy();
		expect(v1.result?.valid).toBe(true);
		expect(v2.error).toBeFalsy();
		expect(v2.result?.valid).toBe(true);
		expect(v3.error).toBeFalsy();
		expect(v3.result?.valid).toBe(false);
		expect(v3.result?.reason).toBe("rate_limited");

		expect(
			analyticsEvents.some((p) => p.namespace === "ns" && p.identifier === id),
		).toBe(true);
	});

	it("requires namespace when plugin enabled", async () => {
		const uk = usefulkey(
			{ adapters: { rateLimitStore: new MemoryRateLimitStore() } },
			{ plugins: [ratelimit({ limit: 1, duration: "1s" })] },
		);
		const created = await uk.createKey();
		const res = await (uk as any).verifyKey({ key: created.result!.key });
		expect(res.error).toBeFalsy();
		expect(res.result?.valid).toBe(false);
		expect(res.result?.reason).toBe("namespace_required");
	});

	it("exposes extension flag and respects custom reason", async () => {
		const analyticsEvents: any[] = [];
		const analytics = {
			async track(_e: string, p: any) {
				analyticsEvents.push(p);
			},
		} as any;
		const uk = usefulkey(
			{ adapters: { rateLimitStore: new MemoryRateLimitStore(), analytics } },
			{
				plugins: [
					ratelimit({
						default: { kind: "fixed", limit: 1, duration: "1s" },
						reason: "too_many",
						analyticsKind: "custom",
					}),
				],
			},
		) as any;
		expect(uk.__hasRateLimit).toBe(true);
		const created = await uk.createKey();
		const key = created.result!.key;
		const ok = await uk.verifyKey({ key, namespace: "ns" });
		expect(ok.result.valid).toBe(true);
		const blocked = await uk.verifyKey({ key, namespace: "ns" });
		expect(blocked.result.valid).toBe(false);
		expect(blocked.result.reason).toBe("too_many");
		expect(
			analyticsEvents.some((e) => e.kind === "custom" && e.namespace === "ns"),
		).toBe(true);
	});

	it("uses custom identify and no-ops when missing id but requires namespace", async () => {
		const rl = new MemoryRateLimitStore();
		const uk = usefulkey(
			{
				adapters: {
					keyStore: new MemoryKeyStore(),
					rateLimitStore: rl,
					analytics: new ConsoleAnalytics(),
				},
			},
			{ plugins: [ratelimit({ identify: () => null })] },
		);
		const created = await uk.createKey();
		const key = created.result?.key ?? "";
		const r1 = await uk.verifyKey({ key, namespace: "ns" });
		expect(r1.result?.valid).toBe(true);
		const r2 = await (uk as any).verifyKey({
			key,
			identifier: "id",
			namespace: null,
		});
		expect(r2.result?.valid).toBe(false);
		expect(r2.result?.reason).toBe("namespace_required");
	});

	it("per-call overrides default and blocks with analyticsKind", async () => {
		const rl = new MemoryRateLimitStore();
		const analytics = new ConsoleAnalytics();
		const uk = usefulkey(
			{
				adapters: {
					keyStore: new MemoryKeyStore(),
					rateLimitStore: rl,
					analytics,
				},
			},
			{
				plugins: [
					ratelimit({
						default: { kind: "fixed", limit: 10, duration: "1m" },
						analyticsKind: "custom",
					}),
				],
			},
		);
		const created = await uk.createKey();
		const key = created.result?.key ?? "";
		const res1 = await uk.verifyKey({
			key,
			namespace: "ns",
			identifier: "id",
			rateLimit: { kind: "fixed", limit: 1, duration: "1m" },
		});
		expect(res1.result?.valid).toBe(true);
		const res2 = await uk.verifyKey({
			key,
			namespace: "ns",
			identifier: "id",
			rateLimit: { kind: "fixed", limit: 1, duration: "1m" },
		});
		expect(res2.result?.valid).toBe(false);
		expect(res2.result?.reason).toBe("rate_limited");
	});

	it("token bucket path with cost", async () => {
		const rl = new MemoryRateLimitStore();
		const uk = usefulkey(
			{
				adapters: {
					keyStore: new MemoryKeyStore(),
					rateLimitStore: rl,
					analytics: new ConsoleAnalytics(),
				},
			},
			{ plugins: [ratelimit({})] },
		);
		const created = await uk.createKey();
		const key = created.result?.key ?? "";
		const rlReq = {
			kind: "tokenBucket" as const,
			capacity: 3,
			refill: { tokens: 1, interval: "1m" },
			cost: 2,
		};
		const a = await uk.verifyKey({
			key,
			namespace: "ns",
			identifier: "idtb",
			rateLimit: rlReq,
		});
		expect(a.result?.valid).toBe(true);
		const b = await uk.verifyKey({
			key,
			namespace: "ns",
			identifier: "idtb",
			rateLimit: rlReq,
		});
		expect(b.result?.valid).toBe(false);
	});
});

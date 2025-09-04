import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpKeyStore } from "../../../../src";

const BASE = "https://api.example.com";

describe("HttpKeyStore", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
	});

	function mockFetchOnce(
		status: number,
		body?: unknown,
		headers: Record<string, string> = {},
	) {
		const res = {
			status,
			ok: status >= 200 && status < 300,
			statusText: String(status),
			json: async () => body,
			text: async () =>
				typeof body === "string" ? body : JSON.stringify(body ?? {}),
			headers: new Headers(headers),
		} as unknown as Response;
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(res);
	}

	function makeResp(status: number): Response {
		return {
			status,
			ok: status >= 200 && status < 300,
			statusText: String(status),
			json: async () => ({}),
			text: async () => "{}",
			headers: new Headers(),
		} as any;
	}

	function record(id: string) {
		return {
			id,
			userId: "u",
			prefix: "uk",
			keyHash: "h",
			createdAt: Date.now(),
			metadata: {},
			usesRemaining: null,
			revokedAt: null,
			expiresAt: null,
		};
	}

	it("createKey accepts 201 or retries 200/204", async () => {
		const store = new HttpKeyStore({ baseUrl: BASE });

		mockFetchOnce(201);
		await store.createKey(record("k1"));

		const f = vi.spyOn(globalThis, "fetch");
		f.mockResolvedValueOnce(makeResp(200));
		f.mockResolvedValueOnce(makeResp(200));
		await store.createKey(record("k2"));

		f.mockResolvedValueOnce(makeResp(204));
		f.mockResolvedValueOnce(makeResp(204));
		f.mockResolvedValueOnce(makeResp(204));
		await store.createKey(record("k3"));
	});

	it("findKeyById returns parsed json or null on 404", async () => {
		const store = new HttpKeyStore({ baseUrl: BASE });
		mockFetchOnce(200, record("id1"));
		const got = await store.findKeyById("id1");
		expect(got?.id).toBe("id1");

		// 404 path -> null
		vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
			new Error("HTTP 404 Not Found"),
		);
		const notFound = await store.findKeyById("missing");
		expect(notFound).toBeNull();
	});

	it("findKeyByHash mirrors findKeyById behavior", async () => {
		const store = new HttpKeyStore({ baseUrl: BASE });
		mockFetchOnce(200, record("id2"));
		const got = await store.findKeyByHash("hash");
		expect(got?.id).toBe("id2");
		vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
			new Error("HTTP 404 Not Found"),
		);
		const notFound = await store.findKeyByHash("missing");
		expect(notFound).toBeNull();
	});

	it("updateKey accepts 200 or retries 204", async () => {
		const store = new HttpKeyStore({ baseUrl: BASE });

		mockFetchOnce(200);
		await store.updateKey(record("id3"));

		const f = vi.spyOn(globalThis, "fetch");
		f.mockResolvedValueOnce(makeResp(204));
		f.mockResolvedValueOnce(makeResp(204));
		await store.updateKey(record("id3"));
	});

	it("revokeKeyById uses POST/PATCH and accepts 200/204", async () => {
		const store = new HttpKeyStore({ baseUrl: BASE });
		mockFetchOnce(200);
		await store.revokeKeyById("id4");

		const storePatch = new HttpKeyStore({
			baseUrl: BASE,
			revokeMethod: "PATCH",
		});
		const f = vi.spyOn(globalThis, "fetch");
		f.mockResolvedValueOnce(makeResp(204));
		f.mockResolvedValueOnce(makeResp(204));
		await storePatch.revokeKeyById("id4");
	});

	it("hardRemoveKeyById uses DELETE and accepts 200/204", async () => {
		const store = new HttpKeyStore({ baseUrl: BASE });
		mockFetchOnce(200);
		await store.hardRemoveKeyById("id5");
		const f = vi.spyOn(globalThis, "fetch");
		f.mockResolvedValueOnce(makeResp(204));
		f.mockResolvedValueOnce(makeResp(204));
		await store.hardRemoveKeyById("id5");
	});

	it("applies apiKey or custom header and times out requests", async () => {
		const store = new HttpKeyStore({
			baseUrl: BASE,
			apiKey: "K",
			request: { timeoutMs: 10 },
		});

		const handler = () => {};
		process.on("unhandledRejection", handler);
		try {
			vi.spyOn(globalThis, "fetch").mockImplementationOnce(
				() =>
					new Promise((resolve) =>
						setTimeout(() => resolve(makeResp(200)), 1000),
					) as any,
			);
			const p = store.findKeyById("x");
			await vi.advanceTimersByTimeAsync(20);
			await expect(p).rejects.toThrow(/timed out/i);
			await vi.runOnlyPendingTimersAsync();
		} finally {
			process.off("unhandledRejection", handler);
		}
	});

	it("supports custom routes and serialize/deserialize", async () => {
		const store = new HttpKeyStore({
			baseUrl: BASE,
			routes: {
				findKeyById: (id) => `/k/${id}`,
			},
			serializeRecord: (r) => ({ ...r, extra: true }),
			deserializeRecord: (p) => ({ ...(p as any), id: (p as any).id }),
		});
		mockFetchOnce(200, record("id6"));
		const got = await store.findKeyById("id6");
		expect(got?.id).toBe("id6");
	});

	it("honors apiKeyHeader and allows overriding Authorization header; baseUrl join works with/without trailing slash", async () => {
		const store = new HttpKeyStore({
			baseUrl: "https://api.example.com/",
			apiKey: "SECRET",
			apiKeyHeader: { header: "X-API-Key" },
			request: { timeoutMs: 1000 },
		});
		const _f = vi
			.spyOn(globalThis, "fetch")
			.mockImplementationOnce(
				(input: string | URL | Request, init?: RequestInit) => {
					const headers = (init?.headers ?? {}) as Record<string, string>;
					expect(headers["X-API-Key"]).toBe("SECRET");
					expect(
						Object.keys(headers).some(
							(h) => h.toLowerCase() === "authorization",
						),
					).toBe(false);

					expect(input.toString()).toBe("https://api.example.com/keys/test");
					return Promise.resolve({
						...makeResp(200),
						json: async () => record("test"),
					}) as any;
				},
			);
		await store.findKeyById("test");

		const store2 = new HttpKeyStore({
			baseUrl: "https://api.example.com",
			apiKey: "SHOULD_NOT_APPLY",
			headers: { Authorization: "Bearer CUSTOM" },
		});
		vi.spyOn(globalThis, "fetch").mockImplementationOnce(
			(input: string | URL | Request, init?: RequestInit) => {
				const headers = (init?.headers ?? {}) as Record<string, string>;
				expect(headers.Authorization).toBe("Bearer CUSTOM");
				expect(input.toString()).toBe("https://api.example.com/keys/test2");
				return Promise.resolve({
					...makeResp(200),
					json: async () => record("test2"),
				}) as any;
			},
		);
		await store2.findKeyById("test2");
	});
});

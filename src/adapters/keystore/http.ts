/**
 * HTTP-backed keystore adapter.
 *
 * Delegates all CRUD operations to a remote HTTP API. Flexible route and
 * header configuration supports a variety of backends.
 */

//TODO This adapter needs work.

import type { KeyId, KeyRecord, KeyStoreAdapter } from "../../types/common";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type HttpRequestInit = {
	headers?: Record<string, string>;
	timeoutMs?: number;
};

export type HttpKeyStoreRoutes = {
	createKey: string;
	findKeyById: (id: KeyId) => string;
	findKeyByHash: (keyHash: string) => string;
	updateKey: (id: KeyId) => string;
	revokeKeyById: (id: KeyId) => string;
	hardRemoveKeyById: (id: KeyId) => string;
	findExpiredIds?: (olderThan: number, limit: number) => string;
};

export interface HttpKeyStoreOptions {
	baseUrl: string;
	/** API key used for auth. If provided, defaults to Authorization: Bearer <apiKey> */
	apiKey?: string;
	/**
	 * Custom headers to send on every request. If `apiKey` is provided and you
	 * also send an `Authorization` header here, this header takes precedence.
	 */
	headers?: Record<string, string>;
	/** Configure request timeout and default headers */
	request?: HttpRequestInit;
	/**
	 * Header name and scheme for apiKey. Example: { header: "X-API-Key" }
	 * to send X-API-Key: <apiKey>. Default is Authorization: Bearer <apiKey>.
	 */
	apiKeyHeader?: { header: string; scheme?: string };
	/**
	 * Customize route paths. Defaults assume a REST API:
	 * - POST   /keys
	 * - GET    /keys/:id
	 * - GET    /keys/by-hash/:keyHash
	 * - PUT    /keys/:id
	 * - POST   /keys/:id/revoke
	 * - DELETE /keys/:id
	 */
	routes?: Partial<HttpKeyStoreRoutes>;
	/**
	 * Convert a `KeyRecord` to a body payload. Default: identity.
	 */
	serializeRecord?: (record: KeyRecord) => unknown;
	/**
	 * Convert a response payload to a `KeyRecord`. Default: identity cast.
	 */
	deserializeRecord?: (payload: unknown) => KeyRecord;
	/**
	 * HTTP method to use for revoke endpoint. Default: POST.
	 */
	revokeMethod?: Extract<HttpMethod, "POST" | "PATCH">;
}

function joinUrl(base: string, path: string): string {
	if (!base.endsWith("/")) base += "/";
	if (path.startsWith("/")) path = path.slice(1);
	return base + path;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	if (!ms || ms <= 0) return p;
	let timer: ReturnType<typeof setTimeout>;
	return await Promise.race([
		p.finally(() => clearTimeout(timer)),
		new Promise<T>((_, reject) => {
			timer = setTimeout(
				() => reject(new Error(`Request timed out after ${ms}ms`)),
				ms,
			);
		}),
	]);
}

export class HttpKeyStore implements KeyStoreAdapter {
	private readonly routes: HttpKeyStoreRoutes;
	private readonly defaultHeaders: Record<string, string>;
	private readonly timeoutMs: number;
	private readonly serializeRecord: (record: KeyRecord) => unknown;
	private readonly deserializeRecord: (payload: unknown) => KeyRecord;
	private readonly revokeMethod: Extract<HttpMethod, "POST" | "PATCH">;
	private readonly hardRemoveMethod: Extract<HttpMethod, "DELETE">;

	constructor(private readonly options: HttpKeyStoreOptions) {
		const base: HttpKeyStoreRoutes = {
			createKey: "/keys",
			findKeyById: (id) => `/keys/${encodeURIComponent(id)}`,
			findKeyByHash: (hash) => `/keys/by-hash/${encodeURIComponent(hash)}`,
			updateKey: (id) => `/keys/${encodeURIComponent(id)}`,
			revokeKeyById: (id) => `/keys/${encodeURIComponent(id)}/revoke`,
			hardRemoveKeyById: (id) => `/keys/${encodeURIComponent(id)}`,
			findExpiredIds: (olderThan, limit) =>
				`/keys/expired?olderThan=${encodeURIComponent(String(olderThan))}&limit=${encodeURIComponent(String(limit))}`,
		};
		this.routes = { ...base, ...(options.routes ?? {}) } as HttpKeyStoreRoutes;

		const userHeaders = {
			...(options.headers ?? {}),
			...(options.request?.headers ?? {}),
		};
		const hasAuthHeader = Object.keys(userHeaders).some(
			(h) => h.toLowerCase() === "authorization",
		);
		let authHeader: Record<string, string> = {};
		if (options.apiKey && !hasAuthHeader) {
			if (options.apiKeyHeader) {
				const headerName = options.apiKeyHeader.header;
				const scheme = options.apiKeyHeader.scheme;
				authHeader[headerName] = scheme
					? `${scheme} ${options.apiKey}`
					: options.apiKey;
			} else {
				authHeader = { Authorization: `Bearer ${options.apiKey}` };
			}
		}
		this.defaultHeaders = {
			"Content-Type": "application/json",
			...authHeader,
			...userHeaders,
		};
		this.timeoutMs = options.request?.timeoutMs ?? 10000;
		this.serializeRecord = options.serializeRecord ?? ((r) => r);
		this.deserializeRecord =
			options.deserializeRecord ?? ((p) => p as KeyRecord);
		this.revokeMethod = options.revokeMethod ?? "POST";
		this.hardRemoveMethod = "DELETE";
	}

	private async request(
		path: string,
		init?: RequestInit & { expectedStatus?: number },
	): Promise<Response> {
		const url = joinUrl(this.options.baseUrl, path);
		const expected = init?.expectedStatus ?? 200;
		const { expectedStatus: _expectedStatus, ...rest } = init ?? {};
		const headers = { ...this.defaultHeaders, ...(rest.headers ?? {}) };
		const promise = fetch(url, { ...rest, headers });
		const res = await withTimeout(promise, this.timeoutMs);
		if (res.status !== expected) {
			let bodySnippet = "";
			try {
				bodySnippet = await res.text();
			} catch {
				// ignore
			}
			throw new Error(
				`HTTP ${res.status} ${res.statusText} for ${url}${
					bodySnippet ? ` - ${bodySnippet.slice(0, 256)}` : ""
				}`,
			);
		}
		return res;
	}

	async createKey(record: KeyRecord): Promise<void> {
		await this.request(this.routes.createKey, {
			method: "POST",
			body: JSON.stringify(this.serializeRecord(record)),
			expectedStatus: 201,
		}).catch(async (err) => {
			// Some APIs return 200/204 on create; retry accepting 200/204
			if (err instanceof Error) {
				// try 200
				try {
					await this.request(this.routes.createKey, {
						method: "POST",
						body: JSON.stringify(this.serializeRecord(record)),
						expectedStatus: 200,
					});
					return;
				} catch {}
				// try 204
				try {
					await this.request(this.routes.createKey, {
						method: "POST",
						body: JSON.stringify(this.serializeRecord(record)),
						expectedStatus: 204,
					});
					return;
				} catch {}
			}
			throw err;
		});
	}

	async findKeyById(id: KeyId): Promise<KeyRecord | null> {
		try {
			const res = await this.request(this.routes.findKeyById(id), {
				method: "GET",
				expectedStatus: 200,
			});
			const payload = await res.json();
			if (!payload) return null;
			return this.deserializeRecord(payload);
		} catch (err: unknown) {
			if (
				err &&
				typeof (err as Error).message === "string" &&
				/\b404\b/.test((err as Error).message)
			)
				return null;
			throw err;
		}
	}

	async findKeyByHash(keyHash: string): Promise<KeyRecord | null> {
		try {
			const res = await this.request(this.routes.findKeyByHash(keyHash), {
				method: "GET",
				expectedStatus: 200,
			});
			const payload = await res.json();
			if (!payload) return null;
			return this.deserializeRecord(payload);
		} catch (err: unknown) {
			if (
				err &&
				typeof (err as Error).message === "string" &&
				/\b404\b/.test((err as Error).message)
			)
				return null;
			throw err;
		}
	}

	async updateKey(record: KeyRecord): Promise<void> {
		await this.request(this.routes.updateKey(record.id), {
			method: "PUT",
			body: JSON.stringify(this.serializeRecord(record)),
			expectedStatus: 200,
		}).catch(async (err) => {
			// Some APIs return 204 on update
			try {
				await this.request(this.routes.updateKey(record.id), {
					method: "PUT",
					body: JSON.stringify(this.serializeRecord(record)),
					expectedStatus: 204,
				});
			} catch {
				throw err;
			}
		});
	}

	async revokeKeyById(id: KeyId): Promise<void> {
		const method = this.revokeMethod;
		await this.request(this.routes.revokeKeyById(id), {
			method,
			expectedStatus: 200,
		}).catch(async (err) => {
			// Accept 204 as well
			try {
				await this.request(this.routes.revokeKeyById(id), {
					method,
					expectedStatus: 204,
				});
			} catch {
				throw err;
			}
		});
	}

	async hardRemoveKeyById(id: KeyId): Promise<void> {
		const method = this.hardRemoveMethod;
		await this.request(this.routes.hardRemoveKeyById(id), {
			method,
			expectedStatus: 200,
		}).catch(async (err) => {
			// Accept 204 as well
			try {
				await this.request(this.routes.hardRemoveKeyById(id), {
					method,
					expectedStatus: 204,
				});
			} catch {
				throw err;
			}
		});
	}

	async findExpiredIds(olderThan: number, limit: number): Promise<KeyId[]> {
		if (!this.routes.findExpiredIds) return [];
		const res = await this.request(
			this.routes.findExpiredIds(olderThan, limit),
			{
				method: "GET",
				expectedStatus: 200,
			},
		);
		const payload = (await res.json()) as { ids?: string[] } | string[] | null;
		if (!payload) return [];
		if (Array.isArray(payload)) return payload.map((x) => String(x));
		if (Array.isArray((payload as any).ids))
			return (payload as any).ids.map((x: unknown) => String(x));
		return [];
	}
}

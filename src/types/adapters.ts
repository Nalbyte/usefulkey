//TODO: These need to be improved

/** Generic async command signature used by Redis‑like clients. */
export type RedisCommand = (...args: unknown[]) => Promise<unknown>;

/**
 * Minimal SQLite client shape used by adapters. Any client that exposes a
 * compatible `prepare().run()/get()/all()` API can be used (e.g., `better-sqlite3`,
 * or custom wrappers).
 */
export interface SqliteLikeClient {
	prepare: (sql: string) => {
		run: (...args: unknown[]) => unknown;
		get: (...args: unknown[]) => unknown;
		all?: (...args: unknown[]) => unknown[];
	};
	exec?: (sql: string) => unknown;
}

/**
 * Minimal Postgres client shape used by adapters. Any client that exposes a
 * compatible `query(text, values?)` API can be used (e.g., `pg`, `postgres.js`,
 * or custom wrappers).
 */
export type PgLikeClient = {
	query: (
		text: string,
		values?: unknown[],
	) => Promise<
		{ rows: Array<Record<string, unknown>>; rowCount?: number } | unknown
	>;
};

/**
 * Cloudflare D1 Database interface that accepts both generic and native D1Database types
 */
export type D1LikeClient = {
	prepare: (sql: string) => {
		bind: (...args: unknown[]) => {
			run: () => Promise<unknown>;
			first?: <T = Record<string, unknown>>() => Promise<T | null>;
			all?: <T = Record<string, unknown>>() => Promise<
				{ results?: T[] } | undefined
			>;
		};
	};
	exec?: (sql: string) => Promise<unknown>;
};

/**
 * Cloudflare KV interface that accepts both generic and native KVNamespace types
 */
export type KvLikeClient = {
	get: (key: string, ...args: any[]) => Promise<string | null>;
	put: (
		key: string,
		value: string,
		options?: { expirationTtl?: number },
	) => Promise<void>;
	delete?: (key: string) => Promise<void>;
};

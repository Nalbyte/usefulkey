import Database from "better-sqlite3";
import {
	ConsoleAnalytics,
	enableDisable,
	MemoryRateLimitStore,
	permissionsScopes,
	ratelimit,
	SqliteKeyStore,
	usageLimitsPerKey,
	usefulkey,
} from "usefulkey";

// Initialize SQLite database
const dbPath = process.env.DATABASE_URL || "./usefulkey.db";
const db = new Database(dbPath);

// Singleton UsefulKey instance for Next.js
export const uk = usefulkey(
	{
		keyPrefix: process.env.KEY_PREFIX || "uk",
		adapters: {
			keyStore: new SqliteKeyStore(db, { tableName: "usefulkey_keys" }),
			rateLimitStore: new MemoryRateLimitStore(),
			analytics: new ConsoleAnalytics(),
		},
	},
	{
		plugins: [
			// Rate limiting plugin is enabled and this is the default limit on all requests to uk.verifyKey
			ratelimit({ default: { kind: "fixed", limit: 200, duration: "1m" } }),
			enableDisable(),
			usageLimitsPerKey(),
			permissionsScopes({
				metadataKey: "scopes",
			}),
		],
	},
);

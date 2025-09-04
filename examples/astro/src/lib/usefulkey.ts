import { Redis } from "ioredis";
import { Pool } from "pg";
import {
	ConsoleAnalytics,
	enableDisable,
	PostgresKeyStore,
	permissionsScopes,
	RedisRateLimitStore,
	ratelimit,
	usageLimitsPerKey,
	usefulkey,
} from "usefulkey";

// Setup postgres and redis

const postgres = new PostgresKeyStore(
	new Pool({
		connectionString:
			process.env.DATABASE_URL ||
			"postgresql://postgres:postgres@localhost:5432/usefulkey",
	}),
);

const redis = new RedisRateLimitStore(
	new Redis(process.env.REDIS_URL || "redis://localhost:6379"),
);

// UsefulKey instance with configured adapters and plugins
export const uk = usefulkey(
	{
		keyPrefix: process.env.KEY_PREFIX || "uk",
		adapters: {
			keyStore: postgres,
			rateLimitStore: redis,
			analytics: new ConsoleAnalytics(),
		},
	},
	{
		plugins: [
			ratelimit({ default: { kind: "fixed", limit: 200, duration: "1m" } }),
			enableDisable(),
			usageLimitsPerKey(),
			permissionsScopes({
				metadataKey: "scopes",
			}),
		],
	},
);

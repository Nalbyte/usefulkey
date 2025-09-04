import { serve } from "@hono/node-server";
import { type Context, Hono } from "hono";
import {
	ConsoleAnalytics,
	enableDisable,
	MemoryKeyStore,
	MemoryRateLimitStore,
	permissionsScopes,
	ratelimit,
	usageLimitsPerKey,
	usefulkey,
} from "usefulkey";

/**
 * Demo API Server for UsefulKey with In-Memory storage
 *
 * API Endpoints:
 * - GET /api/dogs - Get random dog names (requires API key)
 * - GET /api/dogs/facts - Get premium dog facts (requires 'premium' scope)
 * - POST /api/dogs/manage - Admin dog management (requires 'admin' scope)
 * - GET /health - Health check
 *
 * Admin Endpoints (require x-admin-key header):
 * - POST /admin/keys - Create key with metadata
 * - POST /admin/keys/pro - Create pro key
 * - POST /admin/keys/premium - Create premium key with 'premium' scope
 * - POST /admin/keys/admin - Create admin key with 'admin' and 'premium' scopes
 * - GET /admin/keys/:id - Get key info
 * - PUT /admin/keys/:id/enable - Enable a key
 * - PUT /admin/keys/:id/disable - Disable a key
 * - PUT /admin/keys/:id/limits - Set remaining usage limits
 * - GET /admin/keys/:id/scopes - Get scopes for a key
 * - PUT /admin/keys/:id/scopes - Set scopes for a key
 * - POST /admin/keys/:id/scopes/grant - Grant scopes to a key
 * - POST /admin/keys/:id/scopes/revoke - Revoke scopes from a key
 * - DELETE /admin/keys/:id - Revoke key
 *
 * Usage:
 * 1. Start server: npm run dev
 * 2. Create a pro key: curl -X POST http://localhost:8788/admin/keys/pro \
 *      -H "x-admin-key: admin-secret-key"
 * 3. Use the API: curl http://localhost:8788/api/dogs \
 *      -H "x-api-key: YOUR_KEY_HERE"
 * 4. Disable a key: curl -X PUT http://localhost:8788/admin/keys/KEY_ID/disable \
 *      -H "x-admin-key: admin-secret-key"
 * 5. Enable a key: curl -X PUT http://localhost:8788/admin/keys/KEY_ID/enable \
 *      -H "x-admin-key: admin-secret-key"
 * 6. Set usage limit: curl -X PUT http://localhost:8788/admin/keys/KEY_ID/limits \
 *      -H "x-admin-key: admin-secret-key" \
 *      -H "Content-Type: application/json" \
 *      -d '{"remaining": 100}'
 * 7. Create premium key: curl -X POST http://localhost:8788/admin/keys/premium \
 *      -H "x-admin-key: admin-secret-key"
 * 8. Use premium endpoint: curl http://localhost:8788/api/dogs/facts \
 *      -H "x-api-key: PREMIUM_KEY_HERE"
 * 9. Grant scopes: curl -X POST http://localhost:8788/admin/keys/KEY_ID/scopes/grant \
 *      -H "x-admin-key: admin-secret-key" \
 *      -H "Content-Type: application/json" \
 *      -d '{"scopes": ["premium"]}'
 * 10. Get key scopes: curl http://localhost:8788/admin/keys/KEY_ID/scopes \
 *      -H "x-admin-key: admin-secret-key"
 */

// Dog names for the demo API - PRs are welcome! haha
const DOG_NAMES = [
	"Buddy",
	"Max",
	"Charlie",
	"Jack",
	"Oliver",
	"Henry",
	"Leo",
	"Milo",
	"Sam",
	"Teddy",
	"Rocky",
	"Bear",
	"Duke",
	"Zeus",
	"Apollo",
	"Ace",
	"Tucker",
	"Bentley",
	"Coco",
	"Rex",
	"Lucky",
	"Bailey",
	"Daisy",
	"Lucy",
	"Sadie",
	"Maggie",
	"Sophie",
	"Chloe",
	"Bella",
	"Lily",
];

const ADMIN_KEY = process.env.ADMIN_KEY || "admin-secret-key";

// Initialize UsefulKey with In-Memory keystore and rate limit
const uk = usefulkey(
	{
		keyPrefix: process.env.KEY_PREFIX || "uk",
		adapters: {
			keyStore: new MemoryKeyStore(),
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

// Middleware to verify API key with rate limiting, namespace is required for rate limiting plugin
const verifyApiKey = async (c: Context, next: () => Promise<void>) => {
	const key = c.req.header("x-api-key") || "";
	const ip =
		c.req.header("x-forwarded-for")?.split(",")[0].trim() || "127.0.0.1";

	// Use the rate limit plugin with namespace
	const res = await uk.verifyKey(
		{
			key,
			ip,
			namespace: "api-dogs", // Required for rate limiting plugin
		},
		true, // true to include metadata
	);

	console.log(res);

	if (res.error) {
		return c.json(
			{ error: "Invalid API key", code: res.error?.code ?? "invalid_key" },
			401,
		);
	}

	if (!res.result?.valid) {
		const statusCode =
			res.result?.reason === "usage_exceeded"
				? 429
				: res.result?.reason === "disabled"
					? 403
					: 401;
		const errorMessage =
			res.result?.reason === "usage_exceeded"
				? "Rate limit exceeded"
				: res.result?.reason === "disabled"
					? "Key is disabled"
					: res.result?.reason === "revoked"
						? "Key has been revoked"
						: "Invalid API key";

		return c.json(
			{
				error: errorMessage,
				code: res.result?.reason ?? "invalid_key",
			},
			statusCode,
		);
	}

	// Store key info in context for use in handlers
	c.set("keyInfo", res.result);
	await next();
};

// Middleware to verify API key with specific scopes
const verifyApiKeyWithScopes =
	(requiredScopes: string[]) =>
	async (c: Context, next: () => Promise<void>) => {
		const key = c.req.header("x-api-key") || "";
		const ip =
			c.req.header("x-forwarded-for")?.split(",")[0].trim() || "127.0.0.1";

		const res = await uk.verifyKey(
			{
				key,
				ip,
				namespace: "api-dogs",
				scopes: requiredScopes, // Check for required scopes
			},
			true,
		);

		if (res.error) {
			return c.json(
				{
					error: "Invalid API key",
					code: res.error?.code ?? "invalid_key",
				},
				401,
			);
		}

		if (!res.result?.valid) {
			const statusCode =
				res.result?.reason === "usage_exceeded"
					? 429
					: res.result?.reason === "disabled"
						? 403
						: res.result?.reason === "revoked"
							? 401
							: 403;
			const errorMessage =
				res.result?.reason === "usage_exceeded"
					? "Rate limit exceeded"
					: res.result?.reason === "disabled"
						? "Key is disabled"
						: res.result?.reason === "revoked"
							? "Key has been revoked"
							: "Insufficient permissions";

			return c.json(
				{
					error: errorMessage,
					code: res.result?.reason ?? "insufficient_scope",
				},
				statusCode,
			);
		}

		c.set("keyInfo", res.result);
		await next();
	};

// Middleware to verify admin key
const verifyAdminKey = async (c: Context, next: () => Promise<void>) => {
	const adminKey = c.req.header("x-admin-key") || "";
	if (adminKey !== ADMIN_KEY) {
		return c.json({ error: "Invalid admin key" }, 401);
	}
	await next();
};

const app = new Hono();

// Health check endpoint - this is not protected by UsefulKey and is used for integration tests
app.get("/health", (c: Context) => c.json({ ok: true, service: "dog-api" }));

// ===== PUBLIC API ENDPOINTS =====

// Dog names API - requires API key, rate limited via plugin
app.get("/api/dogs", verifyApiKey, async (c: Context) => {
	const keyInfo = c.get("keyInfo");

	// Return 10 random dog names for pro users, 5 for others
	const count = keyInfo?.metadata?.plan === "pro" ? 10 : 5;
	const shuffled = [...DOG_NAMES].sort(() => 0.5 - Math.random());
	const selectedNames = shuffled.slice(0, count);

	return c.json({
		dogs: selectedNames,
		count,
		plan: keyInfo?.metadata?.plan || "basic",
	});
});

// Premium dog facts - requires 'premium' scope
app.get(
	"/api/dogs/facts",
	verifyApiKeyWithScopes(["premium"]),
	async (c: Context) => {
		const facts = [
			"Dogs have about 1,700 taste buds, compared to humans who have 9,000.",
			"A dog's sense of smell is 10,000 to 100,000 times more sensitive than humans.",
			"Dogs can understand up to 250 words and gestures.",
			"The Basenji is the only dog breed that doesn't bark.",
			"Dogs sweat through their paws and can drink up to 40 gallons of water per day.",
		];

		const randomFact = facts[Math.floor(Math.random() * facts.length)];
		return c.json({
			fact: randomFact,
			category: "premium",
		});
	},
);

// Admin dog management - requires 'admin' scope
app.post(
	"/api/dogs/manage",
	verifyApiKeyWithScopes(["admin"]),
	async (c: Context) => {
		const body = await c.req.json().catch(() => ({}));
		const { action, dogName } = body;

		if (!action || !dogName) {
			return c.json({ error: "Missing action or dogName" }, 400);
		}

		if (action === "add") {
			if (!DOG_NAMES.includes(dogName)) {
				DOG_NAMES.push(dogName);
				return c.json({
					success: true,
					message: `Added ${dogName} to the list`,
				});
			}
			return c.json({ error: "Dog name already exists" }, 400);
		}

		return c.json({ error: "Unknown action. Use 'add'" }, 400);
	},
);

// ===== ADMIN ENDPOINTS (Protected) =====

// Create API key with optional metadata
app.post("/admin/keys", verifyAdminKey, async (c: Context) => {
	try {
		const body = await c.req.json().catch(() => ({}));
		const metadata = body.metadata || {};

		const res = await uk.createKey({ metadata });

		if (res.error || !res.result) {
			return c.json({ error: res.error?.code ?? "error" }, 500);
		}

		return c.json({
			key: res.result.key,
			metadata: res.result.metadata,
			id: res.result.id,
		});
	} catch (_error) {
		return c.json({ error: "Invalid request body" }, 400);
	}
});

// Create a pro key (convenience endpoint)
app.post("/admin/keys/pro", verifyAdminKey, async (c: Context) => {
	const res = await uk.createKey({
		metadata: { plan: "pro" },
	});

	if (res.error || !res.result) {
		return c.json({ error: res.error?.code ?? "error" }, 500);
	}

	return c.json({
		key: res.result.key,
		metadata: res.result.metadata,
		id: res.result.id,
	});
});

// Get key info by ID
app.get("/admin/keys/:id", verifyAdminKey, async (c: Context) => {
	const id = c.req.param("id");
	const res = await uk.getKeyById(id);

	if (res.error || !res.result) {
		return c.json({ error: res.error?.code ?? "not_found" }, 404);
	}

	return c.json({
		id: res.result.id,
		metadata: res.result.metadata,
		createdAt: res.result.createdAt,
		expiresAt: res.result.expiresAt,
		revokedAt: res.result.revokedAt,
	});
});

// Revoke a key
app.delete("/admin/keys/:id", verifyAdminKey, async (c: Context) => {
	const id = c.req.param("id");
	const res = await uk.revokeKey(id);

	if (res.error) {
		return c.json({ error: res.error.code ?? "error" }, 500);
	}

	return c.json({ success: true, revoked: id });
});

// Enable a key
app.put("/admin/keys/:id/enable", verifyAdminKey, async (c: Context) => {
	try {
		const id = c.req.param("id");
		await uk.enableKey(id);
		return c.json({ success: true, enabled: id });
	} catch (error: any) {
		return c.json({ error: error.code ?? "error" }, 500);
	}
});

// Disable a key
app.put("/admin/keys/:id/disable", verifyAdminKey, async (c: Context) => {
	try {
		const id = c.req.param("id");
		await uk.disableKey(id);
		return c.json({ success: true, disabled: id });
	} catch (error: any) {
		return c.json({ error: error.code ?? "error" }, 500);
	}
});

// Set remaining limits for a key
app.put("/admin/keys/:id/limits", verifyAdminKey, async (c: Context) => {
	try {
		const id = c.req.param("id");
		const body = await c.req.json().catch(() => ({}));
		const { remaining } = body;

		if (
			remaining === undefined ||
			typeof remaining !== "number" ||
			remaining < 0
		) {
			return c.json(
				{ error: "Invalid remaining limit. Must be a non-negative number." },
				400,
			);
		}

		await uk.setUsesRemaining(id, remaining);
		return c.json({ success: true, id, remaining });
	} catch (error: any) {
		return c.json({ error: error.code ?? "error" }, 500);
	}
});

// Get scopes for a key
app.get("/admin/keys/:id/scopes", verifyAdminKey, async (c: Context) => {
	try {
		const id = c.req.param("id");
		const scopes = await uk.getScopes(id);
		return c.json({ success: true, id, scopes });
	} catch (error: any) {
		return c.json({ error: error.code ?? "error" }, 500);
	}
});

// Set scopes for a key
app.put("/admin/keys/:id/scopes", verifyAdminKey, async (c: Context) => {
	try {
		const id = c.req.param("id");
		const body = await c.req.json().catch(() => ({}));
		const { scopes } = body;

		if (!scopes || (!Array.isArray(scopes) && typeof scopes !== "string")) {
			return c.json(
				{ error: "Invalid scopes. Must be a string or array of strings." },
				400,
			);
		}

		await uk.setScopes(id, scopes);
		return c.json({ success: true, id, scopes });
	} catch (error: any) {
		return c.json({ error: error.code ?? "error" }, 500);
	}
});

// Grant scopes to a key
app.post("/admin/keys/:id/scopes/grant", verifyAdminKey, async (c: Context) => {
	try {
		const id = c.req.param("id");
		const body = await c.req.json().catch(() => ({}));
		const { scopes } = body;

		if (!scopes || (!Array.isArray(scopes) && typeof scopes !== "string")) {
			return c.json(
				{ error: "Invalid scopes. Must be a string or array of strings." },
				400,
			);
		}

		await uk.grantScopes(id, scopes);
		const updatedScopes = await uk.getScopes(id);
		return c.json({
			success: true,
			id,
			granted: scopes,
			scopes: updatedScopes,
		});
	} catch (error: any) {
		return c.json({ error: error.code ?? "error" }, 500);
	}
});

// Revoke scopes from a key
app.post(
	"/admin/keys/:id/scopes/revoke",
	verifyAdminKey,
	async (c: Context) => {
		try {
			const id = c.req.param("id");
			const body = await c.req.json().catch(() => ({}));
			const { scopes } = body;

			if (!scopes || (!Array.isArray(scopes) && typeof scopes !== "string")) {
				return c.json(
					{ error: "Invalid scopes. Must be a string or array of strings." },
					400,
				);
			}

			await uk.revokeScopes(id, scopes);
			const updatedScopes = await uk.getScopes(id);
			return c.json({
				success: true,
				id,
				revoked: scopes,
				scopes: updatedScopes,
			});
		} catch (error: any) {
			return c.json({ error: error.code ?? "error" }, 500);
		}
	},
);

// Create a premium key with premium scope
app.post("/admin/keys/premium", verifyAdminKey, async (c: Context) => {
	try {
		const res = await uk.createKey({
			metadata: { plan: "premium" },
		});

		if (res.error || !res.result) {
			return c.json({ error: res.error?.code ?? "error" }, 500);
		}

		// Grant premium scope to the key
		await uk.grantScopes(res.result.id, ["premium"]);

		return c.json({
			key: res.result.key,
			metadata: res.result.metadata,
			id: res.result.id,
			scopes: ["premium"],
		});
	} catch (error: any) {
		return c.json({ error: error.code ?? "error" }, 500);
	}
});

// Create an admin key with admin scope
app.post("/admin/keys/admin", verifyAdminKey, async (c: Context) => {
	try {
		const res = await uk.createKey({
			metadata: { plan: "admin", role: "administrator" },
		});

		if (res.error || !res.result) {
			return c.json({ error: res.error?.code ?? "error" }, 500);
		}

		// Grant admin scope to the key
		await uk.grantScopes(res.result.id, ["admin", "premium"]);

		return c.json({
			key: res.result.key,
			metadata: res.result.metadata,
			id: res.result.id,
			scopes: ["admin", "premium"],
		});
	} catch (error: any) {
		return c.json({ error: error.code ?? "error" }, 500);
	}
});

const port = Number(process.env.PORT || 8788);
serve({ fetch: app.fetch, port });
console.log(`UsefulKey Demo API Server running on http://localhost:${port}`);
console.log(
	`Try: curl -X POST http://localhost:${port}/admin/keys/pro -H "x-admin-key: ${ADMIN_KEY}"`,
);
console.log(
	`Permissions enabled: Try creating a premium key and accessing /api/dogs/facts`,
);
console.log(
	`Scope-based access: 'premium' scope for facts, 'admin' scope for management`,
);

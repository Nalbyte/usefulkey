/**
 * UsefulKey Cloudflare Worker Example
 *
 * This Worker demonstrates a comprehensive API key management system using UsefulKey.
 * It includes rate limiting, permissions, scopes, and admin functionality.
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
 * 1. Deploy: npm run deploy
 * 2. Create a pro key: curl -X POST https://your-worker.your-subdomain.workers.dev/admin/keys/pro \
 *      -H "x-admin-key: admin-secret-key"
 * 3. Use the API: curl https://your-worker.your-subdomain.workers.dev/api/dogs \
 *      -H "x-api-key: YOUR_KEY_HERE"
 */

import {
	ConsoleAnalytics,
	D1KeyStore,
	CloudflareKvRateLimitStore,
	enableDisable,
	permissionsScopes,
	ratelimit,
	usageLimitsPerKey,
	usefulkey,
} from "usefulkey";

// Dog names for the demo API - PRs are welcome! haha
const DOG_NAMES = [
	"Buddy", "Max", "Charlie", "Jack", "Oliver", "Henry", "Leo", "Milo", "Sam", "Teddy",
	"Rocky", "Bear", "Duke", "Zeus", "Apollo", "Ace", "Tucker", "Bentley", "Coco", "Rex",
	"Lucky", "Bailey", "Daisy", "Lucy", "Sadie", "Maggie", "Sophie", "Chloe", "Bella", "Lily",
];

// Recommend changing this to an environment variable for production
const ADMIN_KEY = "admin-secret-key";

interface Env {
	DB: D1Database;
	RATE_LIMIT_KV: KVNamespace;
}

async function createUsefulKey(env: Env) {
	const keyStore = new D1KeyStore(env.DB, { tableName: "usefulkey_keys" });
	const rateLimitStore = new CloudflareKvRateLimitStore(env.RATE_LIMIT_KV, { keyPrefix: "usefulkey:rl" });

	// Wait for adapters to be ready
	await Promise.all([
		keyStore.ready,
		rateLimitStore.ready,
	]);

	return usefulkey(
		{
			keyPrefix: "uk",
			adapters: {
				keyStore,
				rateLimitStore,
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
}

// Helper function to verify API key with rate limiting
async function verifyApiKey(request: Request, uk: Awaited<ReturnType<typeof createUsefulKey>>): Promise<{ valid: boolean; keyInfo?: any; error?: string; statusCode?: number }> {
	const key = request.headers.get("x-api-key") || "";
	const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "127.0.0.1";

	const res = await uk.verifyKey(
		{
			key,
			ip,
			namespace: "api-dogs",
		},
		true, // true to include metadata in res
	);

	if (res.error) {
		return { valid: false, error: "Invalid API key", statusCode: 401 };
	}

	if (!res.result?.valid) {
		const statusCode = res.result?.reason === "usage_exceeded" ? 429 : 
		                  res.result?.reason === "disabled" ? 403 : 401;
		const errorMessage = res.result?.reason === "usage_exceeded" ? "Rate limit exceeded" :
		                    res.result?.reason === "disabled" ? "Key is disabled" :
		                    res.result?.reason === "revoked" ? "Key has been revoked" : "Invalid API key";
		
		return { valid: false, error: errorMessage, statusCode };
	}

	return { valid: true, keyInfo: res.result };
}

// Helper function to verify API key with specific scopes
async function verifyApiKeyWithScopes(request: Request, requiredScopes: string[], uk: Awaited<ReturnType<typeof createUsefulKey>>): Promise<{ valid: boolean; keyInfo?: any; error?: string; statusCode?: number }> {
	const key = request.headers.get("x-api-key") || "";
	const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "127.0.0.1";

	const res = await uk.verifyKey(
		{
			key,
			ip,
			namespace: "api-dogs",
			scopes: requiredScopes,
		},
		true,
	);

	if (res.error) {
		return { valid: false, error: "Invalid API key", statusCode: 401 };
	}

	if (!res.result?.valid) {
		const statusCode = res.result?.reason === "usage_exceeded" ? 429 : 
		                  res.result?.reason === "disabled" ? 403 : 
		                  res.result?.reason === "revoked" ? 401 : 403;
		const errorMessage = res.result?.reason === "usage_exceeded" ? "Rate limit exceeded" :
		                    res.result?.reason === "disabled" ? "Key is disabled" :
		                    res.result?.reason === "revoked" ? "Key has been revoked" : "Insufficient permissions";
		
		return { valid: false, error: errorMessage, statusCode };
	}

	return { valid: true, keyInfo: res.result };
}

// Helper function to verify admin key
function verifyAdminKey(request: Request, adminKey: string): boolean {
	const adminKeyHeader = request.headers.get("x-admin-key") || "";
	return adminKeyHeader === adminKey;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Health check endpoint for integration tests
		if (url.pathname === "/health") {
			return Response.json({ ok: true, service: "dog-api" });
		}

		// ===== PUBLIC API ENDPOINTS =====

		// Initialize UsefulKey
		const uk = await createUsefulKey(env);

		// Dog names API - requires API key, rate limited via plugin, namespace is required for rate limiting plugin
		if (url.pathname === "/api/dogs" && request.method === "GET") {
			const verification = await verifyApiKey(request, uk);
			if (!verification.valid) {
				return Response.json(
					{ error: verification.error, code: "invalid_key" },
					{ status: verification.statusCode }
				);
			}

			const keyInfo = verification.keyInfo;
			// Return 10 random dog names for pro users, 5 for others
			const count = keyInfo?.metadata?.plan === "pro" ? 10 : 5;
			const shuffled = [...DOG_NAMES].sort(() => 0.5 - Math.random());
			const selectedNames = shuffled.slice(0, count);

			return Response.json({
				dogs: selectedNames,
				count,
				plan: keyInfo?.metadata?.plan || "basic",
			});
		}

		// Premium dog facts - requires 'premium' scope, scopes are checked via plugin
		if (url.pathname === "/api/dogs/facts" && request.method === "GET") {
			const verification = await verifyApiKeyWithScopes(request, ["premium"], uk);
			if (!verification.valid) {
				return Response.json(
					{ error: verification.error, code: "insufficient_scope" },
					{ status: verification.statusCode }
				);
			}

			const facts = [
				"Dogs have about 1,700 taste buds, compared to humans who have 9,000.",
				"A dog's sense of smell is 10,000 to 100,000 times more sensitive than humans.",
				"Dogs can understand up to 250 words and gestures.",
				"The Basenji is the only dog breed that doesn't bark.",
				"Dogs sweat through their paws and can drink up to 40 gallons of water per day.",
			];

			const randomFact = facts[Math.floor(Math.random() * facts.length)];
			return Response.json({
				fact: randomFact,
				category: "premium",
			});
		}

		// Admin dog management - requires 'admin' scope, scopes are checked via plugin
		if (url.pathname === "/api/dogs/manage" && request.method === "POST") {
			const verification = await verifyApiKeyWithScopes(request, ["admin"], uk);
			if (!verification.valid) {
				return Response.json(
					{ error: verification.error, code: "insufficient_scope" },
					{ status: verification.statusCode }
				);
			}

			try {
				const body = await request.json() as { action?: string; dogName?: string };
				const { action, dogName } = body;

				if (!action || !dogName) {
					return Response.json({ error: "Missing action or dogName" }, { status: 400 });
				}

				if (action === "add") {
					if (!DOG_NAMES.includes(dogName)) {
						DOG_NAMES.push(dogName);
						return Response.json({
							success: true,
							message: `Added ${dogName} to the list`,
						});
					}
					return Response.json({ error: "Dog name already exists" }, { status: 400 });
				}

				return Response.json({ error: "Unknown action. Use 'add'" }, { status: 400 });
			} catch (error) {
				return Response.json({ error: "Invalid request body" }, { status: 400 });
			}
		}

		// ===== ADMIN ENDPOINTS (Protected with admin key) =====

		// Initialize UsefulKey for admin endpoints
		const adminUk = await createUsefulKey(env);

		// Create API key with optional metadata
		if (url.pathname === "/admin/keys" && request.method === "POST") {
			if (!verifyAdminKey(request, ADMIN_KEY)) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			try {
				const body = await request.json() as { metadata?: any };
				const metadata = body.metadata || {};

				const res = await adminUk.createKey({ metadata });

				if (res.error || !res.result) {
					return Response.json({ error: res.error?.code ?? "error" }, { status: 500 });
				}

				return Response.json({
					key: res.result.key,
					metadata: res.result.metadata,
					id: res.result.id,
				});
			} catch (error) {
				return Response.json({ error: "Invalid request body" }, { status: 400 });
			}
		}

		// Create a pro key 
		if (url.pathname === "/admin/keys/pro" && request.method === "POST") {
			if (!verifyAdminKey(request, ADMIN_KEY)) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			const res = await adminUk.createKey({
				metadata: { plan: "pro" },
			});

			if (res.error || !res.result) {
				return Response.json({ error: res.error?.code ?? "error" }, { status: 500 });
			}

			return Response.json({
				key: res.result.key,
				metadata: res.result.metadata,
				id: res.result.id,
			});
		}

		// Create a premium key with premium scope, scopes are checked via plugin
		if (url.pathname === "/admin/keys/premium" && request.method === "POST") {
			if (!verifyAdminKey(request, ADMIN_KEY)) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			try {
				const res = await adminUk.createKey({
					metadata: { plan: "premium" },
				});

				if (res.error || !res.result) {
					return Response.json({ error: res.error?.code ?? "error" }, { status: 500 });
				}

				// Grant premium scope to the key, scopes are checked via plugin	
				await adminUk.grantScopes(res.result.id, ["premium"]);

				return Response.json({
					key: res.result.key,
					metadata: res.result.metadata,
					id: res.result.id,
					scopes: ["premium"],
				});
			} catch (error: any) {
				return Response.json({ error: error.code ?? "error" }, { status: 500 });
			}
		}

		// Create an admin key with admin scope
		if (url.pathname === "/admin/keys/admin" && request.method === "POST") {
			if (!verifyAdminKey(request, ADMIN_KEY)) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			try {
				const res = await adminUk.createKey({
					metadata: { plan: "admin", role: "administrator" },
				});

				if (res.error || !res.result) {
					return Response.json({ error: res.error?.code ?? "error" }, { status: 500 });
				}

				// Grant admin scope to the key
				await adminUk.grantScopes(res.result.id, ["admin", "premium"]);

				return Response.json({
					key: res.result.key,
					metadata: res.result.metadata,
					id: res.result.id,
					scopes: ["admin", "premium"],
				});
			} catch (error: any) {
				return Response.json({ error: error.code ?? "error" }, { status: 500 });
			}
		}

		// Get key info by ID
		if (url.pathname.match(/^\/admin\/keys\/([^\/]+)$/) && request.method === "GET") {
			if (!verifyAdminKey(request, ADMIN_KEY)) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			const match = url.pathname.match(/^\/admin\/keys\/([^\/]+)$/);
			const id = match?.[1];
			if (!id) {
				return Response.json({ error: "Invalid key ID" }, { status: 400 });
			}

			const res = await adminUk.getKeyById(id);

			if (res.error || !res.result) {
				return Response.json({ error: res.error?.code ?? "not_found" }, { status: 404 });
			}

			return Response.json({
				id: res.result.id,
				metadata: res.result.metadata,
				createdAt: res.result.createdAt,
				expiresAt: res.result.expiresAt,
				revokedAt: res.result.revokedAt,
			});
		}

		// Enable a key
		if (url.pathname.match(/^\/admin\/keys\/([^\/]+)\/enable$/) && request.method === "PUT") {
			if (!verifyAdminKey(request, ADMIN_KEY)) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			const match = url.pathname.match(/^\/admin\/keys\/([^\/]+)\/enable$/);
			const id = match?.[1];
			if (!id) {
				return Response.json({ error: "Invalid key ID" }, { status: 400 });
			}

			try {
				await adminUk.enableKey(id);
				return Response.json({ success: true, enabled: id });
			} catch (error: any) {
				return Response.json({ error: error.code ?? "error" }, { status: 500 });
			}
		}

		// Disable a key
		if (url.pathname.match(/^\/admin\/keys\/([^\/]+)\/disable$/) && request.method === "PUT") {
			if (!verifyAdminKey(request, ADMIN_KEY)) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			const match = url.pathname.match(/^\/admin\/keys\/([^\/]+)\/disable$/);
			const id = match?.[1];
			if (!id) {
				return Response.json({ error: "Invalid key ID" }, { status: 400 });
			}

			try {
				await adminUk.disableKey(id);
				return Response.json({ success: true, disabled: id });
			} catch (error: any) {
				return Response.json({ error: error.code ?? "error" }, { status: 500 });
			}
		}

		// Set remaining limits for a key
		if (url.pathname.match(/^\/admin\/keys\/([^\/]+)\/limits$/) && request.method === "PUT") {
			if (!verifyAdminKey(request, ADMIN_KEY)) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			const match = url.pathname.match(/^\/admin\/keys\/([^\/]+)\/limits$/);
			const id = match?.[1];
			if (!id) {
				return Response.json({ error: "Invalid key ID" }, { status: 400 });
			}

			try {
				const body = await request.json() as { remaining?: number };
				const { remaining } = body;

				if (remaining === undefined || typeof remaining !== "number" || remaining < 0) {
					return Response.json(
						{ error: "Invalid remaining limit. Must be a non-negative number." },
						{ status: 400 }
					);
				}

				await adminUk.setUsesRemaining(id, remaining);
				return Response.json({ success: true, id, remaining });
			} catch (error: any) {
				return Response.json({ error: error.code ?? "error" }, { status: 500 });
			}
		}

		// Get scopes for a key
		if (url.pathname.match(/^\/admin\/keys\/([^\/]+)\/scopes$/) && request.method === "GET") {
			if (!verifyAdminKey(request, ADMIN_KEY)) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			const match = url.pathname.match(/^\/admin\/keys\/([^\/]+)\/scopes$/);
			const id = match?.[1];
			if (!id) {
				return Response.json({ error: "Invalid key ID" }, { status: 400 });
			}

			try {
				const scopes = await adminUk.getScopes(id);
				return Response.json({ success: true, id, scopes });
			} catch (error: any) {
				return Response.json({ error: error.code ?? "error" }, { status: 500 });
			}
		}

		// Set scopes for a key
		if (url.pathname.match(/^\/admin\/keys\/([^\/]+)\/scopes$/) && request.method === "PUT") {
			if (!verifyAdminKey(request, ADMIN_KEY)) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			const match = url.pathname.match(/^\/admin\/keys\/([^\/]+)\/scopes$/);
			const id = match?.[1];
			if (!id) {
				return Response.json({ error: "Invalid key ID" }, { status: 400 });
			}

			try {
				const body = await request.json() as { scopes?: string[] | string };
				const { scopes } = body;

				if (!scopes || (!Array.isArray(scopes) && typeof scopes !== "string")) {
					return Response.json(
						{ error: "Invalid scopes. Must be a string or array of strings." },
						{ status: 400 }
					);
				}

				await adminUk.setScopes(id, scopes);
				return Response.json({ success: true, id, scopes });
			} catch (error: any) {
				return Response.json({ error: error.code ?? "error" }, { status: 500 });
			}
		}

		// Grant scopes to a key
		if (url.pathname.match(/^\/admin\/keys\/([^\/]+)\/scopes\/grant$/) && request.method === "POST") {
			if (!verifyAdminKey(request, ADMIN_KEY)) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			const match = url.pathname.match(/^\/admin\/keys\/([^\/]+)\/scopes\/grant$/);
			const id = match?.[1];
			if (!id) {
				return Response.json({ error: "Invalid key ID" }, { status: 400 });
			}

			try {
				const body = await request.json() as { scopes?: string[] | string };
				const { scopes } = body;

				if (!scopes || (!Array.isArray(scopes) && typeof scopes !== "string")) {
					return Response.json(
						{ error: "Invalid scopes. Must be a string or array of strings." },
						{ status: 400 }
					);
				}

				await adminUk.grantScopes(id, scopes);
				const updatedScopes = await adminUk.getScopes(id);
				return Response.json({
					success: true,
					id,
					granted: scopes,
					scopes: updatedScopes,
				});
			} catch (error: any) {
				return Response.json({ error: error.code ?? "error" }, { status: 500 });
			}
		}

		// Revoke scopes from a key
		if (url.pathname.match(/^\/admin\/keys\/([^\/]+)\/scopes\/revoke$/) && request.method === "POST") {
			if (!verifyAdminKey(request, ADMIN_KEY)) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			const match = url.pathname.match(/^\/admin\/keys\/([^\/]+)\/scopes\/revoke$/);
			const id = match?.[1];
			if (!id) {
				return Response.json({ error: "Invalid key ID" }, { status: 400 });
			}

			try {
				const body = await request.json() as { scopes?: string[] | string };
				const { scopes } = body;

				if (!scopes || (!Array.isArray(scopes) && typeof scopes !== "string")) {
					return Response.json(
						{ error: "Invalid scopes. Must be a string or array of strings." },
						{ status: 400 }
					);
				}

				await adminUk.revokeScopes(id, scopes);
				const updatedScopes = await adminUk.getScopes(id);
				return Response.json({
					success: true,
					id,
					revoked: scopes,
					scopes: updatedScopes,
				});
			} catch (error: any) {
				return Response.json({ error: error.code ?? "error" }, { status: 500 });
			}
		}

		// Revoke a key
		if (url.pathname.match(/^\/admin\/keys\/([^\/]+)$/) && request.method === "DELETE") {
			if (!verifyAdminKey(request, ADMIN_KEY)) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			const match = url.pathname.match(/^\/admin\/keys\/([^\/]+)$/);
			const id = match?.[1];
			if (!id) {
				return Response.json({ error: "Invalid key ID" }, { status: 400 });
			}

			const res = await adminUk.revokeKey(id);

			if (res.error) {
				return Response.json({ error: res.error.code ?? "error" }, { status: 500 });
			}

			return Response.json({ success: true, revoked: id });
		}

		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

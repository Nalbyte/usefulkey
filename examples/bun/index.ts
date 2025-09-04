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

// Initialize UsefulKey with in-memory adapters and rate limit plugin
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

const port = Number(process.env.PORT || 8789);

const server = Bun.serve({
	port,
	async fetch(req) {
		const url = new URL(req.url);

		// Health check endpoint for integration tests
		if (req.method === "GET" && url.pathname === "/health") {
			return Response.json({ ok: true, service: "dog-api" });
		}

		// ===== PUBLIC API ENDPOINTS =====

		// Dog names API - requires API key, rate limited via plugin
		if (req.method === "GET" && url.pathname === "/api/dogs") {
			const key = req.headers.get("x-api-key") || "";
			const ipHeader = req.headers.get("x-forwarded-for");
			const ip = ipHeader?.split(",")[0].trim() || "127.0.0.1";

			// Use the rate limit plugin with namespace, namespace is required for rate limiting plugin
			const res = await uk.verifyKey(
				{
					key,
					ip,
					namespace: "api-dogs",
				},
				true,
			); // true to include metadata in res

			if (res.error) {
				return Response.json(
					{ error: "Invalid API key", code: res.error?.code ?? "invalid_key" },
					{ status: 401 },
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

				return Response.json(
					{
						error: errorMessage,
						code: res.result?.reason ?? "invalid_key",
					},
					{ status: statusCode },
				);
			}

			// Return 10 random dog names for pro users, 5 for others
			const count = res.result?.metadata?.plan === "pro" ? 10 : 5;
			const shuffled = [...DOG_NAMES].sort(() => 0.5 - Math.random());
			const selectedNames = shuffled.slice(0, count);

			return Response.json({
				dogs: selectedNames,
				count,
				plan: res.result?.metadata?.plan || "basic",
			});
		}

		// Premium dog facts - requires 'premium' scope
		if (req.method === "GET" && url.pathname === "/api/dogs/facts") {
			const key = req.headers.get("x-api-key") || "";
			const ipHeader = req.headers.get("x-forwarded-for");
			const ip = ipHeader?.split(",")[0].trim() || "127.0.0.1";

			const res = await uk.verifyKey(
				{
					key,
					ip,
					namespace: "api-dogs",
					scopes: ["premium"],
				},
				true,
			);

			if (res.error) {
				return Response.json(
					{ error: "Invalid API key", code: res.error?.code ?? "invalid_key" },
					{ status: 401 },
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

				return Response.json(
					{
						error: errorMessage,
						code: res.result?.reason ?? "insufficient_scope",
					},
					{ status: statusCode },
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

		// Admin dog management - requires 'admin' scope
		if (req.method === "POST" && url.pathname === "/api/dogs/manage") {
			const key = req.headers.get("x-api-key") || "";
			const ipHeader = req.headers.get("x-forwarded-for");
			const ip = ipHeader?.split(",")[0].trim() || "127.0.0.1";

			const res = await uk.verifyKey(
				{
					key,
					ip,
					namespace: "api-dogs",
					scopes: ["admin"], // Check for required scopes
				},
				true,
			);

			if (res.error) {
				return Response.json(
					{ error: "Invalid API key", code: res.error?.code ?? "invalid_key" },
					{ status: 401 },
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

				return Response.json(
					{
						error: errorMessage,
						code: res.result?.reason ?? "insufficient_scope",
					},
					{ status: statusCode },
				);
			}

			let body: any = {};
			try {
				body = await req.json();
			} catch {
				return Response.json(
					{ error: "Invalid request body" },
					{ status: 400 },
				);
			}

			const { action, dogName } = body;

			if (!action || !dogName) {
				return Response.json(
					{ error: "Missing action or dogName" },
					{ status: 400 },
				);
			}

			if (action === "add") {
				if (!DOG_NAMES.includes(dogName)) {
					DOG_NAMES.push(dogName);
					return Response.json({
						success: true,
						message: `Added ${dogName} to the list`,
					});
				}
				return Response.json(
					{ error: "Dog name already exists" },
					{ status: 400 },
				);
			}

			return Response.json(
				{ error: "Unknown action. Use 'add'" },
				{ status: 400 },
			);
		}

		// ===== ADMIN ENDPOINTS (Protected with admin key) =====

		// Create API key with optional metadata
		if (req.method === "POST" && url.pathname === "/admin/keys") {
			const adminKey = req.headers.get("x-admin-key") || "";
			if (adminKey !== ADMIN_KEY) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			try {
				let body: any = {};
				try {
					body = await req.json();
				} catch {
					body = {};
				}
				const metadata = body.metadata || {};

				const res = await uk.createKey({ metadata });

				if (res.error || !res.result) {
					return Response.json(
						{ error: res.error?.code ?? "error" },
						{ status: 500 },
					);
				}

				return Response.json({
					key: res.result.key,
					metadata: res.result.metadata,
					id: res.result.id,
				});
			} catch (_error) {
				return Response.json(
					{ error: "Invalid request body" },
					{ status: 400 },
				);
			}
		}

		// Create a pro key
		if (req.method === "POST" && url.pathname === "/admin/keys/pro") {
			const adminKey = req.headers.get("x-admin-key") || "";
			if (adminKey !== ADMIN_KEY) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			const res = await uk.createKey({
				metadata: { plan: "pro" },
			});

			if (res.error || !res.result) {
				return Response.json(
					{ error: res.error?.code ?? "error" },
					{ status: 500 },
				);
			}

			return Response.json({
				key: res.result.key,
				metadata: res.result.metadata,
				id: res.result.id,
			});
		}

		// Create a premium key with premium scope
		if (req.method === "POST" && url.pathname === "/admin/keys/premium") {
			const adminKey = req.headers.get("x-admin-key") || "";
			if (adminKey !== ADMIN_KEY) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			try {
				const res = await uk.createKey({
					metadata: { plan: "premium" },
				});

				if (res.error || !res.result) {
					return Response.json(
						{ error: res.error?.code ?? "error" },
						{ status: 500 },
					);
				}

				// Grant premium scope to the key
				await uk.grantScopes(res.result.id, ["premium"]);

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
		if (req.method === "POST" && url.pathname === "/admin/keys/admin") {
			const adminKey = req.headers.get("x-admin-key") || "";
			if (adminKey !== ADMIN_KEY) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			try {
				const res = await uk.createKey({
					metadata: { plan: "admin", role: "administrator" },
				});

				if (res.error || !res.result) {
					return Response.json(
						{ error: res.error?.code ?? "error" },
						{ status: 500 },
					);
				}

				// Grant admin and premium scopes to the key
				await uk.grantScopes(res.result.id, ["admin", "premium"]);

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
		if (
			req.method === "GET" &&
			url.pathname.startsWith("/admin/keys/") &&
			!url.pathname.includes("/enable") &&
			!url.pathname.includes("/disable") &&
			!url.pathname.includes("/limits") &&
			!url.pathname.includes("/scopes")
		) {
			const adminKey = req.headers.get("x-admin-key") || "";
			if (adminKey !== ADMIN_KEY) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			const id = url.pathname.split("/").pop();
			if (!id) {
				return Response.json({ error: "Missing key ID" }, { status: 400 });
			}

			const res = await uk.getKeyById(id);

			if (res.error || !res.result) {
				return Response.json(
					{ error: res.error?.code ?? "not_found" },
					{ status: 404 },
				);
			}

			return Response.json({
				id: res.result.id,
				metadata: res.result.metadata,
				createdAt: res.result.createdAt,
				expiresAt: res.result.expiresAt,
				revokedAt: res.result.revokedAt,
			});
		}

		// Revoke a key
		if (
			req.method === "DELETE" &&
			url.pathname.startsWith("/admin/keys/") &&
			!url.pathname.includes("/enable") &&
			!url.pathname.includes("/disable") &&
			!url.pathname.includes("/limits") &&
			!url.pathname.includes("/scopes")
		) {
			const adminKey = req.headers.get("x-admin-key") || "";
			if (adminKey !== ADMIN_KEY) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			const id = url.pathname.split("/").pop();
			if (!id) {
				return Response.json({ error: "Missing key ID" }, { status: 400 });
			}

			const res = await uk.revokeKey(id);

			if (res.error) {
				return Response.json(
					{ error: res.error.code ?? "error" },
					{ status: 500 },
				);
			}

			return Response.json({ success: true, revoked: id });
		}

		// Enable a key
		if (req.method === "PUT" && url.pathname.includes("/enable")) {
			const adminKey = req.headers.get("x-admin-key") || "";
			if (adminKey !== ADMIN_KEY) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			try {
				const id = url.pathname.split("/")[3]; // /admin/keys/{id}/enable
				if (!id) {
					return Response.json({ error: "Missing key ID" }, { status: 400 });
				}

				await uk.enableKey(id);
				return Response.json({ success: true, enabled: id });
			} catch (error: any) {
				return Response.json({ error: error.code ?? "error" }, { status: 500 });
			}
		}

		// Disable a key
		if (req.method === "PUT" && url.pathname.includes("/disable")) {
			const adminKey = req.headers.get("x-admin-key") || "";
			if (adminKey !== ADMIN_KEY) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			try {
				const id = url.pathname.split("/")[3]; // /admin/keys/{id}/disable
				if (!id) {
					return Response.json({ error: "Missing key ID" }, { status: 400 });
				}

				await uk.disableKey(id);
				return Response.json({ success: true, disabled: id });
			} catch (error: any) {
				return Response.json({ error: error.code ?? "error" }, { status: 500 });
			}
		}

		// Set remaining limits for a key
		if (req.method === "PUT" && url.pathname.includes("/limits")) {
			const adminKey = req.headers.get("x-admin-key") || "";
			if (adminKey !== ADMIN_KEY) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			try {
				const id = url.pathname.split("/")[3]; // /admin/keys/{id}/limits
				if (!id) {
					return Response.json({ error: "Missing key ID" }, { status: 400 });
				}

				let body: any = {};
				try {
					body = await req.json();
				} catch {
					body = {};
				}
				const { remaining } = body;

				if (
					remaining === undefined ||
					typeof remaining !== "number" ||
					remaining < 0
				) {
					return Response.json(
						{
							error: "Invalid remaining limit. Must be a non-negative number.",
						},
						{ status: 400 },
					);
				}

				await uk.setUsesRemaining(id, remaining);
				return Response.json({ success: true, id, remaining });
			} catch (error: any) {
				return Response.json({ error: error.code ?? "error" }, { status: 500 });
			}
		}

		// Get scopes for a key
		if (
			req.method === "GET" &&
			url.pathname.includes("/scopes") &&
			!url.pathname.includes("/grant") &&
			!url.pathname.includes("/revoke")
		) {
			const adminKey = req.headers.get("x-admin-key") || "";
			if (adminKey !== ADMIN_KEY) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			try {
				const id = url.pathname.split("/")[3]; // /admin/keys/{id}/scopes
				if (!id) {
					return Response.json({ error: "Missing key ID" }, { status: 400 });
				}

				const scopes = await uk.getScopes(id);
				return Response.json({ success: true, id, scopes });
			} catch (error: any) {
				return Response.json({ error: error.code ?? "error" }, { status: 500 });
			}
		}

		// Set scopes for a key
		if (
			req.method === "PUT" &&
			url.pathname.includes("/scopes") &&
			!url.pathname.includes("/grant") &&
			!url.pathname.includes("/revoke")
		) {
			const adminKey = req.headers.get("x-admin-key") || "";
			if (adminKey !== ADMIN_KEY) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			try {
				const id = url.pathname.split("/")[3]; // /admin/keys/{id}/scopes
				if (!id) {
					return Response.json({ error: "Missing key ID" }, { status: 400 });
				}

				let body: any = {};
				try {
					body = await req.json();
				} catch {
					body = {};
				}
				const { scopes } = body;

				if (!scopes || (!Array.isArray(scopes) && typeof scopes !== "string")) {
					return Response.json(
						{ error: "Invalid scopes. Must be a string or array of strings." },
						{ status: 400 },
					);
				}

				await uk.setScopes(id, scopes);
				return Response.json({ success: true, id, scopes });
			} catch (error: any) {
				return Response.json({ error: error.code ?? "error" }, { status: 500 });
			}
		}

		// Grant scopes to a key
		if (req.method === "POST" && url.pathname.includes("/scopes/grant")) {
			const adminKey = req.headers.get("x-admin-key") || "";
			if (adminKey !== ADMIN_KEY) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			try {
				const id = url.pathname.split("/")[3]; // /admin/keys/{id}/scopes/grant
				if (!id) {
					return Response.json({ error: "Missing key ID" }, { status: 400 });
				}

				let body: any = {};
				try {
					body = await req.json();
				} catch {
					body = {};
				}
				const { scopes } = body;

				if (!scopes || (!Array.isArray(scopes) && typeof scopes !== "string")) {
					return Response.json(
						{ error: "Invalid scopes. Must be a string or array of strings." },
						{ status: 400 },
					);
				}

				await uk.grantScopes(id, scopes);
				const updatedScopes = await uk.getScopes(id);
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
		if (req.method === "POST" && url.pathname.includes("/scopes/revoke")) {
			const adminKey = req.headers.get("x-admin-key") || "";
			if (adminKey !== ADMIN_KEY) {
				return Response.json({ error: "Invalid admin key" }, { status: 401 });
			}

			try {
				const id = url.pathname.split("/")[3]; // /admin/keys/{id}/scopes/revoke
				if (!id) {
					return Response.json({ error: "Missing key ID" }, { status: 400 });
				}

				let body: any = {};
				try {
					body = await req.json();
				} catch {
					body = {};
				}
				const { scopes } = body;

				if (!scopes || (!Array.isArray(scopes) && typeof scopes !== "string")) {
					return Response.json(
						{ error: "Invalid scopes. Must be a string or array of strings." },
						{ status: 400 },
					);
				}

				await uk.revokeScopes(id, scopes);
				const updatedScopes = await uk.getScopes(id);
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

		return new Response("Not Found", { status: 404 });
	},
});

console.log(
	`UsefulKey Demo API Server running on http://localhost:${server.port}`,
);
console.log(
	`Try: curl -X POST http://localhost:${server.port}/admin/keys/pro -H "x-admin-key: ${ADMIN_KEY}"`,
);
console.log(
	`Permissions enabled: Try creating a premium key and accessing /api/dogs/facts`,
);
console.log(
	`Scope-based access: 'premium' scope for facts, 'admin' scope for management`,
);

import { describe, it, expect, beforeAll } from 'vitest';
import { SELF, env } from 'cloudflare:test';

declare module 'cloudflare:test' {
	interface ProvidedEnv {
		DB: D1Database;
		RATE_LIMIT_KV: KVNamespace;
	}
}

describe('UsefulKey Cloudflare Worker', () => {
	let adminKey: string;
	let proKey: string;
	let premiumKey: string;
	let adminApiKey: string;

	beforeAll(async () => {
		// Create admin key for testing
		const adminRes = await SELF.fetch("http://example.com/admin/keys/admin", {
			method: "POST",
			headers: { "x-admin-key": "admin-secret-key" },
		});
		expect(adminRes.ok).toBe(true);
		const adminData = await adminRes.json() as { key: string };
		adminKey = adminData.key;

		// Create pro key for testing
		const proRes = await SELF.fetch("http://example.com/admin/keys/pro", {
			method: "POST",
			headers: { "x-admin-key": "admin-secret-key" },
		});
		expect(proRes.ok).toBe(true);
		const proData = await proRes.json() as { key: string };
		proKey = proData.key;

		// Create premium key for testing
		const premiumRes = await SELF.fetch("http://example.com/admin/keys/premium", {
			method: "POST",
			headers: { "x-admin-key": "admin-secret-key" },
		});
		expect(premiumRes.ok).toBe(true);
		const premiumData = await premiumRes.json() as { key: string };
		premiumKey = premiumData.key;

		// Create admin API key for testing
		const adminApiRes = await SELF.fetch("http://example.com/admin/keys/admin", {
			method: "POST",
			headers: { "x-admin-key": "admin-secret-key" },
		});
		expect(adminApiRes.ok).toBe(true);
		const adminApiData = await adminApiRes.json() as { key: string };
		adminApiKey = adminApiData.key;
	});

	describe("Health Check", () => {
		it("responds with ok:true", async () => {
			const res = await SELF.fetch("http://example.com/health");
			expect(res.ok).toBe(true);
			const body = await res.json() as { ok: boolean; service: string };
			expect(body.ok).toBe(true);
			expect(body.service).toBe("dog-api");
		});
	});

	describe("API Endpoints", () => {
		describe("GET /api/dogs", () => {
			it("requires API key", async () => {
				const res = await SELF.fetch("http://example.com/api/dogs");
				expect(res.status).toBe(401);
				const body = await res.json() as { error: string; code: string };
				expect(body.error).toBe("Invalid API key");
				expect(body.code).toBe("invalid_key");
			});

			it("returns dog names with valid API key", async () => {
				const res = await SELF.fetch("http://example.com/api/dogs", {
					headers: { "x-api-key": proKey },
				});
				expect(res.ok).toBe(true);
				const body = await res.json() as { dogs: string[]; count: number; plan: string };
				expect(Array.isArray(body.dogs)).toBe(true);
				expect(body.count).toBe(10); // Pro users get 10 dogs
				expect(body.plan).toBe("pro");
			});

			it("returns 5 dogs for basic users", async () => {
				// Create a basic key
				const basicRes = await SELF.fetch("http://example.com/admin/keys", {
					method: "POST",
					headers: { 
						"x-admin-key": "admin-secret-key",
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ metadata: { plan: "basic" } }),
				});
				expect(basicRes.ok).toBe(true);
				const basicData = await basicRes.json() as { key: string };

				const res = await SELF.fetch("http://example.com/api/dogs", {
					headers: { "x-api-key": basicData.key },
				});
				expect(res.ok).toBe(true);
				const body = await res.json() as { dogs: string[]; count: number; plan: string };
				expect(body.count).toBe(5); // Basic users get 5 dogs
				expect(body.plan).toBe("basic");
			});
		});

		describe("GET /api/dogs/facts", () => {
			it("requires premium scope", async () => {
				const res = await SELF.fetch("http://example.com/api/dogs/facts", {
					headers: { "x-api-key": proKey },
				});
				expect(res.status).toBe(403);
				const body = await res.json() as { error: string; code: string };
				expect(body.error).toBe("Insufficient permissions");
				expect(body.code).toBe("insufficient_scope");
			});

			it("returns facts with premium scope", async () => {
				const res = await SELF.fetch("http://example.com/api/dogs/facts", {
					headers: { "x-api-key": premiumKey },
				});
				expect(res.ok).toBe(true);
				const body = await res.json() as { fact: string; category: string };
				expect(typeof body.fact).toBe("string");
				expect(body.category).toBe("premium");
			});
		});

		describe("POST /api/dogs/manage", () => {
			it("requires admin scope", async () => {
				const res = await SELF.fetch("http://example.com/api/dogs/manage", {
					method: "POST",
					headers: { 
						"x-api-key": premiumKey,
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ action: "add", dogName: "TestDog" }),
				});
				expect(res.status).toBe(403);
				const body = await res.json() as { error: string; code: string };
				expect(body.error).toBe("Insufficient permissions");
				expect(body.code).toBe("insufficient_scope");
			});

			it("allows admin to add dog names", async () => {
				const res = await SELF.fetch("http://example.com/api/dogs/manage", {
					method: "POST",
					headers: { 
						"x-api-key": adminApiKey,
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ action: "add", dogName: "TestDog" }),
				});
				expect(res.ok).toBe(true);
				const body = await res.json() as { success: boolean; message: string };
				expect(body.success).toBe(true);
				expect(body.message).toBe("Added TestDog to the list");
			});

			it("prevents adding duplicate dog names", async () => {
				const res = await SELF.fetch("http://example.com/api/dogs/manage", {
					method: "POST",
					headers: { 
						"x-api-key": adminApiKey,
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ action: "add", dogName: "TestDog" }),
				});
				expect(res.status).toBe(400);
				const body = await res.json() as { error: string };
				expect(body.error).toBe("Dog name already exists");
			});
		});
	});

	describe("Admin Endpoints", () => {
		describe("POST /admin/keys", () => {
			it("requires admin key", async () => {
				const res = await SELF.fetch("http://example.com/admin/keys", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ metadata: { test: true } }),
				});
				expect(res.status).toBe(401);
				const body = await res.json() as { error: string };
				expect(body.error).toBe("Invalid admin key");
			});

			it("creates key with metadata", async () => {
				const res = await SELF.fetch("http://example.com/admin/keys", {
					method: "POST",
					headers: { 
						"x-admin-key": "admin-secret-key",
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ metadata: { test: true, plan: "custom" } }),
				});
				expect(res.ok).toBe(true);
				const body = await res.json() as { key: string; metadata: any; id: string };
				expect(typeof body.key).toBe("string");
				expect(body.key).toMatch(/^uk_/);
				expect(body.metadata.test).toBe(true);
				expect(body.metadata.plan).toBe("custom");
				expect(typeof body.id).toBe("string");
			});
		});

		describe("POST /admin/keys/pro", () => {
			it("creates pro key", async () => {
				const res = await SELF.fetch("http://example.com/admin/keys/pro", {
					method: "POST",
					headers: { "x-admin-key": "admin-secret-key" },
				});
				expect(res.ok).toBe(true);
				const body = await res.json() as { key: string; metadata: any; id: string };
				expect(body.metadata.plan).toBe("pro");
			});
		});

		describe("POST /admin/keys/premium", () => {
			it("creates premium key with premium scope", async () => {
				const res = await SELF.fetch("http://example.com/admin/keys/premium", {
					method: "POST",
					headers: { "x-admin-key": "admin-secret-key" },
				});
				expect(res.ok).toBe(true);
				const body = await res.json() as { key: string; metadata: any; id: string; scopes: string[] };
				expect(body.metadata.plan).toBe("premium");
				expect(body.scopes).toContain("premium");
			});
		});

		describe("POST /admin/keys/admin", () => {
			it("creates admin key with admin and premium scopes", async () => {
				const res = await SELF.fetch("http://example.com/admin/keys/admin", {
					method: "POST",
					headers: { "x-admin-key": "admin-secret-key" },
				});
				expect(res.ok).toBe(true);
				const body = await res.json() as { key: string; metadata: any; id: string; scopes: string[] };
				expect(body.metadata.plan).toBe("admin");
				expect(body.metadata.role).toBe("administrator");
				expect(body.scopes).toContain("admin");
				expect(body.scopes).toContain("premium");
			});
		});

		describe("GET /admin/keys/:id", () => {
			it("gets key info", async () => {
				// First create a key
				const createRes = await SELF.fetch("http://example.com/admin/keys", {
					method: "POST",
					headers: { 
						"x-admin-key": "admin-secret-key",
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ metadata: { test: "info" } }),
				});
				const createData = await createRes.json() as { id: string };

				// Then get its info
				const res = await SELF.fetch(`http://example.com/admin/keys/${createData.id}`, {
					headers: { "x-admin-key": "admin-secret-key" },
				});
				expect(res.ok).toBe(true);
				const body = await res.json() as { id: string; metadata: any; createdAt: number };
				expect(body.id).toBe(createData.id);
				expect(body.metadata.test).toBe("info");
				expect(typeof body.createdAt).toBe("number");
			});
		});

		describe("PUT /admin/keys/:id/enable and /disable", () => {
			it("can enable and disable keys", async () => {
				// Create a key
				const createRes = await SELF.fetch("http://example.com/admin/keys", {
					method: "POST",
					headers: { 
						"x-admin-key": "admin-secret-key",
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ metadata: { test: "enable-disable" } }),
				});
				const createData = await createRes.json() as { id: string; key: string };

				// Disable the key
				const disableRes = await SELF.fetch(`http://example.com/admin/keys/${createData.id}/disable`, {
					method: "PUT",
					headers: { "x-admin-key": "admin-secret-key" },
				});
				expect(disableRes.ok).toBe(true);

				// Try to use the disabled key
				const useDisabledRes = await SELF.fetch("http://example.com/api/dogs", {
					headers: { "x-api-key": createData.key },
				});
				expect(useDisabledRes.status).toBe(403);

				// Enable the key
				const enableRes = await SELF.fetch(`http://example.com/admin/keys/${createData.id}/enable`, {
					method: "PUT",
					headers: { "x-admin-key": "admin-secret-key" },
				});
				expect(enableRes.ok).toBe(true);

				// Key should work again
				const useEnabledRes = await SELF.fetch("http://example.com/api/dogs", {
					headers: { "x-api-key": createData.key },
				});
				expect(useEnabledRes.ok).toBe(true);
			});
		});

		describe("PUT /admin/keys/:id/limits", () => {
			it("can set usage limits", async () => {
				// Create a key
				const createRes = await SELF.fetch("http://example.com/admin/keys", {
					method: "POST",
					headers: { 
						"x-admin-key": "admin-secret-key",
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ metadata: { test: "limits" } }),
				});
				const createData = await createRes.json() as { id: string; key: string };

				// Set limit to 2 uses
				const limitRes = await SELF.fetch(`http://example.com/admin/keys/${createData.id}/limits`, {
					method: "PUT",
					headers: { 
						"x-admin-key": "admin-secret-key",
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ remaining: 2 }),
				});
				expect(limitRes.ok).toBe(true);

				// Use the key twice (should work)
				await SELF.fetch("http://example.com/api/dogs", {
					headers: { "x-api-key": createData.key },
				});
				await SELF.fetch("http://example.com/api/dogs", {
					headers: { "x-api-key": createData.key },
				});

				// Third use should fail
				const thirdUseRes = await SELF.fetch("http://example.com/api/dogs", {
					headers: { "x-api-key": createData.key },
				});
				expect(thirdUseRes.status).toBe(429);
			});
		});

		describe("Scope management", () => {
			it("can manage scopes", async () => {
				// Create a key
				const createRes = await SELF.fetch("http://example.com/admin/keys", {
					method: "POST",
					headers: { 
						"x-admin-key": "admin-secret-key",
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ metadata: { test: "scopes" } }),
				});
				const createData = await createRes.json() as { id: string; key: string };

				// Grant premium scope
				const grantRes = await SELF.fetch(`http://example.com/admin/keys/${createData.id}/scopes/grant`, {
					method: "POST",
					headers: { 
						"x-admin-key": "admin-secret-key",
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ scopes: ["premium"] }),
				});
				expect(grantRes.ok).toBe(true);

				// Check scopes
				const getScopesRes = await SELF.fetch(`http://example.com/admin/keys/${createData.id}/scopes`, {
					headers: { "x-admin-key": "admin-secret-key" },
				});
				expect(getScopesRes.ok).toBe(true);
				const scopesData = await getScopesRes.json() as { scopes: string[] };
				expect(scopesData.scopes).toContain("premium");

				// Key should now have premium access
				const premiumRes = await SELF.fetch("http://example.com/api/dogs/facts", {
					headers: { "x-api-key": createData.key },
				});
				expect(premiumRes.ok).toBe(true);

				// Revoke premium scope
				const revokeRes = await SELF.fetch(`http://example.com/admin/keys/${createData.id}/scopes/revoke`, {
					method: "POST",
					headers: { 
						"x-admin-key": "admin-secret-key",
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ scopes: ["premium"] }),
				});
				expect(revokeRes.ok).toBe(true);

				// Key should no longer have premium access
				const noPremiumRes = await SELF.fetch("http://example.com/api/dogs/facts", {
					headers: { "x-api-key": createData.key },
				});
				expect(noPremiumRes.status).toBe(403);
			});
		});

		describe("DELETE /admin/keys/:id", () => {
			it("can revoke keys", async () => {
				// Create a key
				const createRes = await SELF.fetch("http://example.com/admin/keys", {
					method: "POST",
					headers: { 
						"x-admin-key": "admin-secret-key",
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ metadata: { test: "revoke" } }),
				});
				const createData = await createRes.json() as { id: string; key: string };

				// Revoke the key
				const revokeRes = await SELF.fetch(`http://example.com/admin/keys/${createData.id}`, {
					method: "DELETE",
					headers: { "x-admin-key": "admin-secret-key" },
				});
				expect(revokeRes.ok).toBe(true);

				// Key should no longer work
				const useRevokedRes = await SELF.fetch("http://example.com/api/dogs", {
					headers: { "x-api-key": createData.key },
				});
				expect(useRevokedRes.status).toBe(401);
			});
		});
	});
});

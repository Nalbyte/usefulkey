import { beforeAll, describe, expect, it } from "vitest";

const ADMIN_KEY = "admin-secret-key";

function getBaseUrl(): string {
  return "http://127.0.0.1:8788";
}

async function waitForServer(url: string, maxAttempts = 40, delayMs = 250): Promise<void> {
  let lastErr: unknown = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${url}/health`, { method: "GET" });
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `Hono example server not reachable at ${url}. Ensure it is running (docker compose or GH Actions). Last error: ${String(
      lastErr,
    )}`,
  );
}

const baseUrl = getBaseUrl();

let basicKey: { id: string; key: string } | null = null;
let proKey: { id: string; key: string } | null = null;
let premiumKey: { id: string; key: string } | null = null;
let adminKey: { id: string; key: string } | null = null;

beforeAll(async () => {
  await waitForServer(baseUrl);

  const basicRes = await fetch(`${baseUrl}/admin/keys`, {
    method: "POST",
    headers: { "x-admin-key": ADMIN_KEY, "content-type": "application/json" },
    body: JSON.stringify({ metadata: { plan: "basic" } })
  });
  expect(basicRes.ok).toBe(true);
  basicKey = await basicRes.json() as { id: string; key: string };

  const proRes = await fetch(`${baseUrl}/admin/keys/pro`, {
    method: "POST",
    headers: { "x-admin-key": ADMIN_KEY }
  });
  expect(proRes.ok).toBe(true);
  proKey = await proRes.json() as { id: string; key: string };

  const premiumRes = await fetch(`${baseUrl}/admin/keys/premium`, {
    method: "POST",
    headers: { "x-admin-key": ADMIN_KEY }
  });
  expect(premiumRes.ok).toBe(true);
  premiumKey = await premiumRes.json() as { id: string; key: string };

  const adminRes = await fetch(`${baseUrl}/admin/keys/admin`, {
    method: "POST",
    headers: { "x-admin-key": ADMIN_KEY }
  });
  expect(adminRes.ok).toBe(true);
  adminKey = await adminRes.json() as { id: string; key: string };
});

describe("Hono UsefulKey Demo Server - Comprehensive Integration Tests", () => {

  describe("Health Check", () => {
    it("/health responds with ok:true and service info", async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.service).toBe("dog-api");
    });
  });

  describe("Public API Endpoints", () => {
    it("GET /api/dogs works with basic key", async () => {
      const res = await fetch(`${baseUrl}/api/dogs`, {
        headers: { "x-api-key": basicKey!.key }
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(Array.isArray(body.dogs)).toBe(true);
      expect(typeof body.count).toBe("number");
      expect(body.plan).toBe("basic");
    });

    it("GET /api/dogs returns more dogs for pro key", async () => {
      const res = await fetch(`${baseUrl}/api/dogs`, {
        headers: { "x-api-key": proKey!.key }
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(Array.isArray(body.dogs)).toBe(true);
      expect(body.count).toBeGreaterThan(5); // Pro keys get more dogs
      expect(body.plan).toBe("pro");
    });

    it("GET /api/dogs/facts requires premium scope", async () => {
      // Should fail with basic key
      const basicRes = await fetch(`${baseUrl}/api/dogs/facts`, {
        headers: { "x-api-key": basicKey!.key }
      });
      expect(basicRes.status).toBe(403);
      const basicBody = await basicRes.json();
      expect(basicBody.error).toContain("Insufficient permissions");
    });

    it("GET /api/dogs/facts works with premium key", async () => {
      const res = await fetch(`${baseUrl}/api/dogs/facts`, {
        headers: { "x-api-key": premiumKey!.key }
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.fact).toBeTruthy();
      expect(body.category).toBe("premium");
    });

    it("POST /api/dogs/manage requires admin scope", async () => {
      // Should fail with premium key (only has premium scope)
      const premiumRes = await fetch(`${baseUrl}/api/dogs/manage`, {
        method: "POST",
        headers: {
          "x-api-key": premiumKey!.key,
          "content-type": "application/json"
        },
        body: JSON.stringify({ action: "add", dogName: "TestDog" })
      });
      expect(premiumRes.status).toBe(403);
    });

    it("POST /api/dogs/manage works with admin key", async () => {
      const res = await fetch(`${baseUrl}/api/dogs/manage`, {
        method: "POST",
        headers: {
          "x-api-key": adminKey!.key,
          "content-type": "application/json"
        },
        body: JSON.stringify({ action: "add", dogName: "TestDog" })
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.message).toContain("TestDog");
    });

    it("POST /api/dogs/manage rejects invalid actions", async () => {
      const res = await fetch(`${baseUrl}/api/dogs/manage`, {
        method: "POST",
        headers: {
          "x-api-key": adminKey!.key,
          "content-type": "application/json"
        },
        body: JSON.stringify({ action: "invalid", dogName: "TestDog" })
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Unknown action");
    });
  });

  describe("Admin Key Management", () => {
    it("POST /admin/keys creates key with metadata", async () => {
      const res = await fetch(`${baseUrl}/admin/keys`, {
        method: "POST",
        headers: {
          "x-admin-key": ADMIN_KEY,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          metadata: { plan: "test", customField: "value" }
        })
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.key).toMatch(/^uk_/);
      expect(body.metadata.plan).toBe("test");
      expect(body.metadata.customField).toBe("value");
    });

    it("GET /admin/keys/:id returns key info", async () => {
      const res = await fetch(`${baseUrl}/admin/keys/${basicKey!.id}`, {
        headers: { "x-admin-key": ADMIN_KEY }
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.id).toBe(basicKey!.id);
      expect(body.metadata.plan).toBe("basic");
    });

    it("DELETE /admin/keys/:id revokes key", async () => {
      // First create a temporary key
      const createRes = await fetch(`${baseUrl}/admin/keys`, {
        method: "POST",
        headers: { "x-admin-key": ADMIN_KEY }
      });
      const tempKey = await createRes.json();

      // Delete it
      const deleteRes = await fetch(`${baseUrl}/admin/keys/${tempKey.id}`, {
        method: "DELETE",
        headers: { "x-admin-key": ADMIN_KEY }
      });
      expect(deleteRes.ok).toBe(true);

      // Verify it's revoked
      const verifyRes = await fetch(`${baseUrl}/api/dogs`, {
        headers: { "x-api-key": tempKey.key }
      });
      expect(verifyRes.status).toBe(401);
    });
  });

  describe("Key Enable/Disable", () => {
    it("PUT /admin/keys/:id/disable disables key", async () => {
      const res = await fetch(`${baseUrl}/admin/keys/${basicKey!.id}/disable`, {
        method: "PUT",
        headers: { "x-admin-key": ADMIN_KEY }
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.disabled).toBe(basicKey!.id);
    });

    it("Disabled key cannot access API", async () => {
      const res = await fetch(`${baseUrl}/api/dogs`, {
        headers: { "x-api-key": basicKey!.key }
      });
      expect(res.status).toBe(403);
    });

    it("PUT /admin/keys/:id/enable re-enables key", async () => {
      const res = await fetch(`${baseUrl}/admin/keys/${basicKey!.id}/enable`, {
        method: "PUT",
        headers: { "x-admin-key": ADMIN_KEY }
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.enabled).toBe(basicKey!.id);
    });

    it("Re-enabled key works again", async () => {
      const res = await fetch(`${baseUrl}/api/dogs`, {
        headers: { "x-api-key": basicKey!.key }
      });
      expect(res.ok).toBe(true);
    });
  });

  describe("Usage Limits", () => {
    it("PUT /admin/keys/:id/limits sets usage limit", async () => {
      const res = await fetch(`${baseUrl}/admin/keys/${basicKey!.id}/limits`, {
        method: "PUT",
        headers: {
          "x-admin-key": ADMIN_KEY,
          "content-type": "application/json"
        },
        body: JSON.stringify({ remaining: 2 })
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.remaining).toBe(2);
    });

    it("Key respects usage limit", async () => {
      // First request should work
      const res1 = await fetch(`${baseUrl}/api/dogs`, {
        headers: { "x-api-key": basicKey!.key }
      });
      expect(res1.ok).toBe(true);

      // Second request should work
      const res2 = await fetch(`${baseUrl}/api/dogs`, {
        headers: { "x-api-key": basicKey!.key }
      });
      expect(res2.ok).toBe(true);

      // Third request should fail
      const res3 = await fetch(`${baseUrl}/api/dogs`, {
        headers: { "x-api-key": basicKey!.key }
      });
      expect(res3.status).toBe(429);
    });

    it("PUT /admin/keys/:id/limits rejects invalid values", async () => {
      const res = await fetch(`${baseUrl}/admin/keys/${basicKey!.id}/limits`, {
        method: "PUT",
        headers: {
          "x-admin-key": ADMIN_KEY,
          "content-type": "application/json"
        },
        body: JSON.stringify({ remaining: -1 })
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("non-negative number");
    });
  });

  describe("Scope Management", () => {
    let testKey: { id: string; key: string } | null = null;

    beforeAll(async () => {
      // Create a test key for scope testing
      const res = await fetch(`${baseUrl}/admin/keys`, {
        method: "POST",
        headers: { "x-admin-key": ADMIN_KEY }
      });
      testKey = await res.json();
    });

    it("GET /admin/keys/:id/scopes returns empty scopes initially", async () => {
      const res = await fetch(`${baseUrl}/admin/keys/${testKey!.id}/scopes`, {
        headers: { "x-admin-key": ADMIN_KEY }
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.scopes).toEqual([]);
    });

    it("POST /admin/keys/:id/scopes/grant adds scopes", async () => {
      const res = await fetch(`${baseUrl}/admin/keys/${testKey!.id}/scopes/grant`, {
        method: "POST",
        headers: {
          "x-admin-key": ADMIN_KEY,
          "content-type": "application/json"
        },
        body: JSON.stringify({ scopes: ["premium"] })
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.granted).toEqual(["premium"]);
      expect(body.scopes).toContain("premium");
    });

    it("Key with premium scope can access premium endpoint", async () => {
      const res = await fetch(`${baseUrl}/api/dogs/facts`, {
        headers: { "x-api-key": testKey!.key }
      });
      expect(res.ok).toBe(true);
    });

    it("POST /admin/keys/:id/scopes/revoke removes scopes", async () => {
      const res = await fetch(`${baseUrl}/admin/keys/${testKey!.id}/scopes/revoke`, {
        method: "POST",
        headers: {
          "x-admin-key": ADMIN_KEY,
          "content-type": "application/json"
        },
        body: JSON.stringify({ scopes: ["premium"] })
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.revoked).toEqual(["premium"]);
      expect(body.scopes).not.toContain("premium");
    });

    it("Key without premium scope cannot access premium endpoint", async () => {
      const res = await fetch(`${baseUrl}/api/dogs/facts`, {
        headers: { "x-api-key": testKey!.key }
      });
      expect(res.status).toBe(403);
    });

    it("PUT /admin/keys/:id/scopes sets multiple scopes", async () => {
      const res = await fetch(`${baseUrl}/admin/keys/${testKey!.id}/scopes`, {
        method: "PUT",
        headers: {
          "x-admin-key": ADMIN_KEY,
          "content-type": "application/json"
        },
        body: JSON.stringify({ scopes: ["admin", "premium"] })
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.scopes).toEqual(["admin", "premium"]);
    });

    it("Key with admin scope can access admin endpoint", async () => {
      const res = await fetch(`${baseUrl}/api/dogs/manage`, {
        method: "POST",
        headers: {
          "x-api-key": testKey!.key,
          "content-type": "application/json"
        },
        body: JSON.stringify({ action: "add", dogName: "AdminTestDog" })
      });
      expect(res.ok).toBe(true);
    });

    it("POST /admin/keys/:id/scopes/grant rejects invalid scopes", async () => {
      const res = await fetch(`${baseUrl}/admin/keys/${testKey!.id}/scopes/grant`, {
        method: "POST",
        headers: {
          "x-admin-key": ADMIN_KEY,
          "content-type": "application/json"
        },
        body: JSON.stringify({ scopes: 123 })
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid scopes");
    });
  });

  describe("Error Cases and Validation", () => {
    it("API endpoints reject invalid keys", async () => {
      const res = await fetch(`${baseUrl}/api/dogs`, {
        headers: { "x-api-key": "invalid-key" }
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Invalid API key");
    });

    it("Admin endpoints reject invalid admin key", async () => {
      const res = await fetch(`${baseUrl}/admin/keys`, {
        method: "POST",
        headers: { "x-admin-key": "invalid-admin-key" }
      });
      expect(res.status).toBe(401);
    });

    it("Admin endpoints reject missing admin key", async () => {
      const res = await fetch(`${baseUrl}/admin/keys`, {
        method: "POST"
      });
      expect(res.status).toBe(401);
    });

    it("Non-existent key operations return 500", async () => {
      const res = await fetch(`${baseUrl}/admin/keys/non-existent-id/enable`, {
        method: "PUT",
        headers: { "x-admin-key": ADMIN_KEY }
      });
      expect(res.status).toBe(500);
    });
  });

  describe("Rate Limiting", () => {
    it("Multiple rapid requests are rate limited", async () => {
      const requests = Array(300).fill(null).map(() =>
        fetch(`${baseUrl}/api/dogs`, {
          headers: { "x-api-key": proKey!.key }
        })
      );

      const results = await Promise.all(requests);
      const successCount = results.filter(r => r.ok).length;
      const rateLimitedCount = results.filter(r => !r.ok).length;

      expect(successCount).toBeGreaterThan(0);
      expect(rateLimitedCount).toBeGreaterThan(0);
    });
  });
});



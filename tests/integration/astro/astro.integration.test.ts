import { beforeAll, describe, expect, it } from "vitest";

function getBaseUrl(): string {
  return "http://localhost:4321";
}

async function waitForServer(url: string, maxAttempts = 40, delayMs = 250): Promise<void> {
  let lastErr: unknown = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${url}/api/health`, { method: "GET" });
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `Astro example server not reachable at ${url}. Ensure it is running. Last error: ${String(
      lastErr,
    )}`,
  );
}

const baseUrl = getBaseUrl();
let createdKey: { id: string; key: string } | null = null;
let proKey: { id: string; key: string } | null = null;
let premiumKey: { id: string; key: string } | null = null;
let adminKey: { id: string; key: string } | null = null;
const ADMIN_KEY = "admin-secret-key";

beforeAll(async () => {
  await waitForServer(baseUrl);

  // Create keys to use in tests
  const res = await fetch(`${baseUrl}/api/admin/keys`, {
    method: "POST",
    headers: { 
      "content-type": "application/json",
      "x-admin-key": ADMIN_KEY
    },
    body: "{}",
  });
  expect(res.ok).toBe(true);
  const body = (await res.json()) as { id: string; key: string };
  expect(body.id).toBeTruthy();
  expect(body.key).toMatch(/^uk_/);
  createdKey = body;

  // Create a pro key
  const proRes = await fetch(`${baseUrl}/api/admin/keys/pro`, {
    method: "POST",
    headers: { 
      "content-type": "application/json",
      "x-admin-key": ADMIN_KEY
    },
  });
  expect(proRes.ok).toBe(true);
  const proBody = (await proRes.json()) as { id: string; key: string };
  proKey = proBody;

  // Create a premium key
  const premiumRes = await fetch(`${baseUrl}/api/admin/keys/premium`, {
    method: "POST",
    headers: { 
      "content-type": "application/json",
      "x-admin-key": ADMIN_KEY
    },
  });
  expect(premiumRes.ok).toBe(true);
  const premiumBody = (await premiumRes.json()) as { id: string; key: string; scopes: string[] };
  premiumKey = premiumBody;
  expect(premiumBody.scopes).toContain("premium");

  // Create an admin key
  const adminRes = await fetch(`${baseUrl}/api/admin/keys/admin`, {
    method: "POST",
    headers: { 
      "content-type": "application/json",
      "x-admin-key": ADMIN_KEY
    },
  });
  expect(adminRes.ok).toBe(true);
  const adminBody = (await adminRes.json()) as { id: string; key: string; scopes: string[] };
  adminKey = adminBody;
  expect(adminBody.scopes).toContain("admin");
  expect(adminBody.scopes).toContain("premium");
});

describe("Astro example endpoints", () => {
  it("/api/health responds with ok:true and service name", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("dog-api");
  });

  it("POST /api/admin/keys returns an id and key", async () => {
    const res = await fetch(`${baseUrl}/api/admin/keys`, {
      method: "POST",
      headers: { 
        "content-type": "application/json",
        "x-admin-key": ADMIN_KEY
      },
      body: "{}",
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { id: string; key: string };
    expect(typeof body.id).toBe("string");
    expect(typeof body.key).toBe("string");
    expect(body.key.length).toBeGreaterThan(10);
  });

  it("POST /api/admin/keys/pro creates a pro key", async () => {
    const res = await fetch(`${baseUrl}/api/admin/keys/pro`, {
      method: "POST",
      headers: { 
        "content-type": "application/json",
        "x-admin-key": ADMIN_KEY
      },
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { id: string; key: string; metadata: any };
    expect(body.metadata.plan).toBe("pro");
  });

  it("POST /api/admin/keys/premium creates a premium key with premium scope", async () => {
    const res = await fetch(`${baseUrl}/api/admin/keys/premium`, {
      method: "POST",
      headers: { 
        "content-type": "application/json",
        "x-admin-key": ADMIN_KEY
      },
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { id: string; key: string; scopes: string[] };
    expect(body.scopes).toContain("premium");
  });

  it("POST /api/admin/keys/admin creates an admin key with admin and premium scopes", async () => {
    const res = await fetch(`${baseUrl}/api/admin/keys/admin`, {
      method: "POST",
      headers: { 
        "content-type": "application/json",
        "x-admin-key": ADMIN_KEY
      },
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { id: string; key: string; scopes: string[] };
    expect(body.scopes).toContain("admin");
    expect(body.scopes).toContain("premium");
  });

  it("GET /api/dogs requires API key", async () => {
    const res = await fetch(`${baseUrl}/api/dogs`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid API key");
  });

  it("GET /api/dogs returns dog names with valid key", async () => {
    const key = createdKey?.key ?? "";
    expect(key).toBeTruthy();
    const res = await fetch(`${baseUrl}/api/dogs`, {
      headers: { "x-api-key": key },
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { dogs: string[]; count: number; plan: string };
    expect(Array.isArray(body.dogs)).toBe(true);
    expect(body.count).toBe(5); // Basic plan gets 5 dogs
    expect(body.plan).toBe("basic");
  });

  it("GET /api/dogs returns more dogs for pro users", async () => {
    const key = proKey?.key ?? "";
    expect(key).toBeTruthy();
    const res = await fetch(`${baseUrl}/api/dogs`, {
      headers: { "x-api-key": key },
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { dogs: string[]; count: number; plan: string };
    expect(Array.isArray(body.dogs)).toBe(true);
    expect(body.count).toBe(10); // Pro plan gets 10 dogs
    expect(body.plan).toBe("pro");
  });

  it("GET /api/dogs/facts requires premium scope", async () => {
    const key = createdKey?.key ?? "";
    expect(key).toBeTruthy();
    const res = await fetch(`${baseUrl}/api/dogs/facts`, {
      headers: { "x-api-key": key },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Insufficient permissions");
  });

  it("GET /api/dogs/facts works with premium key", async () => {
    const key = premiumKey?.key ?? "";
    expect(key).toBeTruthy();
    const res = await fetch(`${baseUrl}/api/dogs/facts`, {
      headers: { "x-api-key": key },
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { fact: string; category: string };
    expect(typeof body.fact).toBe("string");
    expect(body.category).toBe("premium");
  });

  it("POST /api/dogs/manage requires admin scope", async () => {
    const key = premiumKey?.key ?? "";
    expect(key).toBeTruthy();
    const res = await fetch(`${baseUrl}/api/dogs/manage`, {
      method: "POST",
      headers: { 
        "content-type": "application/json",
        "x-api-key": key
      },
      body: JSON.stringify({ action: "add", dogName: "TestDog" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Insufficient permissions");
  });

  it("POST /api/dogs/manage works with admin key", async () => {
    const key = adminKey?.key ?? "";
    expect(key).toBeTruthy();
    const res = await fetch(`${baseUrl}/api/dogs/manage`, {
      method: "POST",
      headers: { 
        "content-type": "application/json",
        "x-api-key": key
      },
      body: JSON.stringify({ action: "add", dogName: "TestDog" }),
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toContain("TestDog");
  });

  it("GET /api/admin/keys/:id returns key info", async () => {
    const keyId = createdKey?.id ?? "";
    expect(keyId).toBeTruthy();
    const res = await fetch(`${baseUrl}/api/admin/keys/${keyId}`, {
      headers: { "x-admin-key": ADMIN_KEY },
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { id: string; metadata: any };
    expect(body.id).toBe(keyId);
  });

  it("PUT /api/admin/keys/:id/enable enables a key", async () => {
    const keyId = createdKey?.id ?? "";
    expect(keyId).toBeTruthy();
    const res = await fetch(`${baseUrl}/api/admin/keys/${keyId}/enable`, {
      method: "PUT",
      headers: { "x-admin-key": ADMIN_KEY },
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { success: boolean; enabled: string };
    expect(body.success).toBe(true);
    expect(body.enabled).toBe(keyId);
  });

  it("PUT /api/admin/keys/:id/disable disables a key", async () => {
    const keyId = createdKey?.id ?? "";
    expect(keyId).toBeTruthy();
    const res = await fetch(`${baseUrl}/api/admin/keys/${keyId}/disable`, {
      method: "PUT",
      headers: { "x-admin-key": ADMIN_KEY },
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { success: boolean; disabled: string };
    expect(body.success).toBe(true);
    expect(body.disabled).toBe(keyId);
  });

  it("GET /api/admin/keys/:id/scopes returns scopes", async () => {
    const keyId = premiumKey?.id ?? "";
    expect(keyId).toBeTruthy();
    const res = await fetch(`${baseUrl}/api/admin/keys/${keyId}/scopes`, {
      headers: { "x-admin-key": ADMIN_KEY },
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { success: boolean; scopes: string[] };
    expect(body.success).toBe(true);
    expect(body.scopes).toContain("premium");
  });
});



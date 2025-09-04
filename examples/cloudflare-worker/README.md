## Cloudflare Worker Example

Serverless example for UsefulKey demonstrating API key management with Cloudflare's D1 and KV services.

### Setup

**Database**: D1 (via `D1KeyStore`)
**Rate Limiting**: Cloudflare KV (via `CloudflareKvRateLimitStore`)

### Prerequisites

- Cloudflare account with D1 database
- Cloudflare KV namespace
- Wrangler CLI configured

### How to Run

1. **Navigate to the example directory:**
   ```bash
   cd examples/cloudflare-worker
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Set up Cloudflare resources (optional for local development):**
   - Create a D1 database: `wrangler d1 create usefulkey-db`
   - Create a KV namespace: `wrangler kv:namespace create "RATE_LIMIT_KV"`
   - Update `wrangler.jsonc` with your resource IDs

4. **Start the development server:**
   ```bash
   pnpm dev
   ```

5. **Access the application:**
   The local development server will start on `http://localhost:8787`

**Note:** For local development, the example uses local D1 and KV simulators. For production deployment, use `pnpm deploy`.

### API Endpoints

**Public Endpoints:**
- `GET /health` - Health check
- `GET /api/dogs` - Get random dog names (requires API key)
- `GET /api/dogs/facts` - Premium dog facts (requires 'premium' scope)
- `POST /api/dogs/manage` - Admin dog management (requires 'admin' scope)

**Admin Endpoints (require `x-admin-key` header):**
- `POST /admin/keys` - Create API key
- `POST /admin/keys/pro` - Create pro key
- `POST /admin/keys/premium` - Create premium key with scopes
- `POST /admin/keys/admin` - Create admin key with full access
- `GET /admin/keys/:id` - Get key info
- `DELETE /admin/keys/:id` - Revoke key
- `PUT /admin/keys/:id/enable` - Enable key
- `PUT /admin/keys/:id/disable` - Disable key
- `PUT /admin/keys/:id/limits` - Set usage limits
- `GET/PUT/POST /admin/keys/:id/scopes/*` - Manage scopes

### Quick Start

```bash
# Create a pro key
KEY=$(curl -s -X POST http://localhost:8787/admin/keys/pro \
  -H "x-admin-key: admin-secret-key" | jq -r .key)

# Use the API
curl http://localhost:8787/api/dogs \
  -H "x-api-key: $KEY"
```



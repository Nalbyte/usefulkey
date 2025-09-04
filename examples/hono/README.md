## Hono Example

Hono framework example for UsefulKey demonstrating API key management with in-memory storage.

### Setup

**Storage**: In-Memory (via `MemoryKeyStore`)
**Rate Limiting**: In-memory (via `MemoryRateLimitStore`)

Perfect for development, testing, and simple deployments. Note that all data is lost when the server restarts.

### How to Run

1. **Navigate to the example directory:**
   ```bash
   cd examples/hono
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Set up environment variables (optional):**
   Create a `.env` file or set environment variables:
   ```bash
   KEY_PREFIX=uk                    # API key prefix (defaults to 'uk')
   ADMIN_KEY=admin-secret-key       # Admin key for protected endpoints (defaults to 'admin-secret-key')
   ```

4. **Start the development server:**
   ```bash
   pnpm dev
   ```

5. **Access the application:**
   The server will start on `http://localhost:8788`

**Note:** This example uses in-memory storage, so all data will be lost when the server restarts.

### Environment Variables

- `KEY_PREFIX` - API key prefix (defaults to `uk`)
- `ADMIN_KEY` - Admin key for protected endpoints (defaults to `admin-secret-key`)

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
KEY=$(curl -s -X POST http://localhost:8788/admin/keys/pro \
  -H "x-admin-key: admin-secret-key" | jq -r .key)

# Use the API
curl http://localhost:8788/api/dogs \
  -H "x-api-key: $KEY"
```






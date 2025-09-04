## Astro Example

Astro integration example for UsefulKey demonstrating API key management with production-ready adapters.

### Setup

**Database**: PostgreSQL (via `PostgresKeyStore`)
**Rate Limiting**: Redis (via `RedisRateLimitStore`)

### Prerequisites

- PostgreSQL database
- Redis instance
- Environment variables:
  ```bash
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/usefulkey
  REDIS_URL=redis://localhost:6379
  ADMIN_KEY=your-admin-secret-key
  ```

### How to Run

1. **Navigate to the example directory:**
   ```bash
   cd examples/astro
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Set up environment variables:**
   Create a `.env` file in the project root or set environment variables:
   ```bash
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/usefulkey
   REDIS_URL=redis://localhost:6379
   ADMIN_KEY=your-admin-secret-key
   ```

4. **Start the development server:**
   ```bash
   pnpm dev
   ```

5. **Access the application:**
   The server will start on `http://localhost:4321`

**Note:** Make sure PostgreSQL and Redis are running before starting the server.

### API Endpoints

**Public Endpoints:**
- `GET /api/health` - Health check
- `GET /api/dogs` - Get random dog names (requires API key)
- `GET /api/dogs/facts` - Premium dog facts (requires 'premium' scope)

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
KEY=$(curl -s -X POST http://localhost:4321/admin/keys/pro \
  -H "x-admin-key: admin-secret-key" | jq -r .key)

# Use the API
curl http://localhost:4321/api/dogs \
  -H "x-api-key: $KEY"
```

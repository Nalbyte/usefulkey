## Next.js Example

Next.js integration example for UsefulKey demonstrating API key management with SQLite persistence.

### Setup

**Database**: SQLite (via `SqliteKeyStore`)
**Rate Limiting**: In-memory (via `MemoryRateLimitStore`)

Perfect for development, testing, and production deployments requiring persistent API key storage.

### How to Run

1. **Navigate to the example directory:**
   ```bash
   cd examples/nextjs
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Set up environment variables (optional):**
   Create a `.env.local` file or set environment variables:
   ```bash
   DATABASE_URL=./usefulkey.db       # SQLite database file path (defaults to ./usefulkey.db)
   KEY_PREFIX=uk                     # API key prefix (defaults to 'uk')
   ```

4. **Start the development server:**
   ```bash
   pnpm dev
   ```

5. **Access the application:**
   - Web interface: `http://localhost:3000`
   - API endpoints: `http://localhost:3000/api/*`

**Note:** The example uses SQLite for persistent storage. The database file will be created automatically in the project root.

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
KEY=$(curl -s -X POST http://localhost:3000/admin/keys/pro \
  -H "x-admin-key: admin-secret-key" | jq -r .key)

# Use the API
curl http://localhost:3000/api/dogs \
  -H "x-api-key: $KEY"
```

### UI Usage

Visit `http://localhost:3000` to use the web interface for creating and testing API keys.

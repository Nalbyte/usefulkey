# UsefulKey

Open‑source, Self‑hostable, Typescript toolkit for API keys and rate limiting. Designed to be simple to adopt and easy to extend.

## Features

- Key generation with customizable prefixes and formats
- Pluggable storage and rate limit backends
- Plugin system for rate limiting, IP access control, usage limits, permissions/scopes, and enable/disable functionality
- Analytics for audit history and usage metrics
- Easy-to-extend architecture with custom plugins and adapters

## Install

```npm
npm i usefulkey
```

## Quick Start

### Initialize UsefulKey

Configure adapters and start with in-memory storage for development:

```ts
import { usefulkey, MemoryKeyStore, MemoryRateLimitStore, ConsoleAnalytics } from "usefulkey";

const uk = usefulkey({
  adapters: {
    keyStore: new MemoryKeyStore(),
    rateLimitStore: new MemoryRateLimitStore(),
    analytics: new ConsoleAnalytics(),
  },
});
```

### Add plugins

Plugins add behavior and may extend the UsefulKey instance:

```ts
const uk = usefulkey(
  {
    // ...config
  },
  {
    plugins: [
      // Rate limit default for all verifyKey calls
      // ratelimit({ default: { kind: "fixed", limit: 100, duration: "1m" } }),

      // IP access control with a static allow list
      // ipAccessControlStatic({ allow: ["1.1.1.1"] }),

      // Usage limits per key
      // usageLimitsPerKeyPlugin(),

      // Enable/disable keys
      // enableDisablePlugin(),

      // Permissions/scopes
      // permissionsScopesPlugin({ metadataKey: "scopes" }),
    ],
  }
);
```

### Basic create and verify

```ts
// Create a key
const { result: created } = await uk.createKey({ metadata: { plan: "free" } });

// created -> { id: "...", key: "...", metadata: { plan: "free" } }

// Verify the key (namespace required when ratelimit plugin is enabled)
const { result: verified } = await uk.verifyKey({
  key: created.key,
  namespace: "api"
});

// verified -> { valid: true, keyId: "...", metadata: { plan: "free" } }

// Get the key record (doesn't include plaintext key)
const { result: keyRecord } = await uk.getKey(created.key);

// Optionally wait for setup
await uk.ready;
```

## Why UsefulKey?

I built UsefulKey because I was tired of dealing with key management for each new project I created. The current solutions were overkill for what I actually needed. Most solutions were either not designed for just keys or tied to specific providers.

There are tons of great solutions out there, but most of them felt like overkill for what I actually needed.

UsefulKey is a simple library that does one thing - managing API keys without the hassle. It's lightweight and works with whatever infrastructure you're using.

## Concepts

### Plugins vs Adapters

**Quick mental model: Plugins decide what to do; Adapters decide where it goes.**

- **Plugins (features and policies)**
  - Extend UsefulKey's behavior without touching your infrastructure
  - Run at specific lifecycle points to allow/deny or update state
  - Can add typed properties or helpers to the `uk` instance
  - Examples: rate limiting, IP allow/deny, usage limits per key
  - Choose them per instance when you call `usefulkey(...)`

- **Adapters (infrastructure backends)**
  - Tell UsefulKey where and how to persist or send data
  - Implement interfaces for your stack: `KeyStoreAdapter`, `RateLimitStoreAdapter`, `AnalyticsAdapter`
  - Swap in Postgres/Redis/your own services instead of in-memory versions
  - Choose them once at boot via the `adapters` option

### Available Plugins

- **Rate Limit** - Global rate limiting for all verifyKey calls
- **IP Access Control** - Static, memory, or keystore-based IP allow/deny lists
- **Usage Limits per Key** - Track and limit usage per key
- **Enable/Disable** - Enable or disable keys
- **Permissions/Scopes** - Role-based access control

### Available Adapters

- **Key Store**: Memory, Drizzle, Postgres, MySQL, Redis, SQLite, Cloudflare D1, HTTP
- **Rate Limit Store**: Memory, Postgres, MySQL, Redis, SQLite, Cloudflare KV
- **Analytics**: Console, ClickHouse, Noop


## Writing Custom Plugins

```ts
import type { UsefulKeyPlugin } from "usefulkey";

export function myPlugin(): UsefulKeyPlugin<{ foo: string }> {
  return (ctx) => ({
    name: "my-plugin",
    setup() {
      // initialization
    },
    beforeVerify: async () => {
      // optional
    },
    // Extend the instance surface
    extend: { foo: "bar" },
  });
}
```
See the documentation for more information [here](https://usefulkey.nalbyte.com/docs/plugins/authoring).

## Key Hashing 

- Keys are one-way hashed (SHA-256 by default). Enable keyed hashing by setting `secret` in the UsefulKey config during init. 

## Documentation

For comprehensive documentation, examples, and API reference, visit the [docs](https://usefulkey.nalbyte.com).

## Contributing

We welcome contributions! Please see our [contributing guide](https://usefulkey.nalbyte.com/docs/additional-info/contributing) for details on how to get started. 

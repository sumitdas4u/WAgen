# WAgen Evolution Upgrade — Design Spec

**Date:** 2026-04-21  
**Status:** Approved  
**Reference:** Evolution API (`evolution-api/`) studied alongside WAgen (`WAgen/`)

---

## Overview

Add production-grade WhatsApp channel features to WAgen by adapting patterns from Evolution API while preserving WAgen's existing architecture:

1. Pairing code login as a QR alternative
2. Chunked typing simulation that respects WhatsApp presence expiry
3. Per-user proxy support for QR sessions
4. Event fanout across HTTP webhooks, WebSocket realtime, and RabbitMQ
5. Full inbound/outbound WhatsApp message persistence
6. SQL access-layer hardening around the existing `pg` pool architecture

**Approach:** SQL-first rollout on top of the current `pg` pool + `infra/migrations` stack.  
**Why:** WAgen already uses pool-based PostgreSQL access and a shared SQL migration runner. Introducing Prisma would create a second data-access architecture without solving a current product problem.

---

## Architecture Decision

### Chosen direction
WAgen remains on:
- PostgreSQL
- `pg` pool-based service access
- `withTransaction(...)` for multi-step writes
- SQL migrations in `infra/migrations`

### Not chosen
- Prisma client
- `schema.prisma`
- Prisma migrations
- mixed ORM + raw SQL architecture

### Design rule
When adapting Evolution API patterns:
- keep transport/runtime behavior where useful
- keep WAgen's SQL/pool persistence model
- prefer helper-based hardening over large data-layer rewrites

---

## Database Strategy

### Migration source of truth
All schema changes land in:
```text
infra/migrations/*.sql
```

### Runtime data access
Application services continue using:
```typescript
import { pool, withTransaction } from "../db/pool.js";
```

### Hardening helpers
To improve consistency without changing architecture, shared helpers are introduced:
```typescript
import { firstRow, requireRow, hasRows } from "../db/sql-helpers.js";
```

These helpers reduce unchecked `rows[0]` usage and make SQL result handling more explicit.

---

## Feature 1: Pairing Code Login

**What it is:** Instead of scanning a QR code, the user can enter a pairing code directly inside WhatsApp on their phone.

**Evolution API source:** `whatsapp.baileys.service.ts:376`

**WAgen implementation**

Route change (`apps/api/src/routes/whatsapp.ts`):
```typescript
const ConnectSchema = z.object({
  resetAuth: z.boolean().optional(),
  phoneNumber: z.string().optional()
}).partial().optional();
```

Session runtime change (`whatsapp-session-manager.ts`):
```typescript
interface SessionRuntime {
  socket: WASocket;
  qr: string | null;
  enabled: boolean;
  status: Exclude<QrChannelStatus, "degraded">;
  connectionId: number;
  phoneNumber: string | null;
}
```

Pairing code request on QR update:
```typescript
if (update.qr && runtime.phoneNumber) {
  await wait(1000);
  const code = await socket.requestPairingCode(runtime.phoneNumber);

  void fanoutEvent(userId, "pairing_code.updated", {
    code,
    phoneNumber: runtime.phoneNumber,
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });

  await pool.query(
    `UPDATE whatsapp_sessions
     SET pairing_code = $1,
         pairing_code_expires_at = $2
     WHERE user_id = $3`,
    [code, new Date(Date.now() + 60_000), userId]
  );
}
```

New route:
```text
GET /api/whatsapp/pairing-code
```

Schema addition via SQL migration:
- `whatsapp_sessions.pairing_code`
- `whatsapp_sessions.pairing_code_expires_at`

**Data flow**
```text
POST /api/whatsapp/connect { phoneNumber }
  -> connectUser(userId, { phoneNumber })
  -> Baileys socket emits qr
  -> requestPairingCode(phoneNumber)
  -> store pairing code in whatsapp_sessions
  -> fanoutEvent("pairing_code.updated")
  -> user enters code in WhatsApp
  -> connection opens normally
```

---

## Feature 2: Typing Simulation Upgrade

**Problem:** WhatsApp presence expires after about 20 seconds. A single long typing delay does not survive for realistic replies.

**WAgen implementation**

Typing helper in `whatsapp-session-manager.ts`:
```typescript
const PRESENCE_CHUNK_MS = 20_000;

export async function simulateTyping(
  sock: WASocket,
  jid: string,
  delayMs: number,
  presence: "composing" | "recording" = "composing"
): Promise<void> {
  let remaining = delayMs;

  while (remaining > PRESENCE_CHUNK_MS) {
    await sock.presenceSubscribe(jid);
    await sock.sendPresenceUpdate(presence, jid);
    await wait(PRESENCE_CHUNK_MS);
    await sock.sendPresenceUpdate("paused", jid);
    remaining -= PRESENCE_CHUNK_MS;
  }

  if (remaining > 0) {
    await sock.presenceSubscribe(jid);
    await sock.sendPresenceUpdate(presence, jid);
    await wait(remaining);
  }
}
```

**Behavior**
- full human reply delay is respected
- presence is renewed in chunks
- WAgen keeps its existing reply delay math, but removes the old short hard cap

---

## Feature 3: Per-User Proxy

**What it is:** Each user can configure an HTTP/HTTPS/SOCKS5 proxy for their WhatsApp QR session.

**Schema**
Added via SQL migration:
```text
whatsapp_proxies
  - id
  - user_id (unique)
  - enabled
  - protocol
  - host
  - port
  - username
  - password
```

Passwords are encrypted at rest using the same encryption utility pattern already used elsewhere in WAgen.

**Utility**
New file:
```text
apps/api/src/utils/makeProxyAgent.ts
```

It builds:
- `HttpsProxyAgent`
- `SocksProxyAgent`
- an Undici-compatible proxy config for fetch-style calls

**Session manager wiring**
Before creating the Baileys socket:
```typescript
const proxyRecord = await pool.query<...>(
  `SELECT protocol, host, port, username, password, enabled
   FROM whatsapp_proxies
   WHERE user_id = $1
   LIMIT 1`,
  [userId]
);
```

If enabled:
- decrypt password
- build proxy agent
- pass `agent` / `fetchAgent` into the Baileys socket config

**Routes**
```text
GET    /api/whatsapp/proxy
PUT    /api/whatsapp/proxy
DELETE /api/whatsapp/proxy
POST   /api/whatsapp/proxy/test
```

The proxy test route performs a real outbound check through the configured proxy and returns the resolved IP.

---

## Feature 4: Event Fanout

**What it is:** WhatsApp-related events fan out to every enabled output channel instead of only going to the in-process realtime hub.

### Fanout channels
- WebSocket via `realtimeHub`
- HTTP webhook delivery
- RabbitMQ publish

### Coordinator
New file:
```text
apps/api/src/services/event-fanout-service.ts
```

Core pattern:
```typescript
export async function fanoutEvent(
  userId: string,
  event: WagenEvent,
  payload: unknown
): Promise<void> {
  await Promise.allSettled([
    fanoutWebSocket(userId, event, payload),
    fanoutHttpWebhooks(userId, event, payload),
    fanoutRabbitMQ(userId, event, payload)
  ]);
}
```

### Event types
```typescript
type WagenEvent =
  | "messages.upsert"
  | "messages.update"
  | "messages.delete"
  | "connection.update"
  | "qrcode.updated"
  | "pairing_code.updated"
  | "status.instance"
  | "chats.upsert"
  | "chats.update"
  | "contacts.upsert"
  | "presence.update"
  | "call";
```

### Webhook persistence
Added via SQL migration:
```text
webhook_endpoints
webhook_delivery_logs
rabbitmq_configs
```

### HTTP webhook behavior
- `POST` to each configured endpoint
- `X-Wagen-Event` header
- optional `X-Wagen-Signature` HMAC-SHA256 header
- retry schedule: 1s -> 4s -> 16s
- timeout per attempt
- all attempts logged

### RabbitMQ behavior
- user-scoped config loaded from SQL
- lazy connection/channel creation
- routing key = event name
- stale channel removed on disconnect/error

### Wiring change
Existing direct `realtimeHub.broadcast(...)` calls in:
- `whatsapp-session-manager.ts`
- `meta-whatsapp-service.ts`

are replaced by:
```typescript
void fanoutEvent(userId, eventName, payload);
```

That makes WebSocket delivery an implementation detail of the fanout layer instead of the only event path.

### Routes
New files:
```text
apps/api/src/routes/webhooks.ts
apps/api/src/routes/rabbitmq.ts
```

Endpoints:
```text
GET/POST/PUT/DELETE /api/webhooks
GET /api/webhooks/:id/logs

GET/PUT/DELETE /api/rabbitmq
POST /api/rabbitmq/test
```

---

## Feature 5: Full Message Persistence

**What it is:** Every inbound and outbound WhatsApp QR message is persisted for history, chat list, and audit use cases.

### Schema
Added via SQL migration:
```text
whatsapp_messages
whatsapp_chats
```

### Storage rules

Inbound (`messages.upsert`):
- upsert message row by `(user_id, message_id)`
- update or create chat row by `(user_id, remote_jid)`
- increment unread count for inbound messages

Outbound (`sendAndRememberMessage`):
- persist sent message row after successful send
- keep existing in-memory outbound echo prevention

### Stored message shape
- message id
- remote JID
- from-me flag
- message type
- full JSON content
- extracted text/caption where available
- timestamp
- delivery status

### Routes
Added to `apps/api/src/routes/whatsapp.ts`:
```text
GET /api/whatsapp/chats
GET /api/whatsapp/messages/:jid
```

These routes read from the SQL persistence tables, not from live session memory.

---

## SQL Access-Layer Hardening

This upgrade also establishes a safer SQL access pattern for WAgen without changing architectures.

### Added helpers
```text
apps/api/src/db/sql-helpers.ts
apps/api/src/db/sql-types.ts
```

Main helpers:
```typescript
firstRow(result)
requireRow(result, message)
hasRows(result)
```

### Purpose
- reduce unchecked `result.rows[0]`
- make missing-row behavior explicit
- preserve SQL readability
- keep `withTransaction(...)` where transactional behavior matters

### Scope
Applied incrementally to service hotspots rather than forcing a repo-wide rewrite in one change.

---

## What Is Not Being Copied

| Evolution Feature | Reason Skipped |
|---|---|
| Prisma ORM | WAgen remains SQL/pool based |
| Amazon SQS | AWS-specific, not needed now |
| NATS | unnecessary operational complexity |
| Pusher | paid SaaS, overlaps with current realtime path |
| Chatwoot integration | WAgen already owns its own inbox/CRM |
| Evolution multi-instance container model | WAgen is user/session oriented, not instance oriented |

---

## Dependencies

```json
// apps/api/package.json additions
"amqplib": "^0.10.x",
"@types/amqplib": "^0.10.x",
"https-proxy-agent": "^7.x",
"socks-proxy-agent": "^8.x"
```

No Prisma dependencies are part of this design.

---

## File Structure After Changes

```text
apps/api/
├── src/
│   ├── db/
│   │   ├── pool.ts
│   │   ├── sql-helpers.ts
│   │   └── sql-types.ts
│   ├── services/
│   │   ├── whatsapp-session-manager.ts
│   │   ├── whatsapp-session-store.ts
│   │   ├── event-fanout-service.ts
│   │   ├── rabbitmq-service.ts
│   │   ├── webhook-delivery-service.ts
│   │   └── meta-whatsapp-service.ts
│   ├── utils/
│   │   └── makeProxyAgent.ts
│   └── routes/
│       ├── whatsapp.ts
│       ├── webhooks.ts
│       └── rabbitmq.ts
└── infra/
    └── migrations/
        └── 0056_whatsapp_evolution_features.sql
```

---

## Error Handling

| Scenario | Handling |
|---|---|
| Proxy unreachable | test endpoint returns failure; session connect path logs and surfaces status normally |
| Pairing code request fails | warning logged; QR flow remains available |
| Webhook delivery fails | retry 3x, log delivery failure, never block other channels |
| RabbitMQ disconnects | stale channel removed; reconnect on next publish |
| Message persistence fails | log error, do not block messaging flow |
| Duplicate persisted message | unique SQL constraint + upsert/idempotent logic handles safely |

---

## Testing Strategy

- Unit: `event-fanout-service.test.ts`
- Unit: `rabbitmq-service.test.ts`
- Unit: `webhook-delivery-service.test.ts`
- Unit: `simulate-typing.test.ts`
- Unit: `makeProxyAgent.test.ts`
- Unit: `whatsapp-session-manager-pairing.test.ts`
- Unit: `message-persistence.test.ts`
- Existing suite remains green under `npm run lint`, `npx vitest run`, and `npm run build`

---

## Rollout Order

1. SQL schema migration for new WhatsApp/webhook/rabbitmq/persistence tables
2. Pairing code login
3. Chunked typing simulation
4. Per-user proxy support
5. Full message persistence
6. Event fanout
7. SQL helper layer hardening on affected services

---

## Completeness Check

This spec is aligned with the implemented WAgen direction if the following remain true:
- no Prisma client is introduced into `apps/api`
- schema changes continue through `infra/migrations`
- services continue to use `pool` / `withTransaction`
- fanout remains coordinated through `event-fanout-service.ts`
- WhatsApp message history continues reading from SQL persistence tables

If any future change introduces Prisma, this document should be split or replaced rather than partially mixed.

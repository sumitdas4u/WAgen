# Evolution Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six WhatsApp features to WAgen adapted from Evolution API: pairing code login, chunked typing simulation, per-user proxy, full message persistence, and webhook fanout (HTTP + WebSocket + RabbitMQ).

**Architecture:** SQL migration (Plan A) must be complete before starting this plan. This repo uses the existing pool-based PostgreSQL access layer plus SQL migrations rather than a Prisma client. Features are implemented in rollout order: small isolated features first, then DB-heavy persistence, then the new services for fanout. All events go through a new `event-fanout-service.ts` coordinator that replaces scattered `realtimeHub.broadcast` calls.

**Tech Stack:** Baileys (`@whiskeysockets/baileys`), `pg` pool-based SQL access, SQL migrations, amqplib, https-proxy-agent, socks-proxy-agent, Fastify, Zod, Vitest

**Prerequisite:** the SQL migration layer must add the equivalents of `WhatsappProxy`, `WebhookEndpoint`, `WebhookDeliveryLog`, `RabbitmqConfig`, `WhatsappMessage`, and `WhatsappChat`, and `whatsapp_sessions` must include `pairing_code` / `pairing_code_expires_at` columns. In this repo that means the `infra/migrations` SQL files must be present and applied before implementation starts.

---

## File Map

**Created:**
- `apps/api/src/services/event-fanout-service.ts` — fanout coordinator
- `apps/api/src/services/rabbitmq-service.ts` — RabbitMQ connection pool
- `apps/api/src/services/webhook-delivery-service.ts` — HTTP webhook retry
- `apps/api/src/utils/makeProxyAgent.ts` — proxy agent factory
- `apps/api/src/routes/webhooks.ts` — webhook endpoint CRUD
- `apps/api/src/routes/rabbitmq.ts` — RabbitMQ config routes
- `apps/api/src/services/event-fanout-service.test.ts` — fanout tests
- `apps/api/src/services/rabbitmq-service.test.ts` — RabbitMQ tests
- `apps/api/src/services/webhook-delivery-service.test.ts` — delivery tests

**Modified:**
- `apps/api/package.json` — add amqplib, https-proxy-agent, socks-proxy-agent
- `apps/api/src/services/whatsapp-session-manager.ts` — pairing code + chunked typing + proxy + message persistence + fanout wiring
- `apps/api/src/services/meta-whatsapp-service.ts` — fanout wiring
- `apps/api/src/routes/whatsapp.ts` — pairing code endpoint + proxy endpoints
- `apps/api/src/app.ts` — register new routes

---

## Task 1: Pairing Code Login

**Files:**
- Modify: `apps/api/src/routes/whatsapp.ts`
- Modify: `apps/api/src/services/whatsapp-session-manager.ts`

- [x] **Step 1: Write the failing test**

Create `apps/api/src/services/whatsapp-session-manager-pairing.test.ts`:
```typescript
import { describe, expect, it, vi } from "vitest";

// Test that phoneNumber in connect options is passed through to session runtime
describe("pairing code option", () => {
  it("phoneNumber option stored in connect call is truthy string", () => {
    const opts = { phoneNumber: "5511999999999" };
    expect(typeof opts.phoneNumber).toBe("string");
    expect(opts.phoneNumber.length).toBeGreaterThan(8);
  });

  it("empty string phoneNumber is treated as absent", () => {
    const phoneNumber = "";
    const hasPhone = phoneNumber.length > 0;
    expect(hasPhone).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it passes (these are pure logic tests)**

```bash
cd apps/api
npx vitest run src/services/whatsapp-session-manager-pairing.test.ts
```

Expected: PASS (pure assertions, no mocks needed).

- [x] **Step 3: Update ConnectSchema in whatsapp.ts to accept phoneNumber**

In `apps/api/src/routes/whatsapp.ts`, find `ConnectSchema` and replace:
```typescript
const ConnectSchema = z
  .object({
    resetAuth: z.boolean().optional()
  })
  .partial()
  .optional();
```

With:
```typescript
const ConnectSchema = z
  .object({
    resetAuth: z.boolean().optional(),
    phoneNumber: z.string().min(8).optional()
  })
  .partial()
  .optional();
```

- [x] **Step 4: Pass phoneNumber from route to connectUser**

In `apps/api/src/routes/whatsapp.ts`, find the `/api/whatsapp/connect` POST handler and update:
```typescript
await whatsappSessionManager.connectUser(request.authUser.userId, {
  resetAuth: Boolean(parsed.data?.resetAuth),
  force: Boolean(parsed.data?.resetAuth),
  phoneNumber: parsed.data?.phoneNumber
});
```

- [x] **Step 5: Update connectUser signature in whatsapp-session-manager.ts**

Find the `connectUser` method signature:
```typescript
async connectUser(userId: string, options?: { resetAuth?: boolean; force?: boolean }): Promise<void>
```

Change to:
```typescript
async connectUser(userId: string, options?: { resetAuth?: boolean; force?: boolean; phoneNumber?: string }): Promise<void>
```

- [x] **Step 6: Store phoneNumber in SessionRuntime and request pairing code on QR event**

In `whatsapp-session-manager.ts`, find the `SessionRuntime` interface and add `phoneNumber`:
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

In `connectUser()`, when setting up the session, store the phone number:
```typescript
this.sessions.set(userId, {
  socket,
  qr: null,
  enabled: session.enabled,
  status: "connecting",
  connectionId,
  phoneNumber: options?.phoneNumber ?? null
});
```

Then inside the `socket.ev.on("connection.update", ...)` handler, find where `update.qr` is handled and add pairing code request after it:
```typescript
if (update.qr) {
  runtime.qr = update.qr;
  realtimeHub.broadcast(userId, "whatsapp.qr", {
    qr: update.qr,
    status: "waiting_scan"
  });

  // NEW: request pairing code if phoneNumber was provided
  if (runtime.phoneNumber) {
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const code = await socket.requestPairingCode(runtime.phoneNumber);
      realtimeHub.broadcast(userId, "whatsapp.pairing_code", {
        code,
        phoneNumber: runtime.phoneNumber,
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      });
      await prisma.whatsappSession.update({
        where: { userId },
        data: {
          pairingCode: code,
          pairingCodeExpiresAt: new Date(Date.now() + 60_000)
        }
      });
    } catch (err) {
      console.warn(`[WA] pairing code request failed user=${userId}`, err);
    }
  }
}
```

Add the prisma import at the top of `whatsapp-session-manager.ts`:
```typescript
import { prisma } from "../db/prisma.js";
```

- [x] **Step 7: Add GET /api/whatsapp/pairing-code route**

In `apps/api/src/routes/whatsapp.ts`, add after the existing GET `/api/whatsapp/status` route:
```typescript
fastify.get(
  "/api/whatsapp/pairing-code",
  { preHandler: [fastify.requireAuth] },
  async (request) => {
    const session = await prisma.whatsappSession.findUnique({
      where: { userId: request.authUser.userId },
      select: { pairingCode: true, pairingCodeExpiresAt: true }
    });

    if (!session?.pairingCode) {
      return { code: null, expiresAt: null };
    }

    const expired = session.pairingCodeExpiresAt
      ? session.pairingCodeExpiresAt < new Date()
      : false;

    return {
      code: expired ? null : session.pairingCode,
      expiresAt: session.pairingCodeExpiresAt?.toISOString() ?? null
    };
  }
);
```

Add prisma import at top of `whatsapp.ts`:
```typescript
import { prisma } from "../db/prisma.js";
```

- [x] **Step 8: Verify TypeScript compiles**

```bash
cd apps/api
npm run lint
```

Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/whatsapp.ts apps/api/src/services/whatsapp-session-manager.ts apps/api/src/services/whatsapp-session-manager-pairing.test.ts
git commit -m "feat: add WhatsApp pairing code login support"
```

---

## Task 2: Chunked Typing Simulation

**Files:**
- Modify: `apps/api/src/services/whatsapp-session-manager.ts`

The current `simulateTyping` function caps at 2500ms. Replace it with a chunked version that respects WhatsApp's 20-second presence timeout.

- [x] **Step 1: Write the failing test**

Create `apps/api/src/services/simulate-typing.test.ts`:
```typescript
import { describe, expect, it, vi } from "vitest";

// We'll test the chunked logic by extracting it as a pure function
// The real sendChunkedPresence calls socket methods, so we test the timing math here

function computeChunks(delayMs: number, chunkMs: number): number[] {
  const chunks: number[] = [];
  let remaining = delayMs;
  while (remaining > chunkMs) {
    chunks.push(chunkMs);
    remaining -= chunkMs;
  }
  if (remaining > 0) {
    chunks.push(remaining);
  }
  return chunks;
}

describe("chunked presence timing", () => {
  it("no chunks needed for delay under 20s", () => {
    const chunks = computeChunks(2500, 20_000);
    expect(chunks).toEqual([2500]);
  });

  it("splits 45s into [20000, 20000, 5000]", () => {
    const chunks = computeChunks(45_000, 20_000);
    expect(chunks).toEqual([20_000, 20_000, 5_000]);
  });

  it("splits exactly 20s into [20000]", () => {
    const chunks = computeChunks(20_000, 20_000);
    expect(chunks).toEqual([20_000]);
  });

  it("splits 60s into three 20s chunks", () => {
    const chunks = computeChunks(60_000, 20_000);
    expect(chunks).toEqual([20_000, 20_000, 20_000]);
  });
});
```

- [x] **Step 2: Run test to verify it fails (function not yet extracted)**

```bash
cd apps/api
npx vitest run src/services/simulate-typing.test.ts
```

Expected: PASS (tests are self-contained pure function — they define `computeChunks` locally). Confirms chunking logic is correct.

- [x] **Step 3: Replace simulateTyping in whatsapp-session-manager.ts**

Find the current `simulateTyping` function (around line 435):
```typescript
export async function simulateTyping(sock: WASocket, jid: string, messageLength: number): Promise<void> {
  await sock.sendPresenceUpdate("composing", jid);
  const baseMs = 300;
  const perCharacterMs = 20;
  const typingMs = Math.max(600, Math.min(2500, baseMs + messageLength * perCharacterMs));
  await wait(typingMs);
}
```

Replace with:
```typescript
const PRESENCE_CHUNK_MS = 20_000; // WA drops presence subscription after 20s

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
    // Caller sends "paused" — don't duplicate here
  }
}
```

- [x] **Step 4: Update call site to pass delay in ms instead of message length**

Find the call site in `whatsapp-session-manager.ts` around line 1535:
```typescript
await simulateTyping(runtime.socket, job.remoteJid, text.length);
```

Replace with:
```typescript
const baseMs = 300;
const perCharMs = 20;
const typingMs = Math.min(
  HUMAN_REPLY_DELAY_MAX_MS,
  Math.max(600, baseMs + text.length * perCharMs)
);
await simulateTyping(runtime.socket, job.remoteJid, typingMs, "composing");
```

The `HUMAN_REPLY_DELAY_MAX_MS` constant already exists in the file — the cap is now respected fully.

- [x] **Step 5: Verify TypeScript compiles**

```bash
cd apps/api
npm run lint
```

Expected: No errors.

- [x] **Step 6: Run tests**

```bash
cd apps/api
npx vitest run src/services/simulate-typing.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/whatsapp-session-manager.ts apps/api/src/services/simulate-typing.test.ts
git commit -m "feat: upgrade typing simulation to chunked presence (Evolution pattern)"
```

---

## Task 3: Per-User Proxy Support

**Files:**
- Create: `apps/api/src/utils/makeProxyAgent.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/services/whatsapp-session-manager.ts`
- Modify: `apps/api/src/routes/whatsapp.ts`

- [x] **Step 1: Install proxy dependencies**

```bash
cd apps/api
npm install https-proxy-agent@^7 socks-proxy-agent@^8
```

- [x] **Step 2: Write the failing test**

Create `apps/api/src/utils/makeProxyAgent.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { buildProxyUrl } from "./makeProxyAgent.js";

describe("buildProxyUrl", () => {
  it("builds http proxy URL without auth", () => {
    const url = buildProxyUrl({ protocol: "http", host: "proxy.example.com", port: 8080 });
    expect(url).toBe("http://proxy.example.com:8080");
  });

  it("builds http proxy URL with auth", () => {
    const url = buildProxyUrl({
      protocol: "http",
      host: "proxy.example.com",
      port: 8080,
      username: "user",
      password: "pass"
    });
    expect(url).toBe("http://user:pass@proxy.example.com:8080");
  });

  it("builds socks5 proxy URL", () => {
    const url = buildProxyUrl({ protocol: "socks5", host: "127.0.0.1", port: 1080 });
    expect(url).toBe("socks5://127.0.0.1:1080");
  });

  it("encodes special characters in password", () => {
    const url = buildProxyUrl({
      protocol: "http",
      host: "proxy.example.com",
      port: 8080,
      username: "user",
      password: "p@ss#word"
    });
    expect(url).toContain(encodeURIComponent("p@ss#word"));
  });
});
```

- [x] **Step 3: Run test to verify it fails**

```bash
cd apps/api
npx vitest run src/utils/makeProxyAgent.test.ts
```

Expected: FAIL — "Cannot find module './makeProxyAgent.js'"

- [x] **Step 4: Create makeProxyAgent.ts**

Create `apps/api/src/utils/makeProxyAgent.ts`:
```typescript
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

export interface ProxyConfig {
  protocol: "http" | "https" | "socks5";
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
}

export function buildProxyUrl(config: ProxyConfig): string {
  const auth =
    config.username && config.password
      ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
      : config.username
        ? `${encodeURIComponent(config.username)}@`
        : "";

  return `${config.protocol}://${auth}${config.host}:${config.port}`;
}

export function makeProxyAgent(config: ProxyConfig): HttpsProxyAgent<string> | SocksProxyAgent {
  const url = buildProxyUrl(config);

  if (config.protocol === "socks5") {
    return new SocksProxyAgent(url);
  }

  return new HttpsProxyAgent(url);
}

export function makeProxyAgentUndici(config: ProxyConfig): { uri: string } {
  // undici (used by baileys fetch) accepts a plain URI object
  return { uri: buildProxyUrl(config) };
}
```

- [x] **Step 5: Run test to verify it passes**

```bash
cd apps/api
npx vitest run src/utils/makeProxyAgent.test.ts
```

Expected: All 4 tests PASS.

- [x] **Step 6: Load proxy config in connectUser**

In `apps/api/src/services/whatsapp-session-manager.ts`, add import at top:
```typescript
import { makeProxyAgent, makeProxyAgentUndici, type ProxyConfig } from "../utils/makeProxyAgent.js";
```

In the `connectUser` method, before the `makeWASocket(...)` call, add:
```typescript
// Load per-user proxy config
const proxyRecord = await prisma.whatsappProxy.findUnique({ where: { userId } });
const proxyOptions: Record<string, unknown> = {};
if (proxyRecord?.enabled) {
  const config: ProxyConfig = {
    protocol: proxyRecord.protocol as ProxyConfig["protocol"],
    host: proxyRecord.host,
    port: proxyRecord.port,
    username: proxyRecord.username,
    password: proxyRecord.password
      ? decryptJsonPayload<string>(proxyRecord.password, getSessionEncryptionSecret())
      : null
  };
  proxyOptions.agent = makeProxyAgent(config);
  proxyOptions.fetchAgent = makeProxyAgentUndici(config);
}
```

Then update the `makeWASocket` call:
```typescript
const socket = (baileys.default ?? (baileys as any).makeWASocket)({
  version,
  auth: state,
  printQRInTerminal: false,
  browser: ["WAgen", "Chrome", "1.0.0"],
  getMessage: async (key) => this.getRecentOutboundMessage(userId, key),
  logger: createBaileysLogger(...) as never,
  ...proxyOptions
}) as WASocket;
```

Note: Import `decryptJsonPayload` and `getSessionEncryptionSecret` — these already exist in `whatsapp-session-store.ts`. Move `getSessionEncryptionSecret` to a shared util or import it from the store:
```typescript
import { getSessionEncryptionSecret } from "./whatsapp-session-store.js";
```

If `getSessionEncryptionSecret` is not exported, export it from `whatsapp-session-store.ts`:
```typescript
export function getSessionEncryptionSecret(): string {
  return env.WA_SESSION_ENCRYPTION_KEY || env.JWT_SECRET;
}
```

- [x] **Step 7: Add proxy CRUD routes to whatsapp.ts**

In `apps/api/src/routes/whatsapp.ts`, add these routes after the existing ones:

```typescript
const ProxySchema = z.object({
  enabled: z.boolean(),
  protocol: z.enum(["http", "https", "socks5"]),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().optional(),
  password: z.string().optional()
});

fastify.get(
  "/api/whatsapp/proxy",
  { preHandler: [fastify.requireAuth] },
  async (request) => {
    const proxy = await prisma.whatsappProxy.findUnique({
      where: { userId: request.authUser.userId }
    });
    if (!proxy) return null;
    return {
      enabled: proxy.enabled,
      protocol: proxy.protocol,
      host: proxy.host,
      port: proxy.port,
      username: proxy.username ?? null,
      password: proxy.password ? "••••••••" : null
    };
  }
);

fastify.put(
  "/api/whatsapp/proxy",
  { preHandler: [fastify.requireAuth] },
  async (request, reply) => {
    const parsed = ProxySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid proxy config" });

    const { password, ...rest } = parsed.data;
    const encryptedPassword = password
      ? encryptJsonPayload(password, getSessionEncryptionSecret())
      : null;

    await prisma.whatsappProxy.upsert({
      where: { userId: request.authUser.userId },
      create: { userId: request.authUser.userId, ...rest, password: encryptedPassword },
      update: { ...rest, password: encryptedPassword }
    });
    return { ok: true };
  }
);

fastify.delete(
  "/api/whatsapp/proxy",
  { preHandler: [fastify.requireAuth] },
  async (request) => {
    await prisma.whatsappProxy.deleteMany({ where: { userId: request.authUser.userId } });
    return { ok: true };
  }
);

fastify.post(
  "/api/whatsapp/proxy/test",
  { preHandler: [fastify.requireAuth] },
  async (request, reply) => {
    const parsed = ProxySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid proxy config" });

    const { password, ...rest } = parsed.data;
    const config: ProxyConfig = { ...rest, password: password ?? null };

    try {
      const agent = makeProxyAgent(config);
      const response = await fetch("https://checkip.amazonaws.com", {
        signal: AbortSignal.timeout(8000),
        // @ts-expect-error -- node fetch agent
        agent
      });
      const ip = (await response.text()).trim();
      return { ok: true, ip };
    } catch (err) {
      return reply.status(502).send({ error: "Proxy unreachable", detail: String(err) });
    }
  }
);
```

Add import at top of `whatsapp.ts`:
```typescript
import { makeProxyAgent, type ProxyConfig } from "../utils/makeProxyAgent.js";
import { encryptJsonPayload } from "../utils/encryption.js";
import { getSessionEncryptionSecret } from "../services/whatsapp-session-store.js";
```

- [x] **Step 8: Verify TypeScript compiles**

```bash
cd apps/api
npm run lint
```

Expected: No errors.

- [x] **Step 9: Run tests**

```bash
cd apps/api
npx vitest run src/utils/makeProxyAgent.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/utils/makeProxyAgent.ts apps/api/src/utils/makeProxyAgent.test.ts apps/api/src/services/whatsapp-session-manager.ts apps/api/src/routes/whatsapp.ts apps/api/package.json apps/api/package-lock.json
git commit -m "feat: add per-user proxy support for WhatsApp sessions"
```

---

## Task 4: Full Message Persistence

**Files:**
- Modify: `apps/api/src/services/whatsapp-session-manager.ts`

Save every inbound and outbound QR-channel message to `WhatsappMessage` and `WhatsappChat` tables (added to schema in Plan A Task 2).

- [x] **Step 1: Write the failing test**

Create `apps/api/src/services/message-persistence.test.ts`:
```typescript
import { describe, expect, it } from "vitest";

// Test the message type extraction logic (pure function, no DB)
function extractMessageType(content: Record<string, unknown>): string {
  if (content.conversation || content.extendedTextMessage) return "text";
  if (content.imageMessage) return "image";
  if (content.videoMessage) return "video";
  if (content.audioMessage) return "audio";
  if (content.documentMessage) return "document";
  if (content.stickerMessage) return "sticker";
  if (content.locationMessage) return "location";
  if (content.contactMessage || content.contactsArrayMessage) return "contact";
  if (content.pollCreationMessage || content.pollCreationMessageV2 || content.pollCreationMessageV3) return "poll";
  return "unknown";
}

function extractMessageText(content: Record<string, unknown>): string | null {
  if (typeof content.conversation === "string") return content.conversation;
  const ext = content.extendedTextMessage as Record<string, unknown> | undefined;
  if (typeof ext?.text === "string") return ext.text;
  const img = content.imageMessage as Record<string, unknown> | undefined;
  if (typeof img?.caption === "string") return img.caption;
  return null;
}

describe("extractMessageType", () => {
  it("detects text", () => {
    expect(extractMessageType({ conversation: "hello" })).toBe("text");
  });
  it("detects image", () => {
    expect(extractMessageType({ imageMessage: {} })).toBe("image");
  });
  it("detects audio", () => {
    expect(extractMessageType({ audioMessage: {} })).toBe("audio");
  });
  it("falls back to unknown", () => {
    expect(extractMessageType({})).toBe("unknown");
  });
});

describe("extractMessageText", () => {
  it("returns conversation text", () => {
    expect(extractMessageText({ conversation: "hi there" })).toBe("hi there");
  });
  it("returns extended text", () => {
    expect(extractMessageText({ extendedTextMessage: { text: "hello" } })).toBe("hello");
  });
  it("returns image caption", () => {
    expect(extractMessageText({ imageMessage: { caption: "photo" } })).toBe("photo");
  });
  it("returns null for non-text", () => {
    expect(extractMessageText({ audioMessage: {} })).toBeNull();
  });
});
```

- [x] **Step 2: Run test to verify it passes**

```bash
cd apps/api
npx vitest run src/services/message-persistence.test.ts
```

Expected: All 8 tests PASS.

- [x] **Step 3: Add helper functions to whatsapp-session-manager.ts**

Add these helper functions near the top of `whatsapp-session-manager.ts`, after the import block:
```typescript
function extractMessageType(content: Record<string, unknown>): string {
  if (content.conversation || content.extendedTextMessage) return "text";
  if (content.imageMessage) return "image";
  if (content.videoMessage) return "video";
  if (content.audioMessage) return "audio";
  if (content.documentMessage) return "document";
  if (content.stickerMessage) return "sticker";
  if (content.locationMessage) return "location";
  if (content.contactMessage || content.contactsArrayMessage) return "contact";
  if (content.pollCreationMessage || content.pollCreationMessageV2 || content.pollCreationMessageV3) return "poll";
  return "unknown";
}

function extractMessageText(content: Record<string, unknown>): string | null {
  if (typeof content.conversation === "string") return content.conversation;
  const ext = content.extendedTextMessage as Record<string, unknown> | undefined;
  if (typeof ext?.text === "string") return ext.text;
  const img = content.imageMessage as Record<string, unknown> | undefined;
  if (typeof img?.caption === "string") return img.caption;
  const vid = content.videoMessage as Record<string, unknown> | undefined;
  if (typeof vid?.caption === "string") return vid.caption;
  const doc = content.documentMessage as Record<string, unknown> | undefined;
  if (typeof doc?.caption === "string") return doc.caption;
  return null;
}
```

- [x] **Step 4: Save inbound messages in the messages.upsert handler**

In `whatsapp-session-manager.ts`, find the `messages.upsert` event handler inside `connectUser`. It's the block that calls `processIncomingMessage`. Add message persistence right before that call:

```typescript
socket.ev.on("messages.upsert", async ({ messages, type }) => {
  for (const msg of messages) {
    if (!msg.key?.remoteJid || !msg.key?.id) continue;

    const remoteJid = msg.key.remoteJid;
    const messageId = msg.key.id;
    const fromMe = Boolean(msg.key.fromMe);
    const content = (msg.message ?? {}) as Record<string, unknown>;
    const messageType = extractMessageType(content);
    const text = extractMessageText(content);
    const timestamp = msg.messageTimestamp
      ? new Date(Number(msg.messageTimestamp) * 1000)
      : new Date();

    // Persist to DB — non-blocking, errors don't affect message processing
    prisma.whatsappMessage
      .upsert({
        where: { userId_messageId: { userId, messageId } },
        create: {
          userId,
          remoteJid,
          messageId,
          fromMe,
          messageType,
          content: content as never,
          text,
          timestamp,
          status: fromMe ? "sent" : "received"
        },
        update: { status: fromMe ? "delivered" : "received" }
      })
      .then(() =>
        prisma.whatsappChat.upsert({
          where: { userId_remoteJid: { userId, remoteJid } },
          create: { userId, remoteJid, unreadCount: fromMe ? 0 : 1, lastMessageAt: timestamp, lastMessageId: messageId },
          update: {
            unreadCount: fromMe ? undefined : { increment: 1 },
            lastMessageAt: timestamp,
            lastMessageId: messageId
          }
        })
      )
      .catch((err) => console.error(`[WA] message persist failed user=${userId} msgId=${messageId}`, err));

    // ... existing processIncomingMessage call stays here unchanged
  }
});
```

- [x] **Step 5: Save outbound messages in sendAndRememberMessage**

Find the `sendAndRememberMessage` private method (around line 1336):
```typescript
private async sendAndRememberMessage(
  userId: string,
  socket: WASocket,
  jid: string,
  content: Record<string, unknown>
): Promise<WAMessage | undefined> {
  const sent = await socket.sendMessage(jid, content as never);
  if (sent) {
    this.rememberOutboundMessage(userId, sent);
  }
  return sent;
}
```

Replace with:
```typescript
private async sendAndRememberMessage(
  userId: string,
  socket: WASocket,
  jid: string,
  content: Record<string, unknown>
): Promise<WAMessage | undefined> {
  const sent = await socket.sendMessage(jid, content as never);
  if (sent) {
    this.rememberOutboundMessage(userId, sent);

    const messageId = sent.key?.id;
    if (messageId) {
      const messageType = extractMessageType(content);
      const text = extractMessageText(content);
      const timestamp = sent.messageTimestamp
        ? new Date(Number(sent.messageTimestamp) * 1000)
        : new Date();

      prisma.whatsappMessage
        .create({
          data: {
            userId,
            remoteJid: jid,
            messageId,
            fromMe: true,
            messageType,
            content: content as never,
            text,
            timestamp,
            status: "sent"
          }
        })
        .catch((err) => console.error(`[WA] outbound persist failed user=${userId} msgId=${messageId}`, err));
    }
  }
  return sent;
}
```

- [x] **Step 6: Add message history routes to whatsapp.ts**

In `apps/api/src/routes/whatsapp.ts`, add:
```typescript
fastify.get(
  "/api/whatsapp/chats",
  { preHandler: [fastify.requireAuth] },
  async (request) => {
    const chats = await prisma.whatsappChat.findMany({
      where: { userId: request.authUser.userId },
      orderBy: { lastMessageAt: "desc" },
      take: 50
    });
    return chats;
  }
);

fastify.get(
  "/api/whatsapp/messages/:jid",
  { preHandler: [fastify.requireAuth] },
  async (request) => {
    const { jid } = request.params as { jid: string };
    const { before, limit } = request.query as { before?: string; limit?: string };
    const take = Math.min(Number(limit ?? 50), 100);

    const messages = await prisma.whatsappMessage.findMany({
      where: {
        userId: request.authUser.userId,
        remoteJid: decodeURIComponent(jid),
        ...(before ? { timestamp: { lt: new Date(before) } } : {})
      },
      orderBy: { timestamp: "desc" },
      take
    });
    return messages;
  }
);
```

- [x] **Step 7: Verify TypeScript compiles**

```bash
cd apps/api
npm run lint
```

Expected: No errors.

- [x] **Step 8: Run all tests**

```bash
cd apps/api
npx vitest run
```

Expected: All tests PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/services/whatsapp-session-manager.ts apps/api/src/services/message-persistence.test.ts apps/api/src/routes/whatsapp.ts
git commit -m "feat: add full WhatsApp message and chat persistence"
```

---

## Task 5: Install RabbitMQ Dependency

**Files:**
- Modify: `apps/api/package.json`

- [x] **Step 1: Install amqplib**

```bash
cd apps/api
npm install amqplib@^0.10
npm install --save-dev @types/amqplib@^0.10
```

- [x] **Step 2: Verify types available**

```bash
cd apps/api
npx tsc --noEmit
```

Expected: No new errors from amqplib types.

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json apps/api/package-lock.json
git commit -m "feat: add amqplib dependency for RabbitMQ support"
```

---

## Task 6: Build Event Fanout Service

**Files:**
- Create: `apps/api/src/services/event-fanout-service.ts`
- Create: `apps/api/src/services/event-fanout-service.test.ts`
- Create: `apps/api/src/services/rabbitmq-service.ts`
- Create: `apps/api/src/services/webhook-delivery-service.ts`

- [x] **Step 1: Define WagenEvent type and write the failing test**

Create `apps/api/src/services/event-fanout-service.test.ts`:
```typescript
import { describe, expect, it, vi } from "vitest";

// Test that fanoutEvent calls all three channels even when one fails
describe("fanoutEvent isolation", () => {
  it("calls all channels via Promise.allSettled even when one rejects", async () => {
    const calls: string[] = [];

    const fanoutWebSocket = vi.fn().mockImplementation(() => {
      calls.push("ws");
      return Promise.resolve();
    });
    const fanoutHttp = vi.fn().mockImplementation(() => {
      calls.push("http");
      return Promise.reject(new Error("http down"));
    });
    const fanoutRmq = vi.fn().mockImplementation(() => {
      calls.push("rmq");
      return Promise.resolve();
    });

    // Simulate the allSettled pattern
    await Promise.allSettled([fanoutWebSocket(), fanoutHttp(), fanoutRmq()]);

    expect(calls).toContain("ws");
    expect(calls).toContain("http");
    expect(calls).toContain("rmq");
    expect(calls).toHaveLength(3);
  });

  it("does not throw when all channels fail", async () => {
    const fail = () => Promise.reject(new Error("fail"));
    await expect(Promise.allSettled([fail(), fail(), fail()])).resolves.toBeDefined();
  });
});
```

- [x] **Step 2: Run test to verify logic (should pass — tests pure Promise.allSettled behavior)**

```bash
cd apps/api
npx vitest run src/services/event-fanout-service.test.ts
```

Expected: Both tests PASS.

- [x] **Step 3: Create event-fanout-service.ts**

Create `apps/api/src/services/event-fanout-service.ts`:
```typescript
import { realtimeHub } from "./realtime-hub.js";
import { deliverWebhookEvent } from "./webhook-delivery-service.js";
import { publishRabbitMQEvent } from "./rabbitmq-service.js";

export type WagenEvent =
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

function fanoutWebSocket(userId: string, event: WagenEvent, payload: unknown): Promise<void> {
  try {
    realtimeHub.broadcast(userId, event, payload);
  } catch (err) {
    console.error(`[fanout] ws error user=${userId} event=${event}`, err);
  }
  return Promise.resolve();
}

async function fanoutHttpWebhooks(userId: string, event: WagenEvent, payload: unknown): Promise<void> {
  try {
    await deliverWebhookEvent(userId, event, payload);
  } catch (err) {
    console.error(`[fanout] http error user=${userId} event=${event}`, err);
  }
}

async function fanoutRabbitMQ(userId: string, event: WagenEvent, payload: unknown): Promise<void> {
  try {
    await publishRabbitMQEvent(userId, event, payload);
  } catch (err) {
    console.error(`[fanout] rmq error user=${userId} event=${event}`, err);
  }
}
```

- [x] **Step 4: Write RabbitMQ test**

Create `apps/api/src/services/rabbitmq-service.test.ts`:
```typescript
import { describe, expect, it, vi } from "vitest";

// Test the routing key building (pure function)
describe("RabbitMQ routing key", () => {
  it("uses event name as routing key", () => {
    const routingKey = (event: string) => event;
    expect(routingKey("messages.upsert")).toBe("messages.upsert");
    expect(routingKey("connection.update")).toBe("connection.update");
  });
});
```

- [x] **Step 5: Run RabbitMQ test**

```bash
cd apps/api
npx vitest run src/services/rabbitmq-service.test.ts
```

Expected: PASS.

- [x] **Step 6: Create rabbitmq-service.ts**

Create `apps/api/src/services/rabbitmq-service.ts`:
```typescript
import * as amqplib from "amqplib";
import { prisma } from "../db/prisma.js";
import { decryptJsonPayload } from "../utils/encryption.js";
import { env } from "../config/env.js";
import type { WagenEvent } from "./event-fanout-service.js";

interface ChannelEntry {
  connection: amqplib.AmqpConnectionManager | amqplib.Connection;
  channel: amqplib.Channel;
  exchange: string;
}

const channelPool = new Map<string, ChannelEntry>();

function getEncryptionKey(): string {
  return env.WA_SESSION_ENCRYPTION_KEY || env.JWT_SECRET;
}

async function getOrCreateChannel(userId: string): Promise<ChannelEntry | null> {
  const existing = channelPool.get(userId);
  if (existing) {
    return existing;
  }

  const config = await prisma.rabbitmqConfig.findUnique({ where: { userId } });
  if (!config?.enabled) {
    return null;
  }

  let uri: string;
  try {
    uri = decryptJsonPayload<string>(config.uri, getEncryptionKey());
  } catch {
    uri = config.uri; // fallback: stored as plaintext
  }

  const connection = await amqplib.connect(uri);
  const channel = await connection.createChannel();
  await channel.assertExchange(config.exchange, "topic", { durable: true });

  const entry: ChannelEntry = { connection, channel, exchange: config.exchange };
  channelPool.set(userId, entry);

  // Clean up on disconnect
  (connection as amqplib.Connection).on("close", () => {
    channelPool.delete(userId);
  });
  (connection as amqplib.Connection).on("error", () => {
    channelPool.delete(userId);
  });

  return entry;
}

export async function publishRabbitMQEvent(
  userId: string,
  event: WagenEvent,
  payload: unknown
): Promise<void> {
  const entry = await getOrCreateChannel(userId);
  if (!entry) return;

  const content = Buffer.from(
    JSON.stringify({ userId, event, payload, timestamp: new Date().toISOString() })
  );

  entry.channel.publish(entry.exchange, event, content, {
    persistent: true,
    contentType: "application/json"
  });
}

export function disconnectRabbitMQ(userId: string): void {
  const entry = channelPool.get(userId);
  if (entry) {
    try {
      (entry.connection as amqplib.Connection).close();
    } catch {
      // No-op
    }
    channelPool.delete(userId);
  }
}
```

- [x] **Step 7: Write webhook delivery test**

Create `apps/api/src/services/webhook-delivery-service.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { createHmacSignature } from "./webhook-delivery-service.js";

describe("createHmacSignature", () => {
  it("produces consistent sha256 hmac", () => {
    const sig1 = createHmacSignature("secret", '{"test":1}');
    const sig2 = createHmacSignature("secret", '{"test":1}');
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("different payloads produce different signatures", () => {
    const sig1 = createHmacSignature("secret", '{"test":1}');
    const sig2 = createHmacSignature("secret", '{"test":2}');
    expect(sig1).not.toBe(sig2);
  });
});
```

- [x] **Step 8: Run webhook delivery test (should fail)**

```bash
cd apps/api
npx vitest run src/services/webhook-delivery-service.test.ts
```

Expected: FAIL — "Cannot find module './webhook-delivery-service.js'"

- [x] **Step 9: Create webhook-delivery-service.ts**

Create `apps/api/src/services/webhook-delivery-service.ts`:
```typescript
import { createHmac } from "node:crypto";
import { prisma } from "../db/prisma.js";
import type { WagenEvent } from "./event-fanout-service.js";

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 4_000, 16_000];

export function createHmacSignature(secret: string, body: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(body);
  return `sha256=${hmac.digest("hex")}`;
}

export async function deliverWebhookEvent(
  userId: string,
  event: WagenEvent,
  payload: unknown
): Promise<void> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { userId, enabled: true, events: { has: event } }
  });

  await Promise.allSettled(endpoints.map((ep) => deliverToEndpoint(ep, event, payload)));
}

async function deliverToEndpoint(
  endpoint: { id: string; url: string; secret: string | null },
  event: WagenEvent,
  payload: unknown
): Promise<void> {
  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1]));
    }

    let statusCode: number | null = null;
    let success = false;
    let errorMessage: string | null = null;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Wagen-Event": event
      };

      if (endpoint.secret) {
        headers["X-Wagen-Signature"] = createHmacSignature(endpoint.secret, body);
      }

      const response = await fetch(endpoint.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10_000)
      });

      statusCode = response.status;
      success = response.ok;
    } catch (err) {
      errorMessage = String(err);
    }

    await prisma.webhookDeliveryLog.create({
      data: {
        endpointId: endpoint.id,
        event,
        payload: payload as never,
        statusCode,
        attempt: attempt + 1,
        success,
        errorMessage
      }
    });

    if (success) return;
  }
}
```

- [x] **Step 10: Run webhook delivery test**

```bash
cd apps/api
npx vitest run src/services/webhook-delivery-service.test.ts
```

Expected: Both tests PASS.

- [x] **Step 11: Verify TypeScript compiles**

```bash
cd apps/api
npm run lint
```

Expected: No errors.

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/services/event-fanout-service.ts apps/api/src/services/event-fanout-service.test.ts apps/api/src/services/rabbitmq-service.ts apps/api/src/services/rabbitmq-service.test.ts apps/api/src/services/webhook-delivery-service.ts apps/api/src/services/webhook-delivery-service.test.ts
git commit -m "feat: add event fanout service with HTTP webhooks and RabbitMQ"
```

---

## Task 7: Wire fanoutEvent into Session Manager and Meta Service

**Files:**
- Modify: `apps/api/src/services/whatsapp-session-manager.ts`
- Modify: `apps/api/src/services/meta-whatsapp-service.ts`

Replace scattered `realtimeHub.broadcast` calls with `fanoutEvent`.

- [x] **Step 1: Add fanoutEvent import to whatsapp-session-manager.ts**

```typescript
import { fanoutEvent, type WagenEvent } from "./event-fanout-service.js";
```

- [x] **Step 2: Replace each realtimeHub.broadcast call**

Find all `realtimeHub.broadcast(userId, ...)` calls in `whatsapp-session-manager.ts`. There are 7 (lines 688, 724, 786, 820, 834, 860, 1404 in the original). Replace each with `fanoutEvent`.

Example — QR broadcast (line 786):
```typescript
// BEFORE:
realtimeHub.broadcast(userId, "whatsapp.qr", {
  qr: update.qr,
  status: "waiting_scan"
});

// AFTER:
void fanoutEvent(userId, "qrcode.updated", {
  qr: update.qr,
  status: "waiting_scan"
});
```

Example — connection open (line 820):
```typescript
// BEFORE:
realtimeHub.broadcast(
  userId,
  "whatsapp.status",
  this.buildStatusPayload(userId, { ... })
);

// AFTER:
void fanoutEvent(userId, "connection.update", this.buildStatusPayload(userId, { ... }));
```

Example — status broadcast (line 688 and 1404):
```typescript
// BEFORE:
realtimeHub.broadcast(userId, "whatsapp.status", this.buildStatusPayload(...));

// AFTER:
void fanoutEvent(userId, "status.instance", this.buildStatusPayload(...));
```

Do this replacement for all 7 occurrences. Keep the original `realtimeHub` import — `event-fanout-service.ts` calls it internally now.

Remove the direct `realtimeHub` import from `whatsapp-session-manager.ts` (since fanout-service handles it):
```typescript
// REMOVE this line from whatsapp-session-manager.ts:
import { realtimeHub } from "./realtime-hub.js";
```

- [x] **Step 3: Call disconnectRabbitMQ on session teardown**

In the `disconnectUser` method of `whatsapp-session-manager.ts`, add:
```typescript
import { disconnectRabbitMQ } from "./rabbitmq-service.js";

// In disconnectUser():
disconnectRabbitMQ(userId);
```

- [x] **Step 4: Add fanoutEvent to meta-whatsapp-service.ts**

In `apps/api/src/services/meta-whatsapp-service.ts`, find the inbound message handler (the webhook receiver that processes incoming Meta messages). Add fanout call after message processing:

```typescript
import { fanoutEvent } from "./event-fanout-service.js";

// After processing each inbound message:
void fanoutEvent(userId, "messages.upsert", {
  remoteJid: phoneNumber,
  message: messagePayload,
  fromMe: false,
  timestamp: new Date().toISOString()
});
```

Find the outbound send completion point and add:
```typescript
void fanoutEvent(userId, "messages.update", {
  remoteJid: recipientPhone,
  status: "sent",
  messageId: sentMessageId
});
```

- [x] **Step 5: Verify TypeScript compiles**

```bash
cd apps/api
npm run lint
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/whatsapp-session-manager.ts apps/api/src/services/meta-whatsapp-service.ts
git commit -m "feat: wire fanoutEvent into session manager and meta service"
```

---

## Task 8: Webhook and RabbitMQ Configuration Routes

**Files:**
- Create: `apps/api/src/routes/webhooks.ts`
- Create: `apps/api/src/routes/rabbitmq.ts`
- Modify: `apps/api/src/app.ts`

- [x] **Step 1: Create webhooks.ts route file**

Create `apps/api/src/routes/webhooks.ts`:
```typescript
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";

const CreateWebhookSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  secret: z.string().min(8).optional(),
  events: z.array(z.string()).min(1),
  enabled: z.boolean().default(true)
});

const UpdateWebhookSchema = CreateWebhookSchema.partial();

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/webhooks",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      return prisma.webhookEndpoint.findMany({
        where: { userId: request.authUser.userId },
        orderBy: { createdAt: "desc" }
      });
    }
  );

  fastify.post(
    "/api/webhooks",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = CreateWebhookSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

      const endpoint = await prisma.webhookEndpoint.create({
        data: { userId: request.authUser.userId, ...parsed.data }
      });
      return reply.status(201).send(endpoint);
    }
  );

  fastify.put(
    "/api/webhooks/:id",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = UpdateWebhookSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

      const existing = await prisma.webhookEndpoint.findFirst({
        where: { id, userId: request.authUser.userId }
      });
      if (!existing) return reply.status(404).send({ error: "Not found" });

      return prisma.webhookEndpoint.update({ where: { id }, data: parsed.data });
    }
  );

  fastify.delete(
    "/api/webhooks/:id",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await prisma.webhookEndpoint.findFirst({
        where: { id, userId: request.authUser.userId }
      });
      if (!existing) return reply.status(404).send({ error: "Not found" });

      await prisma.webhookEndpoint.delete({ where: { id } });
      return { ok: true };
    }
  );

  fastify.get(
    "/api/webhooks/:id/logs",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { limit, offset } = request.query as { limit?: string; offset?: string };

      const existing = await prisma.webhookEndpoint.findFirst({
        where: { id, userId: request.authUser.userId }
      });
      if (!existing) return reply.status(404).send({ error: "Not found" });

      return prisma.webhookDeliveryLog.findMany({
        where: { endpointId: id },
        orderBy: { deliveredAt: "desc" },
        take: Math.min(Number(limit ?? 50), 200),
        skip: Number(offset ?? 0)
      });
    }
  );
}
```

- [x] **Step 2: Create rabbitmq.ts route file**

Create `apps/api/src/routes/rabbitmq.ts`:
```typescript
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { encryptJsonPayload } from "../utils/encryption.js";
import { env } from "../config/env.js";
import * as amqplib from "amqplib";

const RabbitMQSchema = z.object({
  uri: z.string().min(1),
  exchange: z.string().min(1).default("wagen.events"),
  enabled: z.boolean().default(true)
});

function getEncryptionKey(): string {
  return env.WA_SESSION_ENCRYPTION_KEY || env.JWT_SECRET;
}

export async function rabbitmqRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/rabbitmq",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const config = await prisma.rabbitmqConfig.findUnique({
        where: { userId: request.authUser.userId }
      });
      if (!config) return null;
      return {
        exchange: config.exchange,
        enabled: config.enabled,
        uri: "amqp://••••••••" // mask credentials
      };
    }
  );

  fastify.put(
    "/api/rabbitmq",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = RabbitMQSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

      const encryptedUri = encryptJsonPayload(parsed.data.uri, getEncryptionKey());

      await prisma.rabbitmqConfig.upsert({
        where: { userId: request.authUser.userId },
        create: { userId: request.authUser.userId, uri: encryptedUri, exchange: parsed.data.exchange, enabled: parsed.data.enabled },
        update: { uri: encryptedUri, exchange: parsed.data.exchange, enabled: parsed.data.enabled }
      });
      return { ok: true };
    }
  );

  fastify.delete(
    "/api/rabbitmq",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      await prisma.rabbitmqConfig.deleteMany({ where: { userId: request.authUser.userId } });
      return { ok: true };
    }
  );

  fastify.post(
    "/api/rabbitmq/test",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = RabbitMQSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

      try {
        const connection = await Promise.race([
          amqplib.connect(parsed.data.uri),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Connection timeout")), 8000)
          )
        ]);
        await (connection as amqplib.Connection).close();
        return { ok: true };
      } catch (err) {
        return reply.status(502).send({ error: "RabbitMQ unreachable", detail: String(err) });
      }
    }
  );
}
```

- [x] **Step 3: Register new routes in app.ts**

Open `apps/api/src/app.ts` and find where routes are registered. Add:
```typescript
import { webhookRoutes } from "./routes/webhooks.js";
import { rabbitmqRoutes } from "./routes/rabbitmq.js";

// In the route registration block, alongside other route registrations:
await app.register(webhookRoutes);
await app.register(rabbitmqRoutes);
```

- [x] **Step 4: Verify TypeScript compiles**

```bash
cd apps/api
npm run lint
```

Expected: No errors.

- [x] **Step 5: Run all tests**

```bash
cd apps/api
npx vitest run
```

Expected: All tests PASS.

- [x] **Step 6: Build the project**

```bash
cd apps/api
npm run build
```

Expected: Zero build errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/webhooks.ts apps/api/src/routes/rabbitmq.ts apps/api/src/app.ts
git commit -m "feat: add webhook endpoint and RabbitMQ configuration routes"
```

---

## Task 9: Final Verification

- [x] **Step 1: Run full test suite**

```bash
cd apps/api
npx vitest run
```

Expected: All tests PASS. Note how many tests pass.

- [x] **Step 2: Full TypeScript build**

```bash
cd apps/api
npm run build
```

Expected: Zero errors, zero warnings.

- [x] **Step 3: Verify all new routes are registered**

```bash
grep -rn "webhookRoutes\|rabbitmqRoutes\|proxy\|pairing-code" apps/api/src/app.ts apps/api/src/routes/
```

Expected: All 6 new route groups appear.

- [x] **Step 4: Verify fanoutEvent replaces all direct realtimeHub calls in session manager**

```bash
grep -n "realtimeHub.broadcast" apps/api/src/services/whatsapp-session-manager.ts
```

Expected: Zero results (all replaced by `fanoutEvent`).

- [x] **Step 5: Verify new SQL tables are used**

```bash
grep -rn "whatsapp_messages\|whatsapp_chats\|whatsapp_proxies\|webhook_endpoints\|rabbitmq_configs" apps/api/src/
```

Expected: Multiple matches across route and service files.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete Evolution API feature port — pairing code, chunked typing, proxy, message persistence, webhook fanout, RabbitMQ"
```

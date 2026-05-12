# WAgen Codebase — VAPT Report

**Assessment Date:** 2026-05-09
**Scope:** `WAgen/` monorepo — API (`apps/api`), Web frontend (`apps/web`), Nginx reverse proxy
**Methodology:** Static Application Security Testing (SAST) — source code review
**Classification:** Confidential

---

## Executive Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 5 |
| Medium | 6 |
| Low / Informational | 7 |
| **Total** | **20** |

The application is broadly well-structured: parameterized SQL queries prevent SQLi, Zod validation is applied consistently at most endpoints, AES-256-GCM is used for encryption, and JWT authentication is enforced site-wide. The most significant risks are an **unfiltered SSRF in the API-Request flow block**, **AI provider secrets stored unencrypted in the database**, and **X-Forwarded-For spoofing** on the rate-limiter. Several medium-severity issues relate to missing HTTP security headers and inconsistent parameter validation.

---

## CRITICAL

---

### [C-1] Server-Side Request Forgery (SSRF) — API Request Flow Block

**File:** `apps/api/src/services/flow-blocks/basic/api-request.ts` (lines 289–322)
**CVSS v3:** 9.1 (AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H)

**Description:**
The `apiRequest` block performs an outbound `fetch()` using a URL that is entirely user-controlled (stored in flow node data, rendered via template interpolation). There is zero filtering on the resolved URL — no blocklist for private IP ranges, no URL scheme restriction, and no hostname allowlist.

```ts
// api-request.ts:289-317
const url = interpolate(String(context.node.data.url ?? ""), context.vars).trim();
// ...
const response = await fetch(url, { method, headers, body: requestBody, signal: controller.signal });
```

An authenticated user can configure a flow node with `url: http://169.254.169.254/latest/meta-data/` (AWS IMDSv1), `http://localhost:5432` (internal DB), `http://redis:6379`, or any other internal service. The API will faithfully make the request from the server's network context and return the response body into a flow variable, which can then be exfiltrated to a third-party API in the next node.

**Impact:** Full cloud-metadata credential theft, internal service enumeration, data exfiltration from any service reachable from the container network.

**Remediation:**
```ts
import { URL } from "node:url";
import dns from "node:dns/promises";

const BLOCKED_NETS = [
  /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, /^::1$/, /^fc/, /^fd/
];

async function isSsrfUrl(raw: string): Promise<boolean> {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return true; }
  if (!["http:", "https:"].includes(parsed.protocol)) return true;
  const addresses = await dns.lookup(parsed.hostname, { all: true });
  return addresses.some(({ address }) => BLOCKED_NETS.some(r => r.test(address)));
}
```

Invoke before the `fetch()` call and return an error signal instead of throwing.

---

### [C-2] AI Provider API Keys Stored Unencrypted in Database

**File:** `apps/api/src/services/ai-service.ts` (lines 77–103)
**CVSS v3:** 8.8 (AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N)

**Description:**
The active AI provider configuration — including the raw API key for OpenAI, Anthropic, or Gemini — is stored as plain JSON in the `app_settings` table:

```ts
// ai-service.ts:213-219
await pool.query(
  `INSERT INTO app_settings (key, value_json, updated_at)
   VALUES ('ai_provider_config', $1::jsonb, NOW()) ...`,
  [JSON.stringify(config)]   // { provider, apiKey, model }
);
```

A SQL injection in any other route, a DB backup exposure, a read replica leak, or any `SELECT * FROM app_settings` access returns the live API key in plaintext.

**Impact:** Complete compromise of the linked AI provider account. Attacker can run up billing, exfiltrate all embeddings/model access, or enumerate the knowledge base.

**Remediation:** Encrypt the `apiKey` field before persisting, using the same `encryptJsonPayload` / `WA_SESSION_ENCRYPTION_KEY` pattern already in use for WhatsApp session keys and webhook secrets.

---

## HIGH

---

### [H-1] Weak API Key Hashing (SHA-256, No Salt)

**File:** `apps/api/src/services/api-key-service.ts` (lines 37–39)
**CVSS v3:** 7.5 (AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:N)

**Description:**
API keys are hashed with raw SHA-256 without a salt:

```ts
function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}
```

SHA-256 is a fast digest — ~10⁹ hashes/second on a GPU. If the `user_api_keys` table is exfiltrated via a breach, all stored hashes can be cracked offline at high speed. The `key_prefix` (first 12 chars) is stored in plaintext, further narrowing the search space for targeted attacks.

**Remediation:** Use HMAC-SHA256 with a server-side secret as the hashing key:
```ts
import { createHmac } from "node:crypto";
const hashKey = (raw: string) =>
  createHmac("sha256", env.JWT_SECRET).update(raw).digest("hex");
```

---

### [H-2] Rate Limiter IP Spoofing via X-Forwarded-For

**File:** `apps/api/src/app.ts` (lines 138–144)
**CVSS v3:** 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H)

**Description:**
The rate limiter key generator trusts the first value of the `X-Forwarded-For` header:

```ts
keyGenerator: (req) =>
  (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip
```

Any attacker can send `X-Forwarded-For: 1.2.3.4` and bypass per-IP limits, effectively disabling the global rate limiter entirely. This enables credential brute-force, API abuse, and DoS.

**Remediation:** Trust only the last IP added by the infrastructure proxy:
```ts
const app = Fastify({ trustProxy: 1 }); // req.ip is now de-spoofed
// keyGenerator: (req) => req.ip
```

---

### [H-3] Missing Security Headers (Nginx)

**File:** `apps/web/nginx.conf`
**CVSS v3:** 7.4 (AV:N/AC:L/PR:N/UI:R/S:C/C:H/I:L/A:N)

**Description:**
The Nginx configuration sets no security response headers. No `Content-Security-Policy`, no `X-Frame-Options`, no `X-Content-Type-Options`, no `Strict-Transport-Security`, no `Referrer-Policy`. Exposes users to clickjacking, MIME sniffing, protocol downgrade, and referrer leakage.

**Remediation:** Add to the `server` block:
```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' wss:;" always;
```

---

### [H-4] Unvalidated Route Parameters in delivery.ts and webhooks.ts

**Files:** `apps/api/src/routes/delivery.ts` (line 139), `apps/api/src/routes/webhooks.ts` (line 74)
**CVSS v3:** 6.5 (AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:N)

**Description:**
Several route handlers extract path parameters with bare type casts without UUID/format validation:

```ts
// delivery.ts:139
const { alertId } = request.params as { alertId: string };
const alert = await resolveDeliveryAlert(request.authUser.userId, alertId);

// webhooks.ts:74
const { id } = request.params as { id: string };
// passed directly to: WHERE id = $1 AND user_id = $2
```

Malformed IDs cause PostgreSQL UUID cast errors, returning 500s that leak DB schema. Compare with `agents.ts` which correctly uses `z.string().uuid()`.

**Remediation:**
```ts
const IdParamSchema = z.object({ alertId: z.string().uuid() });
const params = IdParamSchema.safeParse(request.params);
if (!params.success) return reply.status(400).send({ error: "Invalid ID" });
```

---

### [H-5] Webhook URL SSRF

**File:** `apps/api/src/routes/webhooks.ts` (lines 7–13)
**CVSS v3:** 7.3 (AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:L/A:N)

**Description:**
Webhook endpoints accept a URL with only `z.string().url()` validation, which accepts `http://localhost`, `http://10.0.0.1`, etc.:

```ts
const CreateWebhookSchema = z.object({
  url: z.string().url(),   // no SSRF filter
  ...
});
```

When the webhook delivery service dispatches events, it POSTs to the stored URL from the server's network context — a second SSRF vector.

**Remediation:** Apply the same SSRF hostname blocklist (see C-1 remediation) when a webhook is created or updated.

---

## MEDIUM

---

### [M-1] Encryption Key Derived via Raw SHA-256 (No KDF)

**File:** `apps/api/src/utils/encryption.ts` (lines 6–8)
**CVSS v3:** 5.9

**Description:**
AES-256-GCM key derived from secret via single SHA-256 with no salt or iterations:

```ts
function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}
```

Low-entropy secrets are trivially brute-forceable offline. NIST recommends PBKDF2, scrypt, or Argon2 for password-to-key derivation.

**Remediation:**
```ts
import { scryptSync } from "node:crypto";
// fixed per-deployment salt stored in env
function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, 32);
}
```

---

### [M-2] JWT Has No Revocation Mechanism

**File:** `apps/api/src/app.ts` (lines 178–199)
**CVSS v3:** 5.5

**Description:**
`requireAuth` validates JWTs cryptographically but maintains no revocation list. Issued tokens remain valid until expiry regardless of password reset, account compromise, or admin logout. No `jti` tracking, no session store check.

**Remediation:** Add a `jti` claim to issued tokens; maintain a Redis set of revoked `jti` values with TTL equal to token expiry. Check on every `requireAuth` call.

---

### [M-3] Inconsistent Auth Accessor in contact-fields.ts

**File:** `apps/api/src/routes/contact-fields.ts` (line 31)
**CVSS v3:** 4.3

**Description:**
GET handler uses a fragile manual cast instead of the standard accessor:

```ts
// contact-fields.ts:31 — non-standard, bypasses TypeScript safety
const userId = (request as { user: { userId: string } }).user.userId;

// Standard pattern used everywhere else:
request.authUser.userId
```

Silently returns `undefined` for `userId` if middleware changes, potentially leaking all user records.

**Remediation:** Replace all instances in this file with `request.authUser.userId`.

---

### [M-4] postMessage Origin Defaults to `"*"` on Misconfiguration

**File:** `apps/api/src/services/google-auth-service.ts` (lines 195–201)
**CVSS v3:** 5.4

**Description:**
Google OAuth popup page sends JWT token via `postMessage`. If `APP_BASE_URL` is malformed or unset, `appOrigin` falls back to `"*"`:

```ts
try {
  return new URL(env.APP_BASE_URL).origin;
} catch {
  return "*";   // ← broadcasts token to ANY window
}
```

Any malicious cross-origin window with a reference to the opener can steal the JWT.

**Remediation:** Fail hard instead of falling back:
```ts
if (!env.APP_BASE_URL) throw new Error("APP_BASE_URL must be set");
const appOrigin = new URL(env.APP_BASE_URL).origin;
```

---

### [M-5] Webhook Log Pagination Without Schema Validation

**File:** `apps/api/src/routes/webhooks.ts` (lines 132–159)
**CVSS v3:** 4.3

**Description:**
`limit` and `offset` extracted from query params with raw `Number()`, no Zod validation:

```ts
const { limit, offset } = request.query as { limit?: string; offset?: string };
[id, Math.min(Number(limit ?? 50), 200), Number(offset ?? 0)]
```

`Number("abc")` = `NaN` → PostgreSQL rejects with 500 leaking query structure. `offset=-1` causes unexpected DB behavior.

**Remediation:**
```ts
const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});
```

---

### [M-6] Error Messages Leak Internal Details

**File:** `apps/api/src/app.ts` (lines 305–313)
**CVSS v3:** 4.0

**Description:**
Global error handler returns raw `error.message` to the client for all unhandled errors:

```ts
const message = error instanceof Error ? error.message : "Internal server error";
reply.status(statusCode).send({ error: message });
```

PostgreSQL constraint names, column names, table names, and third-party API details forwarded verbatim to HTTP clients.

**Remediation:** Log full error server-side. Return generic `"Internal server error"` to clients for all non-domain errors. Only `AiTokensDepletedError` / `PlanLimitExceededError` should have structured client responses.

---

## LOW / INFORMATIONAL

---

### [L-1] Default / Placeholder Secrets in .env.example

**File:** `apps/api/.env.example`

`SUPER_ADMIN_PASSWORD=change-this-password`, `META_PHONE_REGISTRATION_PIN=123456`, `JWT_SECRET=replace_with_a_long_random_secret`. If copied as-is to production, these are trivially exploitable. Enforce non-default values at startup via env schema validation.

---

### [L-2] WhatsApp Auth State Cache Has No Eviction

**File:** `apps/api/src/services/baileys-auth-state.ts` (line 17)

`authStateCache` is an unbounded `Map<string, StoredAuthState>` with no TTL or size limit. Grows indefinitely, holding decrypted WhatsApp session credentials in heap. Use a bounded LRU or TTL-based eviction.

---

### [L-3] Agent Number Cache Uses Unsynchronized Module-Level State

**File:** `apps/api/src/services/agent-loop-guard-service.ts` (lines 5–7)

Module-level mutable cache variables without a lock. In clustered deployments, each worker has a stale independent cache, which can cause bot loop detection to fail.

---

### [L-4] API Key Prefix Stored in Plaintext

**File:** `apps/api/src/services/api-key-service.ts` (line 47)

First 12 characters of API keys stored as `key_prefix` in the DB. If the table is breached, partial keys assist rainbow table attacks. The prefix is not functionally required in the DB.

---

### [L-5] Nginx Proxy Timeout Excessively High

**File:** `apps/web/nginx.conf` (lines 41–42)

`proxy_read_timeout 600s` for all routes including non-streaming endpoints. Attacker can hold open connections for 10 minutes, consuming Nginx worker slots. Reduce to 30–60s for non-streaming routes.

---

### [L-6] Content-Type Not Validated on File Uploads

**File:** `apps/api/src/app.ts` (lines 127–131)

Multipart plugin allows 20MB uploads with no MIME type filter at registration. File type validation via magic byte check should be enforced at handler level.

---

### [L-7] AI Provider Fallback Silently Routes to OpenAI

**File:** `apps/api/src/services/ai-service.ts` (lines 97–101)

When DB is unavailable, `loadProviderConfig` silently falls back to env-configured OpenAI key regardless of the admin's provider choice. Can route production traffic to OpenAI unexpectedly (billing and data-privacy implications). Should log a warning on fallback.

---

## Remediation Priority

| Priority | Issues | Estimated Effort |
|----------|--------|-----------------|
| **Immediate** | C-1 (SSRF flow block), C-2 (unencrypted AI keys), H-2 (rate limit spoofing) | 1–2 days |
| **Short-term** | H-1 (key hashing), H-3 (security headers), H-4 (param validation), H-5 (webhook SSRF) | 2–3 days |
| **Medium-term** | M-1 (KDF), M-2 (JWT revocation), M-3 (auth pattern), M-4 (postMessage), M-5 (pagination validation), M-6 (error leakage) | 3–5 days |
| **Backlog** | L-1 through L-7 | 1–2 days |

---

## Positive Security Findings

The following security controls were observed to be correctly implemented:

- **Parameterized SQL** — all visible DB queries use `$1/$2` placeholders; no string concatenation
- **AES-256-GCM with random IV** — correct algorithm, proper auth tag handling, versioned ciphertext format
- **Impersonation read-only restriction** — `requireAuth` blocks write methods for impersonated tokens
- **Zod schema validation** — consistently applied at API boundaries for most routes
- **User-scoped DB queries** — all resource queries include `user_id = $N` constraints, preventing IDOR
- **API key ownership check** — revoke/list operations verify `user_id` before acting
- **Google OAuth state CSRF protection** — encrypted state with 15-minute expiry
- **Webhook secret masking** — `sanitizeWebhookRow` returns `"********"` instead of the secret
- **Development reset guard** — `reset-db-dev.ts` checks `NODE_ENV !== production` AND `ALLOW_DB_RESET=true`
- **Bot loop detection** — implemented with configurable keywords and time windows

---

*Report generated from static source analysis on 2026-05-09. Dynamic testing (runtime fuzzing, network scanning, authenticated penetration testing) is recommended to validate exploitability of the findings above.*

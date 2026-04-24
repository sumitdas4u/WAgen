# SQL Pool Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep WAgen on the existing `pg` pool-based SQL access layer, while making it safer, more typed, more maintainable, and easier to extend for future development.

**Architecture:** Preserve the current PostgreSQL + `pool.query()` service architecture and the existing SQL migration runner in `infra/migrations/`. Do not introduce Prisma. Instead, standardize query patterns, centralize row mapping, keep `withTransaction` for multi-step writes, and move repeated SQL into small reusable repository-style helpers where it reduces duplication.

**Tech Stack:** `pg`, PostgreSQL, SQL migrations in `infra/migrations/`, TypeScript ESM (NodeNext modules), Vitest

**Completion Note:** Implementation and verification were completed in one consolidated SQL-hardening pass. The per-task commit checkpoints below were satisfied by a single focused close-out commit rather than one commit per task.

---

## File Map

**Created:**
- `apps/api/src/db/sql-helpers.ts` — shared SQL row/nullable/transaction helpers
- `apps/api/src/db/sql-types.ts` — common row type helpers for timestamp/json coercion
- `apps/api/src/db/repositories/` — optional focused repository helpers for repeated query patterns
- `apps/api/src/services/__tests__/` additions where pure SQL-adjacent helpers can be tested without DB dependency

**Modified:**
- `apps/api/src/db/pool.ts` — keep pool + `withTransaction`, add guidance comments if needed
- `apps/api/src/services/whatsapp-session-store.ts`
- `apps/api/src/services/user-service.ts`
- `apps/api/src/services/admin-service.ts`
- `apps/api/src/services/conversation-service.ts`
- `apps/api/src/services/conversation-notes-service.ts`
- `apps/api/src/services/conversation-insight-service.ts`
- `apps/api/src/services/message-router-service.ts`
- `apps/api/src/services/message-delivery-service.ts`
- `apps/api/src/services/message-delivery-data-service.ts`
- `apps/api/src/services/message-delivery-report-service.ts`
- `apps/api/src/services/flow-service.ts`
- `apps/api/src/services/flow-engine-service.ts`
- `apps/api/src/services/contacts-service.ts`
- `apps/api/src/services/contact-fields-service.ts`
- `apps/api/src/services/contact-segments-service.ts`
- `apps/api/src/services/campaign-service.ts`
- `apps/api/src/services/campaign-worker-service.ts`
- `apps/api/src/services/broadcast-service.ts`
- `apps/api/src/services/sequence-service.ts`
- `apps/api/src/services/sequence-enrollment-service.ts`
- `apps/api/src/services/sequence-execution-service.ts`
- `apps/api/src/services/sequence-event-service.ts`
- `apps/api/src/services/sequence-log-service.ts`
- `apps/api/src/services/billing-service.ts`
- `apps/api/src/services/workspace-billing-service.ts`
- `apps/api/src/services/workspace-billing-center-service.ts`
- `apps/api/src/services/generic-webhook-service.ts`
- `apps/api/src/services/meta-whatsapp-service.ts`
- `apps/api/src/services/ai-service.ts`
- `apps/api/src/services/ai-token-service.ts`
- `apps/api/src/services/ai-review-service.ts`
- `apps/api/src/services/agent-profile-service.ts`
- `apps/api/src/services/agent-loop-guard-service.ts`
- `apps/api/src/services/template-service.ts`
- `apps/api/src/services/google-sheets-service.ts`
- `apps/api/src/services/google-calendar-service.ts`
- `apps/api/src/services/inbound-media-service.ts`
- `apps/api/src/services/knowledge-ingestion-jobs-service.ts`
- `apps/api/src/services/model-settings-service.ts`
- `apps/api/src/services/outbound-message-service.ts`
- `apps/api/src/services/outbound-policy-service.ts`
- `apps/api/src/services/rag-service.ts`
- `apps/api/src/services/widget-chat-gateway-service.ts`
- `apps/api/src/services/daily-report-data-service.ts`
- `apps/api/src/services/daily-report-worker-service.ts`
- `apps/api/src/services/channel-default-reply-service.ts`
- `apps/api/src/services/api-outbound-router-service.ts`

---

## Task 1: Baseline the Existing SQL Access Layer

**Files:**
- Inspect: `apps/api/src/db/pool.ts`
- Inspect: `apps/api/src/scripts/migrate.ts`
- Inspect: `infra/migrations/`

- [x] **Step 1: Review current pool and migration setup**

Read:
```bash
cd apps/api
cat src/db/pool.ts
cat src/scripts/migrate.ts
```

Expected: confirm `pool` and `withTransaction` remain the canonical app DB layer and `infra/migrations/` remains the migration source of truth.

- [x] **Step 2: Verify no Prisma client exists in app runtime**

```bash
cd apps/api
rg -n "PrismaClient|from \"@prisma/client\"|from \"../db/prisma\"" src
```

Expected: zero results, or only historical references that must be removed in future cleanup.

- [x] **Step 3: Add architecture note to plan or db layer if needed**

If `pool.ts` lacks an explicit comment, add:
```typescript
// NOTE: WAgen uses the shared pg pool + SQL migrations as the primary DB layer.
// Prefer typed SQL helpers and withTransaction over introducing a second ORM stack.
```

- [x] **Step 4: Verify TypeScript still compiles**

```bash
cd apps/api
npm run lint
```

- [x] **Step 5: Commit**

```bash
git add apps/api/src/db/pool.ts docs/superpowers/plans/2026-04-21-sql-pool-hardening.md
git commit -m "docs: align DB architecture plan with pool-based SQL"
```

---

## Task 2: Add Shared SQL Helper Layer

**Files:**
- Create: `apps/api/src/db/sql-helpers.ts`
- Create: `apps/api/src/db/sql-types.ts`

- [x] **Step 1: Create shared SQL helper utilities**

Create `apps/api/src/db/sql-helpers.ts`:
```typescript
import type { PoolClient, QueryResult } from "pg";

export function firstRow<T>(result: QueryResult<T>): T | null {
  return result.rows[0] ?? null;
}

export function requireRow<T>(result: QueryResult<T>, message = "Expected query to return a row"): T {
  const row = result.rows[0];
  if (!row) throw new Error(message);
  return row;
}

export function hasRows<T>(result: QueryResult<T>): boolean {
  return (result.rowCount ?? 0) > 0;
}

export type DbExecutor = Pick<PoolClient, "query">;
```

- [x] **Step 2: Add shared SQL row typing helpers**

Create `apps/api/src/db/sql-types.ts`:
```typescript
export type JsonObject = Record<string, unknown>;
export type Nullable<T> = T | null;
export type TimestampString = string;
```

- [x] **Step 3: Verify helpers compile**

```bash
cd apps/api
npm run lint
```

- [x] **Step 4: Commit**

```bash
git add apps/api/src/db/sql-helpers.ts apps/api/src/db/sql-types.ts
git commit -m "refactor: add shared SQL helper utilities"
```

---

## Task 3: Harden WhatsApp Session Store

**Files:**
- Modify: `apps/api/src/services/whatsapp-session-store.ts`

- [x] **Step 1: Read the current file**

```bash
cd apps/api
cat src/services/whatsapp-session-store.ts
```

- [x] **Step 2: Replace repetitive result handling with shared helpers**

Use `firstRow` / `requireRow` where it improves readability:
```typescript
import { firstRow } from "../db/sql-helpers.js";

const existing = await pool.query<WhatsAppSessionRecord>(...);
const row = firstRow(existing);
if (row) {
  return mapSessionRecord(row);
}
```

- [x] **Step 3: Keep encryption logic unchanged**

Do not change:
- `encodeSessionAuthState`
- `decodeSessionAuthState`
- `getSessionEncryptionSecret`

Only reduce duplication and make row mapping clearer.

- [x] **Step 4: Verify TypeScript compiles**

```bash
cd apps/api
npm run lint
```

- [x] **Step 5: Commit**

```bash
git add apps/api/src/services/whatsapp-session-store.ts
git commit -m "refactor: harden whatsapp-session-store SQL access"
```

---

## Task 4: Standardize Simple CRUD Services

**Files:**
- Modify: `apps/api/src/services/user-service.ts`
- Modify: `apps/api/src/services/admin-service.ts`
- Modify: `apps/api/src/services/model-settings-service.ts`
- Modify: `apps/api/src/services/agent-profile-service.ts`

- [x] **Step 1: Review simple CRUD query style**

Look for repeated patterns:
- `SELECT ... WHERE id = $1`
- `INSERT ... RETURNING *`
- `UPDATE ... RETURNING *`
- `DELETE ... RETURNING *`

- [x] **Step 2: Normalize row handling**

Refactor each service so:
- one row mapping function exists per row type where useful
- `firstRow` / `requireRow` are used consistently
- thrown errors are explicit for missing records

- [x] **Step 3: Avoid behavioral changes**

Do not alter:
- business rules
- auth behavior
- validation semantics
- returned shapes unless needed to match existing callers

- [x] **Step 4: Verify TypeScript compiles**

```bash
cd apps/api
npm run lint
```

- [x] **Step 5: Commit**

```bash
git add apps/api/src/services/user-service.ts apps/api/src/services/admin-service.ts apps/api/src/services/model-settings-service.ts apps/api/src/services/agent-profile-service.ts
git commit -m "refactor: standardize simple CRUD SQL services"
```

---

## Task 5: Harden Conversation and Inbox Services

**Files:**
- Modify: `apps/api/src/services/conversation-service.ts`
- Modify: `apps/api/src/services/conversation-notes-service.ts`
- Modify: `apps/api/src/services/conversation-insight-service.ts`
- Modify: `apps/api/src/services/message-router-service.ts`

- [x] **Step 1: Extract reusable row mappers**

For repeated row types like conversation summaries or message rows, prefer small helper mappers instead of inline casts.

- [x] **Step 2: Preserve SQL features that are a good fit**

Keep SQL-native behavior where useful:
- `INSERT ... ON CONFLICT`
- window functions
- aggregates
- complex joins
- explicit `ORDER BY ... DESC`

Do not try to abstract these away if it makes the SQL harder to read.

- [x] **Step 3: Standardize transaction boundaries**

For multi-step inbox writes:
- use `withTransaction(...)`
- keep all dependent writes inside one transaction
- avoid mixing transactional and non-transactional writes in one logical operation

- [x] **Step 4: Verify TypeScript compiles**

```bash
cd apps/api
npm run lint
```

- [x] **Step 5: Commit**

```bash
git add apps/api/src/services/conversation-service.ts apps/api/src/services/conversation-notes-service.ts apps/api/src/services/conversation-insight-service.ts apps/api/src/services/message-router-service.ts
git commit -m "refactor: harden conversation and inbox SQL services"
```

---

## Task 6: Harden Message Delivery and Outbound Services

**Files:**
- Modify: `apps/api/src/services/message-delivery-service.ts`
- Modify: `apps/api/src/services/message-delivery-data-service.ts`
- Modify: `apps/api/src/services/message-delivery-report-service.ts`
- Modify: `apps/api/src/services/outbound-message-service.ts`
- Modify: `apps/api/src/services/outbound-policy-service.ts`
- Modify: `apps/api/src/services/api-outbound-router-service.ts`

- [x] **Step 1: Review query safety and consistency**

Check for:
- consistent parameterization
- clear row typing
- consistent timestamp handling
- clear status transition updates

- [x] **Step 2: Keep bulk SQL where it is already efficient**

For queue and delivery workloads, prefer existing SQL shapes when they are already efficient instead of over-abstracting them.

- [x] **Step 3: Centralize repeated status update fragments**

If multiple files repeat the same update fragments, extract small helper functions or repository-style wrappers.

- [x] **Step 4: Verify TypeScript compiles**

```bash
cd apps/api
npm run lint
```

- [x] **Step 5: Commit**

```bash
git add apps/api/src/services/message-delivery-service.ts apps/api/src/services/message-delivery-data-service.ts apps/api/src/services/message-delivery-report-service.ts apps/api/src/services/outbound-message-service.ts apps/api/src/services/outbound-policy-service.ts apps/api/src/services/api-outbound-router-service.ts
git commit -m "refactor: harden message delivery and outbound SQL services"
```

---

## Task 7: Harden Flow, Contact, Campaign, and Sequence Services

**Files:**
- Modify: `apps/api/src/services/flow-service.ts`
- Modify: `apps/api/src/services/flow-engine-service.ts`
- Modify: `apps/api/src/services/contacts-service.ts`
- Modify: `apps/api/src/services/contact-fields-service.ts`
- Modify: `apps/api/src/services/contact-segments-service.ts`
- Modify: `apps/api/src/services/campaign-service.ts`
- Modify: `apps/api/src/services/campaign-worker-service.ts`
- Modify: `apps/api/src/services/broadcast-service.ts`
- Modify: `apps/api/src/services/sequence-service.ts`
- Modify: `apps/api/src/services/sequence-enrollment-service.ts`
- Modify: `apps/api/src/services/sequence-execution-service.ts`
- Modify: `apps/api/src/services/sequence-event-service.ts`
- Modify: `apps/api/src/services/sequence-log-service.ts`

- [x] **Step 1: Preserve SQL-first workflows**

Keep:
- JSONB reads/writes for flows
- `ON CONFLICT` contact upserts
- transaction-based campaign creation
- sequence state transitions in SQL

- [x] **Step 2: Introduce helper wrappers only where duplication is high**

Examples:
- contact lookup by normalized phone
- sequence enrollment fetch/update
- campaign recipient batch inserts

- [x] **Step 3: Verify TypeScript compiles**

```bash
cd apps/api
npm run lint
```

- [x] **Step 4: Commit**

```bash
git add apps/api/src/services/flow-service.ts apps/api/src/services/flow-engine-service.ts apps/api/src/services/contacts-service.ts apps/api/src/services/contact-fields-service.ts apps/api/src/services/contact-segments-service.ts apps/api/src/services/campaign-service.ts apps/api/src/services/campaign-worker-service.ts apps/api/src/services/broadcast-service.ts apps/api/src/services/sequence-service.ts apps/api/src/services/sequence-enrollment-service.ts apps/api/src/services/sequence-execution-service.ts apps/api/src/services/sequence-event-service.ts apps/api/src/services/sequence-log-service.ts
git commit -m "refactor: harden flow, contact, campaign, and sequence SQL services"
```

---

## Task 8: Harden Billing, Integration, and AI Services

**Files:**
- Modify: `apps/api/src/services/billing-service.ts`
- Modify: `apps/api/src/services/workspace-billing-service.ts`
- Modify: `apps/api/src/services/workspace-billing-center-service.ts`
- Modify: `apps/api/src/services/generic-webhook-service.ts`
- Modify: `apps/api/src/services/meta-whatsapp-service.ts`
- Modify: `apps/api/src/services/google-sheets-service.ts`
- Modify: `apps/api/src/services/google-calendar-service.ts`
- Modify: `apps/api/src/services/ai-service.ts`
- Modify: `apps/api/src/services/ai-token-service.ts`
- Modify: `apps/api/src/services/ai-review-service.ts`
- Modify: `apps/api/src/services/agent-loop-guard-service.ts`
- Modify: `apps/api/src/services/template-service.ts`
- Modify: `apps/api/src/services/inbound-media-service.ts`
- Modify: `apps/api/src/services/knowledge-ingestion-jobs-service.ts`
- Modify: `apps/api/src/services/rag-service.ts`
- Modify: `apps/api/src/services/widget-chat-gateway-service.ts`
- Modify: `apps/api/src/services/daily-report-data-service.ts`
- Modify: `apps/api/src/services/daily-report-worker-service.ts`
- Modify: `apps/api/src/services/channel-default-reply-service.ts`

- [x] **Step 1: Preserve SQL where it provides real leverage**

Especially keep raw SQL for:
- vector search in `rag-service.ts`
- billing ledger atomic updates
- report aggregates
- complex webhook log queries

- [x] **Step 2: Tighten typing and error handling**

For each service:
- make result row types explicit
- avoid unchecked `rows[0]` usage where possible
- standardize null handling and “not found” behavior

- [x] **Step 3: Keep encryption and external API logic unchanged**

Do not alter:
- encrypted token storage/decryption patterns
- provider request payloads
- retry semantics

- [x] **Step 4: Verify TypeScript compiles**

```bash
cd apps/api
npm run lint
```

- [x] **Step 5: Run tests**

```bash
cd apps/api
npx vitest run
```

- [x] **Step 6: Commit**

```bash
git add apps/api/src/services/billing-service.ts apps/api/src/services/workspace-billing-service.ts apps/api/src/services/workspace-billing-center-service.ts apps/api/src/services/generic-webhook-service.ts apps/api/src/services/meta-whatsapp-service.ts apps/api/src/services/google-sheets-service.ts apps/api/src/services/google-calendar-service.ts apps/api/src/services/ai-service.ts apps/api/src/services/ai-token-service.ts apps/api/src/services/ai-review-service.ts apps/api/src/services/agent-loop-guard-service.ts apps/api/src/services/template-service.ts apps/api/src/services/inbound-media-service.ts apps/api/src/services/knowledge-ingestion-jobs-service.ts apps/api/src/services/rag-service.ts apps/api/src/services/widget-chat-gateway-service.ts apps/api/src/services/daily-report-data-service.ts apps/api/src/services/daily-report-worker-service.ts apps/api/src/services/channel-default-reply-service.ts
git commit -m "refactor: harden billing, integration, and AI SQL services"
```

---

## Task 9: Final Verification

- [x] **Step 1: Verify pool-based SQL remains the only app DB layer**

```bash
cd apps/api
rg -n "PrismaClient|@prisma/client|src/db/prisma" src
```

Expected: zero results.

- [x] **Step 2: Verify migrations still flow through infra SQL**

```bash
cd apps/api
rg -n "infra/migrations|runMigrations|buildMigrationPlan" src/scripts/migrate.ts
```

Expected: current migration runner still references `infra/migrations`.

- [x] **Step 3: Verify TypeScript build**

```bash
cd apps/api
npm run build
```

Expected: zero build errors.

- [x] **Step 4: Run full test suite**

```bash
cd apps/api
npx vitest run
```

Expected: all tests pass.

- [x] **Step 5: Verify service imports still use pool-based DB access**

```bash
cd apps/api
rg -n "from \"../db/pool|from \"../db/sql-helpers|withTransaction" src/services --glob "*.ts"
```

Expected: service layer continues to use pool-based SQL modules, not Prisma.

- [x] **Step 6: Final commit**

```bash
git add apps/api/src/db/ apps/api/src/services/ docs/superpowers/plans/2026-04-21-sql-pool-hardening.md
git commit -m "refactor: complete SQL pool hardening plan"
```

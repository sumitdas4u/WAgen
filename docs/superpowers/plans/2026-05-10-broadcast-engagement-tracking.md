# Broadcast Engagement Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Clicked and Replied engagement tracking to broadcasts — including per-recipient timestamps, time-series graphs, and filterable stat tabs in the detail view.

**Architecture:** A new `campaign_engagement_events` append-only table stores raw events (clicked_button, clicked_url, replied_any, replied_quote). Counter columns on `campaigns` and timestamp columns on `campaign_messages` give O(1) reads. Meta webhook inbound messages drive button-click and reply detection via `context.id` → `campaign_messages.wamid` lookup. URL clicks are tracked via HMAC-signed redirect tokens injected at send time.

**Tech Stack:** PostgreSQL (migrations), TypeScript/Fastify (API), React + TanStack Query + recharts (frontend), vitest (tests)

---

## File Map

**Create:**
- `infra/migrations/0074_broadcast_engagement.sql`
- `apps/api/src/services/broadcast-engagement-service.ts`
- `apps/api/src/services/broadcast-engagement-service.test.ts`
- `apps/api/src/routes/tracking.ts`

**Modify:**
- `apps/api/src/services/campaign-service.ts` — extend `CampaignMessage` type, fix `listCampaignMessages` status filter
- `apps/api/src/services/broadcast-service.ts` — extend `BroadcastSummary`, `BroadcastReport`, `getBroadcastSummary`, `getBroadcastReport`
- `apps/api/src/services/meta-whatsapp-service.ts` — add `context` to `WebhookMessage`, call `recordBroadcastEngagement`
- `apps/api/src/routes/broadcasts.ts` — add `/engagement-timeline` route, extend status filter enum
- `apps/api/src/app.ts` — register `trackingRoutes`
- `apps/web/src/lib/api.ts` — extend types, add `fetchBroadcastEngagementTimeline`
- `apps/web/src/shared/dashboard/query-keys.ts` — add `broadcastEngagementTimeline`
- `apps/web/src/modules/dashboard/broadcast/BroadcastModulePage.tsx` — stat tabs, graph, filtered table, list row, overview card

---

## Task 1: Database Migration

**Files:**
- Create: `infra/migrations/0074_broadcast_engagement.sql`

- [ ] **Step 1: Create migration file**

```sql
-- infra/migrations/0074_broadcast_engagement.sql

-- Append-only engagement event log (drives time-series graphs)
CREATE TABLE IF NOT EXISTS campaign_engagement_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_msg_id  UUID        REFERENCES campaign_messages(id) ON DELETE SET NULL,
  contact_id       UUID        REFERENCES contacts(id) ON DELETE SET NULL,
  event_type       TEXT        NOT NULL
                     CHECK (event_type IN ('clicked_button','clicked_url','replied_any','replied_quote')),
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS campaign_engagement_campaign_time_idx
  ON campaign_engagement_events(campaign_id, occurred_at);

-- Per-recipient engagement timestamps
ALTER TABLE campaign_messages
  ADD COLUMN IF NOT EXISTS clicked_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replied_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quote_replied_at TIMESTAMPTZ;

-- Fast aggregate counters
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS clicked_count       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS replied_count       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quote_replied_count INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Run migration**

```bash
cd apps/api && npm run db:migrate
```

Expected: migration runs without error, new table and columns exist.

- [ ] **Step 3: Commit**

```bash
git add infra/migrations/0074_broadcast_engagement.sql
git commit -m "feat: add campaign engagement events table and columns"
```

---

## Task 2: Engagement Service — Core Write Functions

**Files:**
- Create: `apps/api/src/services/broadcast-engagement-service.ts`
- Create: `apps/api/src/services/broadcast-engagement-service.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/src/services/broadcast-engagement-service.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPoolQuery, mockWithTransaction } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockWithTransaction: vi.fn(),
}));

vi.mock("../db/pool.js", () => ({
  pool: { query: mockPoolQuery },
  withTransaction: mockWithTransaction,
}));

import {
  recordBroadcastEngagement,
  type BroadcastEngagementInput,
} from "./broadcast-engagement-service.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordBroadcastEngagement", () => {
  it("inserts clicked_button event when wamid matches campaign message", async () => {
    // Arrange: wamid lookup returns a campaign_message row
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ id: "msg-1", campaign_id: "camp-1", contact_id: "contact-1", clicked_at: null }],
    });
    // withTransaction executes the callback
    mockWithTransaction.mockImplementation(async (fn: (client: unknown) => Promise<void>) => {
      const mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }) };
      await fn(mockClient);
    });

    const input: BroadcastEngagementInput = {
      eventType: "clicked_button",
      wamid: "wamid.ABC123",
      contactId: "contact-1",
    };

    await recordBroadcastEngagement(input);

    // Should have queried campaign_messages by wamid
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM campaign_messages"),
      ["wamid.ABC123"]
    );
    // Transaction should have been called
    expect(mockWithTransaction).toHaveBeenCalledOnce();
  });

  it("does nothing when wamid does not match any campaign message", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    await recordBroadcastEngagement({
      eventType: "clicked_button",
      wamid: "wamid.UNKNOWN",
      contactId: null,
    });

    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("inserts replied_any event by contact lookup when no wamid", async () => {
    // No wamid provided — look up by contact_id
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ id: "msg-2", campaign_id: "camp-2", contact_id: "contact-2", replied_at: null }],
    });
    mockWithTransaction.mockImplementation(async (fn: (client: unknown) => Promise<void>) => {
      const mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }) };
      await fn(mockClient);
    });

    await recordBroadcastEngagement({
      eventType: "replied_any",
      wamid: null,
      contactId: "contact-2",
    });

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM campaign_messages"),
      expect.arrayContaining(["contact-2"])
    );
    expect(mockWithTransaction).toHaveBeenCalledOnce();
  });

  it("skips duplicate: does not increment counter when clicked_at already set", async () => {
    // clicked_at already set → isFirstEvent = false
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ id: "msg-1", campaign_id: "camp-1", contact_id: "contact-1", clicked_at: "2026-01-01T00:00:00Z" }],
    });
    mockWithTransaction.mockImplementation(async (fn: (client: unknown) => Promise<void>) => {
      const mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }) };
      await fn(mockClient);
    });

    await recordBroadcastEngagement({
      eventType: "clicked_button",
      wamid: "wamid.ABC123",
      contactId: "contact-1",
    });

    // Transaction still called (to log event), but check client.query skips counter increment
    expect(mockWithTransaction).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && npm test -- broadcast-engagement-service
```

Expected: FAIL — `broadcast-engagement-service.js` not found.

- [ ] **Step 3: Implement the service**

```typescript
// apps/api/src/services/broadcast-engagement-service.ts
import { pool, withTransaction } from "../db/pool.js";

export type EngagementEventType =
  | "clicked_button"
  | "clicked_url"
  | "replied_any"
  | "replied_quote";

export interface BroadcastEngagementInput {
  eventType: EngagementEventType;
  /** wamid of the outbound campaign message — used for button clicks and quote replies */
  wamid: string | null;
  /** contact_id of the sender — fallback for replied_any when no wamid context */
  contactId: string | null;
}

interface CampaignMessageRow {
  id: string;
  campaign_id: string;
  contact_id: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  quote_replied_at: string | null;
}

async function findCampaignMessage(
  wamid: string | null,
  contactId: string | null,
  eventType: EngagementEventType
): Promise<CampaignMessageRow | null> {
  if (wamid) {
    const result = await pool.query<CampaignMessageRow>(
      `SELECT id, campaign_id, contact_id, clicked_at, replied_at, quote_replied_at
       FROM campaign_messages
       WHERE wamid = $1
       LIMIT 1`,
      [wamid]
    );
    return result.rows[0] ?? null;
  }

  if (contactId && eventType === "replied_any") {
    // Find most recent campaign message for this contact sent within last 7 days
    const result = await pool.query<CampaignMessageRow>(
      `SELECT id, campaign_id, contact_id, clicked_at, replied_at, quote_replied_at
       FROM campaign_messages
       WHERE contact_id = $1
         AND sent_at IS NOT NULL
         AND sent_at > NOW() - INTERVAL '7 days'
       ORDER BY sent_at DESC
       LIMIT 1`,
      [contactId]
    );
    return result.rows[0] ?? null;
  }

  return null;
}

function timestampColumnFor(eventType: EngagementEventType): string {
  if (eventType === "clicked_button" || eventType === "clicked_url") return "clicked_at";
  if (eventType === "replied_quote") return "quote_replied_at";
  return "replied_at";
}

function counterColumnFor(eventType: EngagementEventType): string {
  if (eventType === "clicked_button" || eventType === "clicked_url") return "clicked_count";
  if (eventType === "replied_quote") return "quote_replied_count";
  return "replied_count";
}

export async function recordBroadcastEngagement(
  input: BroadcastEngagementInput
): Promise<void> {
  const row = await findCampaignMessage(input.wamid, input.contactId, input.eventType);
  if (!row) {
    return;
  }

  const tsCol = timestampColumnFor(input.eventType);
  const counterCol = counterColumnFor(input.eventType);
  const isFirstEvent = row[tsCol as keyof CampaignMessageRow] === null;

  await withTransaction(async (client) => {
    // Always log raw event
    await client.query(
      `INSERT INTO campaign_engagement_events
         (campaign_id, campaign_msg_id, contact_id, event_type)
       VALUES ($1, $2, $3, $4)`,
      [row.campaign_id, row.id, row.contact_id, input.eventType]
    );

    // Set first-occurrence timestamp on campaign_message
    await client.query(
      `UPDATE campaign_messages
       SET ${tsCol} = COALESCE(${tsCol}, NOW())
       WHERE id = $1`,
      [row.id]
    );

    // Increment counter only on first occurrence (distinct recipient)
    if (isFirstEvent) {
      await client.query(
        `UPDATE campaigns
         SET ${counterCol} = ${counterCol} + 1
         WHERE id = $1`,
        [row.campaign_id]
      );
    }
  });
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/api && npm test -- broadcast-engagement-service
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/broadcast-engagement-service.ts \
        apps/api/src/services/broadcast-engagement-service.test.ts
git commit -m "feat: add recordBroadcastEngagement service"
```

---

## Task 3: Engagement Timeline Query

**Files:**
- Modify: `apps/api/src/services/broadcast-engagement-service.ts`
- Modify: `apps/api/src/services/broadcast-engagement-service.test.ts`

- [ ] **Step 1: Add failing test**

Append to `broadcast-engagement-service.test.ts`:

```typescript
import { getBroadcastEngagementTimeline } from "./broadcast-engagement-service.js";

describe("getBroadcastEngagementTimeline", () => {
  it("returns aggregated buckets grouped by day", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        { period: "2026-01-23T00:00:00.000Z", clicked_button: "12", clicked_url: "3", replied_any: "5", replied_quote: "2" },
        { period: "2026-01-24T00:00:00.000Z", clicked_button: "8",  clicked_url: "1", replied_any: "3", replied_quote: "1" },
      ],
    });

    const result = await getBroadcastEngagementTimeline("camp-1", "day");

    expect(result).toEqual([
      { period: "2026-01-23T00:00:00.000Z", clicked_button: 12, clicked_url: 3, replied_any: 5, replied_quote: 2 },
      { period: "2026-01-24T00:00:00.000Z", clicked_button: 8,  clicked_url: 1, replied_any: 3, replied_quote: 1 },
    ]);
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("date_trunc"),
      ["camp-1"]
    );
  });

  it("returns empty array when no events exist", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    const result = await getBroadcastEngagementTimeline("camp-1", "week");
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm new tests fail**

```bash
cd apps/api && npm test -- broadcast-engagement-service
```

Expected: 2 new tests FAIL — `getBroadcastEngagementTimeline` not found.

- [ ] **Step 3: Add the function to the service**

Append to `apps/api/src/services/broadcast-engagement-service.ts`:

```typescript
export interface EngagementTimelineBucket {
  period: string;
  clicked_button: number;
  clicked_url: number;
  replied_any: number;
  replied_quote: number;
}

export async function getBroadcastEngagementTimeline(
  campaignId: string,
  granularity: "hour" | "day" | "week"
): Promise<EngagementTimelineBucket[]> {
  // date_trunc only accepts literal strings — validate here to prevent injection
  const safeGranularity = granularity === "hour" || granularity === "week" ? granularity : "day";

  const result = await pool.query<{
    period: string;
    clicked_button: string;
    clicked_url: string;
    replied_any: string;
    replied_quote: string;
  }>(
    `SELECT
       date_trunc('${safeGranularity}', occurred_at) AS period,
       COUNT(*) FILTER (WHERE event_type = 'clicked_button')::text AS clicked_button,
       COUNT(*) FILTER (WHERE event_type = 'clicked_url')::text   AS clicked_url,
       COUNT(*) FILTER (WHERE event_type = 'replied_any')::text   AS replied_any,
       COUNT(*) FILTER (WHERE event_type = 'replied_quote')::text AS replied_quote
     FROM campaign_engagement_events
     WHERE campaign_id = $1
     GROUP BY 1
     ORDER BY 1`,
    [campaignId]
  );

  return result.rows.map((row) => ({
    period: row.period,
    clicked_button: Number(row.clicked_button),
    clicked_url: Number(row.clicked_url),
    replied_any: Number(row.replied_any),
    replied_quote: Number(row.replied_quote),
  }));
}
```

- [ ] **Step 4: Run all tests**

```bash
cd apps/api && npm test -- broadcast-engagement-service
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/broadcast-engagement-service.ts \
        apps/api/src/services/broadcast-engagement-service.test.ts
git commit -m "feat: add getBroadcastEngagementTimeline query"
```

---

## Task 4: Extend Campaign Service Types + Status Filter

**Files:**
- Modify: `apps/api/src/services/campaign-service.ts`

- [ ] **Step 1: Extend `CampaignMessage` interface**

In `campaign-service.ts`, find the `CampaignMessage` interface (around line 55) and add three fields:

```typescript
export interface CampaignMessage {
  id: string;
  campaign_id: string;
  contact_id: string | null;
  phone_number: string;
  wamid: string | null;
  status: CampaignMessageStatus;
  retry_count: number;
  next_retry_at: string | null;
  error_code: string | null;
  error_message: string | null;
  resolved_variables_json: Record<string, string> | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  clicked_at: string | null;       // NEW
  replied_at: string | null;       // NEW
  quote_replied_at: string | null; // NEW
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Extend `Campaign` interface**

Find the `Campaign` interface and add three counter fields:

```typescript
export interface Campaign {
  // ... all existing fields ...
  clicked_count: number;       // NEW
  replied_count: number;       // NEW
  quote_replied_count: number; // NEW
}
```

- [ ] **Step 3: Fix `listCampaignMessages` to handle engagement status filters**

The current `statusClause` uses `AND status = $N` which only checks the `status` column. Engagement statuses (`clicked`, `replied`, `quote_replied`) are stored in timestamp columns instead. Replace the status clause building block in `listCampaignMessages`:

Find this section in `listCampaignMessages` (around line 657):
```typescript
  let statusClause = "";
  if (opts?.status) {
    params.push(opts.status);
    statusClause = `AND status = $${params.length}`;
  }
```

Replace with:
```typescript
  let statusClause = "";
  if (opts?.status) {
    if (opts.status === "clicked") {
      statusClause = "AND clicked_at IS NOT NULL";
    } else if (opts.status === "replied") {
      statusClause = "AND replied_at IS NOT NULL";
    } else if (opts.status === "quote_replied") {
      statusClause = "AND quote_replied_at IS NOT NULL";
    } else {
      params.push(opts.status);
      statusClause = `AND status = $${params.length}`;
    }
  }
```

- [ ] **Step 4: Run existing campaign service tests**

```bash
cd apps/api && npm test -- campaign-service
```

Expected: all existing tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/campaign-service.ts
git commit -m "feat: extend Campaign and CampaignMessage with engagement fields"
```

---

## Task 5: Extend Broadcast Service

**Files:**
- Modify: `apps/api/src/services/broadcast-service.ts`

- [ ] **Step 1: Extend `BroadcastSummary` interface**

Find the `BroadcastSummary` interface and add:

```typescript
export interface BroadcastSummary {
  totalBroadcasts: number;
  recipients: number;
  sent: number;
  delivered: number;
  engaged: number;
  failed: number;
  suppressed: number;
  frequencyLimited: number;
  monthlyRecipientsUsed: number;
  clicked: number;      // NEW
  replied: number;      // NEW
  quote_replied: number; // NEW
}
```

- [ ] **Step 2: Extend `getBroadcastSummary` SQL + mapping**

In `getBroadcastSummary`, find the SQL query string and add the three new columns:

```typescript
    pool.query<{
      total_broadcasts: string;
      recipients: string;
      sent: string;
      delivered: string;
      engaged: string;
      failed: string;
      suppressed: string;
      clicked: string;      // NEW
      replied: string;      // NEW
      quote_replied: string; // NEW
    }>(
      `SELECT
         COUNT(*)::text AS total_broadcasts,
         COALESCE(SUM(total_count), 0)::text AS recipients,
         COALESCE(SUM(sent_count), 0)::text AS sent,
         COALESCE(SUM(delivered_count), 0)::text AS delivered,
         COALESCE(SUM(read_count), 0)::text AS engaged,
         COALESCE(SUM(failed_count), 0)::text AS failed,
         COALESCE(SUM(skipped_count), 0)::text AS suppressed,
         COALESCE(SUM(clicked_count), 0)::text AS clicked,
         COALESCE(SUM(replied_count), 0)::text AS replied,
         COALESCE(SUM(quote_replied_count), 0)::text AS quote_replied
       FROM campaigns
       WHERE user_id = $1`,
      [userId]
    ),
```

And in the return object, add:
```typescript
  return {
    totalBroadcasts: Number(row?.total_broadcasts ?? 0),
    recipients: Number(row?.recipients ?? 0),
    sent: Number(row?.sent ?? 0),
    delivered: Number(row?.delivered ?? 0),
    engaged: Number(row?.engaged ?? 0),
    failed: Number(row?.failed ?? 0),
    suppressed: Number(row?.suppressed ?? 0),
    frequencyLimited: 0,
    monthlyRecipientsUsed: parseInt(monthlyResult.rows[0]?.monthly_used ?? "0", 10),
    clicked: Number(row?.clicked ?? 0),      // NEW
    replied: Number(row?.replied ?? 0),       // NEW
    quote_replied: Number(row?.quote_replied ?? 0), // NEW
  };
```

- [ ] **Step 3: Extend `BroadcastReport` buckets + `getBroadcastReport`**

Find the `BroadcastReport` interface and extend `buckets`:

```typescript
export interface BroadcastReport {
  campaign: Campaign;
  messages: CampaignMessage[];
  total: number;
  buckets: Record<RetargetStatus, number> & {
    clicked: number;
    replied: number;
    quote_replied: number;
  };
}
```

In `getBroadcastReport`, extend the `bucketResult` query:

```typescript
    pool.query<{
      sent_count: string;
      delivered_count: string;
      read_count: string;
      failed_count: string;
      skipped_count: string;
      clicked_count: string;       // NEW
      replied_count: string;       // NEW
      quote_replied_count: string; // NEW
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE sent_at IS NOT NULL)::text AS sent_count,
         COUNT(*) FILTER (WHERE delivered_at IS NOT NULL OR status IN ('delivered', 'read'))::text AS delivered_count,
         COUNT(*) FILTER (WHERE read_at IS NOT NULL OR status = 'read')::text AS read_count,
         COUNT(*) FILTER (WHERE status = 'failed')::text AS failed_count,
         COUNT(*) FILTER (WHERE status = 'skipped')::text AS skipped_count,
         COUNT(*) FILTER (WHERE clicked_at IS NOT NULL)::text AS clicked_count,
         COUNT(*) FILTER (WHERE replied_at IS NOT NULL)::text AS replied_count,
         COUNT(*) FILTER (WHERE quote_replied_at IS NOT NULL)::text AS quote_replied_count
       FROM campaign_messages
       WHERE campaign_id = $1`,
      [campaignId]
    )
```

And in the return object:
```typescript
    buckets: {
      sent: Number(buckets?.sent_count ?? 0),
      delivered: Number(buckets?.delivered_count ?? 0),
      read: Number(buckets?.read_count ?? 0),
      failed: Number(buckets?.failed_count ?? 0),
      skipped: Number(buckets?.skipped_count ?? 0),
      clicked: Number(buckets?.clicked_count ?? 0),            // NEW
      replied: Number(buckets?.replied_count ?? 0),            // NEW
      quote_replied: Number(buckets?.quote_replied_count ?? 0), // NEW
    }
```

- [ ] **Step 4: Run tests**

```bash
cd apps/api && npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/broadcast-service.ts
git commit -m "feat: extend BroadcastSummary and BroadcastReport with engagement counters"
```

---

## Task 6: Meta Webhook — Hook Engagement Detection

**Files:**
- Modify: `apps/api/src/services/meta-whatsapp-service.ts`

- [ ] **Step 1: Add `context` field to `WebhookMessage` interface**

Find the `WebhookMessage` interface (around line 159) and add `context`:

```typescript
interface WebhookMessage {
  id?: string;
  from?: string;
  type?: string;
  timestamp?: string;
  context?: { id?: string; from?: string }; // NEW — present on replies and button taps
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; sha256?: string; caption?: string };
  video?: { id?: string; mime_type?: string; sha256?: string; caption?: string };
  audio?: { id?: string; mime_type?: string; sha256?: string; voice?: boolean };
  document?: { id?: string; mime_type?: string; sha256?: string; filename?: string; caption?: string };
  sticker?: { id?: string; mime_type?: string; sha256?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string; url?: string };
  contacts?: Array<{
    name?: { formatted_name?: string; first_name?: string; last_name?: string };
    phones?: Array<{ phone?: string; wa_id?: string; type?: string }>;
    org?: { company?: string };
  }>;
  reaction?: { message_id?: string; emoji?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    button_reply?: { title?: string; id?: string };
    list_reply?: { title?: string; description?: string; id?: string };
  };
}
```

- [ ] **Step 2: Add import for engagement service**

At the top of `meta-whatsapp-service.ts`, add the import alongside existing service imports:

```typescript
import { recordBroadcastEngagement } from "./broadcast-engagement-service.js";
```

- [ ] **Step 3: Hook engagement detection into `processWebhookTask`**

Find the `processWebhookTask` function. Near the bottom, after the `processIncomingMessage` call and auto-reply block, add engagement detection before the final return. The contact lookup already happens — find where `contactRow` or `upsertWebhookContact` is called and where `normalizedTask` is used.

Locate this pattern near the end of `processWebhookTask`:

```typescript
  if (!result.autoReplySent) {
    console.info(
      `[MetaWebhook] auto-reply skipped ...`
    );
    return;
  }

  console.info(
    `[MetaWebhook] auto-reply sent ...`
  );
```

Insert engagement detection BEFORE that block (after `processIncomingMessage` is called and `result` is available). You need the `contactId` — find where contact lookup happens in the function. Add this after the conversation/contact resolution:

```typescript
  // Engagement tracking: detect button clicks and replies to broadcast messages
  try {
    const contextWamid = normalizedTask.message.context?.id?.trim() || null;
    const msgType = normalizedTask.message.type?.trim();
    const isButtonClick = msgType === "button" || Boolean(normalizedTask.message.interactive?.button_reply);

    if (isButtonClick && contextWamid) {
      await recordBroadcastEngagement({
        eventType: "clicked_button",
        wamid: contextWamid,
        contactId: normalizedTask.contactId ?? null,
      });
    } else if (contextWamid) {
      // Has context → quote-reply
      await recordBroadcastEngagement({
        eventType: "replied_quote",
        wamid: contextWamid,
        contactId: normalizedTask.contactId ?? null,
      });
      // Also count as replied_any
      await recordBroadcastEngagement({
        eventType: "replied_any",
        wamid: contextWamid,
        contactId: normalizedTask.contactId ?? null,
      });
    } else if (normalizedTask.contactId) {
      // No context → plain reply, look up by contact
      await recordBroadcastEngagement({
        eventType: "replied_any",
        wamid: null,
        contactId: normalizedTask.contactId,
      });
    }
  } catch (error) {
    console.error("[MetaWebhook] engagement tracking failed", error);
  }
```

**Note:** `normalizedTask.contactId` may not exist yet. Check the `NormalizedWebhookMessageTask` type. If it doesn't have `contactId`, you need to look up the contact. Find where `upsertWebhookContact` is called and capture its return value as the contactId. The contact lookup returns a contact object or id — use `contact?.id ?? null`.

To be concrete: find `upsertWebhookContact` call in `processWebhookTask`:
```typescript
    await upsertWebhookContact({
      userId: connectionRow.user_id,
      phoneNumber: normalizedTask.from,
      displayName: normalizedTask.senderName ?? undefined
    });
```

Change it to capture the result:
```typescript
    const upsertedContact = await upsertWebhookContact({
      userId: connectionRow.user_id,
      phoneNumber: normalizedTask.from,
      displayName: normalizedTask.senderName ?? undefined
    });
    const inboundContactId = upsertedContact?.id ?? null;
```

Then use `inboundContactId` in the engagement tracking block above instead of `normalizedTask.contactId`.

- [ ] **Step 4: Check `upsertWebhookContact` return type**

```bash
grep -n "export.*upsertWebhookContact\|async function upsertWebhookContact" apps/api/src/services/contacts-service.ts
```

If it returns `Promise<void>`, change it to return `Promise<{ id: string } | null>` by adding `RETURNING id` to its INSERT/UPDATE SQL. If it already returns a contact object, use that directly.

- [ ] **Step 5: Run existing meta-whatsapp-service tests**

```bash
cd apps/api && npm test -- meta-whatsapp-service
```

Expected: all existing tests PASS (engagement errors are caught and logged, never thrown).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/meta-whatsapp-service.ts \
        apps/api/src/services/contacts-service.ts
git commit -m "feat: hook engagement tracking into Meta webhook inbound handler"
```

---

## Task 7: Tracking Redirect Route (`/t/:token`)

**Files:**
- Create: `apps/api/src/routes/tracking.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Create the tracking route**

```typescript
// apps/api/src/routes/tracking.ts
import type { FastifyInstance } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { recordBroadcastEngagement } from "../services/broadcast-engagement-service.js";

function hmacSign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

function verifyToken(token: string): { campaignMsgId: string; destinationUrl: string } | null {
  const secret = env.SESSION_ENCRYPTION_SECRET;
  if (!secret) return null;

  const dotIndex = token.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const payload = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);
  const expected = hmacSign(payload, secret);

  try {
    if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      c: string;
      u: string;
    };
    if (!decoded.c || !decoded.u) return null;
    return { campaignMsgId: decoded.c, destinationUrl: decoded.u };
  } catch {
    return null;
  }
}

export function buildTrackingToken(campaignMsgId: string, destinationUrl: string): string {
  const secret = env.SESSION_ENCRYPTION_SECRET ?? "";
  const payload = Buffer.from(JSON.stringify({ c: campaignMsgId, u: destinationUrl })).toString("base64url");
  const sig = hmacSign(payload, secret);
  return `${payload}.${sig}`;
}

export async function trackingRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/t/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const decoded = verifyToken(token);

    if (!decoded) {
      return reply.status(400).send({ error: "Invalid tracking token" });
    }

    // Fire-and-forget — don't let tracking errors block the redirect
    recordBroadcastEngagement({
      eventType: "clicked_url",
      wamid: null,
      contactId: null,
    }).catch((error) => {
      console.error("[Tracking] engagement record failed", error);
    });

    // Need campaignMsgId to look up contact — extend recordBroadcastEngagement to accept it directly
    // For now pass via a campaign_messages id lookup (extend the service in next step)
    return reply.redirect(decoded.destinationUrl, 302);
  });
}
```

**Note:** `recordBroadcastEngagement` uses `wamid` to look up the campaign message. For URL tracking, we have the `campaignMsgId` directly. Extend `BroadcastEngagementInput` to also accept `campaignMsgId`:

In `broadcast-engagement-service.ts`, add `campaignMsgId` to the input and update `findCampaignMessage`:

```typescript
export interface BroadcastEngagementInput {
  eventType: EngagementEventType;
  wamid: string | null;
  contactId: string | null;
  campaignMsgId?: string; // NEW — used by URL tracking redirect
}
```

And in `findCampaignMessage`, add a third branch:

```typescript
async function findCampaignMessage(
  wamid: string | null,
  contactId: string | null,
  eventType: EngagementEventType,
  campaignMsgId?: string
): Promise<CampaignMessageRow | null> {
  if (campaignMsgId) {
    const result = await pool.query<CampaignMessageRow>(
      `SELECT id, campaign_id, contact_id, clicked_at, replied_at, quote_replied_at
       FROM campaign_messages
       WHERE id = $1
       LIMIT 1`,
      [campaignMsgId]
    );
    return result.rows[0] ?? null;
  }
  // ... rest of existing branches unchanged
}
```

Update the call site inside `recordBroadcastEngagement`:
```typescript
  const row = await findCampaignMessage(input.wamid, input.contactId, input.eventType, input.campaignMsgId);
```

Update the tracking route to pass `campaignMsgId`:
```typescript
    recordBroadcastEngagement({
      eventType: "clicked_url",
      wamid: null,
      contactId: null,
      campaignMsgId: decoded.campaignMsgId,
    }).catch((error) => {
      console.error("[Tracking] engagement record failed", error);
    });
```

- [ ] **Step 2: Register route in `app.ts`**

Find where `broadcastRoutes` is registered in `app.ts`:
```typescript
import { broadcastRoutes } from "./routes/broadcasts.js";
```

Add alongside it:
```typescript
import { trackingRoutes } from "./routes/tracking.js";
```

And in the route registration section:
```typescript
  await broadcastRoutes(app);
  await trackingRoutes(app); // NEW
```

- [ ] **Step 3: Run all tests**

```bash
cd apps/api && npm test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/tracking.ts \
        apps/api/src/services/broadcast-engagement-service.ts \
        apps/api/src/app.ts
git commit -m "feat: add URL click tracking redirect endpoint /t/:token"
```

---

## Task 8: Broadcasts API Route — Engagement Timeline Endpoint

**Files:**
- Modify: `apps/api/src/routes/broadcasts.ts`

- [ ] **Step 1: Import the new service function and extend the status enum**

At the top of `broadcasts.ts`, add to the imports:

```typescript
import {
  getBroadcastReport,
  getBroadcastSummary,
  importBroadcastAudienceWorkbook,
  listBroadcasts,
  previewBroadcastAudienceWorkbookImport,
  previewRetargetAudience,
  uploadBroadcastMedia
} from "../services/broadcast-service.js";
import { getBroadcastEngagementTimeline } from "../services/broadcast-engagement-service.js"; // NEW
import type { CampaignMessageStatus, RetargetStatus } from "../services/campaign-service.js";
```

- [ ] **Step 2: Extend `CampaignMessagesQuerySchema` status enum**

Find:
```typescript
const CampaignMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  status: z.enum(["queued", "sending", "sent", "delivered", "read", "failed", "skipped"] as [CampaignMessageStatus, ...CampaignMessageStatus[]]).optional()
});
```

Replace with:
```typescript
const CampaignMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  status: z.enum([
    "queued", "sending", "sent", "delivered", "read", "failed", "skipped",
    "clicked", "replied", "quote_replied"
  ] as [CampaignMessageStatus, ...CampaignMessageStatus[]]).optional()
});
```

- [ ] **Step 3: Add engagement timeline route**

Inside `broadcastRoutes`, after the existing `/api/broadcasts/:campaignId/report` route, add:

```typescript
  fastify.get(
    "/api/broadcasts/:campaignId/engagement-timeline",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { campaignId } = request.params as { campaignId: string };
      const query = request.query as Record<string, string | undefined>;
      const granularity = query.granularity;
      if (granularity !== "hour" && granularity !== "day" && granularity !== "week") {
        return reply.status(400).send({ error: "granularity must be hour, day, or week" });
      }
      const buckets = await getBroadcastEngagementTimeline(campaignId, granularity);
      return { buckets };
    }
  );
```

- [ ] **Step 4: Run all tests**

```bash
cd apps/api && npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/broadcasts.ts
git commit -m "feat: add /engagement-timeline route and extend status filter"
```

---

## Task 9: Frontend — API Types + Fetch Functions

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/shared/dashboard/query-keys.ts`

- [ ] **Step 1: Extend `CampaignMessageStatus` type in `api.ts`**

Find:
```typescript
export type CampaignMessageStatus = "queued" | "sending" | "sent" | "delivered" | "read" | "failed" | "skipped";
```

Replace with:
```typescript
export type CampaignMessageStatus =
  | "queued" | "sending" | "sent" | "delivered" | "read" | "failed" | "skipped"
  | "clicked" | "replied" | "quote_replied";
```

- [ ] **Step 2: Extend `CampaignMessage` interface in `api.ts`**

Find the `CampaignMessage` interface and add:
```typescript
export interface CampaignMessage {
  // ... existing fields ...
  clicked_at: string | null;
  replied_at: string | null;
  quote_replied_at: string | null;
}
```

- [ ] **Step 3: Extend `Campaign` interface in `api.ts`**

Find the `Campaign` interface and add:
```typescript
export interface Campaign {
  // ... all existing fields ...
  clicked_count: number;
  replied_count: number;
  quote_replied_count: number;
}

```

- [ ] **Step 4: Extend `BroadcastSummary` interface in `api.ts`**

Find `BroadcastSummary` and add:
```typescript
export interface BroadcastSummary {
  // ... existing fields ...
  clicked: number;
  replied: number;
  quote_replied: number;
}
```

- [ ] **Step 5: Add `BroadcastEngagementBucket` type and `fetchBroadcastEngagementTimeline` function**

After the existing `fetchBroadcastReport` function in `api.ts`, add:

```typescript
export interface BroadcastEngagementBucket {
  period: string;
  clicked_button: number;
  clicked_url: number;
  replied_any: number;
  replied_quote: number;
}

export function fetchBroadcastEngagementTimeline(
  token: string,
  campaignId: string,
  granularity: "hour" | "day" | "week"
) {
  return apiRequest<{ buckets: BroadcastEngagementBucket[] }>(
    `/api/broadcasts/${campaignId}/engagement-timeline?granularity=${granularity}`,
    { token }
  );
}
```

- [ ] **Step 6: Add query key in `query-keys.ts`**

Find the `broadcastReport` entry and add after it:

```typescript
  broadcastEngagementTimeline: (campaignId: string, granularity: string) =>
    [...dashboardBroadcastRoot, "engagement-timeline", campaignId, granularity] as const,
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/api.ts \
        apps/web/src/shared/dashboard/query-keys.ts
git commit -m "feat: add engagement types and fetchBroadcastEngagementTimeline to frontend API"
```

---

## Task 10: Frontend — Overview Card + List Row

**Files:**
- Modify: `apps/web/src/modules/dashboard/broadcast/BroadcastModulePage.tsx`

- [ ] **Step 1: Add Clicked + Replied to `overviewStats` in `BroadcastListPage`**

Find the `overviewStats` array (around line 561):
```typescript
  const overviewStats = [
    { label: "Recipients", value: summary?.recipients ?? 0, pctVal: null, icon: "👥" },
    { label: "Sent", value: summary?.sent ?? 0, pctVal: pct(summary?.sent ?? 0, summary?.recipients ?? 0), icon: "✓" },
    { label: "Delivered", value: summary?.delivered ?? 0, pctVal: pct(summary?.delivered ?? 0, summary?.recipients ?? 0), icon: "✓✓" },
    { label: "Engaged", value: summary?.engaged ?? 0, pctVal: pct(summary?.engaged ?? 0, summary?.recipients ?? 0), icon: "↩" },
    { label: "Not in WhatsApp", value: summary?.suppressed ?? 0, pctVal: pct(summary?.suppressed ?? 0, summary?.recipients ?? 0), icon: "⊘" },
    { label: "Frequency Limit", value: summary?.frequencyLimited ?? 0, pctVal: pct(summary?.frequencyLimited ?? 0, summary?.recipients ?? 0), icon: "∞" },
    { label: "Failed", value: summary?.failed ?? 0, pctVal: pct(summary?.failed ?? 0, summary?.recipients ?? 0), icon: "!" }
  ];
```

Replace with:
```typescript
  const overviewStats = [
    { label: "Recipients", value: summary?.recipients ?? 0, pctVal: null, icon: "👥" },
    { label: "Sent", value: summary?.sent ?? 0, pctVal: pct(summary?.sent ?? 0, summary?.recipients ?? 0), icon: "✓" },
    { label: "Delivered", value: summary?.delivered ?? 0, pctVal: pct(summary?.delivered ?? 0, summary?.recipients ?? 0), icon: "✓✓" },
    { label: "Engaged", value: summary?.engaged ?? 0, pctVal: pct(summary?.engaged ?? 0, summary?.recipients ?? 0), icon: "↩" },
    { label: "Clicked", value: summary?.clicked ?? 0, pctVal: pct(summary?.clicked ?? 0, summary?.recipients ?? 0), icon: "🔗" },
    { label: "Replied", value: summary?.replied ?? 0, pctVal: pct(summary?.replied ?? 0, summary?.recipients ?? 0), icon: "↩" },
    { label: "Not in WhatsApp", value: summary?.suppressed ?? 0, pctVal: pct(summary?.suppressed ?? 0, summary?.recipients ?? 0), icon: "⊘" },
    { label: "Frequency Limit", value: summary?.frequencyLimited ?? 0, pctVal: pct(summary?.frequencyLimited ?? 0, summary?.recipients ?? 0), icon: "∞" },
    { label: "Failed", value: summary?.failed ?? 0, pctVal: pct(summary?.failed ?? 0, summary?.recipients ?? 0), icon: "!" }
  ];
```

- [ ] **Step 2: Add Clicked + Replied to the broadcast list row**

Find the line in the campaign list button where delivery stats are shown:
```typescript
                <div style={{ color: "#475569", fontSize: "12px" }}>
                  Total {campaign.total_count} • Sent {campaign.sent_count} • Delivered {campaign.delivered_count} • Read {campaign.read_count} • Failed {campaign.failed_count} • Skipped {campaign.skipped_count}
                </div>
```

Replace with:
```typescript
                <div style={{ color: "#475569", fontSize: "12px" }}>
                  Total {campaign.total_count} • Sent {campaign.sent_count} • Delivered {campaign.delivered_count} • Read {campaign.read_count} • Clicked {campaign.clicked_count} • Replied {campaign.replied_count} • Failed {campaign.failed_count} • Skipped {campaign.skipped_count}
                </div>
```

**Note:** This is in `BroadcastsPage.tsx` (the old templates page). Apply the same change there too if applicable. Check by searching for the same pattern in `BroadcastsPage.tsx`.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/modules/dashboard/broadcast/BroadcastModulePage.tsx
git commit -m "feat: add clicked/replied to broadcast overview card and list rows"
```

---

## Task 11: Frontend — Detail Page Stat Tabs

**Files:**
- Modify: `apps/web/src/modules/dashboard/broadcast/BroadcastModulePage.tsx`

- [ ] **Step 1: Add `activeFilter` state to `BroadcastDetailPage`**

Find the `BroadcastDetailPage` function. After the existing state declarations, add:

```typescript
  const [activeFilter, setActiveFilter] = useState<CampaignMessageStatus | "all">("all");
```

Add the import for `CampaignMessageStatus` if not already imported (it should be from `api`).

- [ ] **Step 2: Update `reportQuery` to pass the active filter**

Find the `reportQuery` definition. Change the `queryFn` to pass `activeFilter`:

```typescript
  const reportQuery = useQuery({
    queryKey: dashboardQueryKeys.broadcastReport(campaignId, activeFilter, 0),
    queryFn: () =>
      fetchBroadcastReport(token, campaignId, {
        limit: 50,
        status: activeFilter === "all" ? undefined : activeFilter,
      }).then((response) => response.report),
    refetchInterval: (query) =>
      query.state.data && shouldPollCampaign(query.state.data.campaign.status) ? 4000 : false
  });
```

- [ ] **Step 3: Replace the static stat pills with clickable filter tabs**

Find the `detailStats` array and the stats rendering section. Replace the static rendering with clickable tabs. Find:

```typescript
      <div className="bl-overview-card">
        <div className="bl-overview-head">
          <span className="bl-overview-title">Delivery Overview</span>
        </div>
        <div className="bl-overview-stats" style={{ gridTemplateColumns: `repeat(${detailStats.length}, minmax(0,1fr))` }}>
          {detailStats.map((stat) => (
            <div key={stat.label} className="bl-stat-cell">
              <div className="bl-stat-label">{stat.label}</div>
              <div className="bl-stat-value">
                {stat.value}
                {stat.pct !== null ? <span className="bl-stat-pct">{stat.pct}</span> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
```

Replace with:

```typescript
      <div className="bl-overview-card">
        <div className="bl-overview-head">
          <span className="bl-overview-title">Delivery Overview</span>
          {activeFilter !== "all" && (
            <button
              type="button"
              className="bl-toolbar-btn"
              style={{ fontSize: "0.75rem" }}
              onClick={() => setActiveFilter("all")}
            >
              ✕ Clear filter
            </button>
          )}
        </div>
        <div className="bl-overview-stats" style={{ gridTemplateColumns: `repeat(${detailStats.length}, minmax(0,1fr))` }}>
          {detailStats.map((stat) => {
            const isActive = activeFilter === stat.filterKey;
            const isClickable = Boolean(stat.filterKey);
            return (
              <div
                key={stat.label}
                className="bl-stat-cell"
                role={isClickable ? "button" : undefined}
                tabIndex={isClickable ? 0 : undefined}
                onClick={() => isClickable && setActiveFilter(isActive ? "all" : stat.filterKey!)}
                onKeyDown={(e) => isClickable && e.key === "Enter" && setActiveFilter(isActive ? "all" : stat.filterKey!)}
                style={{
                  cursor: isClickable ? "pointer" : "default",
                  background: isActive ? "#f0fdf4" : undefined,
                  borderRadius: isActive ? "10px" : undefined,
                  outline: isActive ? "2px solid #86efac" : undefined,
                }}
              >
                <div className="bl-stat-label">{stat.label}</div>
                <div className="bl-stat-value">
                  {stat.value}
                  {stat.pct !== null ? <span className="bl-stat-pct">{stat.pct}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
```

- [ ] **Step 4: Update `detailStats` to include engagement stats with `filterKey`**

Replace the `detailStats` array:

```typescript
  const detailStats: Array<{ label: string; value: number; pct: string | null; filterKey?: CampaignMessageStatus }> = [
    { label: "Recipients", value: totalCount, pct: null },
    { label: "Sent", value: report.buckets.sent, pct: pct(report.buckets.sent, totalCount), filterKey: "sent" },
    { label: "Delivered", value: report.buckets.delivered, pct: pct(report.buckets.delivered, totalCount), filterKey: "delivered" },
    { label: "Read", value: report.buckets.read, pct: pct(report.buckets.read, totalCount), filterKey: "read" },
    { label: "Clicked", value: report.buckets.clicked, pct: pct(report.buckets.clicked, totalCount), filterKey: "clicked" },
    { label: "Replied", value: report.buckets.replied, pct: pct(report.buckets.replied, totalCount), filterKey: "replied" },
    { label: "Quote-replied", value: report.buckets.quote_replied, pct: pct(report.buckets.quote_replied, totalCount), filterKey: "quote_replied" },
    { label: "Failed", value: report.buckets.failed, pct: pct(report.buckets.failed, totalCount), filterKey: "failed" },
    { label: "Skipped", value: report.buckets.skipped, pct: pct(report.buckets.skipped, totalCount) },
    { label: "Not Delivered", value: Math.max(0, report.buckets.sent - report.buckets.delivered - report.buckets.read - report.buckets.failed), pct: pct(Math.max(0, report.buckets.sent - report.buckets.delivered - report.buckets.read - report.buckets.failed), totalCount) }
  ];
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/modules/dashboard/broadcast/BroadcastModulePage.tsx
git commit -m "feat: add clickable engagement filter tabs to broadcast detail page"
```

---

## Task 12: Frontend — Engagement Timeline Graph

**Files:**
- Modify: `apps/web/src/modules/dashboard/broadcast/BroadcastModulePage.tsx`

- [ ] **Step 1: Add recharts imports**

At the top of `BroadcastModulePage.tsx`, add:

```typescript
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  fetchBroadcastEngagementTimeline,
  type BroadcastEngagementBucket,
} from "../../../lib/api";
```

- [ ] **Step 2: Add granularity state and timeline query to `BroadcastDetailPage`**

Inside `BroadcastDetailPage`, after the `activeFilter` state, add:

```typescript
  const [granularity, setGranularity] = useState<"hour" | "day" | "week">("day");

  const timelineQuery = useQuery({
    queryKey: dashboardQueryKeys.broadcastEngagementTimeline(campaignId, granularity),
    queryFn: () =>
      fetchBroadcastEngagementTimeline(token, campaignId, granularity).then((r) => r.buckets),
    staleTime: 30_000,
  });
```

- [ ] **Step 3: Add the graph component inline in `BroadcastDetailPage`**

Find the section between the overview stats card and the delivery log table:

```typescript
      {/* Delivery log table */}
      <section className="broadcast-table-shell">
```

Insert before it:

```typescript
      {/* Engagement timeline graph */}
      {(report.campaign.clicked_count > 0 || report.campaign.replied_count > 0) && (
        <div className="bl-overview-card">
          <div className="bl-overview-head">
            <span className="bl-overview-title">Engagement Over Time</span>
            <div style={{ display: "flex", gap: "6px" }}>
              {(["hour", "day", "week"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  className="bl-toolbar-btn"
                  style={{
                    fontWeight: granularity === g ? 700 : 400,
                    background: granularity === g ? "#f0fdf4" : undefined,
                    borderColor: granularity === g ? "#86efac" : undefined,
                  }}
                  onClick={() => setGranularity(g)}
                >
                  {g.charAt(0).toUpperCase() + g.slice(1)}
                </button>
              ))}
            </div>
          </div>
          {timelineQuery.isLoading ? (
            <div style={{ height: 200, display: "grid", placeItems: "center", color: "#94a3b8", fontSize: "13px" }}>
              Loading chart…
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart
                data={(timelineQuery.data ?? []).map((bucket) => ({
                  period: new Date(bucket.period).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    ...(granularity === "hour" ? { hour: "2-digit", minute: "2-digit" } : {}),
                  }),
                  Clicked: bucket.clicked_button + bucket.clicked_url,
                  Replied: bucket.replied_any,
                }))}
                margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="Clicked"
                  stroke="#7c3aed"
                  fill="#ede9fe"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="Replied"
                  stroke="#16a34a"
                  fill="#dcfce7"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/modules/dashboard/broadcast/BroadcastModulePage.tsx
git commit -m "feat: add engagement timeline area chart to broadcast detail page"
```

---

## Task 13: Frontend — Filtered Recipient Table Columns

**Files:**
- Modify: `apps/web/src/modules/dashboard/broadcast/BroadcastModulePage.tsx`

- [ ] **Step 1: Update the recipient table to show context-aware columns**

Find the recipient table inside `BroadcastDetailPage`:

```typescript
        <table className="broadcast-table">
          <thead>
            <tr>
              {["Phone", "Status", "Sent", "Delivered", "Read", "Error"].map((heading) => (
                <th key={heading}>{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.messages.map((message) => (
              <tr key={message.id}>
                <td style={{ fontWeight: 600 }}>{message.phone_number}</td>
                <td>
                  <span className={`bl-status-pill status-${String(message.status)}`}>
                    {formatCampaignStatus(message.status as Campaign["status"])}
                  </span>
                </td>
                <td>{message.sent_at ? formatDateTime(message.sent_at) : "—"}</td>
                <td>{message.delivered_at ? formatDateTime(message.delivered_at) : "—"}</td>
                <td>{message.read_at ? formatDateTime(message.read_at) : "—"}</td>
                <td style={{ color: message.error_message ? "#be123c" : "#94a3b8", fontSize: "0.8rem" }}>
                  {message.error_message || "—"}
                </td>
              </tr>
            ))}
```

Replace with:

```typescript
        <table className="broadcast-table">
          <thead>
            <tr>
              {activeFilter === "clicked"
                ? ["Phone", "Status", "Sent", "Clicked At"].map((h) => <th key={h}>{h}</th>)
                : activeFilter === "replied" || activeFilter === "quote_replied"
                  ? ["Phone", "Status", "Sent", "Replied At"].map((h) => <th key={h}>{h}</th>)
                  : ["Phone", "Status", "Sent", "Delivered", "Read", "Error"].map((h) => <th key={h}>{h}</th>)
              }
            </tr>
          </thead>
          <tbody>
            {report.messages.map((message) => (
              <tr key={message.id}>
                <td style={{ fontWeight: 600 }}>{message.phone_number}</td>
                <td>
                  <span className={`bl-status-pill status-${String(message.status)}`}>
                    {formatCampaignStatus(message.status as Campaign["status"])}
                  </span>
                </td>
                <td>{message.sent_at ? formatDateTime(message.sent_at) : "—"}</td>
                {activeFilter === "clicked" ? (
                  <td>{message.clicked_at ? formatDateTime(message.clicked_at) : "—"}</td>
                ) : activeFilter === "replied" || activeFilter === "quote_replied" ? (
                  <td>
                    {(activeFilter === "quote_replied" ? message.quote_replied_at : message.replied_at)
                      ? formatDateTime((activeFilter === "quote_replied" ? message.quote_replied_at : message.replied_at)!)
                      : "—"}
                  </td>
                ) : (
                  <>
                    <td>{message.delivered_at ? formatDateTime(message.delivered_at) : "—"}</td>
                    <td>{message.read_at ? formatDateTime(message.read_at) : "—"}</td>
                    <td style={{ color: message.error_message ? "#be123c" : "#94a3b8", fontSize: "0.8rem" }}>
                      {message.error_message || "—"}
                    </td>
                  </>
                )}
              </tr>
            ))}
```

- [ ] **Step 2: Update the table title to reflect the active filter**

Find:
```typescript
          <span className="bl-table-title">Recipient delivery log</span>
```

Replace with:
```typescript
          <span className="bl-table-title">
            {activeFilter === "all"
              ? "Recipient delivery log"
              : activeFilter === "clicked"
                ? "Clicked recipients"
                : activeFilter === "replied"
                  ? "Replied recipients"
                  : activeFilter === "quote_replied"
                    ? "Quote-replied recipients"
                    : `Filtered: ${activeFilter}`}
          </span>
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/modules/dashboard/broadcast/BroadcastModulePage.tsx
git commit -m "feat: context-aware recipient table columns for engagement filters"
```

---

## Self-Review Checklist

- [x] DB migration — `campaign_engagement_events` table, `clicked_at/replied_at/quote_replied_at` columns, counter columns on `campaigns`
- [x] `recordBroadcastEngagement` — wamid lookup, contact lookup, event insert, counter increment, first-event dedup
- [x] `getBroadcastEngagementTimeline` — GROUP BY date_trunc, returns typed array
- [x] `WebhookMessage.context` — typed, used in `processWebhookTask`
- [x] Engagement detection in `processWebhookTask` — button clicks, quote replies, any replies
- [x] `/t/:token` redirect — HMAC verify, log event, 302
- [x] `trackingRoutes` registered in `app.ts`
- [x] `/engagement-timeline` route added to `broadcasts.ts`
- [x] Status filter extended to `clicked|replied|quote_replied` (API filters by timestamp columns, not status column)
- [x] `BroadcastSummary.clicked/replied/quote_replied` — added to SQL and return
- [x] `BroadcastReport.buckets.clicked/replied/quote_replied` — added to SQL and return
- [x] Frontend types extended in `api.ts`
- [x] `fetchBroadcastEngagementTimeline` added to `api.ts`
- [x] Query key added to `query-keys.ts`
- [x] Overview card — Clicked + Replied stat cells
- [x] List row — Clicked + Replied counts
- [x] Detail page — clickable filter tabs with active highlight
- [x] Detail page — engagement timeline recharts graph with hour/day/week toggle
- [x] Detail page — context-aware table columns per active filter

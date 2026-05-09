# Broadcast Engagement Tracking — Design Spec
**Date:** 2026-05-10  
**Status:** Approved

## Overview

Add Clicked and Replied tracking to the broadcast feature. Users need to filter broadcast reports by these engagement types and see per-day/hour/week graphs — similar to the reference image showing Clicked (45%, 7.3K) and Replied (42%, 7.5K) as stat pills with an area chart below.

Engagement stats surface in three places:
1. Top-level overview card (aggregate across all broadcasts)
2. Per-broadcast row in the list page
3. Broadcast detail page (stat tabs + graph + filtered recipient table)

---

## Section 1: Database Schema

### Migration `0074_broadcast_engagement.sql`

```sql
-- Append-only event log — drives time-series graphs
CREATE TABLE campaign_engagement_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_msg_id  UUID        REFERENCES campaign_messages(id) ON DELETE SET NULL,
  contact_id       UUID        REFERENCES contacts(id) ON DELETE SET NULL,
  event_type       TEXT        NOT NULL
                     CHECK (event_type IN ('clicked_button','clicked_url','replied_any','replied_quote')),
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX campaign_engagement_campaign_time_idx
  ON campaign_engagement_events(campaign_id, occurred_at);

-- Per-recipient timestamps on campaign_messages
ALTER TABLE campaign_messages
  ADD COLUMN clicked_at       TIMESTAMPTZ,
  ADD COLUMN replied_at       TIMESTAMPTZ,
  ADD COLUMN quote_replied_at TIMESTAMPTZ;

-- Fast aggregate counters on campaigns
ALTER TABLE campaigns
  ADD COLUMN clicked_count       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN replied_count       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN quote_replied_count INTEGER NOT NULL DEFAULT 0;
```

**Design notes:**
- `campaign_engagement_events` is append-only. One row per event occurrence (a contact can click multiple times — all logged).
- Counter columns (`clicked_count` etc.) on `campaigns` are incremented atomically via `UPDATE ... SET clicked_count = clicked_count + 1`. They count distinct recipients who ever engaged (first-event-only semantics enforced in the write service).
- `clicked_at` / `replied_at` / `quote_replied_at` on `campaign_messages` are set only once (first occurrence via `COALESCE(clicked_at, NOW())`).

---

## Section 2: Where Data Comes From (Meta Webhooks)

Meta sends two distinct webhook event types to `/api/meta/webhook`:

### A. Delivery status events (`statuses` array)
Already handled. No changes needed for engagement tracking.

### B. Inbound messages (`messages` array)
This is the primary source for all engagement events.

#### Exact Meta webhook payloads:

**Quick-reply button tap** (`type: "button"`) — fired when user taps a quick-reply button on a template:
```json
{
  "type": "button",
  "context": { "from": "PHONE", "id": "wamid.ORIGINAL_OUTBOUND_WAMID" },
  "button": { "text": "Shop Now", "payload": "CUSTOM_PAYLOAD" }
}
```

**Interactive button_reply** (`type: "interactive"`) — fired for non-template interactive buttons:
```json
{
  "type": "interactive",
  "context": { "from": "PHONE", "id": "wamid.ORIGINAL_WAMID" },
  "interactive": { "type": "button_reply", "button_reply": { "id": "BTN_ID", "title": "Title" } }
}
```

**Quote-reply (any message type)** — `context.id` is present on ALL replies:
```json
{
  "type": "text",
  "context": { "from": "PHONE", "id": "wamid.ORIGINAL_WAMID" },
  "text": { "body": "I want to order!" }
}
```

**URL button (CTA) clicks** — Meta does NOT send webhooks for URL button taps. Tracked via our own redirect endpoint (see Section 3D).

#### Event detection logic (in `recordBroadcastEngagement`):

| Event | Condition | Mechanism |
|---|---|---|
| `clicked_button` | `message.type === "button"` OR `message.interactive?.button_reply` | `context.id` → `campaign_messages.wamid` lookup |
| `clicked_url` | HTTP GET to `/t/:token` | HMAC token decodes `{campaign_msg_id, destination_url}` |
| `replied_quote` | `message.context?.id` exists AND message is NOT a button type | `context.id` → `campaign_messages.wamid` lookup |
| `replied_any` | Any inbound from contact with a recent campaign message | `contact_id` → `campaign_messages` within 7 days |

#### Code changes for inbound path:

1. **`WebhookMessage` interface** (in `meta-whatsapp-service.ts`) — add `context?: { id?: string; from?: string }`
2. **`processWebhookTask`** — after `processIncomingMessage`, call `recordBroadcastEngagement(userId, message, contactId)`
3. **New `recordBroadcastEngagement` function** (in `campaign-service.ts`) — performs wamid/contact lookup, inserts event, increments counters, sets timestamps (all in one transaction)
4. **Template send time** — when a template has URL buttons with a `{{1}}` suffix variable, inject a tracking URL suffix encoding the campaign_msg_id

---

## Section 3: API Changes

### A. `GET /api/broadcasts/:id/report` (extended)

`CampaignMessage` gains: `clicked_at`, `replied_at`, `quote_replied_at`  
`Campaign` gains: `clicked_count`, `replied_count`, `quote_replied_count`  
`BroadcastReport.buckets` gains: `clicked`, `replied`, `quote_replied`  
`CampaignMessageStatus` gains: `"clicked"`, `"replied"`, `"quote_replied"` for `?status=` filter. **Important:** these are NOT stored in `campaign_messages.status` (that column stays unchanged). The API filters by `clicked_at IS NOT NULL` / `replied_at IS NOT NULL` / `quote_replied_at IS NOT NULL` when these values are passed as the status param.

### B. `GET /api/broadcasts` + `GET /api/broadcasts/summary` (extended)

`BroadcastSummary` gains:
```ts
clicked: number;
replied: number;
quote_replied: number;
```

### C. New: `GET /api/broadcasts/:id/engagement-timeline`

Query params: `?granularity=hour|day|week`

Response:
```ts
{
  buckets: Array<{
    period: string;          // ISO timestamp of bucket start
    clicked_button: number;
    clicked_url: number;
    replied_any: number;
    replied_quote: number;
  }>
}
```

Implementation: `date_trunc($granularity, occurred_at)` GROUP BY on `campaign_engagement_events` — fast via index on `(campaign_id, occurred_at)`.

### D. New: `GET /t/:token` (public, no auth)

- Verifies HMAC-SHA256 signature (secret = workspace env var)
- Decodes `{campaign_msg_id, destination_url}` from token
- Inserts `clicked_url` event into `campaign_engagement_events`
- Atomically increments `campaigns.clicked_count` and sets `campaign_messages.clicked_at`
- Returns `302` redirect to `destination_url`
- Idempotent: duplicate clicks still log events but counter uses `COALESCE(clicked_at, NOW())` semantics

Token format: `base64url(JSON.stringify({c: campaign_msg_id, u: destination_url})).HMAC`

---

## Section 4: Frontend

### A. Overview card (`BroadcastListPage`)

Add to `overviewStats` array:
- `Clicked` — `summary.clicked` / `summary.recipients %`
- `Replied` — `summary.replied` / `summary.recipients %`

Data from extended `BroadcastSummary`.

### B. Broadcast list row

Current: `Total • Sent • Delivered • Read • Failed • Skipped`  
Updated: `Total • Sent • Delivered • Read • Clicked • Replied • Failed • Skipped`

### C. Detail page — stat pills (clickable filter tabs)

Current stats: Recipients, Sent, Delivered, Read, Failed, Skipped, Not Delivered  
Add: **Clicked** (button+url combined), **Replied** (any), **Quote-replied**

Each pill is a **clickable tab**. Clicking one:
- Highlights that pill as active
- Filters the recipient table to only matching rows (passes `?status=clicked` to API)
- Resets to "all" when clicked again

### D. Detail page — engagement graph (new component)

Position: between stat pills and recipient table.

```
Granularity toggle: [Hour]  [Day]  [Week]

Area chart (recharts AreaChart):
  X-axis: formatted period labels
  Y-axis: count
  Area 1: clicked_button + clicked_url (purple, label "Clicked")
  Area 2: replied_any (green, label "Replied")
  Tooltip: shows breakdown on hover
```

Data: `GET /api/broadcasts/:id/engagement-timeline?granularity=day`  
Refetches when granularity toggle changes. Shows loading skeleton while fetching.  
Hidden entirely if `clicked_count + replied_count === 0`.

### E. Recipient table (detail page)

Default view (all): existing columns (Phone, Status, Sent, Delivered, Read, Error)  
Clicked filter active: columns → Phone, Clicked At, Button/URL  
Replied filter active: columns → Phone, Replied At, Quote Reply  
Quote-replied filter: columns → Phone, Quote Replied At, Original Message Wamid

Status filter passed as `?status=clicked|replied|quote_replied` to `fetchBroadcastReport`.  
`fetchBroadcastReport` in `api.ts` updated to accept extended `CampaignMessageStatus`.

---

## Type Changes Summary

### `apps/web/src/lib/api.ts`
```ts
// Extended
export type CampaignMessageStatus =
  "queued" | "sending" | "sent" | "delivered" | "read" | "failed" | "skipped"
  | "clicked" | "replied" | "quote_replied";

export type RetargetStatus = "sent" | "delivered" | "read" | "failed" | "skipped";
// (RetargetStatus unchanged — engagement not used for retargeting yet)

export interface CampaignMessage {
  // ... existing fields ...
  clicked_at: string | null;
  replied_at: string | null;
  quote_replied_at: string | null;
}

export interface Campaign {
  // ... existing fields ...
  clicked_count: number;
  replied_count: number;
  quote_replied_count: number;
}

export interface BroadcastSummary {
  // ... existing fields ...
  clicked: number;
  replied: number;
  quote_replied: number;
}

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
): Promise<{ buckets: BroadcastEngagementBucket[] }>;
```

---

## Files to Create / Modify

### Backend (`apps/api/src/`)
| File | Change |
|---|---|
| `infra/migrations/0074_broadcast_engagement.sql` | New migration |
| `services/campaign-service.ts` | Add `recordBroadcastEngagement`, `getBroadcastEngagementTimeline`, extend types |
| `services/meta-whatsapp-service.ts` | Add `context` to `WebhookMessage`, call `recordBroadcastEngagement` in `processWebhookTask` |
| `services/broadcast-service.ts` | Extend `getBroadcastReport`, `getBroadcastSummary`, `listBroadcasts` |
| `routes/broadcasts.ts` | Add `/engagement-timeline` route, extend status filter enum |
| `routes/tracking.ts` | New file — `/t/:token` redirect handler |
| `app.ts` | Register `trackingRoutes` |

### Frontend (`apps/web/src/`)
| File | Change |
|---|---|
| `lib/api.ts` | Extend types + add `fetchBroadcastEngagementTimeline` |
| `shared/dashboard/query-keys.ts` | Add `broadcastEngagementTimeline` key |
| `modules/dashboard/broadcast/BroadcastModulePage.tsx` | Stat tabs, graph, filtered table, list row |

---

## Out of Scope
- Retargeting by clicked/replied (RetargetStatus unchanged)
- Meta's native "Track click events" marketing feature (opt-in per WABA, not universally available)
- Per-button breakdown (which specific button was clicked)
- Click deduplication beyond first-click semantics on counters

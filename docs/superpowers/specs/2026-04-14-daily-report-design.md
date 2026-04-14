# Daily End-of-Day Report — Design Spec

**Date:** 2026-04-14  
**Status:** Approved  

---

## Overview

Add a daily summary email report feature to WagenAI. Users opt in via a toggle in the Settings tab. At 11:59 PM (server timezone) a BullMQ cron enqueues one job per opted-in user. A worker generates a rich HTML email with conversation insights, broadcast stats, AI alerts, and automation counts, then sends it via Brevo.

---

## Goals

- One-click opt-in/opt-out in Settings → Notifications
- Premium email with leads, complaints, feedback, broadcast stats, AI insights, automation counts, and alerts
- Zero extra UI for email address — uses the account email
- Plugs into existing BullMQ + Redis infrastructure (no separate process)

---

## Non-Goals

- Per-user timezone selection (fixed server timezone)
- Configurable send time
- Multiple recipient addresses
- Weekly or custom-frequency reports (future)

---

## Database Changes

### Migration 0030 — `users.daily_report_enabled`

```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daily_report_enabled BOOLEAN NOT NULL DEFAULT FALSE;
```

### Migration 0031 — `conversation_insights`

```sql
CREATE TABLE IF NOT EXISTS conversation_insights (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type             TEXT        NOT NULL CHECK (type IN ('lead', 'complaint', 'feedback')),
  summary          TEXT        NOT NULL,
  sentiment        TEXT        CHECK (sentiment IN ('positive', 'neutral', 'negative', 'angry', 'frustrated')),
  priority_score   INTEGER     NOT NULL DEFAULT 50 CHECK (priority_score >= 0 AND priority_score <= 100),
  status           TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'pending')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id)
);

CREATE INDEX IF NOT EXISTS conversation_insights_user_type_score_idx
  ON conversation_insights(user_id, type, priority_score DESC, created_at DESC);
```

**Priority score semantics:**
- 80–100 → 🔴 Hot lead
- 50–79 → 🟡 Warm
- 0–49 → ⚪ Cold

---

## Backend Components

### New files

#### `apps/api/src/services/conversation-insight-service.ts`

Upserts a row in `conversation_insights` whenever the AI classifies or reclassifies a conversation.

```
upsertConversationInsight(conversationId, userId, {
  type,        // 'lead' | 'complaint' | 'feedback'
  summary,     // 1-line AI-generated summary of the conversation
  sentiment,   // derived from message tone
  priority_score, // conversations.score value
  status       // 'open' | 'resolved' | 'pending'
})
```

Called from `conversation-service.ts` after AI classification updates `conversations.lead_kind`.

---

#### `apps/api/src/services/daily-report-worker-service.ts`

BullMQ worker on queue `"daily-report"`. One job per user per day.

**Job payload:** `{ userId: string }`

**Worker logic:**

1. Load user (email, name) from `users`
2. Query today's data:

| Section | Query |
|---------|-------|
| Overview | `COUNT(*)` from `conversations` by `lead_kind` where `last_message_at >= today_start` |
| Top leads | `conversation_insights` WHERE `type='lead'` ORDER BY `priority_score DESC` LIMIT 5 |
| Top complaints | `conversation_insights` WHERE `type='complaint'` ORDER BY `priority_score DESC` LIMIT 5 |
| Top feedback | `conversation_insights` WHERE `type='feedback'` ORDER BY `priority_score DESC` LIMIT 5 |
| Broadcast | `campaigns` WHERE `completed_at >= today_start`: sum `sent_count`, `delivered_count`, `failed_count` |
| AI unanswered | `COUNT(*)` from `ai_review_queue` WHERE `created_at >= today_start` |
| Sequences | `COUNT(*)` from `sequence_enrollments` WHERE `status='completed'` AND `updated_at >= today_start` |
| Flow sessions | `COUNT(*)` from `flow_sessions` WHERE `status='completed'` AND `updated_at >= today_start` |

3. Derive alerts:
   - Broadcast failure alert if `failed_count > 100` or `failed_count / sent_count > 0.05`
   - Unanswered alert if AI unanswered count `> 10`
   - Unresolved complaints alert if open complaints `> 0`

4. Generate HTML email (see Email Template section)
5. Send via Brevo SMTP API (`POST https://api.brevo.com/v3/smtp/email`)
6. Log success; on failure BullMQ retries up to 3× with exponential backoff

---

### Modified files

#### `apps/api/src/services/queue-service.ts`

Add `"daily-report"` to `managedQueueNames` and export a named getter following the same pattern as `getCampaignDispatchQueue`:

```ts
export const managedQueueNames = [
  // ... existing names
  "daily-report",
] as const;

// Add alongside existing getters:
export function getDailyReportQueue(): Queue | null {
  return getOrInitQueues()?.find(q => q.name === "daily-report") ?? null;
}
```

---

#### `apps/api/src/worker.ts`

```ts
import cron from "node-cron";
import { startDailyReportWorker, stopDailyReportWorker } from "./services/daily-report-worker-service.js";
import { pool } from "./db/pool.js";
import { getDailyReportQueue } from "./services/queue-service.js";

// Start the worker
startDailyReportWorker();

// Cron: 23:59 every day (server timezone)
cron.schedule("59 23 * * *", async () => {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE daily_report_enabled = TRUE"
  );
  const queue = getDailyReportQueue();
  if (!queue) return; // Redis not configured
  for (const user of rows) {
    const jobId = `daily-report-${user.id}-${new Date().toISOString().slice(0, 10)}`;
    await queue.add("send-report", { userId: user.id }, {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    });
  }
});

// Shutdown
const shutdown = async () => {
  await stopDailyReportWorker();
  // ... existing stops
};
```

---

#### `apps/api/src/routes/notifications.ts` (new route file)

```
PATCH /api/notifications/settings
Body: { dailyReportEnabled: boolean }
Auth: requireAuth
```

Updates `users.daily_report_enabled` for the authenticated user. Returns `{ dailyReportEnabled: boolean }`.

Register in `apps/api/src/app.ts` alongside other route registrations.

---

#### `apps/api/src/services/conversation-service.ts`

After updating `conversations.lead_kind` and `conversations.score`, call:

```ts
await upsertConversationInsight(conversationId, userId, {
  type: newLeadKind,
  summary: generatedSummary,
  sentiment: derivedSentiment,
  priority_score: conversation.score,
  status: "open",
});
```

---

## API

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| `PATCH` | `/api/notifications/settings` | ✅ | `{ dailyReportEnabled: boolean }` | `{ dailyReportEnabled: boolean }` |
| `GET` | `/api/notifications/settings` | ✅ | — | `{ dailyReportEnabled: boolean }` |

---

## Frontend Changes

### `apps/web/src/pages/dashboard/tabs/settings-tab.tsx`

Add a **Notifications** section below existing settings sections.

**New props to add to `SettingsTabProps`:**
```ts
dailyReportEnabled: boolean;
dailyReportBusy: boolean;
onToggleDailyReport: () => void;
```

**UI element:**

A labelled section header `NOTIFICATIONS` followed by a single card row:

```
┌─────────────────────────────────────────────────────┐
│  📊 Daily Summary Email                    [ ● ON ] │
│  Receive a daily recap of conversations,            │
│  leads & complaints — sent at 11:59 PM              │
└─────────────────────────────────────────────────────┘
Report will be sent to: user@example.com
```

- Toggle calls `onToggleDailyReport` → `PATCH /api/notifications/settings`
- While saving, disable the toggle and show a spinner (uses existing `busy` pattern)
- Optimistic update: flip the boolean immediately, revert on error

---

## Email Template

**Subject:** `WagenAI Daily Report — {date}`

**Sections (in order):**

1. **Header** — gradient banner with date
2. **Overview** — 4-stat grid: Conversations / Leads / Complaints / Feedback
3. **Top Leads** — up to 5, each showing: phone, summary, intent badge (🔴/🟡/⚪ + score), status
4. **Top Complaints** — up to 5, each showing: phone, issue summary, sentiment badge, resolution status
5. **Customer Feedback** — up to 5 positive/negative snippets
6. **Broadcast Performance** — campaigns sent, delivered count, failed count (with ⚠️ if failed > threshold)
7. **AI Insights** — unanswered questions count + one example question
8. **Automation** — sequences completed today, flow sessions completed today
9. **Alerts** — derived list of actionable warnings (only shown if alerts exist)
10. **CTA button** — "View Full Dashboard →" linking to the dashboard URL
11. **Settings link** — "Manage notification settings" linking to the Settings tab in the dashboard (authenticated; users disable from there)

**Sent via:** Brevo SMTP API  
**Sender:** `reports@wagenai.com`  
**Retry:** 3 attempts with exponential backoff (handled by BullMQ)

---

## Environment Variables

No new env vars required. Brevo API key already in `BREVO_API_KEY`.

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Brevo API returns non-2xx | Throw — BullMQ retries up to 3× |
| User has no conversations today | Send report with zeros (good for SaaS stickiness) |
| `conversation_insights` is empty | Skip those sections gracefully, still send overview |
| Cron fires but queue enqueue fails | Log error, skip that user, continue loop |

---

## Out of Scope (Future)

- True one-click unsubscribe from email (requires unauthenticated token endpoint — future compliance work)
- Per-user timezone setting
- Weekly digest option
- Broadcast failure details table in migrations (currently using `campaigns` table)
- Lead score badge on dashboard UI
- Auto-assign agent on complaint escalation

# Daily End-of-Day Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a daily summary email report feature — users toggle it in Settings, a BullMQ worker sends a rich HTML email every night at 23:59 via Brevo.

**Architecture:** Two DB migrations add a toggle column and an insights table. A new `conversation-insight-service` writes insights on every AI classification. A new `daily-report-worker-service` plugs into the existing BullMQ + Redis infra (no new dependencies), fires at 23:59 via a self-rescheduling `setTimeout`, queries all data from existing tables, and sends email via Brevo. A new Fastify route handles the toggle. The Settings page gets a Notifications section.

**Tech Stack:** Node.js + TypeScript, PostgreSQL (pg), BullMQ 5, Fastify 5, React + TanStack Query, Brevo SMTP API (existing `BREVO_API_KEY` env var).

---

## File Map

**Create:**
- `infra/migrations/0030_daily_report_toggle.sql`
- `infra/migrations/0031_conversation_insights.sql`
- `apps/api/src/services/conversation-insight-service.ts`
- `apps/api/src/services/daily-report-worker-service.ts`
- `apps/api/src/routes/notifications.ts`

**Modify:**
- `apps/api/src/services/queue-service.ts` — add `"daily-report"` queue name + `getDailyReportQueue()` getter
- `apps/api/src/worker.ts` — import and start daily report worker
- `apps/api/src/app.ts` — import and register notifications routes
- `apps/api/src/services/conversation-service.ts` — call `upsertConversationInsight` after classification update (around line 591)
- `apps/web/src/lib/api.ts` — add `getNotificationSettings` + `updateNotificationSettings`
- `apps/web/src/modules/dashboard/settings/api.ts` — re-export the two new functions
- `apps/web/src/modules/dashboard/settings/settings-page.tsx` — add state + mutation + pass props
- `apps/web/src/pages/dashboard/tabs/settings-tab.tsx` — add props + render Notifications section

---

## Task 1: Migration — `users.daily_report_enabled`

**Files:**
- Create: `infra/migrations/0030_daily_report_toggle.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- infra/migrations/0030_daily_report_toggle.sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daily_report_enabled BOOLEAN NOT NULL DEFAULT FALSE;
```

- [ ] **Step 2: Apply migration**

```bash
cd apps/api && npm run db:migrate
```

Expected output: `[migrate] Applied migration: 0030_daily_report_toggle`

- [ ] **Step 3: Verify column exists**

```bash
cd apps/api && npm run db:migrate:status
```

Expected: migration `0030` shows as applied.

- [ ] **Step 4: Commit**

```bash
git add infra/migrations/0030_daily_report_toggle.sql
git commit -m "feat(db): add daily_report_enabled column to users"
```

---

## Task 2: Migration — `conversation_insights` table

**Files:**
- Create: `infra/migrations/0031_conversation_insights.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- infra/migrations/0031_conversation_insights.sql
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

DROP TRIGGER IF EXISTS conversation_insights_touch_updated_at ON conversation_insights;
CREATE TRIGGER conversation_insights_touch_updated_at
  BEFORE UPDATE ON conversation_insights
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();
```

- [ ] **Step 2: Apply migration**

```bash
cd apps/api && npm run db:migrate
```

Expected: `[migrate] Applied migration: 0031_conversation_insights`

- [ ] **Step 3: Commit**

```bash
git add infra/migrations/0031_conversation_insights.sql
git commit -m "feat(db): add conversation_insights table"
```

---

## Task 3: `conversation-insight-service.ts`

**Files:**
- Create: `apps/api/src/services/conversation-insight-service.ts`

- [ ] **Step 1: Create the service**

```typescript
// apps/api/src/services/conversation-insight-service.ts
import { pool } from "../db/pool.js";

export type InsightType = "lead" | "complaint" | "feedback";
export type InsightSentiment = "positive" | "neutral" | "negative" | "angry" | "frustrated";
export type InsightStatus = "open" | "resolved" | "pending";

export interface UpsertInsightParams {
  type: InsightType;
  summary: string;
  sentiment: InsightSentiment | null;
  priority_score: number;
  status: InsightStatus;
}

export async function upsertConversationInsight(
  conversationId: string,
  userId: string,
  params: UpsertInsightParams
): Promise<void> {
  await pool.query(
    `INSERT INTO conversation_insights
       (conversation_id, user_id, type, summary, sentiment, priority_score, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (conversation_id) DO UPDATE SET
       type           = EXCLUDED.type,
       summary        = EXCLUDED.summary,
       sentiment      = EXCLUDED.sentiment,
       priority_score = EXCLUDED.priority_score,
       status         = EXCLUDED.status,
       updated_at     = NOW()`,
    [
      conversationId,
      userId,
      params.type,
      params.summary,
      params.sentiment,
      params.priority_score,
      params.status
    ]
  );
}

export function deriveSentiment(
  type: InsightType,
  score: number
): InsightSentiment | null {
  if (type === "lead") return null;
  if (type === "complaint") {
    return score < 40 ? "angry" : "frustrated";
  }
  // feedback
  return score >= 50 ? "positive" : "negative";
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/api && npm run lint
```

Expected: no errors in `conversation-insight-service.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/conversation-insight-service.ts
git commit -m "feat: add conversation-insight-service with upsert + sentiment derivation"
```

---

## Task 4: Add `"daily-report"` queue to `queue-service.ts`

**Files:**
- Modify: `apps/api/src/services/queue-service.ts`

- [ ] **Step 1: Add `"daily-report"` to `managedQueueNames`**

Find the `managedQueueNames` array (currently the first export) and add the new name:

```typescript
export const managedQueueNames = [
  "campaign-dispatch",
  "campaign-message-send",
  "sequence-enrollment-run",
  "sequence-enrollment-retry",
  "delivery-webhook-process",
  "outbound-execution",
  "outbound-qr-execution",
  "daily-report"
] as const;
```

- [ ] **Step 2: Add `getDailyReportQueue` getter**

Add after the last existing getter (after `getOutboundQrExecutionQueue`):

```typescript
export function getDailyReportQueue(): Queue | null {
  return getManagedQueue("daily-report");
}
```

- [ ] **Step 3: Type-check**

```bash
cd apps/api && npm run lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/queue-service.ts
git commit -m "feat: add daily-report queue to queue-service"
```

---

## Task 5: `daily-report-worker-service.ts`

**Files:**
- Create: `apps/api/src/services/daily-report-worker-service.ts`

- [ ] **Step 1: Create the worker service**

```typescript
// apps/api/src/services/daily-report-worker-service.ts
import { Worker } from "bullmq";
import { pool } from "../db/pool.js";
import { createQueueWorkerConnection, getDailyReportQueue } from "./queue-service.js";
import { env } from "../config/env.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReportUser {
  id: string;
  name: string;
  email: string;
}

interface InsightRow {
  conversation_id: string;
  phone_number: string;
  summary: string;
  sentiment: string | null;
  priority_score: number;
  status: string;
}

interface OverviewRow {
  lead_kind: string;
  count: string;
}

interface BroadcastRow {
  sent_count: string;
  delivered_count: string;
  failed_count: string;
}

interface AiReviewRow {
  count: string;
  example_question: string | null;
}

interface AutomationRow {
  sequences_completed: string;
  flows_completed: string;
}

// ─── Data Queries ─────────────────────────────────────────────────────────────

function todayRange(): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

async function fetchOverview(userId: string, start: Date): Promise<Record<string, number>> {
  const result = await pool.query<OverviewRow>(
    `SELECT lead_kind, COUNT(*)::text AS count
     FROM conversations
     WHERE user_id = $1 AND last_message_at >= $2
     GROUP BY lead_kind`,
    [userId, start]
  );
  const map: Record<string, number> = { lead: 0, complaint: 0, feedback: 0, other: 0 };
  for (const row of result.rows) {
    map[row.lead_kind] = parseInt(row.count, 10);
  }
  const total = result.rows.reduce((sum, r) => sum + parseInt(r.count, 10), 0);
  return { ...map, total };
}

async function fetchTopInsights(userId: string, type: string, limit = 5): Promise<InsightRow[]> {
  const result = await pool.query<InsightRow>(
    `SELECT ci.conversation_id,
            c.phone_number,
            COALESCE(ls.summary_text, ci.summary) AS summary,
            ci.sentiment,
            ci.priority_score,
            ci.status
     FROM conversation_insights ci
     JOIN conversations c ON c.id = ci.conversation_id
     LEFT JOIN lead_summaries ls ON ls.conversation_id = ci.conversation_id
     WHERE ci.user_id = $1 AND ci.type = $2
     ORDER BY ci.priority_score DESC
     LIMIT $3`,
    [userId, type, limit]
  );
  return result.rows;
}

async function fetchBroadcastStats(userId: string, start: Date): Promise<BroadcastRow | null> {
  const result = await pool.query<BroadcastRow>(
    `SELECT
       COALESCE(SUM(sent_count), 0)::text      AS sent_count,
       COALESCE(SUM(delivered_count), 0)::text AS delivered_count,
       COALESCE(SUM(failed_count), 0)::text    AS failed_count
     FROM campaigns
     WHERE user_id = $1
       AND status = 'completed'
       AND completed_at >= $2`,
    [userId, start]
  );
  return result.rows[0] ?? null;
}

async function fetchAiInsights(userId: string, start: Date): Promise<AiReviewRow> {
  const result = await pool.query<AiReviewRow>(
    `SELECT
       COUNT(*)::text AS count,
       (SELECT question FROM ai_review_queue
        WHERE user_id = $1 AND created_at >= $2
        ORDER BY created_at DESC LIMIT 1) AS example_question
     FROM ai_review_queue
     WHERE user_id = $1 AND created_at >= $2`,
    [userId, start]
  );
  return result.rows[0] ?? { count: "0", example_question: null };
}

async function fetchAutomationStats(userId: string, start: Date): Promise<AutomationRow> {
  const seqResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM sequence_enrollments
     WHERE sequence_id IN (SELECT id FROM sequences WHERE user_id = $1)
       AND status = 'completed'
       AND updated_at >= $2`,
    [userId, start]
  );
  const flowResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM flow_sessions
     WHERE user_id = $1 AND status = 'completed' AND updated_at >= $2`,
    [userId, start]
  );
  return {
    sequences_completed: seqResult.rows[0]?.count ?? "0",
    flows_completed: flowResult.rows[0]?.count ?? "0"
  };
}

// ─── HTML Email Generator ─────────────────────────────────────────────────────

function scoreBadge(score: number): string {
  if (score >= 80) return `🔴 HOT · ${score}`;
  if (score >= 50) return `🟡 WARM · ${score}`;
  return `⚪ COLD · ${score}`;
}

function sentimentBadge(sentiment: string | null): string {
  const map: Record<string, string> = {
    angry: "😡 Angry",
    frustrated: "😤 Frustrated",
    negative: "😞 Negative",
    positive: "😊 Positive",
    neutral: "😐 Neutral"
  };
  return sentiment ? (map[sentiment] ?? sentiment) : "";
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    open: "❌ Not resolved",
    pending: "⏳ Follow-up pending",
    resolved: "✅ Resolved"
  };
  return map[status] ?? status;
}

function insightRows(rows: InsightRow[], mode: "lead" | "complaint" | "feedback"): string {
  if (rows.length === 0) return `<p style="color:#888;font-size:12px;margin:0">No ${mode}s today.</p>`;
  return rows
    .map(
      (r) => `
      <div style="border-left:3px solid ${mode === "lead" ? "#6c47ff" : mode === "complaint" ? "#ef4444" : "#22c55e"};padding:8px 12px;margin-bottom:8px;background:#fafafa;border-radius:0 6px 6px 0">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:12px;font-weight:600;color:#333">${r.phone_number}</span>
          ${mode === "lead" ? `<span style="background:#f3f0ff;color:#6c47ff;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600">${scoreBadge(r.priority_score)}</span>` : ""}
          ${mode !== "lead" && r.sentiment ? `<span style="background:#fff5f5;color:#ef4444;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600">${sentimentBadge(r.sentiment)}</span>` : ""}
        </div>
        <div style="font-size:11px;color:#555;margin-top:4px">${r.summary}</div>
        <div style="font-size:10px;color:#999;margin-top:2px">${statusLabel(r.status)}</div>
      </div>`
    )
    .join("");
}

function buildAlerts(
  overview: Record<string, number>,
  broadcast: BroadcastRow | null,
  aiInsights: AiReviewRow,
  complaints: InsightRow[]
): string[] {
  const alerts: string[] = [];
  const failed = parseInt(broadcast?.failed_count ?? "0", 10);
  const sent = parseInt(broadcast?.sent_count ?? "0", 10);
  if (sent > 0 && failed / sent > 0.05) {
    alerts.push(`⚠️ High broadcast failure rate — ${failed} of ${sent} failed`);
  }
  const unanswered = parseInt(aiInsights.count, 10);
  if (unanswered > 10) {
    alerts.push(`🤖 ${unanswered} unanswered queries need AI training`);
  }
  const openComplaints = complaints.filter((c) => c.status === "open").length;
  if (openComplaints > 0) {
    alerts.push(`❌ ${openComplaints} complaint${openComplaints > 1 ? "s" : ""} not resolved`);
  }
  return alerts;
}

function generateEmailHtml(params: {
  user: ReportUser;
  date: string;
  overview: Record<string, number>;
  leads: InsightRow[];
  complaints: InsightRow[];
  feedback: InsightRow[];
  broadcast: BroadcastRow | null;
  aiInsights: AiReviewRow;
  automation: AutomationRow;
  dashboardUrl: string;
}): string {
  const { user, date, overview, leads, complaints, feedback, broadcast, aiInsights, automation, dashboardUrl } = params;
  const alerts = buildAlerts(overview, broadcast, aiInsights, complaints);
  const sent = parseInt(broadcast?.sent_count ?? "0", 10);
  const delivered = parseInt(broadcast?.delivered_count ?? "0", 10);
  const failed = parseInt(broadcast?.failed_count ?? "0", 10);
  const unanswered = parseInt(aiInsights.count, 10);

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WagenAI Daily Report</title></head>
<body style="margin:0;padding:20px;background:#f0f0f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1)">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#6c47ff,#9b59b6);padding:24px;color:white">
    <div style="font-size:20px;font-weight:700">📊 WagenAI Daily Report</div>
    <div style="font-size:12px;opacity:0.85;margin-top:4px">Hi ${user.name} · ${date}</div>
  </div>

  <div style="padding:24px">

    <!-- Overview -->
    <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">Overview</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:24px">
      <div style="background:#f3f0ff;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#6c47ff">${overview.total ?? 0}</div>
        <div style="font-size:10px;color:#888;margin-top:2px">Conversations</div>
      </div>
      <div style="background:#f0fff4;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#22c55e">${overview.lead ?? 0}</div>
        <div style="font-size:10px;color:#888;margin-top:2px">Leads</div>
      </div>
      <div style="background:#fff5f5;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#ef4444">${overview.complaint ?? 0}</div>
        <div style="font-size:10px;color:#888;margin-top:2px">Complaints</div>
      </div>
      <div style="background:#fffbf0;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#f59e0b">${overview.feedback ?? 0}</div>
        <div style="font-size:10px;color:#888;margin-top:2px">Feedback</div>
      </div>
    </div>

    <!-- Top Leads -->
    <div style="font-size:13px;font-weight:700;color:#6c47ff;margin-bottom:10px">🧲 Top Leads</div>
    ${insightRows(leads, "lead")}

    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">

    <!-- Top Complaints -->
    <div style="font-size:13px;font-weight:700;color:#ef4444;margin-bottom:10px">⚠️ Top Complaints</div>
    ${insightRows(complaints, "complaint")}

    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">

    <!-- Feedback -->
    <div style="font-size:13px;font-weight:700;color:#22c55e;margin-bottom:10px">💬 Customer Feedback</div>
    ${insightRows(feedback, "feedback")}

    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">

    <!-- Broadcast -->
    <div style="font-size:13px;font-weight:700;color:#333;margin-bottom:10px">📩 Broadcast Performance</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:4px">
      <div style="text-align:center;background:#f9f9f9;border-radius:6px;padding:10px">
        <div style="font-size:18px;font-weight:700;color:#333">${sent}</div>
        <div style="font-size:10px;color:#888">Sent</div>
      </div>
      <div style="text-align:center;background:#f0fff4;border-radius:6px;padding:10px">
        <div style="font-size:18px;font-weight:700;color:#22c55e">${delivered}</div>
        <div style="font-size:10px;color:#888">Delivered</div>
      </div>
      <div style="text-align:center;background:${failed > 0 ? "#fff5f5" : "#f9f9f9"};border-radius:6px;padding:10px">
        <div style="font-size:18px;font-weight:700;color:${failed > 0 ? "#ef4444" : "#333"}">${failed}${failed > 0 ? " ⚠️" : ""}</div>
        <div style="font-size:10px;color:#888">Failed</div>
      </div>
    </div>

    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">

    <!-- AI Insights -->
    <div style="font-size:13px;font-weight:700;color:#333;margin-bottom:10px">🤖 AI Insights</div>
    ${unanswered > 0 ? `
    <div style="background:#f9f3ff;border-radius:6px;padding:12px;margin-bottom:6px">
      <div style="font-size:12px;color:#6c47ff;font-weight:600">${unanswered} unanswered question${unanswered > 1 ? "s" : ""} need training</div>
      ${aiInsights.example_question ? `<div style="font-size:11px;color:#888;margin-top:4px">Example: "${aiInsights.example_question}"</div>` : ""}
    </div>` : `<p style="color:#888;font-size:12px;margin:0">No unanswered queries today. 🎉</p>`}

    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">

    <!-- Automation -->
    <div style="font-size:13px;font-weight:700;color:#333;margin-bottom:10px">⚙️ Automation</div>
    <div style="display:flex;gap:10px">
      <div style="flex:1;background:#f9f9f9;border-radius:6px;padding:10px;text-align:center">
        <div style="font-size:18px;font-weight:700;color:#333">${automation.sequences_completed}</div>
        <div style="font-size:10px;color:#888">Sequences completed</div>
      </div>
      <div style="flex:1;background:#f9f9f9;border-radius:6px;padding:10px;text-align:center">
        <div style="font-size:18px;font-weight:700;color:#333">${automation.flows_completed}</div>
        <div style="font-size:10px;color:#888">Flows completed</div>
      </div>
    </div>

    ${alerts.length > 0 ? `
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
    <div style="font-size:13px;font-weight:700;color:#ef4444;margin-bottom:10px">🚨 Alerts</div>
    ${alerts.map((a) => `<div style="font-size:12px;color:#555;padding:4px 0">${a}</div>`).join("")}
    ` : ""}

    <!-- CTA -->
    <div style="text-align:center;margin-top:24px">
      <a href="${dashboardUrl}" style="background:#6c47ff;color:white;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:13px;font-weight:600;display:inline-block">View Full Dashboard →</a>
    </div>

    <div style="font-size:10px;color:#aaa;text-align:center;margin-top:16px">
      WagenAI · <a href="${dashboardUrl}/settings" style="color:#6c47ff;text-decoration:none">Manage notification settings</a>
    </div>

  </div>
</div>
</body>
</html>`;
}

// ─── Email Sender ─────────────────────────────────────────────────────────────

async function sendReportEmail(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      sender: { email: "reports@wagenai.com", name: "WagenAI Reports" },
      to: [{ email: to }],
      subject,
      htmlContent: html
    })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo email failed (${res.status}): ${body}`);
  }
}

// ─── Worker ───────────────────────────────────────────────────────────────────

let reportWorker: Worker | null = null;
let cronTimer: ReturnType<typeof setTimeout> | null = null;

async function processReportJob(userId: string): Promise<void> {
  const userResult = await pool.query<ReportUser>(
    "SELECT id, name, email FROM users WHERE id = $1",
    [userId]
  );
  const user = userResult.rows[0];
  if (!user) {
    console.warn(`[DailyReport] User ${userId} not found, skipping`);
    return;
  }

  const { start } = todayRange();
  const [overview, leads, complaints, feedback, broadcast, aiInsights, automation] =
    await Promise.all([
      fetchOverview(userId, start),
      fetchTopInsights(userId, "lead"),
      fetchTopInsights(userId, "complaint"),
      fetchTopInsights(userId, "feedback"),
      fetchBroadcastStats(userId, start),
      fetchAiInsights(userId, start),
      fetchAutomationStats(userId, start)
    ]);

  const date = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  const dashboardUrl = env.APP_BASE_URL;

  const html = generateEmailHtml({
    user,
    date,
    overview,
    leads,
    complaints,
    feedback,
    broadcast,
    aiInsights,
    automation,
    dashboardUrl
  });

  await sendReportEmail(user.email, `WagenAI Daily Report — ${date}`, html);
  console.log(`[DailyReport] Report sent to ${user.email}`);
}

async function enqueueDailyReports(): Promise<void> {
  const queue = getDailyReportQueue();
  if (!queue) {
    console.warn("[DailyReport] Queue unavailable — Redis not configured");
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE daily_report_enabled = TRUE"
  );
  for (const user of rows) {
    const jobId = `daily-report-${user.id}-${today}`;
    await queue.add(
      "send-report",
      { userId: user.id },
      { jobId, attempts: 3, backoff: { type: "exponential", delay: 5000 } }
    );
  }
  console.log(`[DailyReport] Enqueued ${rows.length} report job(s) for ${today}`);
}

function scheduleDailyCron(): void {
  const now = new Date();
  const next = new Date();
  next.setHours(23, 59, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  const msUntilNext = next.getTime() - now.getTime();

  cronTimer = setTimeout(async () => {
    try {
      await enqueueDailyReports();
    } catch (err) {
      console.error("[DailyReport] Cron enqueue error", err);
    }
    scheduleDailyCron(); // reschedule for next day
  }, msUntilNext);

  console.log(
    `[DailyReport] Next report cron in ${Math.round(msUntilNext / 1000 / 60)} minutes`
  );
}

export function startDailyReportWorker(): void {
  const connection = createQueueWorkerConnection();
  if (!connection) {
    console.warn("[DailyReport] Worker not started — Redis not configured");
    return;
  }
  reportWorker = new Worker(
    "daily-report",
    async (job) => {
      const { userId } = job.data as { userId: string };
      await processReportJob(userId);
    },
    { connection, concurrency: 3 }
  );
  reportWorker.on("completed", (job) =>
    console.log(`[DailyReport] Job completed: ${job.id}`)
  );
  reportWorker.on("failed", (job, err) =>
    console.error(`[DailyReport] Job failed: ${job?.id}`, err)
  );
  scheduleDailyCron();
}

export async function stopDailyReportWorker(): Promise<void> {
  if (cronTimer) {
    clearTimeout(cronTimer);
    cronTimer = null;
  }
  if (reportWorker) {
    await reportWorker.close();
    reportWorker = null;
  }
}
```

- [ ] **Step 2: Add `BREVO_API_KEY` to env config**

Open `apps/api/src/config/env.ts`. Add to the `BaseEnvSchema` object:

```typescript
BREVO_API_KEY: z.string().min(1, "BREVO_API_KEY must be set"),
```

The dashboard URL is already available as `env.APP_BASE_URL` — no new variable needed. In the worker service above, replace the `dashboardUrl` line:

```typescript
// Change this line:
const dashboardUrl = env.DASHBOARD_URL ?? "https://wagenai.com/dashboard";

// To this:
const dashboardUrl = env.APP_BASE_URL;
```

- [ ] **Step 3: Type-check**

```bash
cd apps/api && npm run lint
```

Expected: no errors in `daily-report-worker-service.ts`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/daily-report-worker-service.ts
git commit -m "feat: add daily-report-worker-service with cron, HTML email, Brevo sender"
```

---

## Task 6: Wire worker into `worker.ts`

**Files:**
- Modify: `apps/api/src/worker.ts`

- [ ] **Step 1: Add import at the top of `worker.ts`**

Add alongside the other worker imports:

```typescript
import { startDailyReportWorker, stopDailyReportWorker } from "./services/daily-report-worker-service.js";
```

- [ ] **Step 2: Start the worker**

Add after the other `start*()` calls:

```typescript
startDailyReportWorker();
```

- [ ] **Step 3: Add to shutdown**

In the `shutdown` async function, add alongside the other `stop*()` calls:

```typescript
await stopDailyReportWorker();
```

- [ ] **Step 4: Type-check**

```bash
cd apps/api && npm run lint
```

Expected: no errors.

- [ ] **Step 5: Smoke-test the worker starts**

```bash
cd apps/api && npm run worker
```

Expected log output includes:
```
[DailyReport] Next report cron in NNN minutes
```

Press `Ctrl+C` to stop.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/worker.ts
git commit -m "feat: start daily-report worker in worker.ts"
```

---

## Task 7: `notifications.ts` API route

**Files:**
- Create: `apps/api/src/routes/notifications.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Create the route file**

```typescript
// apps/api/src/routes/notifications.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";

const UpdateNotificationSettingsSchema = z.object({
  dailyReportEnabled: z.boolean()
});

export async function notificationsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/notifications/settings",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const result = await pool.query<{ daily_report_enabled: boolean }>(
        "SELECT daily_report_enabled FROM users WHERE id = $1",
        [request.authUser.userId]
      );
      const row = result.rows[0];
      return { dailyReportEnabled: row?.daily_report_enabled ?? false };
    }
  );

  fastify.patch(
    "/api/notifications/settings",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = UpdateNotificationSettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid payload" });
      }
      await pool.query(
        "UPDATE users SET daily_report_enabled = $1 WHERE id = $2",
        [parsed.data.dailyReportEnabled, request.authUser.userId]
      );
      return { dailyReportEnabled: parsed.data.dailyReportEnabled };
    }
  );
}
```

- [ ] **Step 2: Register routes in `app.ts`**

Add the import near the other route imports (around line 36):

```typescript
import { notificationsRoutes } from "./routes/notifications.js";
```

Add the registration call near the other route registrations (around line 215):

```typescript
await notificationsRoutes(app);
```

- [ ] **Step 3: Type-check**

```bash
cd apps/api && npm run lint
```

Expected: no errors.

- [ ] **Step 4: Smoke-test the endpoint**

Start the API server, then:

```bash
# Replace TOKEN with a valid JWT from your dev login
curl -X GET http://localhost:4000/api/notifications/settings \
  -H "Authorization: Bearer TOKEN"
# Expected: {"dailyReportEnabled":false}

curl -X PATCH http://localhost:4000/api/notifications/settings \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dailyReportEnabled":true}'
# Expected: {"dailyReportEnabled":true}
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/notifications.ts apps/api/src/app.ts
git commit -m "feat: add notifications settings GET/PATCH endpoints"
```

---

## Task 8: Hook insight upsert into `conversation-service.ts`

**Files:**
- Modify: `apps/api/src/services/conversation-service.ts`

- [ ] **Step 1: Add import at the top of conversation-service.ts**

```typescript
import {
  upsertConversationInsight,
  deriveSentiment,
  type InsightType
} from "./conversation-insight-service.js";
```

- [ ] **Step 2: Call upsert after the UPDATE conversations query**

Find the block ending around line 591 (after `syncConversationContact` and before `return updated.rows[0]`). Insert this block:

```typescript
  // Write insight record — used for daily email report
  const insightType = classification.kind as InsightType;
  if (insightType === "lead" || insightType === "complaint" || insightType === "feedback") {
    try {
      await upsertConversationInsight(conversation.id, userId, {
        type: insightType,
        summary: message.slice(0, 150),
        sentiment: deriveSentiment(insightType, score),
        priority_score: score,
        status: "open"
      });
    } catch (insightError) {
      // Non-fatal — don't block the main conversation flow
      console.warn(`[ConversationInsight] upsert failed for ${conversation.id}`, insightError);
    }
  }
```

Place this block after the `syncConversationContact` try/catch block (around line 591) and before `return updated.rows[0]`.

- [ ] **Step 3: Type-check**

```bash
cd apps/api && npm run lint
```

Expected: no errors.

- [ ] **Step 4: Verify insight is written**

Send a test WhatsApp message through your dev environment. Then query:

```sql
SELECT * FROM conversation_insights ORDER BY created_at DESC LIMIT 5;
```

Expected: rows appear with type, summary, sentiment, priority_score.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/conversation-service.ts
git commit -m "feat: write conversation_insights on every AI classification"
```

---

## Task 9: Frontend API functions

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/modules/dashboard/settings/api.ts`

- [ ] **Step 1: Add functions to `lib/api.ts`**

At the end of the file, add:

```typescript
export function getNotificationSettings(token: string): Promise<{ dailyReportEnabled: boolean }> {
  return apiRequest("/api/notifications/settings", { token });
}

export function updateNotificationSettings(
  token: string,
  dailyReportEnabled: boolean
): Promise<{ dailyReportEnabled: boolean }> {
  return apiRequest("/api/notifications/settings", {
    method: "PATCH",
    token,
    body: JSON.stringify({ dailyReportEnabled })
  });
}
```

- [ ] **Step 2: Re-export from settings `api.ts`**

In `apps/web/src/modules/dashboard/settings/api.ts`, add at the top of imports:

```typescript
import {
  // ... existing imports
  getNotificationSettings,
  updateNotificationSettings
} from "../../../lib/api";
```

And add re-exports at the bottom:

```typescript
export function fetchNotificationSettings(token: string) {
  return getNotificationSettings(token);
}

export function saveNotificationSettings(token: string, dailyReportEnabled: boolean) {
  return updateNotificationSettings(token, dailyReportEnabled);
}
```

- [ ] **Step 3: Type-check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/modules/dashboard/settings/api.ts
git commit -m "feat: add notification settings API client functions"
```

---

## Task 10: Frontend — `settings-page.tsx` state + mutation

**Files:**
- Modify: `apps/web/src/modules/dashboard/settings/settings-page.tsx`

- [ ] **Step 1: Add import for the new API functions**

In the import from `"./api"`, add `fetchNotificationSettings` and `saveNotificationSettings`:

```typescript
import {
  // ... existing imports
  fetchNotificationSettings,
  saveNotificationSettings
} from "./api";
```

- [ ] **Step 2: Add state for daily report toggle**

Inside the component function, after the existing `useState` declarations (around line 281), add:

```typescript
const [dailyReportEnabled, setDailyReportEnabled] = useState(false);
const [dailyReportBusy, setDailyReportBusy] = useState(false);
```

- [ ] **Step 3: Load initial value from the API**

Add a `useEffect` after the existing effects to fetch the current toggle state:

```typescript
useEffect(() => {
  if (!token) return;
  fetchNotificationSettings(token)
    .then((data) => setDailyReportEnabled(data.dailyReportEnabled))
    .catch(() => {/* silently ignore */});
}, [token]);
```

- [ ] **Step 4: Add the toggle handler**

After the existing mutation declarations (around line 431), add:

```typescript
const handleToggleDailyReport = async () => {
  if (!token || dailyReportBusy) return;
  const next = !dailyReportEnabled;
  setDailyReportEnabled(next); // optimistic update
  setDailyReportBusy(true);
  try {
    await saveNotificationSettings(token, next);
  } catch (toggleError) {
    setDailyReportEnabled(!next); // revert on error
    setError((toggleError as Error).message);
  } finally {
    setDailyReportBusy(false);
  }
};
```

- [ ] **Step 5: Pass new props to `<SettingsTab />`**

Find the `<SettingsTab` JSX (around line 549) and add:

```tsx
dailyReportEnabled={dailyReportEnabled}
dailyReportBusy={dailyReportBusy}
onToggleDailyReport={handleToggleDailyReport}
```

- [ ] **Step 6: Type-check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: TypeScript will complain that `SettingsTab` doesn't accept these props yet — that's expected, fixed in the next task.

- [ ] **Step 7: Commit** (after Task 11 completes and type-check passes)

---

## Task 11: Frontend — `settings-tab.tsx` Notifications UI

**Files:**
- Modify: `apps/web/src/pages/dashboard/tabs/settings-tab.tsx`

- [ ] **Step 1: Add new props to `SettingsTabProps`**

Find the `SettingsTabProps` interface and add at the end (before the closing `}`):

```typescript
  dailyReportEnabled: boolean;
  dailyReportBusy: boolean;
  onToggleDailyReport: () => void;
```

- [ ] **Step 2: Destructure new props in the function body**

Find the destructuring of `props` inside `export function SettingsTab(props: SettingsTabProps)` and add:

```typescript
const {
  // ... existing destructured props
  dailyReportEnabled,
  dailyReportBusy,
  onToggleDailyReport
} = props;
```

- [ ] **Step 3: Add the Notifications section to the JSX**

Find line 710 (`<article className="channel-setup-panel account-danger-panel">`). Insert the following block **immediately before** that line:

```tsx
{/* ── Notifications ───────────────────────────── */}
<article className="channel-setup-panel">
  <header>
    <h3>Notifications</h3>
    <p>Manage email reports sent to your account email address.</p>
  </header>
  <div className="go-live-card-head" style={{ justifyContent: "space-between", padding: "12px 0" }}>
    <div>
      <strong style={{ fontSize: "14px" }}>📊 Daily Summary Email</strong>
      <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--color-text-secondary, #888)" }}>
        Receive a daily recap of conversations, leads &amp; complaints — sent at 11:59 PM
      </p>
    </div>
    <button
      type="button"
      className={dailyReportEnabled ? "go-live-switch on" : "go-live-switch"}
      disabled={dailyReportBusy}
      onClick={onToggleDailyReport}
      aria-label={dailyReportEnabled ? "Disable daily report email" : "Enable daily report email"}
      title={dailyReportEnabled ? "Disable daily report email" : "Enable daily report email"}
    >
      <span />
    </button>
  </div>
</article>
```

- [ ] **Step 4: Type-check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit Tasks 10 and 11 together**

```bash
git add apps/web/src/modules/dashboard/settings/settings-page.tsx \
        apps/web/src/pages/dashboard/tabs/settings-tab.tsx
git commit -m "feat: add daily report toggle to Settings Notifications section"
```

---

## Task 12: End-to-end verification

- [ ] **Step 1: Start API worker**

```bash
cd apps/api && npm run worker
```

Confirm log: `[DailyReport] Next report cron in NNN minutes`

- [ ] **Step 2: Enable the toggle in the UI**

Start the web dev server, log in, go to Settings → scroll to Notifications, toggle "Daily Summary Email" on. Confirm the toggle persists on page refresh (the GET endpoint loads it).

- [ ] **Step 3: Manually trigger a report job**

In a Node REPL or via a temporary script, enqueue a test job directly:

```typescript
// apps/api/src/scripts/test-daily-report.ts
import "./observability/otel.js";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { getDailyReportQueue, getManagedQueues } from "./services/queue-service.js";

getManagedQueues(); // initialise queues
const queue = getDailyReportQueue();
const { rows } = await pool.query("SELECT id FROM users LIMIT 1");
if (rows[0] && queue) {
  await queue.add("send-report", { userId: rows[0].id }, { attempts: 1 });
  console.log("Job enqueued. Watch worker logs.");
}
await pool.end();
```

Run: `cd apps/api && tsx src/scripts/test-daily-report.ts`

- [ ] **Step 4: Verify email received**

Check the inbox of the user whose ID was used. Confirm the email has all sections: overview, leads, complaints, feedback, broadcast, AI insights, automation.

- [ ] **Step 5: Final commit**

```bash
git add apps/api/src/scripts/test-daily-report.ts
git commit -m "chore: add test script for daily report job"
```

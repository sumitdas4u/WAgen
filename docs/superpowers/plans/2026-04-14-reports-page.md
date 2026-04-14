# Reports Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Reports page to the dashboard sidebar showing today's live conversation summary, 30 days of stored daily snapshots, and a notification toggle.

**Architecture:** Extract existing data-fetch queries from `daily-report-worker-service.ts` into a shared `daily-report-data-service.ts`; worker saves a JSON snapshot to a new `daily_reports` table after each send; two new API routes serve today's live query and stored history; a new React module at `/dashboard/reports` renders stat cards, insight lists, and collapsible history rows.

**Tech Stack:** Fastify 5, PostgreSQL (pool), Zod, React 18, TanStack Query, TypeScript strict mode. No new dependencies.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `infra/migrations/0042_daily_reports.sql` | `daily_reports` table + index |
| Create | `apps/api/src/services/daily-report-data-service.ts` | Shared query functions + `DailyReportSnapshot` type |
| Modify | `apps/api/src/services/daily-report-worker-service.ts` | Use data service, save snapshot, update HTML generator |
| Create | `apps/api/src/routes/reports.ts` | `GET /api/reports/daily/today` + `GET /api/reports/daily` |
| Modify | `apps/api/src/app.ts` | Register reports route |
| Modify | `apps/web/src/lib/api.ts` | Export `DailyReportSnapshot`, `fetchTodayReport`, `fetchDailyReports` |
| Modify | `apps/web/src/shared/dashboard/query-keys.ts` | Add `reportsRoot`, `todayReport`, `dailyReports` keys |
| Create | `apps/web/src/modules/dashboard/reports/api.ts` | Thin wrappers over lib/api calls |
| Create | `apps/web/src/modules/dashboard/reports/queries.ts` | TanStack Query hooks |
| Create | `apps/web/src/modules/dashboard/reports/reports.css` | Page styles |
| Create | `apps/web/src/modules/dashboard/reports/route.tsx` | Full Reports page component |
| Modify | `apps/web/src/registry/dashboardModules.ts` | Register nav entry |

---

### Task 1: Migration — daily_reports table

**Files:**
- Create: `infra/migrations/0042_daily_reports.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- infra/migrations/0042_daily_reports.sql
CREATE TABLE IF NOT EXISTS daily_reports (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_date DATE        NOT NULL,
  snapshot    JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_reports_user_date
  ON daily_reports (user_id, report_date DESC);
```

- [ ] **Step 2: Commit**

```bash
git add infra/migrations/0042_daily_reports.sql
git commit -m "feat(db): add daily_reports snapshot table"
```

---

### Task 2: daily-report-data-service.ts

**Files:**
- Create: `apps/api/src/services/daily-report-data-service.ts`

This file moves the five private query functions out of the worker and wraps them in a single exported `fetchDailyReportData` function. The `DailyReportSnapshot` type is also exported — it is the single shared shape used by the API, the worker, and the frontend.

- [ ] **Step 1: Create the file**

```typescript
// apps/api/src/services/daily-report-data-service.ts
import { pool } from "../db/pool.js";

// ─── Shared snapshot type (used by API routes AND worker) ────────────────────

export type DailyReportSnapshot = {
  date: string;
  overview: {
    totalConversations: number;
    leads: number;
    complaints: number;
    feedback: number;
  };
  topLeads: {
    conversationId: string;
    phoneNumber: string;
    summary: string;
    score: number;
    status: string;
  }[];
  topComplaints: {
    conversationId: string;
    phoneNumber: string;
    summary: string;
    sentiment: string | null;
    score: number;
    status: string;
  }[];
  topFeedback: {
    conversationId: string;
    phoneNumber: string;
    summary: string;
    status: string;
  }[];
  broadcasts: {
    sent: number;
    delivered: number;
    failed: number;
  };
  automation: {
    sequencesCompleted: number;
    flowsCompleted: number;
  };
  alerts: string[];
};

// ─── Private query helpers ───────────────────────────────────────────────────

interface OverviewRow { lead_kind: string; count: string; }
interface InsightRow {
  conversation_id: string; phone_number: string;
  summary: string; sentiment: string | null;
  priority_score: number; status: string;
}
interface BroadcastRow { sent_count: string; delivered_count: string; failed_count: string; }
interface AiReviewRow { count: string; }
interface AutomationRow { sequences_completed: string; flows_completed: string; }

async function queryOverview(userId: string, start: Date): Promise<Record<string, number>> {
  const result = await pool.query<OverviewRow>(
    `SELECT lead_kind, COUNT(*)::text AS count
     FROM conversations
     WHERE user_id = $1 AND last_message_at >= $2
     GROUP BY lead_kind`,
    [userId, start]
  );
  const map: Record<string, number> = { lead: 0, complaint: 0, feedback: 0 };
  for (const row of result.rows) map[row.lead_kind] = parseInt(row.count, 10);
  const total = result.rows.reduce((sum, r) => sum + parseInt(r.count, 10), 0);
  return { ...map, total };
}

async function queryTopInsights(userId: string, type: string, limit = 5): Promise<InsightRow[]> {
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

async function queryBroadcastStats(userId: string, start: Date): Promise<BroadcastRow> {
  const result = await pool.query<BroadcastRow>(
    `SELECT
       COALESCE(SUM(sent_count), 0)::text      AS sent_count,
       COALESCE(SUM(delivered_count), 0)::text AS delivered_count,
       COALESCE(SUM(failed_count), 0)::text    AS failed_count
     FROM campaigns
     WHERE user_id = $1 AND status = 'completed' AND completed_at >= $2`,
    [userId, start]
  );
  return result.rows[0] ?? { sent_count: "0", delivered_count: "0", failed_count: "0" };
}

async function queryAiInsights(userId: string, start: Date): Promise<AiReviewRow> {
  const result = await pool.query<AiReviewRow>(
    `SELECT COUNT(*)::text AS count FROM ai_review_queue WHERE user_id = $1 AND created_at >= $2`,
    [userId, start]
  );
  return result.rows[0] ?? { count: "0" };
}

async function queryAutomationStats(userId: string, start: Date): Promise<AutomationRow> {
  const seqResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM sequence_enrollments
     WHERE sequence_id IN (SELECT id FROM sequences WHERE user_id = $1)
       AND status = 'completed' AND updated_at >= $2`,
    [userId, start]
  );
  const flowResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM flow_sessions
     WHERE user_id = $1 AND status = 'completed' AND updated_at >= $2`,
    [userId, start]
  );
  return {
    sequences_completed: seqResult.rows[0]?.count ?? "0",
    flows_completed: flowResult.rows[0]?.count ?? "0"
  };
}

function buildAlerts(
  broadcast: BroadcastRow,
  aiInsights: AiReviewRow,
  complaints: InsightRow[]
): string[] {
  const alerts: string[] = [];
  const failed = parseInt(broadcast.failed_count, 10);
  const sent = parseInt(broadcast.sent_count, 10);
  if (sent > 0 && failed / sent > 0.05) {
    alerts.push(`High broadcast failure rate — ${failed} of ${sent} failed`);
  }
  const unanswered = parseInt(aiInsights.count, 10);
  if (unanswered > 10) alerts.push(`${unanswered} unanswered queries need AI training`);
  const openComplaints = complaints.filter((c) => c.status === "open").length;
  if (openComplaints > 0) {
    alerts.push(`${openComplaints} complaint${openComplaints > 1 ? "s" : ""} not resolved`);
  }
  return alerts;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchDailyReportData(userId: string, start: Date): Promise<DailyReportSnapshot> {
  const [overview, leads, complaints, feedback, broadcast, aiInsights, automation] =
    await Promise.all([
      queryOverview(userId, start),
      queryTopInsights(userId, "lead"),
      queryTopInsights(userId, "complaint"),
      queryTopInsights(userId, "feedback"),
      queryBroadcastStats(userId, start),
      queryAiInsights(userId, start),
      queryAutomationStats(userId, start)
    ]);

  return {
    date: start.toISOString().slice(0, 10),
    overview: {
      totalConversations: overview.total ?? 0,
      leads: overview.lead ?? 0,
      complaints: overview.complaint ?? 0,
      feedback: overview.feedback ?? 0
    },
    topLeads: leads.map((r) => ({
      conversationId: r.conversation_id,
      phoneNumber: r.phone_number,
      summary: r.summary,
      score: r.priority_score,
      status: r.status
    })),
    topComplaints: complaints.map((r) => ({
      conversationId: r.conversation_id,
      phoneNumber: r.phone_number,
      summary: r.summary,
      sentiment: r.sentiment,
      score: r.priority_score,
      status: r.status
    })),
    topFeedback: feedback.map((r) => ({
      conversationId: r.conversation_id,
      phoneNumber: r.phone_number,
      summary: r.summary,
      status: r.status
    })),
    broadcasts: {
      sent: parseInt(broadcast.sent_count, 10),
      delivered: parseInt(broadcast.delivered_count, 10),
      failed: parseInt(broadcast.failed_count, 10)
    },
    automation: {
      sequencesCompleted: parseInt(automation.sequences_completed, 10),
      flowsCompleted: parseInt(automation.flows_completed, 10)
    },
    alerts: buildAlerts(broadcast, aiInsights, complaints)
  };
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd apps/api && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/daily-report-data-service.ts
git commit -m "feat: add daily-report-data-service with shared snapshot type"
```

---

### Task 3: Update daily-report-worker-service.ts

**Files:**
- Modify: `apps/api/src/services/daily-report-worker-service.ts`

Remove the five private query functions and their types (now in data service). Update `processReportJob` to call `fetchDailyReportData`, save the snapshot to `daily_reports`, then generate HTML from the snapshot. Update `generateEmailHtml` to accept `DailyReportSnapshot` instead of raw rows.

- [ ] **Step 1: Replace the entire file**

```typescript
// apps/api/src/services/daily-report-worker-service.ts
import { Worker } from "bullmq";
import { pool } from "../db/pool.js";
import { createQueueWorkerConnection, getDailyReportQueue } from "./queue-service.js";
import { fetchDailyReportData, type DailyReportSnapshot } from "./daily-report-data-service.js";
import { env } from "../config/env.js";

// ─── HTML helpers ─────────────────────────────────────────────────────────────

type InsightItem = {
  phoneNumber: string;
  summary: string;
  sentiment?: string | null;
  score?: number;
  status: string;
};

function scoreBadge(score: number): string {
  if (score >= 80) return `🔴 HOT · ${score}`;
  if (score >= 50) return `🟡 WARM · ${score}`;
  return `⚪ COLD · ${score}`;
}

function sentimentLabel(sentiment: string | null | undefined): string {
  const map: Record<string, string> = {
    angry: "😡 Angry", frustrated: "😤 Frustrated",
    negative: "😞 Negative", positive: "😊 Positive", neutral: "😐 Neutral"
  };
  return sentiment ? (map[sentiment] ?? sentiment) : "";
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    open: "❌ Not resolved", pending: "⏳ Follow-up pending", resolved: "✅ Resolved"
  };
  return map[status] ?? status;
}

function insightRows(rows: InsightItem[], mode: "lead" | "complaint" | "feedback"): string {
  if (rows.length === 0) {
    return `<p style="color:#888;font-size:12px;margin:0">No ${mode}s today.</p>`;
  }
  const borderColor = mode === "lead" ? "#6c47ff" : mode === "complaint" ? "#ef4444" : "#22c55e";
  return rows.map((r) => `
    <div style="border-left:3px solid ${borderColor};padding:8px 12px;margin-bottom:8px;background:#fafafa;border-radius:0 6px 6px 0">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:12px;font-weight:600;color:#333">${r.phoneNumber}</span>
        ${mode === "lead" && r.score !== undefined
          ? `<span style="background:#f3f0ff;color:#6c47ff;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600">${scoreBadge(r.score)}</span>`
          : ""}
        ${mode !== "lead" && r.sentiment
          ? `<span style="background:#fff5f5;color:#ef4444;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600">${sentimentLabel(r.sentiment)}</span>`
          : ""}
      </div>
      <div style="font-size:11px;color:#555;margin-top:4px">${r.summary}</div>
      <div style="font-size:10px;color:#999;margin-top:2px">${statusLabel(r.status)}</div>
    </div>`).join("");
}

function generateEmailHtml(params: {
  userName: string;
  dateLabel: string;
  snapshot: DailyReportSnapshot;
  dashboardUrl: string;
}): string {
  const { userName, dateLabel, snapshot, dashboardUrl } = params;
  const { overview, topLeads, topComplaints, topFeedback, broadcasts, automation, alerts } = snapshot;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>WagenAI Daily Report</title></head>
<body style="margin:0;padding:20px;background:#f0f0f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1)">
  <div style="background:linear-gradient(135deg,#6c47ff,#9b59b6);padding:24px;color:white">
    <div style="font-size:20px;font-weight:700">📊 WagenAI Daily Report</div>
    <div style="font-size:12px;opacity:0.85;margin-top:4px">Hi ${userName} · ${dateLabel}</div>
  </div>
  <div style="padding:24px">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:24px">
      <div style="background:#f3f0ff;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#6c47ff">${overview.totalConversations}</div>
        <div style="font-size:10px;color:#888;margin-top:2px">Conversations</div>
      </div>
      <div style="background:#f0fff4;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#22c55e">${overview.leads}</div>
        <div style="font-size:10px;color:#888;margin-top:2px">Leads</div>
      </div>
      <div style="background:#fff5f5;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#ef4444">${overview.complaints}</div>
        <div style="font-size:10px;color:#888;margin-top:2px">Complaints</div>
      </div>
      <div style="background:#fffbf0;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#f59e0b">${overview.feedback}</div>
        <div style="font-size:10px;color:#888;margin-top:2px">Feedback</div>
      </div>
    </div>
    <div style="font-size:13px;font-weight:700;color:#6c47ff;margin-bottom:10px">🧲 Top Leads</div>
    ${insightRows(topLeads, "lead")}
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
    <div style="font-size:13px;font-weight:700;color:#ef4444;margin-bottom:10px">⚠️ Top Complaints</div>
    ${insightRows(topComplaints, "complaint")}
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
    <div style="font-size:13px;font-weight:700;color:#22c55e;margin-bottom:10px">💬 Feedback</div>
    ${insightRows(topFeedback, "feedback")}
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
    <div style="font-size:13px;font-weight:700;color:#333;margin-bottom:10px">📩 Broadcast Performance</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <div style="text-align:center;background:#f9f9f9;border-radius:6px;padding:10px">
        <div style="font-size:18px;font-weight:700">${broadcasts.sent}</div>
        <div style="font-size:10px;color:#888">Sent</div>
      </div>
      <div style="text-align:center;background:#f0fff4;border-radius:6px;padding:10px">
        <div style="font-size:18px;font-weight:700;color:#22c55e">${broadcasts.delivered}</div>
        <div style="font-size:10px;color:#888">Delivered</div>
      </div>
      <div style="text-align:center;background:${broadcasts.failed > 0 ? "#fff5f5" : "#f9f9f9"};border-radius:6px;padding:10px">
        <div style="font-size:18px;font-weight:700;color:${broadcasts.failed > 0 ? "#ef4444" : "#333"}">${broadcasts.failed}</div>
        <div style="font-size:10px;color:#888">Failed</div>
      </div>
    </div>
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
    <div style="font-size:13px;font-weight:700;color:#333;margin-bottom:10px">⚙️ Automation</div>
    <div style="display:flex;gap:10px">
      <div style="flex:1;background:#f9f9f9;border-radius:6px;padding:10px;text-align:center">
        <div style="font-size:18px;font-weight:700">${automation.sequencesCompleted}</div>
        <div style="font-size:10px;color:#888">Sequences completed</div>
      </div>
      <div style="flex:1;background:#f9f9f9;border-radius:6px;padding:10px;text-align:center">
        <div style="font-size:18px;font-weight:700">${automation.flowsCompleted}</div>
        <div style="font-size:10px;color:#888">Flows completed</div>
      </div>
    </div>
    ${alerts.length > 0 ? `
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
    <div style="font-size:13px;font-weight:700;color:#ef4444;margin-bottom:10px">🚨 Alerts</div>
    ${alerts.map((a) => `<div style="font-size:12px;color:#555;padding:4px 0">⚠️ ${a}</div>`).join("")}` : ""}
    <div style="text-align:center;margin-top:24px">
      <a href="${dashboardUrl}/dashboard/reports" style="background:#6c47ff;color:white;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:13px;font-weight:600;display:inline-block">View Reports →</a>
    </div>
    <div style="font-size:10px;color:#aaa;text-align:center;margin-top:16px">
      WagenAI · <a href="${dashboardUrl}/dashboard/settings" style="color:#6c47ff;text-decoration:none">Manage notification settings</a>
    </div>
  </div>
</div>
</body></html>`;
}

// ─── Email sender ─────────────────────────────────────────────────────────────

async function sendReportEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = env.BREVO_API_KEY;
  if (!apiKey) throw new Error("BREVO_API_KEY is not configured");
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
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

// ─── Job processor ────────────────────────────────────────────────────────────

function todayStart(): Date {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start;
}

async function processReportJob(userId: string): Promise<void> {
  const userResult = await pool.query<{ id: string; name: string; email: string }>(
    "SELECT id, name, email FROM users WHERE id = $1",
    [userId]
  );
  const user = userResult.rows[0];
  if (!user) {
    console.warn(`[DailyReport] User ${userId} not found, skipping`);
    return;
  }

  const start = todayStart();
  const snapshot = await fetchDailyReportData(userId, start);

  await pool.query(
    `INSERT INTO daily_reports (user_id, report_date, snapshot)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, report_date) DO UPDATE SET snapshot = EXCLUDED.snapshot`,
    [userId, snapshot.date, JSON.stringify(snapshot)]
  );

  const dateLabel = new Date().toLocaleDateString("en-IN", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

  const html = generateEmailHtml({
    userName: user.name,
    dateLabel,
    snapshot,
    dashboardUrl: env.APP_BASE_URL
  });

  await sendReportEmail(user.email, `WagenAI Daily Report — ${dateLabel}`, html);
  console.log(`[DailyReport] Report sent to ${user.email}`);
}

// ─── Cron scheduler ───────────────────────────────────────────────────────────

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
    await queue.add("send-report", { userId: user.id }, {
      jobId, attempts: 3, backoff: { type: "exponential", delay: 5000 }
    });
  }
  console.log(`[DailyReport] Enqueued ${rows.length} report job(s) for ${today}`);
}

function scheduleDailyCron(): void {
  const now = new Date();
  const next = new Date();
  next.setHours(23, 59, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const msUntilNext = next.getTime() - now.getTime();
  cronTimer = setTimeout(async () => {
    try { await enqueueDailyReports(); } catch (err) {
      console.error("[DailyReport] Cron enqueue error", err);
    }
    scheduleDailyCron();
  }, msUntilNext);
  console.log(`[DailyReport] Next cron in ${Math.round(msUntilNext / 60000)} minutes`);
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let reportWorker: Worker | null = null;
let cronTimer: ReturnType<typeof setTimeout> | null = null;

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
  reportWorker.on("completed", (job) => console.log(`[DailyReport] Job completed: ${job.id}`));
  reportWorker.on("failed", (job, err) =>
    console.error(`[DailyReport] Job failed: ${job?.id}`, err)
  );
  scheduleDailyCron();
}

export async function stopDailyReportWorker(): Promise<void> {
  if (cronTimer) { clearTimeout(cronTimer); cronTimer = null; }
  if (reportWorker) { await reportWorker.close(); reportWorker = null; }
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd apps/api && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/daily-report-worker-service.ts
git commit -m "refactor: use daily-report-data-service in worker, save snapshot to DB"
```

---

### Task 4: reports.ts API route

**Files:**
- Create: `apps/api/src/routes/reports.ts`

- [ ] **Step 1: Create the file**

```typescript
// apps/api/src/routes/reports.ts
import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";
import { fetchDailyReportData, type DailyReportSnapshot } from "../services/daily-report-data-service.js";

interface DailyReportRow {
  id: string;
  report_date: string;
  snapshot: DailyReportSnapshot;
}

export async function reportsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/reports/daily/today",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return fetchDailyReportData(request.authUser.userId, start);
    }
  );

  fastify.get(
    "/api/reports/daily",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const result = await pool.query<DailyReportRow>(
        `SELECT id, report_date, snapshot
         FROM daily_reports
         WHERE user_id = $1
         ORDER BY report_date DESC
         LIMIT 30`,
        [request.authUser.userId]
      );
      return {
        reports: result.rows.map((r) => ({
          id: r.id,
          reportDate: r.report_date,
          snapshot: r.snapshot
        }))
      };
    }
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/reports.ts
git commit -m "feat: add /api/reports/daily routes"
```

---

### Task 5: Register reports route in app.ts

**Files:**
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Add import** (after the `notificationsRoutes` import line)

```typescript
import { reportsRoutes } from "./routes/reports.js";
```

- [ ] **Step 2: Register the route** (after `await notificationsRoutes(app);`)

```typescript
await reportsRoutes(app);
```

- [ ] **Step 3: Run TypeScript check**

```bash
cd apps/api && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/app.ts
git commit -m "feat: register reportsRoutes in app"
```

---

### Task 6: Frontend API types and functions

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/shared/dashboard/query-keys.ts`

- [ ] **Step 1: Add to `apps/web/src/lib/api.ts`** (append at end of file)

```typescript
export type DailyReportSnapshot = {
  date: string;
  overview: {
    totalConversations: number;
    leads: number;
    complaints: number;
    feedback: number;
  };
  topLeads: {
    conversationId: string;
    phoneNumber: string;
    summary: string;
    score: number;
    status: string;
  }[];
  topComplaints: {
    conversationId: string;
    phoneNumber: string;
    summary: string;
    sentiment: string | null;
    score: number;
    status: string;
  }[];
  topFeedback: {
    conversationId: string;
    phoneNumber: string;
    summary: string;
    status: string;
  }[];
  broadcasts: { sent: number; delivered: number; failed: number };
  automation: { sequencesCompleted: number; flowsCompleted: number };
  alerts: string[];
};

export type DailyReportEntry = {
  id: string;
  reportDate: string;
  snapshot: DailyReportSnapshot;
};

export function fetchTodayReport(token: string): Promise<DailyReportSnapshot> {
  return apiRequest("/api/reports/daily/today", { token });
}

export function fetchDailyReports(token: string): Promise<{ reports: DailyReportEntry[] }> {
  return apiRequest("/api/reports/daily", { token });
}
```

- [ ] **Step 2: Add query keys to `apps/web/src/shared/dashboard/query-keys.ts`**

Add after line 17 (after `dashboardWebhooksRoot`):

```typescript
const dashboardReportsRoot = ["dashboard", "reports"] as const;
```

Add inside the `dashboardQueryKeys` object (after `segmentContacts`):

```typescript
reportsRoot: dashboardReportsRoot,
todayReport: [...dashboardReportsRoot, "today"] as const,
dailyReports: [...dashboardReportsRoot, "history"] as const,
notificationSettings: [...dashboardReportsRoot, "notification-settings"] as const,
```

- [ ] **Step 3: Run TypeScript check**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/shared/dashboard/query-keys.ts
git commit -m "feat: add DailyReportSnapshot types and fetch functions to api client"
```

---

### Task 7: Frontend reports module

**Files:**
- Create: `apps/web/src/modules/dashboard/reports/api.ts`
- Create: `apps/web/src/modules/dashboard/reports/queries.ts`
- Create: `apps/web/src/modules/dashboard/reports/reports.css`
- Create: `apps/web/src/modules/dashboard/reports/route.tsx`

- [ ] **Step 1: Create `api.ts`**

```typescript
// apps/web/src/modules/dashboard/reports/api.ts
import {
  fetchTodayReport,
  fetchDailyReports,
  getNotificationSettings,
  updateNotificationSettings
} from "../../../lib/api";

export function getTodayReport(token: string) {
  return fetchTodayReport(token);
}

export function getDailyReports(token: string) {
  return fetchDailyReports(token);
}

export function fetchNotifSettings(token: string) {
  return getNotificationSettings(token);
}

export function saveNotifSettings(token: string, dailyReportEnabled: boolean) {
  return updateNotificationSettings(token, dailyReportEnabled);
}
```

- [ ] **Step 2: Create `queries.ts`**

```typescript
// apps/web/src/modules/dashboard/reports/queries.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { getTodayReport, getDailyReports, fetchNotifSettings, saveNotifSettings } from "./api";

export function useTodayReportQuery(token: string) {
  return useQuery({
    queryKey: dashboardQueryKeys.todayReport,
    queryFn: () => getTodayReport(token),
    staleTime: 5 * 60 * 1000
  });
}

export function useDailyReportsQuery(token: string) {
  return useQuery({
    queryKey: dashboardQueryKeys.dailyReports,
    queryFn: () => getDailyReports(token)
  });
}

export function useNotificationSettingsQuery(token: string) {
  return useQuery({
    queryKey: dashboardQueryKeys.notificationSettings,
    queryFn: () => fetchNotifSettings(token)
  });
}

export function useToggleNotificationMutation(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => saveNotifSettings(token, enabled),
    onSuccess: (data) => {
      queryClient.setQueryData(dashboardQueryKeys.notificationSettings, data);
    }
  });
}
```

- [ ] **Step 3: Create `reports.css`**

```css
/* apps/web/src/modules/dashboard/reports/reports.css */
.reports-page {
  padding: 1.5rem;
  max-width: 860px;
  display: grid;
  gap: 1.25rem;
}

.reports-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.reports-header h2 {
  font-size: 1.4rem;
  font-family: "Manrope", "Segoe UI", sans-serif;
  color: #1f2d48;
  margin: 0;
}

.reports-notif-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.reports-section-label {
  font-size: 0.72rem;
  font-weight: 700;
  color: #8096b2;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.reports-stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.75rem;
}

.reports-stat-card {
  border-radius: 10px;
  padding: 1rem;
  text-align: center;
}

.reports-stat-card .stat-value {
  font-size: 1.6rem;
  font-weight: 700;
  line-height: 1;
}

.reports-stat-card .stat-label {
  font-size: 0.7rem;
  color: #8096b2;
  margin-top: 0.3rem;
}

.reports-stat-card.total  { background: #f3f0ff; }
.reports-stat-card.total  .stat-value { color: #6c47ff; }
.reports-stat-card.leads  { background: #f0fff4; }
.reports-stat-card.leads  .stat-value { color: #22c55e; }
.reports-stat-card.complaints { background: #fff5f5; }
.reports-stat-card.complaints .stat-value { color: #ef4444; }
.reports-stat-card.feedback { background: #fffbf0; }
.reports-stat-card.feedback .stat-value { color: #f59e0b; }

.reports-insight-list {
  display: grid;
  gap: 0.5rem;
}

.reports-insight-item {
  border-radius: 0 8px 8px 0;
  padding: 0.6rem 0.8rem;
  background: #fafafa;
}

.reports-insight-item.lead     { border-left: 3px solid #6c47ff; }
.reports-insight-item.complaint { border-left: 3px solid #ef4444; }
.reports-insight-item.feedback { border-left: 3px solid #22c55e; }

.reports-insight-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.reports-insight-phone {
  font-size: 0.82rem;
  font-weight: 600;
  color: #253551;
}

.reports-badge {
  font-size: 0.68rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
}

.reports-badge.score-hot  { background: #fde8e8; color: #b91c1c; }
.reports-badge.score-warm { background: #fef3c7; color: #b45309; }
.reports-badge.score-cold { background: #f1f5f9; color: #475569; }
.reports-badge.sentiment  { background: #fff5f5; color: #ef4444; }

.reports-insight-summary {
  font-size: 0.78rem;
  color: #546a86;
  margin-top: 0.2rem;
}

.reports-insight-status {
  font-size: 0.68rem;
  color: #8096b2;
  margin-top: 0.15rem;
}

.reports-broadcast-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
}

.reports-broadcast-card {
  text-align: center;
  background: #f9f9f9;
  border-radius: 8px;
  padding: 0.75rem;
}

.reports-broadcast-card.failed-nonzero { background: #fff5f5; }

.reports-broadcast-card .stat-value {
  font-size: 1.3rem;
  font-weight: 700;
  color: #253551;
}

.reports-broadcast-card.failed-nonzero .stat-value { color: #ef4444; }

.reports-broadcast-card .stat-label {
  font-size: 0.7rem;
  color: #8096b2;
  margin-top: 0.2rem;
}

.reports-auto-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.reports-auto-card {
  text-align: center;
  background: #f9f9f9;
  border-radius: 8px;
  padding: 0.75rem;
}

.reports-auto-card .stat-value {
  font-size: 1.3rem;
  font-weight: 700;
  color: #253551;
}

.reports-auto-card .stat-label {
  font-size: 0.7rem;
  color: #8096b2;
  margin-top: 0.2rem;
}

.reports-alerts {
  display: grid;
  gap: 0.4rem;
}

.reports-alert-item {
  font-size: 0.82rem;
  color: #7c3827;
  background: #fff5f0;
  border-left: 3px solid #ef4444;
  padding: 0.5rem 0.75rem;
  border-radius: 0 6px 6px 0;
}

.reports-empty {
  font-size: 0.88rem;
  color: #8096b2;
  margin: 0;
}

.reports-error {
  font-size: 0.88rem;
  color: #b91c1c;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.reports-error button {
  font-size: 0.82rem;
  color: #6c47ff;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
}

.reports-history-row {
  border: 1px solid #d4deec;
  border-radius: 10px;
  overflow: hidden;
}

.reports-history-toggle {
  width: 100%;
  text-align: left;
  background: #f7f9fc;
  border: none;
  padding: 0.75rem 1rem;
  font-size: 0.9rem;
  font-weight: 600;
  color: #253551;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.reports-history-toggle:hover { background: #eef3fa; }

.reports-history-content {
  padding: 1rem;
  display: grid;
  gap: 1rem;
}

.reports-loading {
  font-size: 0.88rem;
  color: #8096b2;
}
```

- [ ] **Step 4: Create `route.tsx`**

```tsx
// apps/web/src/modules/dashboard/reports/route.tsx
import "./reports.css";
import type { DailyReportSnapshot } from "../../../lib/api";
import { useState } from "react";
import { useDashboardShell } from "../../../shared/dashboard/shell-context";
import {
  useTodayReportQuery,
  useDailyReportsQuery,
  useNotificationSettingsQuery,
  useToggleNotificationMutation
} from "./queries";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatReportDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function scoreBadgeClass(score: number): string {
  if (score >= 80) return "reports-badge score-hot";
  if (score >= 50) return "reports-badge score-warm";
  return "reports-badge score-cold";
}

function scoreBadgeLabel(score: number): string {
  if (score >= 80) return `🔴 HOT · ${score}`;
  if (score >= 50) return `🟡 WARM · ${score}`;
  return `⚪ COLD · ${score}`;
}

function statusLabel(status: string): string {
  if (status === "open") return "❌ Not resolved";
  if (status === "pending") return "⏳ Follow-up pending";
  if (status === "resolved") return "✅ Resolved";
  return status;
}

function sentimentLabel(s: string | null): string {
  const map: Record<string, string> = {
    angry: "😡 Angry", frustrated: "😤 Frustrated",
    negative: "😞 Negative", positive: "😊 Positive", neutral: "😐 Neutral"
  };
  return s ? (map[s] ?? s) : "";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ReportCard({ snapshot }: { snapshot: DailyReportSnapshot }) {
  const { overview, topLeads, topComplaints, topFeedback, broadcasts, automation, alerts } = snapshot;
  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div className="reports-stat-grid">
        <div className="reports-stat-card total">
          <div className="stat-value">{overview.totalConversations}</div>
          <div className="stat-label">Conversations</div>
        </div>
        <div className="reports-stat-card leads">
          <div className="stat-value">{overview.leads}</div>
          <div className="stat-label">Leads</div>
        </div>
        <div className="reports-stat-card complaints">
          <div className="stat-value">{overview.complaints}</div>
          <div className="stat-label">Complaints</div>
        </div>
        <div className="reports-stat-card feedback">
          <div className="stat-value">{overview.feedback}</div>
          <div className="stat-label">Feedback</div>
        </div>
      </div>

      <div>
        <p className="web-widget-label" style={{ marginBottom: "0.5rem" }}>🧲 Top Leads</p>
        {topLeads.length === 0
          ? <p className="reports-empty">No leads today.</p>
          : <div className="reports-insight-list">
              {topLeads.map((r) => (
                <div key={r.conversationId} className="reports-insight-item lead">
                  <div className="reports-insight-head">
                    <span className="reports-insight-phone">{r.phoneNumber}</span>
                    <span className={scoreBadgeClass(r.score)}>{scoreBadgeLabel(r.score)}</span>
                  </div>
                  <div className="reports-insight-summary">{r.summary}</div>
                  <div className="reports-insight-status">{statusLabel(r.status)}</div>
                </div>
              ))}
            </div>
        }
      </div>

      <div>
        <p className="web-widget-label" style={{ marginBottom: "0.5rem" }}>⚠️ Top Complaints</p>
        {topComplaints.length === 0
          ? <p className="reports-empty">No complaints today.</p>
          : <div className="reports-insight-list">
              {topComplaints.map((r) => (
                <div key={r.conversationId} className="reports-insight-item complaint">
                  <div className="reports-insight-head">
                    <span className="reports-insight-phone">{r.phoneNumber}</span>
                    {r.sentiment && <span className="reports-badge sentiment">{sentimentLabel(r.sentiment)}</span>}
                  </div>
                  <div className="reports-insight-summary">{r.summary}</div>
                  <div className="reports-insight-status">{statusLabel(r.status)}</div>
                </div>
              ))}
            </div>
        }
      </div>

      <div>
        <p className="web-widget-label" style={{ marginBottom: "0.5rem" }}>💬 Feedback</p>
        {topFeedback.length === 0
          ? <p className="reports-empty">No feedback today.</p>
          : <div className="reports-insight-list">
              {topFeedback.map((r) => (
                <div key={r.conversationId} className="reports-insight-item feedback">
                  <div className="reports-insight-phone">{r.phoneNumber}</div>
                  <div className="reports-insight-summary">{r.summary}</div>
                  <div className="reports-insight-status">{statusLabel(r.status)}</div>
                </div>
              ))}
            </div>
        }
      </div>

      <div>
        <p className="web-widget-label" style={{ marginBottom: "0.5rem" }}>📩 Broadcast Performance</p>
        <div className="reports-broadcast-grid">
          <div className="reports-broadcast-card">
            <div className="stat-value">{broadcasts.sent}</div>
            <div className="stat-label">Sent</div>
          </div>
          <div className="reports-broadcast-card">
            <div className="stat-value" style={{ color: "#22c55e" }}>{broadcasts.delivered}</div>
            <div className="stat-label">Delivered</div>
          </div>
          <div className={`reports-broadcast-card${broadcasts.failed > 0 ? " failed-nonzero" : ""}`}>
            <div className="stat-value">{broadcasts.failed}</div>
            <div className="stat-label">Failed</div>
          </div>
        </div>
      </div>

      <div>
        <p className="web-widget-label" style={{ marginBottom: "0.5rem" }}>⚙️ Automation</p>
        <div className="reports-auto-grid">
          <div className="reports-auto-card">
            <div className="stat-value">{automation.sequencesCompleted}</div>
            <div className="stat-label">Sequences completed</div>
          </div>
          <div className="reports-auto-card">
            <div className="stat-value">{automation.flowsCompleted}</div>
            <div className="stat-label">Flows completed</div>
          </div>
        </div>
      </div>

      {alerts.length > 0 && (
        <div>
          <p className="web-widget-label" style={{ marginBottom: "0.5rem" }}>🚨 Alerts</p>
          <div className="reports-alerts">
            {alerts.map((a, i) => (
              <div key={i} className="reports-alert-item">⚠️ {a}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function Component() {
  const { token } = useDashboardShell();
  const todayQuery = useTodayReportQuery(token);
  const historyQuery = useDailyReportsQuery(token);
  const notifQuery = useNotificationSettingsQuery(token);
  const toggleMutation = useToggleNotificationMutation(token);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const dailyReportEnabled = notifQuery.data?.dailyReportEnabled ?? false;

  return (
    <section className="reports-page">
      <div className="reports-header">
        <h2>Reports</h2>
        <div className="reports-notif-row">
          <span className="web-widget-label">Daily email</span>
          <button
            type="button"
            className={dailyReportEnabled ? "go-live-switch on" : "go-live-switch"}
            disabled={toggleMutation.isPending || notifQuery.isPending}
            onClick={() => toggleMutation.mutate(!dailyReportEnabled)}
            aria-label={dailyReportEnabled ? "Disable daily report email" : "Enable daily report email"}
          >
            <span />
          </button>
        </div>
      </div>

      <div className="reports-section-label">Today</div>
      {todayQuery.isPending ? (
        <p className="reports-loading">Loading today&apos;s report…</p>
      ) : todayQuery.isError ? (
        <div className="reports-error">
          Failed to load today&apos;s report.
          <button type="button" onClick={() => { void todayQuery.refetch(); }}>Retry</button>
        </div>
      ) : todayQuery.data ? (
        <article className="channel-setup-panel">
          <header>
            <h3>Today · {formatReportDate(todayQuery.data.date)}</h3>
          </header>
          <ReportCard snapshot={todayQuery.data} />
        </article>
      ) : null}

      <div className="reports-section-label">Past Reports</div>
      {historyQuery.isPending ? (
        <p className="reports-loading">Loading history…</p>
      ) : historyQuery.isError ? (
        <p className="reports-error">Failed to load report history.</p>
      ) : !historyQuery.data?.reports.length ? (
        <p className="reports-empty">Your first report will appear here after 11:59 PM tonight.</p>
      ) : (
        historyQuery.data.reports.map((r) => (
          <div key={r.id} className="reports-history-row">
            <button
              type="button"
              className="reports-history-toggle"
              onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
            >
              <span>{formatReportDate(r.reportDate)}</span>
              <span>{expandedId === r.id ? "▲" : "▶"}</span>
            </button>
            {expandedId === r.id && (
              <div className="reports-history-content">
                <ReportCard snapshot={r.snapshot} />
              </div>
            )}
          </div>
        ))
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run TypeScript check**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/modules/dashboard/reports/
git commit -m "feat: add reports module (api, queries, route, css)"
```

---

### Task 8: Register nav entry

**Files:**
- Modify: `apps/web/src/registry/dashboardModules.ts`

- [ ] **Step 1: Add entry** (after the `analytics` entry, around line 81)

```typescript
  {
    id: "reports",
    path: "reports",
    navTo: "/dashboard/reports",
    navLabel: "Reports",
    subtitle: "Daily summaries",
    icon: "analytics",
    section: "main",
    lazyRoute: () => import("../modules/dashboard/reports/route"),
    prefetchStrategy: "code+data",
    requiresAuth: true
  },
```

- [ ] **Step 2: Run full lint**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 3: Commit and push**

```bash
git add apps/web/src/registry/dashboardModules.ts
git commit -m "feat: add Reports nav entry to dashboard"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- ✅ New Reports nav entry — Task 8
- ✅ `daily_reports` table — Task 1
- ✅ Shared data service extracted — Task 2
- ✅ Worker saves snapshot + updated HTML generator — Task 3
- ✅ `GET /api/reports/daily/today` (live query) — Task 4
- ✅ `GET /api/reports/daily` (last 30 snapshots) — Task 4
- ✅ Notification toggle on Reports page — Task 7 (`route.tsx`)
- ✅ Today's live panel — Task 7
- ✅ History list collapsible — Task 7
- ✅ Error/empty states — Task 7
- ✅ Notification toggle stays in Settings too (existing, untouched)

**Placeholder scan:** None found — all steps have complete code.

**Type consistency:**
- `DailyReportSnapshot` defined in Task 2 (`daily-report-data-service.ts`) and mirrored identically in Task 6 (`lib/api.ts`) — same field names throughout.
- `fetchDailyReportData` imported in Task 3 (worker) and Task 4 (route) — same import path.
- `dashboardQueryKeys.todayReport`, `.dailyReports`, `.notificationSettings` added in Task 6, consumed in Task 7 `queries.ts` — consistent.

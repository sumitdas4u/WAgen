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

function todayStart(): Date {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start;
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

function sentimentLabel(sentiment: string | null): string {
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
  if (rows.length === 0) {
    return `<p style="color:#888;font-size:12px;margin:0">No ${mode}s today.</p>`;
  }
  const borderColor = mode === "lead" ? "#6c47ff" : mode === "complaint" ? "#ef4444" : "#22c55e";
  return rows
    .map(
      (r) => `
      <div style="border-left:3px solid ${borderColor};padding:8px 12px;margin-bottom:8px;background:#fafafa;border-radius:0 6px 6px 0">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:12px;font-weight:600;color:#333">${r.phone_number}</span>
          ${mode === "lead" ? `<span style="background:#f3f0ff;color:#6c47ff;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600">${scoreBadge(r.priority_score)}</span>` : ""}
          ${mode !== "lead" && r.sentiment ? `<span style="background:#fff5f5;color:#ef4444;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600">${sentimentLabel(r.sentiment)}</span>` : ""}
        </div>
        <div style="font-size:11px;color:#555;margin-top:4px">${r.summary}</div>
        <div style="font-size:10px;color:#999;margin-top:2px">${statusLabel(r.status)}</div>
      </div>`
    )
    .join("");
}

function buildAlerts(
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
  const { user, date, overview, leads, complaints, feedback, broadcast, aiInsights, automation, dashboardUrl } =
    params;
  const alerts = buildAlerts(broadcast, aiInsights, complaints);
  const sent = parseInt(broadcast?.sent_count ?? "0", 10);
  const delivered = parseInt(broadcast?.delivered_count ?? "0", 10);
  const failed = parseInt(broadcast?.failed_count ?? "0", 10);
  const unanswered = parseInt(aiInsights.count, 10);

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WagenAI Daily Report</title></head>
<body style="margin:0;padding:20px;background:#f0f0f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1)">

  <div style="background:linear-gradient(135deg,#6c47ff,#9b59b6);padding:24px;color:white">
    <div style="font-size:20px;font-weight:700">📊 WagenAI Daily Report</div>
    <div style="font-size:12px;opacity:0.85;margin-top:4px">Hi ${user.name} · ${date}</div>
  </div>

  <div style="padding:24px">

    <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">Overview</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:24px">
      <div style="background:#f3f0ff;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#6c47ff">${overview["total"] ?? 0}</div>
        <div style="font-size:10px;color:#888;margin-top:2px">Conversations</div>
      </div>
      <div style="background:#f0fff4;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#22c55e">${overview["lead"] ?? 0}</div>
        <div style="font-size:10px;color:#888;margin-top:2px">Leads</div>
      </div>
      <div style="background:#fff5f5;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#ef4444">${overview["complaint"] ?? 0}</div>
        <div style="font-size:10px;color:#888;margin-top:2px">Complaints</div>
      </div>
      <div style="background:#fffbf0;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#f59e0b">${overview["feedback"] ?? 0}</div>
        <div style="font-size:10px;color:#888;margin-top:2px">Feedback</div>
      </div>
    </div>

    <div style="font-size:13px;font-weight:700;color:#6c47ff;margin-bottom:10px">🧲 Top Leads</div>
    ${insightRows(leads, "lead")}

    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">

    <div style="font-size:13px;font-weight:700;color:#ef4444;margin-bottom:10px">⚠️ Top Complaints</div>
    ${insightRows(complaints, "complaint")}

    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">

    <div style="font-size:13px;font-weight:700;color:#22c55e;margin-bottom:10px">💬 Customer Feedback</div>
    ${insightRows(feedback, "feedback")}

    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">

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

    <div style="font-size:13px;font-weight:700;color:#333;margin-bottom:10px">🤖 AI Insights</div>
    ${
      unanswered > 0
        ? `<div style="background:#f9f3ff;border-radius:6px;padding:12px;margin-bottom:6px">
      <div style="font-size:12px;color:#6c47ff;font-weight:600">${unanswered} unanswered question${unanswered > 1 ? "s" : ""} need training</div>
      ${aiInsights.example_question ? `<div style="font-size:11px;color:#888;margin-top:4px">Example: "${aiInsights.example_question}"</div>` : ""}
    </div>`
        : `<p style="color:#888;font-size:12px;margin:0">No unanswered queries today. 🎉</p>`
    }

    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">

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

    ${
      alerts.length > 0
        ? `<hr style="border:none;border-top:1px solid #eee;margin:20px 0">
    <div style="font-size:13px;font-weight:700;color:#ef4444;margin-bottom:10px">🚨 Alerts</div>
    ${alerts.map((a) => `<div style="font-size:12px;color:#555;padding:4px 0">${a}</div>`).join("")}`
        : ""
    }

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
  const apiKey = env.BREVO_API_KEY;
  if (!apiKey) {
    throw new Error("BREVO_API_KEY is not configured");
  }
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
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

// ─── Job Processor ────────────────────────────────────────────────────────────

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

  const start = todayStart();
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
    dashboardUrl: env.APP_BASE_URL
  });

  await sendReportEmail(user.email, `WagenAI Daily Report — ${date}`, html);
  console.log(`[DailyReport] Report sent to ${user.email}`);
}

// ─── Cron Scheduler ───────────────────────────────────────────────────────────

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
    scheduleDailyCron();
  }, msUntilNext);

  const minutesUntil = Math.round(msUntilNext / 1000 / 60);
  console.log(`[DailyReport] Next report cron in ${minutesUntil} minutes`);
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
  if (cronTimer) {
    clearTimeout(cronTimer);
    cronTimer = null;
  }
  if (reportWorker) {
    await reportWorker.close();
    reportWorker = null;
  }
}

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

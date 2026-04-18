import { Worker } from "bullmq";
import { pool } from "../db/pool.js";
import { createQueueWorkerConnection, getDailyReportQueue } from "./queue-service.js";
import { fetchDailyReportData, type DailyReportSnapshot } from "./daily-report-data-service.js";
import { env } from "../config/env.js";

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

function scoreBadge(score: number): string {
  if (score >= 80) return `HOT · ${score}`;
  if (score >= 50) return `WARM · ${score}`;
  return `COLD · ${score}`;
}

function metricLine(label: string, value: string): string {
  return `<div style="font-size:12px;color:#445068;padding:4px 0"><strong>${label}:</strong> ${value}</div>`;
}

function listBlock(items: string[]): string {
  if (items.length === 0) {
    return `<p style="margin:0;color:#7a879a;font-size:12px">No items for this section today.</p>`;
  }

  return items.map((item) => `<div style="padding:6px 0;font-size:12px;color:#445068">• ${item}</div>`).join("");
}

function priorityRows(snapshot: DailyReportSnapshot): string {
  const items = [
    ...snapshot.priority.staleLeads.map((item) => `${item.contactLabel} — ${item.reason}. ${item.suggestedAction}`),
    ...snapshot.priority.stuckConversations.map((item) => `${item.contactLabel} — ${item.reason}. ${item.suggestedAction}`),
    ...snapshot.priority.lowConfidenceChats.map((item) => `${item.contactLabel} — low AI confidence on "${item.question}"`)
  ];

  if (items.length === 0) {
    return `<div style="font-size:12px;color:#166534;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px">No urgent attention items today.</div>`;
  }

  return items.slice(0, 5).map((item) => `
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:10px 12px;margin-bottom:8px;font-size:12px;color:#9a3412">
      ${item}
    </div>
  `).join("");
}

function leadRows(snapshot: DailyReportSnapshot): string {
  if (snapshot.topLeads.length === 0) {
    return `<p style="margin:0;color:#7a879a;font-size:12px">No leads recorded today.</p>`;
  }

  return snapshot.topLeads.map((lead) => `
    <div style="border:1px solid #dbeafe;border-left:4px solid #2563eb;border-radius:10px;padding:12px;margin-bottom:10px;background:#f8fbff">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div>
          <div style="font-size:13px;font-weight:700;color:#122033">${lead.contactLabel}</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px">${lead.lastActivityAt ? `Last activity ${new Date(lead.lastActivityAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : "No activity time"}</div>
        </div>
        <div style="font-size:10px;font-weight:700;color:#1d4ed8;background:#dbeafe;padding:4px 8px;border-radius:999px">${scoreBadge(lead.score)}</div>
      </div>
      ${metricLine("Last message", lead.lastMessage || lead.summary)}
      ${metricLine("Summary", lead.summary)}
      ${metricLine("Action", lead.suggestedAction)}
    </div>
  `).join("");
}

function complaintRows(snapshot: DailyReportSnapshot): string {
  if (snapshot.topComplaints.length === 0) {
    return `<div style="font-size:12px;color:#166534;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px">No complaints today. ${snapshot.comparisons.complaintsDelta < 0 ? "Performance improved vs yesterday." : ""}</div>`;
  }

  return snapshot.topComplaints.map((item) => `
    <div style="border:1px solid #fecdd3;border-left:4px solid #dc2626;border-radius:10px;padding:12px;margin-bottom:10px;background:#fff8f8">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div style="font-size:13px;font-weight:700;color:#122033">${item.contactLabel}</div>
        <div style="font-size:10px;font-weight:700;color:#b91c1c;background:#fee2e2;padding:4px 8px;border-radius:999px">${sentimentLabel(item.sentiment)}</div>
      </div>
      ${metricLine("Last message", item.lastMessage || item.summary)}
      ${metricLine("Status", statusLabel(item.status))}
      ${metricLine("Comparison", item.comparisonNote)}
    </div>
  `).join("");
}

function feedbackRows(snapshot: DailyReportSnapshot): string {
  if (snapshot.topFeedback.length === 0) {
    return `<p style="margin:0;color:#7a879a;font-size:12px">No feedback recorded today.</p>`;
  }

  return snapshot.topFeedback.map((item) => `
    <div style="border:1px solid #bbf7d0;border-left:4px solid #16a34a;border-radius:10px;padding:12px;margin-bottom:10px;background:#f8fff9">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div style="font-size:13px;font-weight:700;color:#122033">${item.contactLabel}</div>
        <div style="font-size:10px;font-weight:700;color:#166534;background:#dcfce7;padding:4px 8px;border-radius:999px">${sentimentLabel(item.sentiment)}</div>
      </div>
      ${metricLine("Feedback", item.summary)}
      ${metricLine("Insight", item.insight)}
      ${metricLine("Pattern", item.repeatCount > 1 ? `Repeated ${item.repeatCount} times today` : "Single feedback pattern today")}
    </div>
  `).join("");
}

function generateEmailHtml(params: {
  userName: string;
  dateLabel: string;
  snapshot: DailyReportSnapshot;
  dashboardUrl: string;
}): string {
  const { userName, dateLabel, snapshot, dashboardUrl } = params;
  const { overview, broadcasts, automation, alerts, aiPerformance } = snapshot;

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
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:24px">
      <div style="background:#f8fafc;border-radius:10px;padding:12px;border:1px solid #e2e8f0">
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.08em">Response Rate</div>
        <div style="font-size:22px;font-weight:700;color:#122033">${overview.responseRate ?? "—"}${overview.responseRate !== null ? "%" : ""}</div>
      </div>
      <div style="background:#f8fafc;border-radius:10px;padding:12px;border:1px solid #e2e8f0">
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.08em">Avg Response</div>
        <div style="font-size:22px;font-weight:700;color:#122033">${overview.avgResponseTimeMinutes ?? "—"}${overview.avgResponseTimeMinutes !== null ? "m" : ""}</div>
      </div>
    </div>
    <div style="font-size:13px;font-weight:700;color:#9a3412;margin-bottom:10px">🚨 Needs Attention</div>
    ${priorityRows(snapshot)}
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
    <div style="font-size:13px;font-weight:700;color:#2563eb;margin-bottom:10px">💰 Top Leads</div>
    ${leadRows(snapshot)}
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
    <div style="font-size:13px;font-weight:700;color:#dc2626;margin-bottom:10px">⚠️ Complaints</div>
    ${complaintRows(snapshot)}
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
    <div style="font-size:13px;font-weight:700;color:#16a34a;margin-bottom:10px">💬 Customer Feedback</div>
    ${feedbackRows(snapshot)}
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
    <div style="font-size:13px;font-weight:700;color:#333;margin-bottom:10px">🤖 AI Performance</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <div style="background:#f8fafc;border-radius:10px;padding:12px;border:1px solid #e2e8f0">
        <div style="font-size:18px;font-weight:700;color:#122033">${aiPerformance.aiHandled.percent ?? 0}%</div>
        <div style="font-size:10px;color:#64748b">AI handled</div>
      </div>
      <div style="background:#f8fafc;border-radius:10px;padding:12px;border:1px solid #e2e8f0">
        <div style="font-size:18px;font-weight:700;color:#122033">${aiPerformance.humanTakeover.percent ?? 0}%</div>
        <div style="font-size:10px;color:#64748b">Human takeover</div>
      </div>
      <div style="background:#fff7ed;border-radius:10px;padding:12px;border:1px solid #fed7aa">
        <div style="font-size:18px;font-weight:700;color:#9a3412">${aiPerformance.failedResponses}</div>
        <div style="font-size:10px;color:#9a3412">Low confidence</div>
      </div>
    </div>
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
    <div style="font-size:13px;font-weight:700;color:#333;margin-bottom:10px">📈 Insights & Improvements</div>
    ${listBlock([...snapshot.insights, ...snapshot.improvements].slice(0, 6))}
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
    <div style="font-size:13px;font-weight:700;color:#333;margin-bottom:10px">📩 Broadcasts & Automation</div>
    ${metricLine("Broadcast sent", String(broadcasts.sent))}
    ${metricLine("Broadcast delivered", String(broadcasts.delivered))}
    ${metricLine("Broadcast failed", String(broadcasts.failed))}
    ${metricLine("Sequences completed", String(automation.sequencesCompleted))}
    ${metricLine("Flows completed", String(automation.flowsCompleted))}
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

  await sendReportEmail(
    user.email,
    `📊 WagenAI Daily Report – ${dateLabel} | ${snapshot.overview.leads} Lead${snapshot.overview.leads === 1 ? "" : "s"}, ${snapshot.overview.complaints} Complaint${snapshot.overview.complaints === 1 ? "" : "s"}`,
    html
  );
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
    {
      connection,
      prefix: env.QUEUE_PREFIX?.trim() || undefined,
      concurrency: 3
    }
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

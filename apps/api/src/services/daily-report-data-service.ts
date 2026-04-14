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
  conversation_id: string;
  phone_number: string;
  summary: string;
  sentiment: string | null;
  priority_score: number;
  status: string;
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
  try {
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
  } catch {
    return [];
  }
}

async function queryBroadcastStats(userId: string, start: Date): Promise<BroadcastRow> {
  try {
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
  } catch {
    return { sent_count: "0", delivered_count: "0", failed_count: "0" };
  }
}

async function queryAiInsights(userId: string, start: Date): Promise<AiReviewRow> {
  try {
    const result = await pool.query<AiReviewRow>(
      `SELECT COUNT(*)::text AS count FROM ai_review_queue WHERE user_id = $1 AND created_at >= $2`,
      [userId, start]
    );
    return result.rows[0] ?? { count: "0" };
  } catch {
    return { count: "0" };
  }
}

async function queryAutomationStats(userId: string, start: Date): Promise<AutomationRow> {
  let sequences_completed = "0";
  let flows_completed = "0";
  try {
    const seqResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM sequence_enrollments
       WHERE sequence_id IN (SELECT id FROM sequences WHERE user_id = $1)
         AND status = 'completed' AND updated_at >= $2`,
      [userId, start]
    );
    sequences_completed = seqResult.rows[0]?.count ?? "0";
  } catch { /* table may not exist yet */ }
  try {
    const flowResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM flow_sessions
       WHERE user_id = $1 AND status = 'completed' AND updated_at >= $2`,
      [userId, start]
    );
    flows_completed = flowResult.rows[0]?.count ?? "0";
  } catch { /* table may not exist yet */ }
  return { sequences_completed, flows_completed };
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

import { pool } from "../db/pool.js";

function scoreFromMetrics(
  deliveryRate: number | null,
  failureRate: number | null,
  readRate: number | null,
  templateRejectionRate: number | null,
  totalBlocked: number
): number {
  let score = 100;
  if (deliveryRate !== null && deliveryRate < 0.85) score -= 20;
  if (failureRate !== null && failureRate > 0.10) score -= 25;
  if (readRate !== null && readRate < 0.10) score -= 15;
  if (templateRejectionRate !== null && templateRejectionRate > 0.20) score -= 20;
  if (totalBlocked > 10) score -= 20;
  return Math.max(0, score);
}

function riskLevel(score: number): string {
  if (score >= 80) return "safe";
  if (score >= 60) return "warning";
  if (score >= 40) return "danger";
  return "blocked";
}

export async function recalculateBroadcastReputation(workspaceId?: string): Promise<void> {
  // Aggregate campaign message delivery counts per workspace
  const deliveryResult = await pool.query<{
    workspace_id: string;
    total_sent: string;
    total_delivered: string;
    total_read: string;
    total_failed: string;
    total_blocked: string;
  }>(
    `SELECT
       w.id AS workspace_id,
       COUNT(cm.id) FILTER (WHERE cm.status IN ('sent','delivered','read','failed'))::text AS total_sent,
       COUNT(cm.id) FILTER (WHERE cm.status IN ('delivered','read'))::text AS total_delivered,
       COUNT(cm.id) FILTER (WHERE cm.status = 'read')::text AS total_read,
       COUNT(cm.id) FILTER (WHERE cm.status = 'failed')::text AS total_failed,
       COUNT(cm.id) FILTER (WHERE cm.status = 'skipped')::text AS total_blocked
     FROM workspaces w
     JOIN campaigns c ON c.user_id = w.owner_id
     JOIN campaign_messages cm ON cm.campaign_id = c.id
     ${workspaceId ? "WHERE w.id = $1" : ""}
     GROUP BY w.id`,
    workspaceId ? [workspaceId] : []
  );

  // Template rejection rates per workspace owner
  const templateResult = await pool.query<{
    user_id: string;
    total_templates: string;
    total_rejected: string;
  }>(
    `SELECT
       user_id::text,
       COUNT(*)::text AS total_templates,
       COUNT(*) FILTER (WHERE status = 'REJECTED')::text AS total_rejected
     FROM message_templates
     ${workspaceId ? "WHERE user_id = (SELECT owner_id FROM workspaces WHERE id = $1)" : ""}
     GROUP BY user_id`,
    workspaceId ? [workspaceId] : []
  );

  // Build owner_id → template stats map
  const templateMap = new Map<string, { total: number; rejected: number }>();
  for (const row of templateResult.rows) {
    templateMap.set(row.user_id, {
      total: Number(row.total_templates),
      rejected: Number(row.total_rejected),
    });
  }

  // Owner id per workspace
  const ownerResult = await pool.query<{ workspace_id: string; owner_id: string }>(
    `SELECT id AS workspace_id, owner_id::text FROM workspaces ${workspaceId ? "WHERE id = $1" : ""}`,
    workspaceId ? [workspaceId] : []
  );
  const ownerMap = new Map(ownerResult.rows.map((r) => [r.workspace_id, r.owner_id]));

  for (const row of deliveryResult.rows) {
    const totalSent = Number(row.total_sent);
    const totalDelivered = Number(row.total_delivered);
    const totalRead = Number(row.total_read);
    const totalFailed = Number(row.total_failed);
    const totalBlocked = Number(row.total_blocked);

    const deliveryRate = totalSent > 0 ? totalDelivered / totalSent : null;
    const failureRate = totalSent > 0 ? totalFailed / totalSent : null;
    const readRate = totalDelivered > 0 ? totalRead / totalDelivered : null;

    const ownerId = ownerMap.get(row.workspace_id);
    const templateStats = ownerId ? (templateMap.get(ownerId) ?? null) : null;
    const templateRejectionRate = templateStats && templateStats.total > 0
      ? templateStats.rejected / templateStats.total
      : null;

    const score = scoreFromMetrics(deliveryRate, failureRate, readRate, templateRejectionRate, totalBlocked);
    const risk = riskLevel(score);

    await pool.query(
      `INSERT INTO workspace_broadcast_reputation (
         workspace_id, total_sent, total_delivered, total_read, total_failed, total_blocked,
         total_templates, total_templates_rejected,
         delivery_rate, read_rate, failure_rate, template_rejection_rate,
         reputation_score, risk_level, last_calculated_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
       ON CONFLICT (workspace_id) DO UPDATE SET
         total_sent = EXCLUDED.total_sent,
         total_delivered = EXCLUDED.total_delivered,
         total_read = EXCLUDED.total_read,
         total_failed = EXCLUDED.total_failed,
         total_blocked = EXCLUDED.total_blocked,
         total_templates = EXCLUDED.total_templates,
         total_templates_rejected = EXCLUDED.total_templates_rejected,
         delivery_rate = EXCLUDED.delivery_rate,
         read_rate = EXCLUDED.read_rate,
         failure_rate = EXCLUDED.failure_rate,
         template_rejection_rate = EXCLUDED.template_rejection_rate,
         reputation_score = EXCLUDED.reputation_score,
         risk_level = EXCLUDED.risk_level,
         last_calculated_at = NOW(),
         updated_at = NOW()`,
      [
        row.workspace_id, totalSent, totalDelivered, totalRead, totalFailed, totalBlocked,
        templateStats?.total ?? 0, templateStats?.rejected ?? 0,
        deliveryRate, readRate, failureRate, templateRejectionRate,
        score, risk,
      ]
    );
  }
}

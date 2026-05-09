import { pool } from "../db/pool.js";

function computeTier(score: number): string {
  if (score >= 80) return "power_user";
  if (score >= 55) return "engaged";
  if (score >= 30) return "at_risk";
  return "inactive";
}

export async function recalculateWorkspaceHealth(workspaceId?: string): Promise<void> {
  const whereClause = workspaceId ? "WHERE w.id = $1" : "";
  const params = workspaceId ? [workspaceId] : [];

  const result = await pool.query<{
    workspace_id: string;
    owner_id: string;
    ai_active: boolean;
    has_active_flow: boolean;
    has_approved_template: boolean;
    has_sent_broadcast: boolean;
    active_conversations_7d: string;
    messages_sent_7d: string;
    payment_ok: boolean;
  }>(
    `SELECT
       w.id AS workspace_id,
       w.owner_id,
       u.ai_active,
       EXISTS(
         SELECT 1 FROM flows f WHERE f.user_id = w.owner_id AND f.status = 'active'
       ) AS has_active_flow,
       EXISTS(
         SELECT 1 FROM message_templates mt WHERE mt.user_id = w.owner_id AND mt.status = 'APPROVED'
       ) AS has_approved_template,
       EXISTS(
         SELECT 1 FROM campaigns c WHERE c.user_id = w.owner_id
           AND c.created_at > NOW() - INTERVAL '30 days'
           AND c.status IN ('completed','running')
       ) AS has_sent_broadcast,
       COALESCE((
         SELECT COUNT(*)::text FROM conversations cv
         WHERE cv.user_id = w.owner_id AND cv.updated_at > NOW() - INTERVAL '7 days'
       ), '0') AS active_conversations_7d,
       COALESCE((
         SELECT COUNT(*)::text FROM conversation_messages cm
         JOIN conversations cv ON cv.id = cm.conversation_id
         WHERE cv.user_id = w.owner_id
           AND cm.direction = 'outbound'
           AND cm.created_at > NOW() - INTERVAL '7 days'
       ), '0') AS messages_sent_7d,
       EXISTS(
         SELECT 1 FROM subscriptions s WHERE s.user_id = w.owner_id AND s.status = 'active'
       ) AS payment_ok
     FROM workspaces w
     JOIN users u ON u.id = w.owner_id
     ${whereClause}`,
    params
  );

  for (const row of result.rows) {
    let score = 0;
    if (row.ai_active) score += 20;
    if (row.has_active_flow) score += 15;
    if (row.has_approved_template) score += 15;
    if (row.has_sent_broadcast) score += 15;
    if (Number(row.active_conversations_7d) > 5) score += 10;
    if (Number(row.messages_sent_7d) > 50) score += 15;
    if (row.payment_ok) score += 10;

    const tier = computeTier(score);

    await pool.query(
      `INSERT INTO workspace_health_scores (
         workspace_id, score, tier,
         ai_enabled, has_active_flow, has_approved_template, has_sent_broadcast,
         active_conversations_7d, messages_sent_7d, payment_ok, calculated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (workspace_id) DO UPDATE SET
         score = EXCLUDED.score,
         tier = EXCLUDED.tier,
         ai_enabled = EXCLUDED.ai_enabled,
         has_active_flow = EXCLUDED.has_active_flow,
         has_approved_template = EXCLUDED.has_approved_template,
         has_sent_broadcast = EXCLUDED.has_sent_broadcast,
         active_conversations_7d = EXCLUDED.active_conversations_7d,
         messages_sent_7d = EXCLUDED.messages_sent_7d,
         payment_ok = EXCLUDED.payment_ok,
         calculated_at = NOW()`,
      [
        row.workspace_id, score, tier,
        row.ai_active, row.has_active_flow, row.has_approved_template, row.has_sent_broadcast,
        Number(row.active_conversations_7d), Number(row.messages_sent_7d), row.payment_ok,
      ]
    );
  }
}

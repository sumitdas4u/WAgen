import { firstRow } from "../db/sql-helpers.js";
import { pool } from "../db/pool.js";
import { estimateInrCost } from "./usage-cost-service.js";
import { getManagedQueues } from "./queue-service.js";
import { createPasswordResetToken } from "./user-service.js";
import { sendTransactionalEmail } from "./email-service.js";

export interface AdminOverview {
  totalUsers: number;
  activeAgents: number;
  totalConversations: number;
  totalMessages: number;
  totalChunks: number;
  totalTokens: number;
  totalCostInr: number;
}

export interface AdminUserUsage {
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  plan: string;
  aiActive: boolean;
  conversations: number;
  messages: number;
  chunks: number;
  totalTokens: number;
  costInr: number;
  createdAt: string;
}

function toCount(value: string | null | undefined): number {
  return Number(value ?? 0);
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const [usersResult, conversationsResult, messagesResult, chunksResult, usageByModelResult] = await Promise.all([
    pool.query<{ total_users: string; active_agents: string }>(
      `SELECT COUNT(*)::text AS total_users,
              COUNT(*) FILTER (WHERE ai_active = true)::text AS active_agents
       FROM users`
    ),
    pool.query<{ total_conversations: string }>(
      `SELECT COUNT(*)::text AS total_conversations FROM conversations`
    ),
    pool.query<{ total_messages: string }>(
      `SELECT COUNT(*)::text AS total_messages FROM conversation_messages`
    ),
    pool.query<{ total_chunks: string }>(
      `SELECT COUNT(*)::text AS total_chunks FROM knowledge_base`
    ),
    pool.query<{ ai_model: string | null; prompt_tokens: string; completion_tokens: string; total_tokens: string }>(
      `SELECT
         ai_model,
         COALESCE(SUM(COALESCE(prompt_tokens, 0)), 0)::text AS prompt_tokens,
         COALESCE(SUM(COALESCE(completion_tokens, 0)), 0)::text AS completion_tokens,
         COALESCE(
           SUM(COALESCE(total_tokens, COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0))),
           0
         )::text AS total_tokens
       FROM conversation_messages
       WHERE direction = 'outbound'
       GROUP BY ai_model`
    )
  ]);

  const usageTotals = usageByModelResult.rows.reduce(
    (acc, row) => {
      const promptTokens = Number(row.prompt_tokens ?? 0);
      const completionTokens = Number(row.completion_tokens ?? 0);
      const totalTokens = Number(row.total_tokens ?? 0);
      acc.totalTokens += totalTokens;
      acc.totalCostInr += estimateInrCost(row.ai_model, promptTokens, completionTokens);
      return acc;
    },
    { totalTokens: 0, totalCostInr: 0 }
  );

  return {
    totalUsers: toCount(firstRow(usersResult)?.total_users),
    activeAgents: toCount(firstRow(usersResult)?.active_agents),
    totalConversations: toCount(firstRow(conversationsResult)?.total_conversations),
    totalMessages: toCount(firstRow(messagesResult)?.total_messages),
    totalChunks: toCount(firstRow(chunksResult)?.total_chunks),
    totalTokens: usageTotals.totalTokens,
    totalCostInr: usageTotals.totalCostInr
  };
}

export async function listAdminUserUsage(limit = 200): Promise<AdminUserUsage[]> {
  const clampedLimit = Math.max(1, Math.min(500, limit));
  const usersResult = await pool.query<{
    user_id: string;
    name: string;
    email: string;
    phone: string | null;
    plan: string;
    ai_active: boolean;
    conversations: string;
    messages: string;
    chunks: string;
    created_at: string;
  }>(
    `SELECT
       u.id AS user_id,
       u.name,
       u.email,
       u.phone_number AS phone,
       u.subscription_plan AS plan,
       u.ai_active,
       COALESCE(c.conversations, 0)::text AS conversations,
       COALESCE(m.messages, 0)::text AS messages,
       COALESCE(k.chunks, 0)::text AS chunks,
       u.created_at
     FROM users u
     LEFT JOIN (
       SELECT user_id, COUNT(*) AS conversations
       FROM conversations
       GROUP BY user_id
     ) c ON c.user_id = u.id
     LEFT JOIN (
       SELECT c.user_id, COUNT(*) AS messages
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       GROUP BY c.user_id
     ) m ON m.user_id = u.id
     LEFT JOIN (
       SELECT user_id, COUNT(*) AS chunks
       FROM knowledge_base
       GROUP BY user_id
     ) k ON k.user_id = u.id
     ORDER BY u.created_at DESC
     LIMIT $1`,
    [clampedLimit]
  );

  const userIds = usersResult.rows.map((row) => row.user_id);
  const usageByUser = new Map<string, { totalTokens: number; costInr: number }>();

  if (userIds.length > 0) {
    const usageResult = await pool.query<{
      user_id: string;
      ai_model: string | null;
      prompt_tokens: string;
      completion_tokens: string;
      total_tokens: string;
    }>(
      `SELECT
         c.user_id::text AS user_id,
         m.ai_model,
         COALESCE(SUM(COALESCE(m.prompt_tokens, 0)), 0)::text AS prompt_tokens,
         COALESCE(SUM(COALESCE(m.completion_tokens, 0)), 0)::text AS completion_tokens,
         COALESCE(
           SUM(COALESCE(m.total_tokens, COALESCE(m.prompt_tokens, 0) + COALESCE(m.completion_tokens, 0))),
           0
         )::text AS total_tokens
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.direction = 'outbound'
         AND c.user_id::text = ANY($1::text[])
       GROUP BY c.user_id, m.ai_model`,
      [userIds]
    );

    for (const row of usageResult.rows) {
      const promptTokens = Number(row.prompt_tokens ?? 0);
      const completionTokens = Number(row.completion_tokens ?? 0);
      const totalTokens = Number(row.total_tokens ?? 0);
      const userUsage = usageByUser.get(row.user_id) ?? { totalTokens: 0, costInr: 0 };
      userUsage.totalTokens += totalTokens;
      userUsage.costInr += estimateInrCost(row.ai_model, promptTokens, completionTokens);
      usageByUser.set(row.user_id, userUsage);
    }
  }

  return usersResult.rows.map((row) => {
    const usage = usageByUser.get(row.user_id) ?? { totalTokens: 0, costInr: 0 };
    return {
      userId: row.user_id,
      name: row.name,
      email: row.email,
      phone: row.phone ?? null,
      plan: row.plan,
      aiActive: row.ai_active,
      conversations: Number(row.conversations),
      messages: Number(row.messages),
      chunks: Number(row.chunks),
      totalTokens: usage.totalTokens,
      costInr: usage.costInr,
      createdAt: row.created_at,
    };
  });
}

// ── QR Sessions ───────────────────────────────────────────────────────────────

export interface AdminQrSession {
  userId: string;
  userEmail: string;
  userName: string;
  status: string;
  phoneNumber: string | null;
  enabled: boolean;
  lastConnectedAt: string | null;
  updatedAt: string;
}

export async function listAdminQrSessions(): Promise<AdminQrSession[]> {
  const result = await pool.query<{
    user_id: string;
    user_email: string;
    user_name: string;
    status: string;
    phone_number: string | null;
    enabled: boolean;
    last_connected_at: string | null;
    updated_at: string;
  }>(`
    SELECT
      s.user_id,
      u.email AS user_email,
      u.name AS user_name,
      s.status,
      s.phone_number,
      s.enabled,
      s.last_connected_at,
      s.updated_at
    FROM whatsapp_sessions s
    JOIN users u ON u.id = s.user_id
    ORDER BY s.updated_at DESC
    LIMIT 500
  `);
  return result.rows.map((r) => ({
    userId: r.user_id,
    userEmail: r.user_email,
    userName: r.user_name,
    status: r.status,
    phoneNumber: r.phone_number,
    enabled: r.enabled,
    lastConnectedAt: r.last_connected_at,
    updatedAt: r.updated_at,
  }));
}

// ── WABA Connections ──────────────────────────────────────────────────────────

export interface AdminWabaConnection {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  wabaId: string | null;
  displayPhoneNumber: string | null;
  linkedNumber: string | null;
  billingStatus: string | null;
  status: string;
  enabled: boolean;
  tokenExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listAdminWabaConnections(): Promise<AdminWabaConnection[]> {
  const result = await pool.query<{
    id: string;
    user_id: string;
    user_email: string;
    user_name: string;
    waba_id: string | null;
    display_phone_number: string | null;
    linked_number: string | null;
    billing_status: string | null;
    status: string;
    enabled: boolean;
    token_expires_at: string | null;
    created_at: string;
    updated_at: string;
  }>(`
    SELECT
      c.id,
      c.user_id,
      u.email AS user_email,
      u.name AS user_name,
      c.waba_id,
      c.display_phone_number,
      c.linked_number,
      c.billing_status,
      c.status,
      c.enabled,
      c.token_expires_at,
      c.created_at,
      c.updated_at
    FROM whatsapp_business_connections c
    JOIN users u ON u.id = c.user_id
    ORDER BY c.created_at DESC
    LIMIT 500
  `);
  return result.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    userEmail: r.user_email,
    userName: r.user_name,
    wabaId: r.waba_id,
    displayPhoneNumber: r.display_phone_number,
    linkedNumber: r.linked_number,
    billingStatus: r.billing_status,
    status: r.status,
    enabled: r.enabled,
    tokenExpiresAt: r.token_expires_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

// ── Broadcasts ────────────────────────────────────────────────────────────────

export interface AdminBroadcast {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  name: string;
  status: string;
  totalCount: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export async function listAdminBroadcasts(options: { limit?: number; status?: string } = {}): Promise<AdminBroadcast[]> {
  const limit = Math.min(options.limit ?? 200, 500);
  const params: (string | number)[] = [limit];
  let whereClause = "";
  if (options.status) {
    params.push(options.status);
    whereClause = `WHERE c.status = $${params.length}`;
  }
  const result = await pool.query<{
    id: string;
    user_id: string;
    user_email: string;
    user_name: string;
    name: string;
    status: string;
    total_count: number;
    sent_count: number;
    delivered_count: number;
    read_count: number;
    failed_count: number;
    scheduled_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
  }>(`
    SELECT
      c.id, c.user_id,
      u.email AS user_email, u.name AS user_name,
      c.name, c.status,
      c.total_count, c.sent_count, c.delivered_count, c.read_count, c.failed_count,
      c.scheduled_at, c.started_at, c.completed_at, c.created_at
    FROM campaigns c
    JOIN users u ON u.id = c.user_id
    ${whereClause}
    ORDER BY c.created_at DESC
    LIMIT $1
  `, params);
  return result.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    userEmail: r.user_email,
    userName: r.user_name,
    name: r.name,
    status: r.status,
    totalCount: r.total_count,
    sentCount: r.sent_count,
    deliveredCount: r.delivered_count,
    readCount: r.read_count,
    failedCount: r.failed_count,
    scheduledAt: r.scheduled_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    createdAt: r.created_at,
  }));
}

export async function cancelAdminBroadcast(campaignId: string): Promise<void> {
  await pool.query(
    `UPDATE campaigns SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status IN ('scheduled', 'running', 'paused')`,
    [campaignId]
  );
}

// ── Templates ─────────────────────────────────────────────────────────────────

export interface AdminTemplate {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  name: string;
  category: string;
  language: string;
  status: string;
  qualityScore: string | null;
  metaRejectionReason: string | null;
  createdAt: string;
}

export async function listAdminTemplates(options: { status?: string; limit?: number } = {}): Promise<AdminTemplate[]> {
  const limit = Math.min(options.limit ?? 200, 500);
  const params: (string | number)[] = [limit];
  let whereClause = "";
  if (options.status) {
    params.push(options.status);
    whereClause = `WHERE t.status = $${params.length}`;
  }
  const result = await pool.query<{
    id: string;
    user_id: string;
    user_email: string;
    user_name: string;
    name: string;
    category: string;
    language: string;
    status: string;
    quality_score: string | null;
    meta_rejection_reason: string | null;
    created_at: string;
  }>(`
    SELECT
      t.id, t.user_id,
      u.email AS user_email, u.name AS user_name,
      t.name, t.category, t.language, t.status,
      t.quality_score, t.meta_rejection_reason, t.created_at
    FROM message_templates t
    JOIN users u ON u.id = t.user_id
    ${whereClause}
    ORDER BY t.created_at DESC
    LIMIT $1
  `, params);
  return result.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    userEmail: r.user_email,
    userName: r.user_name,
    name: r.name,
    category: r.category,
    language: r.language,
    status: r.status,
    qualityScore: r.quality_score,
    metaRejectionReason: r.meta_rejection_reason,
    createdAt: r.created_at,
  }));
}

// ── AI Logs ───────────────────────────────────────────────────────────────────

export interface AdminAiLogEntry {
  id: string;
  userId: string;
  userEmail: string;
  workspaceId: string | null;
  actionType: string;
  module: string | null;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostInr: number;
  creditsDeducted: number;
  status: string;
  createdAt: string;
}

export async function listAdminAiLogs(options: { limit?: number; workspaceId?: string; model?: string } = {}): Promise<AdminAiLogEntry[]> {
  const limit = Math.min(options.limit ?? 100, 500);
  const conditions: string[] = ["1=1"];
  const params: (string | number)[] = [limit];
  if (options.workspaceId) {
    params.push(options.workspaceId);
    conditions.push(`l.workspace_id = $${params.length}`);
  }
  if (options.model) {
    params.push(options.model);
    conditions.push(`l.model = $${params.length}`);
  }
  const result = await pool.query<{
    id: string;
    user_id: string;
    user_email: string;
    workspace_id: string | null;
    action_type: string;
    module: string | null;
    model: string | null;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    estimated_cost_inr: string;
    credits_deducted: number;
    status: string;
    created_at: string;
  }>(`
    SELECT
      l.id, l.user_id,
      u.email AS user_email,
      l.workspace_id,
      l.action_type, l.module, l.model,
      COALESCE(l.prompt_tokens, 0) AS prompt_tokens,
      COALESCE(l.completion_tokens, 0) AS completion_tokens,
      COALESCE(l.total_tokens, 0) AS total_tokens,
      COALESCE(l.estimated_cost_inr, 0) AS estimated_cost_inr,
      COALESCE(l.credits_deducted, 0) AS credits_deducted,
      l.status,
      l.created_at
    FROM ai_token_ledger l
    JOIN users u ON u.id = l.user_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY l.created_at DESC
    LIMIT $1
  `, params);
  return result.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    userEmail: r.user_email,
    workspaceId: r.workspace_id,
    actionType: r.action_type,
    module: r.module,
    model: r.model,
    promptTokens: r.prompt_tokens,
    completionTokens: r.completion_tokens,
    totalTokens: r.total_tokens,
    estimatedCostInr: Number(r.estimated_cost_inr),
    creditsDeducted: r.credits_deducted,
    status: r.status,
    createdAt: r.created_at,
  }));
}

// ── Audit Logs ────────────────────────────────────────────────────────────────

export interface AdminAuditLogEntry {
  id: string;
  adminEmail: string | null;
  action: string;
  workspaceId: string | null;
  targetUserId: string | null;
  ipAddress: string | null;
  detailsJson: Record<string, unknown>;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
  createdAt: string;
}

export async function listAdminAuditLogs(options: { limit?: number; action?: string } = {}): Promise<AdminAuditLogEntry[]> {
  const limit = Math.min(options.limit ?? 100, 500);
  const params: (string | number)[] = [limit];
  let whereClause = "";
  if (options.action) {
    params.push(options.action);
    whereClause = `WHERE action ILIKE $${params.length}`;
  }
  const result = await pool.query<{
    id: string;
    admin_email: string | null;
    action: string;
    workspace_id: string | null;
    target_user_id: string | null;
    ip_address: string | null;
    details_json: Record<string, unknown>;
    before_json: Record<string, unknown> | null;
    after_json: Record<string, unknown> | null;
    created_at: string;
  }>(`
    SELECT
      id, admin_email, action, workspace_id, target_user_id,
      ip_address, details_json, before_json, after_json, created_at
    FROM admin_audit_logs
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $1
  `, params);
  return result.rows.map((r) => ({
    id: r.id,
    adminEmail: r.admin_email,
    action: r.action,
    workspaceId: r.workspace_id,
    targetUserId: r.target_user_id,
    ipAddress: r.ip_address,
    detailsJson: r.details_json ?? {},
    beforeJson: r.before_json ?? null,
    afterJson: r.after_json ?? null,
    createdAt: r.created_at,
  }));
}

export async function writeAdminAuditLog(entry: {
  adminEmail?: string;
  action: string;
  workspaceId?: string;
  targetUserId?: string;
  ipAddress?: string;
  details?: Record<string, unknown>;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}): Promise<void> {
  await pool.query(
    `INSERT INTO admin_audit_logs (admin_email, action, workspace_id, target_user_id, ip_address, details_json, before_json, after_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.adminEmail ?? null,
      entry.action,
      entry.workspaceId ?? null,
      entry.targetUserId ?? null,
      entry.ipAddress ?? null,
      JSON.stringify(entry.details ?? {}),
      entry.before ? JSON.stringify(entry.before) : null,
      entry.after ? JSON.stringify(entry.after) : null,
    ]
  );
}

// ── System Health ─────────────────────────────────────────────────────────────

export interface WorkerHeartbeat {
  workerName: string;
  lastPingAt: string;
  status: "ok" | "stale" | "missing";
  staleSecs: number;
}

export interface SystemHealthStatus {
  postgres: { status: "ok" | "down"; latencyMs: number };
  redis: { status: "ok" | "down" | "unavailable" };
  workers: WorkerHeartbeat[];
  checkedAt: string;
}

export async function getSystemHealth(): Promise<SystemHealthStatus> {
  const pgStart = Date.now();
  let pgStatus: "ok" | "down" = "down";
  let pgLatency = 0;
  try {
    await pool.query("SELECT 1");
    pgLatency = Date.now() - pgStart;
    pgStatus = "ok";
  } catch { /* intentionally ignored */ }

  let redisStatus: "ok" | "down" | "unavailable" = "unavailable";
  try {
    const queues = getManagedQueues();
    if (queues.length > 0) {
      redisStatus = "ok";
    }
  } catch { /* intentionally ignored */ }

  let workers: WorkerHeartbeat[] = [];
  try {
    const result = await pool.query<{ worker_name: string; last_ping_at: string }>(
      `SELECT worker_name, last_ping_at FROM worker_heartbeats ORDER BY worker_name`
    );
    const now = Date.now();
    workers = result.rows.map((r) => {
      const staleSecs = Math.floor((now - new Date(r.last_ping_at).getTime()) / 1000);
      return {
        workerName: r.worker_name,
        lastPingAt: r.last_ping_at,
        status: staleSecs <= 90 ? "ok" : "stale",
        staleSecs,
      };
    });
  } catch { /* intentionally ignored */ }

  return {
    postgres: { status: pgStatus, latencyMs: pgLatency },
    redis: { status: redisStatus },
    workers,
    checkedAt: new Date().toISOString(),
  };
}

// ── Workspace Health Scores ───────────────────────────────────────────────────

export interface WorkspaceHealthSummary {
  workspaceId: string;
  workspaceName: string;
  ownerEmail: string;
  score: number;
  tier: string;
  aiEnabled: boolean;
  hasActiveBroadcast: boolean;
  calculatedAt: string;
}

export async function listWorkspaceHealthScores(limit = 200): Promise<WorkspaceHealthSummary[]> {
  const result = await pool.query<{
    workspace_id: string;
    workspace_name: string;
    owner_email: string;
    score: number;
    tier: string;
    ai_enabled: boolean;
    has_sent_broadcast: boolean;
    calculated_at: string;
  }>(`
    SELECT
      h.workspace_id, w.name AS workspace_name, u.email AS owner_email,
      h.score, h.tier, h.ai_enabled, h.has_sent_broadcast, h.calculated_at
    FROM workspace_health_scores h
    JOIN workspaces w ON w.id = h.workspace_id
    JOIN users u ON u.id = w.owner_id
    ORDER BY h.score ASC
    LIMIT $1
  `, [limit]);
  return result.rows.map((r) => ({
    workspaceId: r.workspace_id,
    workspaceName: r.workspace_name,
    ownerEmail: r.owner_email,
    score: r.score,
    tier: r.tier,
    aiEnabled: r.ai_enabled,
    hasActiveBroadcast: r.has_sent_broadcast,
    calculatedAt: r.calculated_at,
  }));
}

// ── Abuse Flags ───────────────────────────────────────────────────────────────

export interface AdminAbuseFlag {
  id: string;
  workspaceId: string;
  workspaceName: string;
  ownerEmail: string;
  flagType: string;
  severity: string;
  autoActioned: boolean;
  resolvedAt: string | null;
  createdAt: string;
}

export async function listAdminAbuseFlags(options: { unresolved?: boolean } = {}): Promise<AdminAbuseFlag[]> {
  const whereClause = options.unresolved ? "WHERE f.resolved_at IS NULL" : "";
  const result = await pool.query<{
    id: string;
    workspace_id: string;
    workspace_name: string;
    owner_email: string;
    flag_type: string;
    severity: string;
    auto_actioned: boolean;
    resolved_at: string | null;
    created_at: string;
  }>(`
    SELECT
      f.id, f.workspace_id, w.name AS workspace_name, u.email AS owner_email,
      f.flag_type, f.severity, f.auto_actioned, f.resolved_at, f.created_at
    FROM workspace_abuse_flags f
    JOIN workspaces w ON w.id = f.workspace_id
    JOIN users u ON u.id = w.owner_id
    ${whereClause}
    ORDER BY f.created_at DESC
    LIMIT 300
  `);
  return result.rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    workspaceName: r.workspace_name,
    ownerEmail: r.owner_email,
    flagType: r.flag_type,
    severity: r.severity,
    autoActioned: r.auto_actioned,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
  }));
}

export async function resolveAdminAbuseFlag(flagId: string): Promise<void> {
  await pool.query(`UPDATE workspace_abuse_flags SET resolved_at = NOW() WHERE id = $1`, [flagId]);
}

// ── Fraud Signals ─────────────────────────────────────────────────────────────

export interface AdminFraudSignal {
  id: string;
  userId: string | null;
  userEmail: string;
  workspaceId: string | null;
  workspaceName: string;
  signalType: string;
  severity: string;
  autoActioned: boolean;
  resolvedAt: string | null;
  createdAt: string;
}

export async function listAdminFraudSignals(options: { unresolved?: boolean } = {}): Promise<AdminFraudSignal[]> {
  const whereClause = options.unresolved ? "WHERE s.resolved_at IS NULL" : "";
  const result = await pool.query<{
    id: string;
    user_id: string | null;
    user_email: string;
    workspace_id: string | null;
    workspace_name: string;
    signal_type: string;
    severity: string;
    auto_actioned: boolean;
    resolved_at: string | null;
    created_at: string;
  }>(`
    SELECT
      s.id, s.user_id,
      COALESCE(u.email, 'unknown') AS user_email,
      s.workspace_id,
      COALESCE(w.name, 'unknown') AS workspace_name,
      s.signal_type, s.severity, s.auto_actioned, s.resolved_at, s.created_at
    FROM fraud_signals s
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN workspaces w ON w.id = s.workspace_id
    ${whereClause}
    ORDER BY s.created_at DESC
    LIMIT 300
  `);
  return result.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    userEmail: r.user_email,
    workspaceId: r.workspace_id,
    workspaceName: r.workspace_name,
    signalType: r.signal_type,
    severity: r.severity,
    autoActioned: r.auto_actioned,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
  }));
}

export async function resolveAdminFraudSignal(signalId: string): Promise<void> {
  await pool.query(`UPDATE fraud_signals SET resolved_at = NOW() WHERE id = $1`, [signalId]);
}

// ── Queue Stats ───────────────────────────────────────────────────────────────

export interface AdminQueueStat {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export async function getAdminQueueStats(): Promise<AdminQueueStat[]> {
  const queues = getManagedQueues();
  if (queues.length === 0) return [];
  const statsArr = await Promise.all(
    queues.map(async (q) => {
      const counts = await q.getJobCounts("waiting", "active", "completed", "failed", "delayed");
      return {
        name: q.name,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
      };
    })
  );
  return statsArr;
}

export async function retryAdminQueueFailed(queueName: string): Promise<number> {
  const queues = getManagedQueues();
  const q = queues.find((x) => x.name === queueName);
  if (!q) return 0;
  const failedJobs = await q.getFailed(0, 99);
  await Promise.all(failedJobs.map((job) => job.retry()));
  return failedJobs.length;
}

export async function pauseAdminQueue(queueName: string, pause: boolean): Promise<void> {
  const queues = getManagedQueues();
  const q = queues.find((x) => x.name === queueName);
  if (!q) return;
  if (pause) {
    await q.pause();
  } else {
    await q.resume();
  }
}

// ── Kill Switches ─────────────────────────────────────────────────────────────

export interface AdminKillSwitch {
  key: string;
  enabled: boolean;
  enabledBy: string | null;
  enabledAt: string | null;
  reason: string | null;
}

export async function listAdminKillSwitches(): Promise<AdminKillSwitch[]> {
  const result = await pool.query<{
    key: string;
    enabled: boolean;
    enabled_by: string | null;
    enabled_at: string | null;
    reason: string | null;
  }>(`SELECT key, enabled, enabled_by, enabled_at, reason FROM admin_kill_switches ORDER BY key`);
  return result.rows.map((r) => ({
    key: r.key,
    enabled: r.enabled,
    enabledBy: r.enabled_by,
    enabledAt: r.enabled_at,
    reason: r.reason,
  }));
}

export async function setAdminKillSwitch(key: string, enabled: boolean, adminEmail: string, reason?: string): Promise<void> {
  await pool.query(
    `UPDATE admin_kill_switches
     SET enabled = $1, enabled_by = $2, enabled_at = CASE WHEN $1 THEN NOW() ELSE NULL END, reason = $3
     WHERE key = $4`,
    [enabled, adminEmail, reason ?? null, key]
  );
}

// ── Prompt Management ─────────────────────────────────────────────────────────

export interface AdminPromptTemplate {
  id: string;
  key: string;
  name: string;
  content: string;
  version: number;
  isActive: boolean;
  createdByAdmin: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listAdminPrompts(): Promise<AdminPromptTemplate[]> {
  const result = await pool.query<{
    id: string; key: string; name: string; content: string;
    version: number; is_active: boolean; created_by_admin: string | null;
    created_at: string; updated_at: string;
  }>(`SELECT id, key, name, content, version, is_active, created_by_admin, created_at, updated_at FROM admin_prompt_templates ORDER BY name`);
  return result.rows.map((r) => ({
    id: r.id, key: r.key, name: r.name, content: r.content,
    version: r.version, isActive: r.is_active, createdByAdmin: r.created_by_admin,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}

export async function updateAdminPrompt(key: string, content: string, adminEmail?: string): Promise<AdminPromptTemplate> {
  const result = await pool.query<{
    id: string; key: string; name: string; content: string;
    version: number; is_active: boolean; created_by_admin: string | null;
    created_at: string; updated_at: string;
  }>(`
    UPDATE admin_prompt_templates
    SET content = $1, version = version + 1, updated_at = NOW()
    WHERE key = $2
    RETURNING *
  `, [content, key]);
  if (!result.rows[0]) throw new Error(`Prompt "${key}" not found`);
  const r = result.rows[0];
  // Archive the version
  await pool.query(
    `INSERT INTO admin_prompt_versions (prompt_key, content, version, changed_by_admin) VALUES ($1, $2, $3, $4)`,
    [key, content, r.version, adminEmail ?? null]
  );
  return {
    id: r.id, key: r.key, name: r.name, content: r.content,
    version: r.version, isActive: r.is_active, createdByAdmin: r.created_by_admin,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// ── Feature Flags ─────────────────────────────────────────────────────────────

export interface AdminFeatureFlag {
  id: string;
  key: string;
  name: string;
  description: string | null;
  enabledGlobally: boolean;
  rolloutPercent: number;
  createdAt: string;
  updatedAt: string;
}

export async function listAdminFeatureFlags(): Promise<AdminFeatureFlag[]> {
  const result = await pool.query<{
    id: string;
    key: string;
    name: string;
    description: string | null;
    enabled_globally: boolean;
    rollout_percent: number;
    created_at: string;
    updated_at: string;
  }>(`SELECT id, key, name, description, enabled_globally, rollout_percent, created_at, updated_at FROM feature_flags ORDER BY name`);
  return result.rows.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    enabledGlobally: r.enabled_globally,
    rolloutPercent: r.rollout_percent,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

// ── Webhook Delivery Logs ─────────────────────────────────────────────────────

export interface AdminWebhookLogEntry {
  id: string;
  endpointId: string;
  endpointUrl: string;
  userId: string;
  userEmail: string;
  event: string;
  statusCode: number | null;
  attempt: number;
  success: boolean;
  errorMessage: string | null;
  deliveredAt: string;
}

export async function listAdminWebhookLogs(options: { limit?: number; successOnly?: boolean; failureOnly?: boolean } = {}): Promise<AdminWebhookLogEntry[]> {
  const limit = Math.min(options.limit ?? 200, 500);
  const conditions: string[] = [];
  if (options.failureOnly) conditions.push("l.success = FALSE");
  if (options.successOnly) conditions.push("l.success = TRUE");
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query<{
    id: string;
    endpoint_id: string;
    endpoint_url: string;
    user_id: string;
    user_email: string;
    event: string;
    status_code: number | null;
    attempt: number;
    success: boolean;
    error_message: string | null;
    delivered_at: string;
  }>(`
    SELECT
      l.id, l.endpoint_id,
      e.url AS endpoint_url,
      e.user_id,
      u.email AS user_email,
      l.event, l.status_code, l.attempt, l.success,
      l.error_message, l.delivered_at
    FROM webhook_delivery_logs l
    JOIN webhook_endpoints e ON e.id = l.endpoint_id
    JOIN users u ON u.id = e.user_id
    ${whereClause}
    ORDER BY l.delivered_at DESC
    LIMIT $1
  `, [limit]);
  return result.rows.map((r) => ({
    id: r.id,
    endpointId: r.endpoint_id,
    endpointUrl: r.endpoint_url,
    userId: r.user_id,
    userEmail: r.user_email,
    event: r.event,
    statusCode: r.status_code,
    attempt: r.attempt,
    success: r.success,
    errorMessage: r.error_message,
    deliveredAt: r.delivered_at,
  }));
}

// ── Broadcast Reputation ──────────────────────────────────────────────────────

export interface BroadcastReputationEntry {
  workspaceId: string;
  workspaceName: string;
  ownerEmail: string;
  totalSent: number;
  totalDelivered: number;
  totalRead: number;
  totalFailed: number;
  deliveryRate: number | null;
  readRate: number | null;
  failureRate: number | null;
  templateRejectionRate: number | null;
  reputationScore: number;
  riskLevel: string;
  lastCalculatedAt: string | null;
}

export async function listBroadcastReputation(): Promise<BroadcastReputationEntry[]> {
  const result = await pool.query<{
    workspace_id: string;
    workspace_name: string;
    owner_email: string;
    total_sent: number;
    total_delivered: number;
    total_read: number;
    total_failed: number;
    delivery_rate: string | null;
    read_rate: string | null;
    failure_rate: string | null;
    template_rejection_rate: string | null;
    reputation_score: number;
    risk_level: string;
    last_calculated_at: string | null;
  }>(`
    SELECT
      r.workspace_id, w.name AS workspace_name, u.email AS owner_email,
      r.total_sent, r.total_delivered, r.total_read, r.total_failed,
      r.delivery_rate, r.read_rate, r.failure_rate, r.template_rejection_rate,
      r.reputation_score, r.risk_level, r.last_calculated_at
    FROM workspace_broadcast_reputation r
    JOIN workspaces w ON w.id = r.workspace_id
    JOIN users u ON u.id = w.owner_id
    ORDER BY r.reputation_score ASC
    LIMIT 300
  `);
  return result.rows.map((r) => ({
    workspaceId: r.workspace_id,
    workspaceName: r.workspace_name,
    ownerEmail: r.owner_email,
    totalSent: r.total_sent,
    totalDelivered: r.total_delivered,
    totalRead: r.total_read,
    totalFailed: r.total_failed,
    deliveryRate: r.delivery_rate !== null ? Number(r.delivery_rate) : null,
    readRate: r.read_rate !== null ? Number(r.read_rate) : null,
    failureRate: r.failure_rate !== null ? Number(r.failure_rate) : null,
    templateRejectionRate: r.template_rejection_rate !== null ? Number(r.template_rejection_rate) : null,
    reputationScore: r.reputation_score,
    riskLevel: r.risk_level,
    lastCalculatedAt: r.last_calculated_at,
  }));
}

// ── Meta Compliance Events ────────────────────────────────────────────────────

export interface MetaComplianceEvent {
  id: string;
  workspaceId: string;
  workspaceName: string;
  ownerEmail: string;
  connectionId: string | null;
  eventType: string;
  severity: string;
  detailJson: Record<string, unknown>;
  createdAt: string;
}

export async function writeMetaComplianceEvent(opts: {
  workspaceId: string;
  connectionId?: string | null;
  eventType: string;
  severity?: "warn" | "critical";
  detailJson?: Record<string, unknown>;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO meta_compliance_events (workspace_id, connection_id, event_type, severity, detail_json)
       VALUES ($1, $2, $3, $4, $5)`,
      [opts.workspaceId, opts.connectionId ?? null, opts.eventType, opts.severity ?? "warn", opts.detailJson ?? {}]
    );
  } catch (e) {
    console.error("[MetaCompliance] failed to write event", e);
  }
}

export async function listMetaComplianceEvents(options: { limit?: number } = {}): Promise<MetaComplianceEvent[]> {
  const limit = Math.min(options.limit ?? 200, 500);
  const result = await pool.query<{
    id: string;
    workspace_id: string;
    workspace_name: string;
    owner_email: string;
    connection_id: string | null;
    event_type: string;
    severity: string;
    detail_json: Record<string, unknown>;
    created_at: string;
  }>(`
    SELECT
      e.id, e.workspace_id, w.name AS workspace_name, u.email AS owner_email,
      e.connection_id, e.event_type, e.severity, e.detail_json, e.created_at
    FROM meta_compliance_events e
    JOIN workspaces w ON w.id = e.workspace_id
    JOIN users u ON u.id = w.owner_id
    ORDER BY e.created_at DESC
    LIMIT $1
  `, [limit]);
  return result.rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    workspaceName: r.workspace_name,
    ownerEmail: r.owner_email,
    connectionId: r.connection_id,
    eventType: r.event_type,
    severity: r.severity,
    detailJson: r.detail_json,
    createdAt: r.created_at,
  }));
}

// ── AI Spend Limits ───────────────────────────────────────────────────────────

export interface WorkspaceSpendLimits {
  workspaceId: string;
  dailyCapInr: number | null;
  monthlyCapInr: number | null;
  actionOnBreach: string;
  notifyEmail: string | null;
  currentDaySpendInr: number;
  currentMonthSpendInr: number;
  breachedAt: string | null;
  updatedAt: string;
}

export async function getWorkspaceSpendLimits(workspaceId: string): Promise<WorkspaceSpendLimits | null> {
  const result = await pool.query<{
    workspace_id: string;
    daily_cap_inr: string | null;
    monthly_cap_inr: string | null;
    action_on_breach: string;
    notify_email: string | null;
    current_day_spend_inr: string;
    current_month_spend_inr: string;
    breached_at: string | null;
    updated_at: string;
  }>(`SELECT * FROM workspace_ai_spend_limits WHERE workspace_id = $1`, [workspaceId]);
  const r = result.rows[0];
  if (!r) return null;
  return {
    workspaceId: r.workspace_id,
    dailyCapInr: r.daily_cap_inr !== null ? Number(r.daily_cap_inr) : null,
    monthlyCapInr: r.monthly_cap_inr !== null ? Number(r.monthly_cap_inr) : null,
    actionOnBreach: r.action_on_breach,
    notifyEmail: r.notify_email,
    currentDaySpendInr: Number(r.current_day_spend_inr),
    currentMonthSpendInr: Number(r.current_month_spend_inr),
    breachedAt: r.breached_at,
    updatedAt: r.updated_at,
  };
}

export async function setWorkspaceSpendLimits(workspaceId: string, data: {
  dailyCapInr?: number | null;
  monthlyCapInr?: number | null;
  actionOnBreach?: string;
  notifyEmail?: string | null;
}): Promise<WorkspaceSpendLimits> {
  const result = await pool.query<{
    workspace_id: string;
    daily_cap_inr: string | null;
    monthly_cap_inr: string | null;
    action_on_breach: string;
    notify_email: string | null;
    current_day_spend_inr: string;
    current_month_spend_inr: string;
    breached_at: string | null;
    updated_at: string;
  }>(`
    INSERT INTO workspace_ai_spend_limits (workspace_id, daily_cap_inr, monthly_cap_inr, action_on_breach, notify_email)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (workspace_id) DO UPDATE SET
      daily_cap_inr = COALESCE(EXCLUDED.daily_cap_inr, workspace_ai_spend_limits.daily_cap_inr),
      monthly_cap_inr = COALESCE(EXCLUDED.monthly_cap_inr, workspace_ai_spend_limits.monthly_cap_inr),
      action_on_breach = COALESCE(EXCLUDED.action_on_breach, workspace_ai_spend_limits.action_on_breach),
      notify_email = COALESCE(EXCLUDED.notify_email, workspace_ai_spend_limits.notify_email),
      updated_at = NOW()
    RETURNING *
  `, [workspaceId, data.dailyCapInr ?? null, data.monthlyCapInr ?? null, data.actionOnBreach ?? 'pause_ai', data.notifyEmail ?? null]);
  const r = result.rows[0]!;
  return {
    workspaceId: r.workspace_id,
    dailyCapInr: r.daily_cap_inr !== null ? Number(r.daily_cap_inr) : null,
    monthlyCapInr: r.monthly_cap_inr !== null ? Number(r.monthly_cap_inr) : null,
    actionOnBreach: r.action_on_breach,
    notifyEmail: r.notify_email,
    currentDaySpendInr: Number(r.current_day_spend_inr),
    currentMonthSpendInr: Number(r.current_month_spend_inr),
    breachedAt: r.breached_at,
    updatedAt: r.updated_at,
  };
}

// ── Business Analytics ────────────────────────────────────────────────────────

export interface BusinessAnalytics {
  totalWorkspaces: number;
  activeSubscriptions: number;
  trialWorkspaces: number;
  mrrInr: number;
  newWorkspaces30d: number;
  churned30d: number;
  totalAiCostInr: number;
  totalBroadcastsSent: number;
  planDistribution: Record<string, number>;
  workspaceTrend: Array<{ date: string; count: number }>;
  revenueByPlan: Array<{ plan: string; count: number; mrrInr: number }>;
}

export async function getBusinessAnalytics(): Promise<BusinessAnalytics> {
  const [overviewResult, planDistResult, trendResult, revResult, broadcastResult, aiCostResult] = await Promise.all([
    pool.query<{
      total: string;
      active_subs: string;
      trial: string;
      new_30d: string;
      churned_30d: string;
    }>(`
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE subscription_plan NOT IN ('trial','free') AND status = 'active')::text AS active_subs,
        COUNT(*) FILTER (WHERE subscription_plan IN ('trial','free'))::text AS trial,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::text AS new_30d,
        COUNT(*) FILTER (WHERE status = 'suspended' AND updated_at >= NOW() - INTERVAL '30 days')::text AS churned_30d
      FROM workspaces
      WHERE status != 'deleted'
    `),
    pool.query<{ plan: string; count: string }>(`
      SELECT subscription_plan AS plan, COUNT(*)::text AS count
      FROM workspaces
      WHERE status != 'deleted'
      GROUP BY subscription_plan
      ORDER BY count DESC
    `),
    pool.query<{ day: string; count: string }>(`
      SELECT DATE_TRUNC('day', created_at)::date::text AS day, COUNT(*)::text AS count
      FROM workspaces
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY 1 ORDER BY 1
    `),
    pool.query<{ plan: string; count: string; total_price: string }>(`
      SELECT
        p.code AS plan,
        COUNT(DISTINCT s.id)::text AS count,
        COALESCE(SUM(p.price_monthly), 0)::text AS total_price
      FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
      WHERE s.status = 'active'
      GROUP BY p.code
    `),
    pool.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM campaigns WHERE status IN ('completed','running')`),
    pool.query<{ total_cost: string }>(`
      SELECT COALESCE(SUM(estimated_cost_inr), 0)::text AS total_cost
      FROM ai_token_ledger
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `),
  ]);

  const overview = overviewResult.rows[0]!;
  const planDist: Record<string, number> = {};
  for (const row of planDistResult.rows) planDist[row.plan] = Number(row.count);

  const revenueByPlan = revResult.rows.map((r) => ({
    plan: r.plan,
    count: Number(r.count),
    mrrInr: Number(r.total_price),
  }));
  const mrrInr = revenueByPlan.reduce((sum, r) => sum + r.mrrInr, 0);

  return {
    totalWorkspaces: Number(overview.total),
    activeSubscriptions: Number(overview.active_subs),
    trialWorkspaces: Number(overview.trial),
    mrrInr,
    newWorkspaces30d: Number(overview.new_30d),
    churned30d: Number(overview.churned_30d),
    totalAiCostInr: Number(aiCostResult.rows[0]?.total_cost ?? 0),
    totalBroadcastsSent: Number(broadcastResult.rows[0]?.total ?? 0),
    planDistribution: planDist,
    workspaceTrend: trendResult.rows.map((r) => ({ date: r.day, count: Number(r.count) })),
    revenueByPlan,
  };
}

// ── Admin Sessions ────────────────────────────────────────────────────────────

export async function writeAdminSession(adminEmail: string, ipAddress?: string, userAgent?: string): Promise<void> {
  await pool.query(
    `INSERT INTO admin_sessions (admin_email, ip_address, user_agent) VALUES ($1, $2, $3)`,
    [adminEmail, ipAddress ?? null, userAgent ?? null]
  );
}

export async function upsertAdminFeatureFlag(data: {
  key: string;
  name: string;
  description?: string;
  enabledGlobally?: boolean;
  rolloutPercent?: number;
}): Promise<AdminFeatureFlag> {
  const result = await pool.query<{
    id: string;
    key: string;
    name: string;
    description: string | null;
    enabled_globally: boolean;
    rollout_percent: number;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO feature_flags (key, name, description, enabled_globally, rollout_percent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (key) DO UPDATE SET
       name = EXCLUDED.name,
       description = COALESCE(EXCLUDED.description, feature_flags.description),
       enabled_globally = COALESCE(EXCLUDED.enabled_globally, feature_flags.enabled_globally),
       rollout_percent = COALESCE(EXCLUDED.rollout_percent, feature_flags.rollout_percent),
       updated_at = NOW()
     RETURNING *`,
    [data.key, data.name, data.description ?? null, data.enabledGlobally ?? false, data.rolloutPercent ?? 0]
  );
  const r = result.rows[0]!;
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    enabledGlobally: r.enabled_globally,
    rolloutPercent: r.rollout_percent,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── Workspace Detail ──────────────────────────────────────────────────────────

export interface AdminWorkspaceDetail {
  workspaceId: string;
  workspaceName: string;
  status: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string | null;
  planCode: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  nextBillingDate: string | null;
  totalCredits: number;
  usedCredits: number;
  remainingCredits: number;
  totalConversations: number;
  totalMessages: number;
  totalBroadcasts: number;
  totalKnowledgeChunks: number;
  aiActive: boolean;
  createdAt: string;
}

export async function getAdminWorkspaceDetail(workspaceId: string): Promise<AdminWorkspaceDetail | null> {
  const result = await pool.query<{
    workspace_id: string;
    workspace_name: string;
    status: string;
    owner_id: string;
    owner_name: string;
    owner_email: string;
    owner_phone: string | null;
    ai_active: boolean;
    plan_code: string | null;
    plan_name: string | null;
    subscription_status: string | null;
    next_billing_date: string | null;
    total_credits: string | null;
    used_credits: string | null;
    remaining_credits: string | null;
    total_conversations: string;
    total_messages: string;
    total_broadcasts: string;
    total_chunks: string;
    created_at: string;
  }>(`
    SELECT
      w.id AS workspace_id, w.name AS workspace_name, w.status, w.created_at,
      u.id AS owner_id, u.name AS owner_name, u.email AS owner_email,
      u.phone_number AS owner_phone, u.ai_active,
      p.code AS plan_code, p.name AS plan_name,
      s.status AS subscription_status, s.next_billing_date,
      cw.total_credits::text, cw.used_credits::text, cw.remaining_credits::text,
      COALESCE((SELECT COUNT(*) FROM conversations c WHERE c.user_id = u.id), 0)::text AS total_conversations,
      COALESCE((SELECT COUNT(*) FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.user_id = u.id), 0)::text AS total_messages,
      COALESCE((SELECT COUNT(*) FROM campaigns ca WHERE ca.user_id = u.id), 0)::text AS total_broadcasts,
      COALESCE((SELECT COUNT(*) FROM knowledge_base kb WHERE kb.user_id = u.id), 0)::text AS total_chunks
    FROM workspaces w
    JOIN users u ON u.id = w.owner_id
    LEFT JOIN plans p ON p.code = u.subscription_plan
    LEFT JOIN LATERAL (
      SELECT status, next_billing_date FROM subscriptions
      WHERE user_id = u.id AND status NOT IN ('cancelled', 'expired')
      ORDER BY created_at DESC LIMIT 1
    ) s ON TRUE
    LEFT JOIN credit_wallet cw ON cw.workspace_id = w.id
    WHERE w.id = $1
    LIMIT 1
  `, [workspaceId]);
  const r = result.rows[0];
  if (!r) return null;
  return {
    workspaceId: r.workspace_id,
    workspaceName: r.workspace_name,
    status: r.status,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    ownerEmail: r.owner_email,
    ownerPhone: r.owner_phone,
    aiActive: r.ai_active,
    planCode: r.plan_code,
    planName: r.plan_name,
    subscriptionStatus: r.subscription_status,
    nextBillingDate: r.next_billing_date,
    totalCredits: Number(r.total_credits ?? 0),
    usedCredits: Number(r.used_credits ?? 0),
    remainingCredits: Number(r.remaining_credits ?? 0),
    totalConversations: Number(r.total_conversations),
    totalMessages: Number(r.total_messages),
    totalBroadcasts: Number(r.total_broadcasts),
    totalKnowledgeChunks: Number(r.total_chunks),
    createdAt: r.created_at,
  };
}

// ── Credit Ledger ─────────────────────────────────────────────────────────────

export interface CreditLedgerEntry {
  id: string;
  type: string;
  credits: number;
  referenceId: string | null;
  reason: string | null;
  createdAt: string;
}

export async function getWorkspaceCreditLedger(workspaceId: string, limit = 100): Promise<CreditLedgerEntry[]> {
  const result = await pool.query<{
    id: string;
    type: string;
    credits: string;
    reference_id: string | null;
    reason: string | null;
    created_at: string;
  }>(`
    SELECT id, type, credits::text, reference_id, reason, created_at
    FROM credit_transactions
    WHERE workspace_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `, [workspaceId, Math.min(limit, 500)]);
  return result.rows.map((r) => ({
    id: r.id,
    type: r.type,
    credits: Number(r.credits),
    referenceId: r.reference_id,
    reason: r.reason,
    createdAt: r.created_at,
  }));
}

// ── Override Workspace Plan ───────────────────────────────────────────────────

export async function overrideWorkspacePlan(workspaceId: string, planCode: string, adminEmail?: string): Promise<void> {
  const workspaceResult = await pool.query<{ owner_id: string; plan: string | null }>(
    `SELECT w.owner_id, u.subscription_plan AS plan FROM workspaces w JOIN users u ON u.id = w.owner_id WHERE w.id = $1`,
    [workspaceId]
  );
  const ws = workspaceResult.rows[0];
  if (!ws) throw new Error("Workspace not found");
  const beforePlan = ws.plan;
  await pool.query(`UPDATE users SET subscription_plan = $1 WHERE id = $2`, [planCode, ws.owner_id]);
  await writeAdminAuditLog({
    adminEmail,
    action: "workspace.plan_override",
    workspaceId,
    before: { plan: beforePlan },
    after: { plan: planCode },
  });
}

// ── Admin Notes ───────────────────────────────────────────────────────────────

export interface AdminNote {
  id: string;
  workspaceId: string;
  adminEmail: string;
  content: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listWorkspaceNotes(workspaceId: string): Promise<AdminNote[]> {
  const result = await pool.query<{
    id: string;
    workspace_id: string;
    admin_email: string;
    content: string;
    is_pinned: boolean;
    created_at: string;
    updated_at: string;
  }>(`
    SELECT id, workspace_id, admin_email, content, is_pinned, created_at, updated_at
    FROM admin_workspace_notes
    WHERE workspace_id = $1
    ORDER BY is_pinned DESC, created_at DESC
  `, [workspaceId]);
  return result.rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    adminEmail: r.admin_email,
    content: r.content,
    isPinned: r.is_pinned,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function createWorkspaceNote(workspaceId: string, adminEmail: string, content: string): Promise<AdminNote> {
  const result = await pool.query<{
    id: string;
    workspace_id: string;
    admin_email: string;
    content: string;
    is_pinned: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO admin_workspace_notes (workspace_id, admin_email, content) VALUES ($1, $2, $3) RETURNING *`,
    [workspaceId, adminEmail, content]
  );
  const r = result.rows[0]!;
  return { id: r.id, workspaceId: r.workspace_id, adminEmail: r.admin_email, content: r.content, isPinned: r.is_pinned, createdAt: r.created_at, updatedAt: r.updated_at };
}

export async function updateWorkspaceNote(noteId: string, data: { content?: string; isPinned?: boolean }): Promise<AdminNote> {
  const result = await pool.query<{
    id: string; workspace_id: string; admin_email: string;
    content: string; is_pinned: boolean; created_at: string; updated_at: string;
  }>(
    `UPDATE admin_workspace_notes SET
      content = COALESCE($1, content),
      is_pinned = COALESCE($2, is_pinned),
      updated_at = NOW()
     WHERE id = $3 RETURNING *`,
    [data.content ?? null, data.isPinned ?? null, noteId]
  );
  const r = result.rows[0];
  if (!r) throw new Error("Note not found");
  return { id: r.id, workspaceId: r.workspace_id, adminEmail: r.admin_email, content: r.content, isPinned: r.is_pinned, createdAt: r.created_at, updatedAt: r.updated_at };
}

export async function deleteWorkspaceNote(noteId: string): Promise<void> {
  await pool.query(`DELETE FROM admin_workspace_notes WHERE id = $1`, [noteId]);
}

// ── User Detail ───────────────────────────────────────────────────────────────

export interface AdminUserDetail {
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  planCode: string | null;
  planName: string | null;
  aiActive: boolean;
  aiTokenBalance: number;
  subscriptionStatus: string | null;
  totalConversations: number;
  totalMessages: number;
  totalChunks: number;
  totalBroadcasts: number;
  totalTokens: number;
  totalCostInr: number;
  createdAt: string;
  workspaceId: string | null;
  workspaceName: string | null;
}

export async function getAdminUserDetail(userId: string): Promise<AdminUserDetail | null> {
  const result = await pool.query<{
    user_id: string;
    name: string;
    email: string;
    phone: string | null;
    ai_active: boolean;
    ai_token_balance: number;
    plan_code: string | null;
    plan_name: string | null;
    subscription_status: string | null;
    workspace_id: string | null;
    workspace_name: string | null;
    total_conversations: string;
    total_messages: string;
    total_chunks: string;
    total_broadcasts: string;
    created_at: string;
  }>(`
    SELECT
      u.id AS user_id, u.name, u.email, u.phone_number AS phone,
      u.ai_active, COALESCE(u.ai_token_balance, 0) AS ai_token_balance,
      p.code AS plan_code, p.name AS plan_name,
      s.status AS subscription_status,
      w.id AS workspace_id, w.name AS workspace_name,
      COALESCE((SELECT COUNT(*) FROM conversations c WHERE c.user_id = u.id), 0)::text AS total_conversations,
      COALESCE((SELECT COUNT(*) FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.user_id = u.id), 0)::text AS total_messages,
      COALESCE((SELECT COUNT(*) FROM knowledge_base kb WHERE kb.user_id = u.id), 0)::text AS total_chunks,
      COALESCE((SELECT COUNT(*) FROM campaigns ca WHERE ca.user_id = u.id), 0)::text AS total_broadcasts,
      u.created_at
    FROM users u
    LEFT JOIN plans p ON p.code = u.subscription_plan
    LEFT JOIN LATERAL (
      SELECT status FROM subscriptions
      WHERE user_id = u.id AND status NOT IN ('cancelled', 'expired')
      ORDER BY created_at DESC LIMIT 1
    ) s ON TRUE
    LEFT JOIN workspaces w ON w.owner_id = u.id
    WHERE u.id = $1
    LIMIT 1
  `, [userId]);
  const r = result.rows[0];
  if (!r) return null;

  const usageResult = await pool.query<{
    ai_model: string | null; prompt_tokens: string; completion_tokens: string;
  }>(`
    SELECT m.ai_model,
      COALESCE(SUM(COALESCE(m.prompt_tokens, 0)), 0)::text AS prompt_tokens,
      COALESCE(SUM(COALESCE(m.completion_tokens, 0)), 0)::text AS completion_tokens
    FROM conversation_messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.direction = 'outbound' AND c.user_id = $1
    GROUP BY m.ai_model
  `, [userId]);
  let totalTokens = 0;
  let totalCostInr = 0;
  for (const row of usageResult.rows) {
    const pt = Number(row.prompt_tokens);
    const ct = Number(row.completion_tokens);
    totalTokens += pt + ct;
    totalCostInr += estimateInrCost(row.ai_model, pt, ct);
  }

  return {
    userId: r.user_id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    aiActive: r.ai_active,
    aiTokenBalance: Number(r.ai_token_balance),
    planCode: r.plan_code,
    planName: r.plan_name,
    subscriptionStatus: r.subscription_status,
    workspaceId: r.workspace_id,
    workspaceName: r.workspace_name,
    totalConversations: Number(r.total_conversations),
    totalMessages: Number(r.total_messages),
    totalChunks: Number(r.total_chunks),
    totalBroadcasts: Number(r.total_broadcasts),
    totalTokens,
    totalCostInr,
    createdAt: r.created_at,
  };
}

// ── Toggle User AI Active ─────────────────────────────────────────────────────

export async function toggleUserAiActive(userId: string, aiActive: boolean, adminEmail?: string): Promise<void> {
  const before = await pool.query<{ ai_active: boolean }>(`SELECT ai_active FROM users WHERE id = $1`, [userId]);
  const prevActive = before.rows[0]?.ai_active;
  await pool.query(`UPDATE users SET ai_active = $1 WHERE id = $2`, [aiActive, userId]);
  await writeAdminAuditLog({
    adminEmail,
    action: "user.ai_active_toggle",
    targetUserId: userId,
    before: { aiActive: prevActive },
    after: { aiActive },
  });
}

// ── Force Password Reset ──────────────────────────────────────────────────────

export async function sendAdminPasswordReset(userId: string, appBaseUrl: string): Promise<void> {
  const userResult = await pool.query<{ email: string }>(
    `SELECT email FROM users WHERE id = $1`, [userId]
  );
  const email = userResult.rows[0]?.email;
  if (!email) throw new Error("User not found");
  const reset = await createPasswordResetToken(email);
  if (!reset) throw new Error("Failed to create reset token");
  const resetUrl = `${appBaseUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(reset.token)}`;
  await sendTransactionalEmail({
    to: reset.email,
    subject: "Reset your WAgen AI password (Admin initiated)",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
        <h1 style="font-size:22px;margin:0 0 12px">Password Reset</h1>
        <p style="font-size:14px;line-height:1.6;color:#475569">Hi ${reset.name}, your account administrator has initiated a password reset for your account. Use the button below to set a new password. This link expires in 1 hour.</p>
        <p style="margin:24px 0">
          <a href="${resetUrl}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;display:inline-block;font-weight:700">Reset password</a>
        </p>
        <p style="font-size:12px;line-height:1.6;color:#64748b">If you did not expect this, please contact support immediately.</p>
      </div>
    `
  });
}

// ── Global Search ─────────────────────────────────────────────────────────────

export interface AdminSearchResults {
  workspaces: Array<{ id: string; name: string; ownerEmail: string }>;
  users: Array<{ id: string; name: string; email: string; plan: string }>;
  phones: Array<{ phoneNumber: string; conversationId: string; workspaceName: string }>;
  campaigns: Array<{ id: string; name: string; workspaceName: string; status: string }>;
}

export async function globalAdminSearch(query: string): Promise<AdminSearchResults> {
  const q = `%${query.trim()}%`;

  const [wsResult, usersResult, phonesResult, campaignsResult] = await Promise.all([
    pool.query<{ id: string; name: string; owner_email: string }>(
      `SELECT w.id, w.name, u.email AS owner_email
       FROM workspaces w
       JOIN users u ON u.id = w.owner_id
       WHERE w.name ILIKE $1 OR u.email ILIKE $1 OR u.name ILIKE $1
       LIMIT 10`,
      [q]
    ),
    pool.query<{ id: string; name: string; email: string; plan: string }>(
      `SELECT id, name, email, subscription_plan AS plan
       FROM users
       WHERE email ILIKE $1 OR name ILIKE $1
       LIMIT 10`,
      [q]
    ),
    pool.query<{ phone_number: string; conversation_id: string; workspace_name: string }>(
      `SELECT DISTINCT ON (ct.phone_number) ct.phone_number, cv.id AS conversation_id, w.name AS workspace_name
       FROM contacts ct
       JOIN conversations cv ON cv.contact_id = ct.id
       JOIN workspaces w ON w.owner_id = cv.user_id
       WHERE ct.phone_number ILIKE $1
       LIMIT 10`,
      [q]
    ),
    pool.query<{ id: string; name: string; workspace_name: string; status: string }>(
      `SELECT c.id, c.name, w.name AS workspace_name, c.status
       FROM campaigns c
       JOIN workspaces w ON w.owner_id = c.user_id
       WHERE c.name ILIKE $1
       LIMIT 10`,
      [q]
    ),
  ]);

  return {
    workspaces: wsResult.rows.map((r) => ({ id: r.id, name: r.name, ownerEmail: r.owner_email })),
    users: usersResult.rows.map((r) => ({ id: r.id, name: r.name, email: r.email, plan: r.plan })),
    phones: phonesResult.rows.map((r) => ({ phoneNumber: r.phone_number, conversationId: r.conversation_id, workspaceName: r.workspace_name })),
    campaigns: campaignsResult.rows.map((r) => ({ id: r.id, name: r.name, workspaceName: r.workspace_name, status: r.status })),
  };
}

// ── Computed Alerts ───────────────────────────────────────────────────────────

export interface AdminAlert {
  type: string;
  severity: "warn" | "critical";
  message: string;
  count: number;
  detail?: Record<string, unknown>;
}

export async function getAdminAlerts(): Promise<AdminAlert[]> {
  const alerts: AdminAlert[] = [];

  const [zeroCredits, pastDue, wabaExpiring] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM workspaces w
       JOIN users u ON u.id = w.owner_id
       LEFT JOIN credit_wallet cw ON cw.user_id = u.id
       WHERE w.status = 'active' AND COALESCE(cw.remaining_credits, 0) <= 0`
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM subscriptions
       WHERE status = 'past_due'
         AND updated_at <= NOW() - INTERVAL '3 days'`
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM whatsapp_business_connections
       WHERE token_expires_at IS NOT NULL
         AND token_expires_at <= NOW() + INTERVAL '7 days'
         AND token_expires_at > NOW()`
    ),
  ]);

  const zeroCreditsCount = Number(zeroCredits.rows[0]?.count ?? 0);
  if (zeroCreditsCount > 0) {
    alerts.push({
      type: "zero_credits",
      severity: zeroCreditsCount > 5 ? "critical" : "warn",
      message: `${zeroCreditsCount} active workspace${zeroCreditsCount === 1 ? "" : "s"} have 0 credits`,
      count: zeroCreditsCount,
    });
  }

  const pastDueCount = Number(pastDue.rows[0]?.count ?? 0);
  if (pastDueCount > 0) {
    alerts.push({
      type: "past_due_subscription",
      severity: "warn",
      message: `${pastDueCount} subscription${pastDueCount === 1 ? "" : "s"} past_due for more than 3 days`,
      count: pastDueCount,
    });
  }

  const wabaExpiringCount = Number(wabaExpiring.rows[0]?.count ?? 0);
  if (wabaExpiringCount > 0) {
    alerts.push({
      type: "waba_token_expiring",
      severity: "critical",
      message: `${wabaExpiringCount} WABA connection${wabaExpiringCount === 1 ? "" : "s"} token expiring within 7 days`,
      count: wabaExpiringCount,
    });
  }

  // Queue failures from BullMQ
  try {
    const queues = await getManagedQueues();
    let totalFailed = 0;
    for (const q of queues) {
      const counts = await q.getJobCounts("failed");
      totalFailed += counts.failed ?? 0;
    }
    if (totalFailed > 100) {
      alerts.push({
        type: "queue_failures",
        severity: "critical",
        message: `${totalFailed} failed jobs across all queues`,
        count: totalFailed,
      });
    } else if (totalFailed > 20) {
      alerts.push({
        type: "queue_failures",
        severity: "warn",
        message: `${totalFailed} failed jobs across all queues`,
        count: totalFailed,
      });
    }
  } catch {
    // Queue may be unavailable — non-fatal
  }

  return alerts;
}

// ── Impersonation Log ─────────────────────────────────────────────────────────

export async function writeAdminImpersonationLog(opts: {
  adminEmail: string;
  workspaceId: string;
  targetUserId: string;
  ipAddress?: string;
}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO admin_impersonation_logs (admin_email, workspace_id, target_user_id, ip_address)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [opts.adminEmail, opts.workspaceId, opts.targetUserId, opts.ipAddress ?? null]
  );
  return result.rows[0]?.id ?? "";
}

// ── Admin Sessions ────────────────────────────────────────────────────────────

export interface AdminSession {
  id: string;
  adminEmail: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

// ── Billing Payments ───────────────────────────────────────────────────────────

export interface BillingPaymentEntry {
  id: string;
  type: "subscription" | "recharge";
  userEmail: string;
  workspaceName: string;
  amountPaise: number;
  currency: string;
  status: string;
  method: string | null;
  razorpayId: string | null;
  paidAt: string | null;
  createdAt: string;
}

export async function listBillingPayments(limit = 200): Promise<BillingPaymentEntry[]> {
  const result = await pool.query<{
    id: string;
    type: "subscription" | "recharge";
    user_email: string;
    workspace_name: string;
    amount_paise: number;
    currency: string;
    status: string;
    method: string | null;
    razorpay_id: string | null;
    paid_at: string | null;
    created_at: string;
  }>(
    `SELECT
       p.id,
       'subscription' AS type,
       u.email AS user_email,
       COALESCE(w.name, u.email) AS workspace_name,
       p.amount_paise,
       p.currency,
       p.status,
       p.method,
       p.razorpay_payment_id AS razorpay_id,
       p.paid_at,
       p.created_at
     FROM subscription_payments p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN workspaces w ON w.owner_id = u.id
     UNION ALL
     SELECT
       o.id,
       'recharge' AS type,
       u.email AS user_email,
       COALESCE(w.name, u.email) AS workspace_name,
       o.amount_total_paise AS amount_paise,
       o.currency,
       o.status,
       NULL AS method,
       o.razorpay_payment_id AS razorpay_id,
       o.paid_at,
       o.created_at
     FROM credit_recharge_orders o
     JOIN users u ON u.id = o.user_id
     LEFT JOIN workspaces w ON w.owner_id = u.id
     ORDER BY created_at DESC
     LIMIT $1`,
    [Math.max(1, Math.min(500, limit))]
  );

  return result.rows.map((r) => ({
    id: r.id,
    type: r.type,
    userEmail: r.user_email,
    workspaceName: r.workspace_name,
    amountPaise: Number(r.amount_paise),
    currency: r.currency,
    status: r.status,
    method: r.method,
    razorpayId: r.razorpay_id,
    paidAt: r.paid_at,
    createdAt: r.created_at,
  }));
}

// ── AI Cost Summary ─────────────────────────────────────────────────────────────

export interface AiCostSummaryEntry {
  label: string;
  costInr: number;
  tokens: number;
  messages: number;
}

export async function getAiCostSummary(
  groupBy: "model" | "workspace" | "module" | "day" = "model",
  days = 30
): Promise<AiCostSummaryEntry[]> {
  let selectLabel: string;
  switch (groupBy) {
    case "workspace":
      selectLabel = "COALESCE(w.name, u.email)";
      break;
    case "module":
      selectLabel = "COALESCE(l.module, 'unknown')";
      break;
    case "day":
      selectLabel = "TO_CHAR(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')";
      break;
    default:
      selectLabel = "COALESCE(l.model, 'unknown')";
  }

  const result = await pool.query<{
    label: string;
    cost_inr: string;
    tokens: string;
    messages: string;
  }>(
    `SELECT
       ${selectLabel} AS label,
       SUM(l.estimated_cost_inr) AS cost_inr,
       SUM(l.total_tokens) AS tokens,
       COUNT(*) AS messages
     FROM ai_token_ledger l
     LEFT JOIN users u ON u.id = l.user_id
     LEFT JOIN workspaces w ON w.owner_id = u.id
     WHERE l.created_at >= NOW() - INTERVAL '1 day' * $1
     GROUP BY 1
     ORDER BY cost_inr DESC
     LIMIT 50`,
    [days]
  );

  return result.rows.map((r) => ({
    label: r.label,
    costInr: Number(r.cost_inr),
    tokens: Number(r.tokens),
    messages: Number(r.messages),
  }));
}

// ── Workspace Feature Flag Overrides ───────────────────────────────────────────

export interface WorkspaceFeatureFlagOverride {
  flagKey: string;
  enabled: boolean;
  overrideReason: string | null;
  setByAdmin: string | null;
  updatedAt: string;
}

export async function listWorkspaceFeatureFlagOverrides(workspaceId: string): Promise<WorkspaceFeatureFlagOverride[]> {
  const result = await pool.query<{
    flag_key: string;
    enabled: boolean;
    override_reason: string | null;
    set_by_admin: string | null;
    updated_at: string;
  }>(
    `SELECT flag_key, enabled, override_reason, set_by_admin, updated_at
     FROM workspace_feature_overrides
     WHERE workspace_id = $1
     ORDER BY updated_at DESC`,
    [workspaceId]
  );

  return result.rows.map((r) => ({
    flagKey: r.flag_key,
    enabled: r.enabled,
    overrideReason: r.override_reason,
    setByAdmin: r.set_by_admin,
    updatedAt: r.updated_at,
  }));
}

export async function setWorkspaceFeatureFlagOverride(
  workspaceId: string,
  flagKey: string,
  enabled: boolean,
  adminEmail: string,
  reason?: string
): Promise<void> {
  await pool.query(
    `INSERT INTO workspace_feature_overrides (workspace_id, flag_key, enabled, override_reason, set_by_admin, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (workspace_id, flag_key) DO UPDATE
       SET enabled = EXCLUDED.enabled,
           override_reason = EXCLUDED.override_reason,
           set_by_admin = EXCLUDED.set_by_admin,
           updated_at = NOW()`,
    [workspaceId, flagKey, enabled, reason ?? null, adminEmail]
  );
  await writeAdminAuditLog({
    adminEmail,
    action: "workspace.feature_flag_override",
    workspaceId,
    details: { flagKey, enabled, reason },
  });
}

export async function removeWorkspaceFeatureFlagOverride(
  workspaceId: string,
  flagKey: string,
  adminEmail: string
): Promise<void> {
  await pool.query(
    `DELETE FROM workspace_feature_overrides WHERE workspace_id = $1 AND flag_key = $2`,
    [workspaceId, flagKey]
  );
  await writeAdminAuditLog({
    adminEmail,
    action: "workspace.feature_flag_override_removed",
    workspaceId,
    details: { flagKey },
  });
}

export async function listAdminSessions(limit = 50): Promise<AdminSession[]> {
  const result = await pool.query<{
    id: string;
    admin_email: string;
    ip_address: string | null;
    user_agent: string | null;
    created_at: string;
  }>(
    `SELECT id, admin_email, ip_address, user_agent, created_at
     FROM admin_sessions
     ORDER BY created_at DESC
     LIMIT $1`,
    [Math.max(1, Math.min(200, limit))]
  );

  return result.rows.map((r) => ({
    id: r.id,
    adminEmail: r.admin_email,
    ipAddress: r.ip_address,
    userAgent: r.user_agent,
    createdAt: r.created_at,
  }));
}

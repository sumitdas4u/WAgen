import { firstRow } from "../db/sql-helpers.js";
import { pool } from "../db/pool.js";
import { estimateInrCost } from "./usage-cost-service.js";
import { getManagedQueues } from "./queue-service.js";

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
    plan: row.plan,
    aiActive: row.ai_active,
    conversations: Number(row.conversations),
    messages: Number(row.messages),
    chunks: Number(row.chunks),
    totalTokens: usage.totalTokens,
    costInr: usage.costInr,
    createdAt: row.created_at
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

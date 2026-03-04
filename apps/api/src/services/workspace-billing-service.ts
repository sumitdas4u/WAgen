import type { PoolClient } from "pg";
import { env } from "../config/env.js";
import { pool, withTransaction } from "../db/pool.js";

const WORKSPACE_PLAN_CODES = ["starter", "pro", "business"] as const;
type WorkspacePlanCode = (typeof WORKSPACE_PLAN_CODES)[number];
type WorkspaceSubscriptionStatus = "active" | "trial" | "past_due" | "cancelled";

interface WorkspacePlanRow {
  id: string;
  code: WorkspacePlanCode;
  name: string;
  price_monthly: number;
  monthly_credits: number;
  agent_limit: number;
  whatsapp_number_limit: number;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
}

interface WorkspaceRow {
  id: string;
  name: string;
  owner_id: string;
  plan_id: string | null;
  status: "active" | "suspended" | "deleted";
  created_at: string;
  updated_at: string;
}

interface CreditWalletRow {
  id: string;
  workspace_id: string;
  total_credits: number;
  used_credits: number;
  remaining_credits: number;
  last_reset_date: string;
  updated_at: string;
}

interface WorkspaceSubscriptionRow {
  id: string;
  workspace_id: string;
  plan_id: string;
  status: WorkspaceSubscriptionStatus;
  start_date: string;
  next_billing_date: string | null;
  payment_gateway_id: string | null;
  updated_at: string;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  business_type: string | null;
  subscription_plan: string;
  workspace_id: string | null;
}

export interface WorkspacePlan {
  id: string;
  code: WorkspacePlanCode;
  name: string;
  priceMonthly: number;
  monthlyCredits: number;
  agentLimit: number;
  whatsappNumberLimit: number;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  ownerId: string;
  status: "active" | "suspended" | "deleted";
  createdAt: string;
  plan: WorkspacePlan | null;
}

export interface WorkspaceCreditSummary {
  workspaceId: string;
  totalCredits: number;
  usedCredits: number;
  remainingCredits: number;
  lastResetDate: string;
  lowCreditThresholdPercent: number;
  lowCredit: boolean;
  lowCreditMessage: string | null;
}

export interface ConversationCreditDecision {
  allowed: boolean;
  deducted: boolean;
  sessionId: string | null;
  workspaceId: string;
  totalCredits: number;
  usedCredits: number;
  remainingCredits: number;
  lowCredit: boolean;
  blockMessage: string | null;
}

export interface AdminWorkspaceSummary {
  workspaceId: string;
  workspaceName: string;
  workspaceStatus: "active" | "suspended" | "deleted";
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  planCode: WorkspacePlanCode | null;
  planName: string | null;
  subscriptionStatus: WorkspaceSubscriptionStatus | null;
  nextBillingDate: string | null;
  totalCredits: number;
  usedCredits: number;
  remainingCredits: number;
  updatedAt: string | null;
}

function normalizePlanCode(value: unknown): WorkspacePlanCode {
  if (value === "starter" || value === "pro" || value === "business") {
    return value;
  }
  return "starter";
}

function resolveWorkspaceName(user: Pick<UserRow, "name" | "email" | "business_type">): string {
  const fromBusinessType = user.business_type?.trim();
  if (fromBusinessType) {
    return fromBusinessType;
  }
  const fromName = user.name.trim();
  if (fromName) {
    return `${fromName}'s Workspace`;
  }
  const fromEmail = user.email.split("@")[0]?.trim();
  if (fromEmail) {
    return `${fromEmail} Workspace`;
  }
  return "Workspace";
}

function toWorkspacePlan(row: WorkspacePlanRow): WorkspacePlan {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    priceMonthly: Number(row.price_monthly ?? 0),
    monthlyCredits: Number(row.monthly_credits ?? 0),
    agentLimit: Number(row.agent_limit ?? 0),
    whatsappNumberLimit: Number(row.whatsapp_number_limit ?? 0),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toLowCreditThresholdPercent(): number {
  const value = Math.round(Number(env.LOW_CREDIT_THRESHOLD ?? 10));
  if (!Number.isFinite(value)) {
    return 10;
  }
  return Math.max(1, Math.min(99, value));
}

function computeLowCredit(totalCredits: number, remainingCredits: number): boolean {
  if (totalCredits <= 0) {
    return false;
  }
  const remainingPercent = (remainingCredits / totalCredits) * 100;
  return remainingPercent < toLowCreditThresholdPercent();
}

function buildLowCreditMessage(totalCredits: number, remainingCredits: number): string | null {
  if (!computeLowCredit(totalCredits, remainingCredits)) {
    return null;
  }
  return `Only ${remainingCredits} credits left this month. Upgrade plan or buy add-on credits.`;
}

function mapBillingStatus(status: string): WorkspaceSubscriptionStatus {
  const normalized = status.trim().toLowerCase();
  if (normalized === "active" || normalized === "authenticated") {
    return "active";
  }
  if (normalized === "cancelled" || normalized === "completed" || normalized === "expired") {
    return "cancelled";
  }
  if (normalized === "payment_failed" || normalized === "halted" || normalized === "paused") {
    return "past_due";
  }
  return "trial";
}

function normalizeStatus(status: WorkspaceSubscriptionStatus): WorkspaceSubscriptionStatus {
  if (status === "active" || status === "trial" || status === "past_due" || status === "cancelled") {
    return status;
  }
  return "trial";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function getWorkspacePlanByCode(client: PoolClient, code: WorkspacePlanCode): Promise<WorkspacePlanRow | null> {
  const result = await client.query<WorkspacePlanRow>(
    `SELECT id, code, name, price_monthly, monthly_credits, agent_limit, whatsapp_number_limit, status, created_at, updated_at
     FROM plans
     WHERE code = $1
     LIMIT 1`,
    [code]
  );
  return result.rows[0] ?? null;
}

async function ensureDefaultPlans(client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO plans (code, name, price_monthly, monthly_credits, agent_limit, whatsapp_number_limit, status)
     VALUES
       ('starter', 'Starter', 799, 300, 5, 1, 'active'),
       ('pro', 'Growth', 1499, 600, 10, 2, 'active'),
       ('business', 'Pro', 2999, 1200, 30, 3, 'active')
     ON CONFLICT (code) DO NOTHING`
  );
}

async function getUserByIdForWorkspace(client: PoolClient, userId: string): Promise<UserRow> {
  const result = await client.query<UserRow>(
    `SELECT id, name, email, business_type, subscription_plan, workspace_id
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );
  const user = result.rows[0];
  if (!user) {
    throw new Error("User not found");
  }
  return user;
}

async function findWorkspaceByOwnerId(client: PoolClient, userId: string): Promise<WorkspaceRow | null> {
  const result = await client.query<WorkspaceRow>(
    `SELECT id, name, owner_id, plan_id, status, created_at, updated_at
     FROM workspaces
     WHERE owner_id = $1
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] ?? null;
}

async function getWorkspaceById(client: PoolClient, workspaceId: string): Promise<WorkspaceRow | null> {
  const result = await client.query<WorkspaceRow>(
    `SELECT id, name, owner_id, plan_id, status, created_at, updated_at
     FROM workspaces
     WHERE id = $1
     LIMIT 1`,
    [workspaceId]
  );
  return result.rows[0] ?? null;
}

async function createDefaultWorkspace(client: PoolClient, user: UserRow): Promise<WorkspaceRow> {
  await ensureDefaultPlans(client);
  const defaultPlan = await getWorkspacePlanByCode(client, normalizePlanCode(user.subscription_plan));
  const fallbackPlan = defaultPlan ?? (await getWorkspacePlanByCode(client, "starter"));
  if (!fallbackPlan) {
    throw new Error("No workspace plans configured");
  }

  const created = await client.query<WorkspaceRow>(
    `INSERT INTO workspaces (name, owner_id, plan_id, status)
     VALUES ($1, $2, $3, 'active')
     ON CONFLICT (owner_id) DO UPDATE SET
       plan_id = COALESCE(workspaces.plan_id, EXCLUDED.plan_id),
       status = CASE WHEN workspaces.status = 'deleted' THEN 'active' ELSE workspaces.status END,
       updated_at = NOW()
     RETURNING id, name, owner_id, plan_id, status, created_at, updated_at`,
    [resolveWorkspaceName(user), user.id, fallbackPlan.id]
  );

  const workspace = created.rows[0];
  if (!workspace) {
    throw new Error("Failed to create workspace");
  }

  await client.query(
    `UPDATE users
     SET workspace_id = $1
     WHERE id = $2
       AND (workspace_id IS NULL OR workspace_id <> $1)`,
    [workspace.id, user.id]
  );

  return workspace;
}

async function ensureWorkspaceSubscription(
  client: PoolClient,
  workspace: WorkspaceRow,
  user: UserRow
): Promise<WorkspaceSubscriptionRow> {
  const existing = await client.query<WorkspaceSubscriptionRow>(
    `SELECT id, workspace_id, plan_id, status, start_date, next_billing_date, payment_gateway_id, updated_at
     FROM subscriptions
     WHERE workspace_id = $1
     LIMIT 1`,
    [workspace.id]
  );
  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const status: WorkspaceSubscriptionStatus = user.subscription_plan === "trial" ? "trial" : "active";
  const trialDays = Math.max(1, env.TRIAL_DAYS);
  const nextBillingDate =
    status === "trial"
      ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString()
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const inserted = await client.query<WorkspaceSubscriptionRow>(
    `INSERT INTO subscriptions (
       workspace_id,
       plan_id,
       status,
       start_date,
       next_billing_date,
       metadata_json
     )
     VALUES ($1, $2, $3, NOW(), $4::timestamptz, $5::jsonb)
     RETURNING id, workspace_id, plan_id, status, start_date, next_billing_date, payment_gateway_id, updated_at`,
    [
      workspace.id,
      workspace.plan_id,
      status,
      nextBillingDate,
      JSON.stringify({
        source: "workspace_auto_provision",
        legacyPlan: user.subscription_plan
      })
    ]
  );

  const subscription = inserted.rows[0];
  if (!subscription) {
    throw new Error("Failed to create workspace subscription");
  }
  return subscription;
}

async function getWorkspacePlanById(client: PoolClient, planId: string): Promise<WorkspacePlanRow | null> {
  const result = await client.query<WorkspacePlanRow>(
    `SELECT id, code, name, price_monthly, monthly_credits, agent_limit, whatsapp_number_limit, status, created_at, updated_at
     FROM plans
     WHERE id = $1
     LIMIT 1`,
    [planId]
  );
  return result.rows[0] ?? null;
}

async function ensureWalletForWorkspace(
  client: PoolClient,
  workspace: WorkspaceRow,
  subscription: WorkspaceSubscriptionRow
): Promise<CreditWalletRow> {
  const existing = await client.query<CreditWalletRow>(
    `SELECT id, workspace_id, total_credits, used_credits, remaining_credits, last_reset_date, updated_at
     FROM credit_wallet
     WHERE workspace_id = $1
     LIMIT 1`,
    [workspace.id]
  );
  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const plan = workspace.plan_id ? await getWorkspacePlanById(client, workspace.plan_id) : null;
  const trialCredits = Math.max(0, env.TRIAL_CREDITS);
  const seedCredits =
    subscription.status === "trial"
      ? trialCredits
      : Math.max(0, Number(plan?.monthly_credits ?? 0));

  const inserted = await client.query<CreditWalletRow>(
    `INSERT INTO credit_wallet (
       workspace_id,
       total_credits,
       used_credits,
       remaining_credits,
       last_reset_date
     )
     VALUES ($1, $2, 0, $2, NOW())
     RETURNING id, workspace_id, total_credits, used_credits, remaining_credits, last_reset_date, updated_at`,
    [workspace.id, seedCredits]
  );

  await client.query(
    `INSERT INTO credit_transactions (
       workspace_id,
       type,
       credits,
       reference_id,
       reason,
       metadata_json
     )
     VALUES ($1, 'subscription', $2, $3, $4, $5::jsonb)
     ON CONFLICT DO NOTHING`,
    [
      workspace.id,
      seedCredits,
      `wallet-seed:${workspace.id}`,
      "Initial wallet credits",
      JSON.stringify({
        source: "workspace_auto_provision",
        status: subscription.status
      })
    ]
  );

  const wallet = inserted.rows[0];
  if (!wallet) {
    throw new Error("Failed to create workspace wallet");
  }
  return wallet;
}

async function ensureWorkspaceContext(client: PoolClient, userId: string): Promise<{
  user: UserRow;
  workspace: WorkspaceRow;
  subscription: WorkspaceSubscriptionRow;
  wallet: CreditWalletRow;
  plan: WorkspacePlanRow | null;
}> {
  const user = await getUserByIdForWorkspace(client, userId);
  let workspace: WorkspaceRow | null = null;
  if (user.workspace_id) {
    workspace = await getWorkspaceById(client, user.workspace_id);
  }
  if (!workspace) {
    workspace = await findWorkspaceByOwnerId(client, userId);
  }
  if (!workspace) {
    workspace = await createDefaultWorkspace(client, user);
  }

  if (!workspace.plan_id) {
    const fallbackPlan = await getWorkspacePlanByCode(client, "starter");
    if (!fallbackPlan) {
      throw new Error("Starter plan is not configured");
    }
    await client.query(
      `UPDATE workspaces
       SET plan_id = $1,
           status = CASE WHEN status = 'deleted' THEN 'active' ELSE status END
       WHERE id = $2`,
      [fallbackPlan.id, workspace.id]
    );
    workspace = {
      ...workspace,
      plan_id: fallbackPlan.id,
      status: workspace.status === "deleted" ? "active" : workspace.status
    };
  }

  const subscription = await ensureWorkspaceSubscription(client, workspace, user);
  const wallet = await ensureWalletForWorkspace(client, workspace, subscription);
  const plan = workspace.plan_id ? await getWorkspacePlanById(client, workspace.plan_id) : null;

  return { user, workspace, subscription, wallet, plan };
}

function toCreditSummary(workspaceId: string, wallet: CreditWalletRow): WorkspaceCreditSummary {
  const totalCredits = Number(wallet.total_credits ?? 0);
  const usedCredits = Number(wallet.used_credits ?? 0);
  const remainingCredits = Number(wallet.remaining_credits ?? 0);
  const lowCreditThresholdPercent = toLowCreditThresholdPercent();
  return {
    workspaceId,
    totalCredits,
    usedCredits,
    remainingCredits,
    lastResetDate: wallet.last_reset_date,
    lowCreditThresholdPercent,
    lowCredit: computeLowCredit(totalCredits, remainingCredits),
    lowCreditMessage: buildLowCreditMessage(totalCredits, remainingCredits)
  };
}

export async function ensureWorkspaceForUser(userId: string): Promise<WorkspaceSummary> {
  return withTransaction(async (client) => {
    const context = await ensureWorkspaceContext(client, userId);
    return {
      id: context.workspace.id,
      name: context.workspace.name,
      ownerId: context.workspace.owner_id,
      status: context.workspace.status,
      createdAt: context.workspace.created_at,
      plan: context.plan ? toWorkspacePlan(context.plan) : null
    };
  });
}

export async function getWorkspaceCreditsByUserId(userId: string): Promise<WorkspaceCreditSummary> {
  return withTransaction(async (client) => {
    const context = await ensureWorkspaceContext(client, userId);
    return toCreditSummary(context.workspace.id, context.wallet);
  });
}

export async function listPlans(options?: { includeInactive?: boolean }): Promise<WorkspacePlan[]> {
  const includeInactive = Boolean(options?.includeInactive);
  const result = await pool.query<WorkspacePlanRow>(
    `SELECT id, code, name, price_monthly, monthly_credits, agent_limit, whatsapp_number_limit, status, created_at, updated_at
     FROM plans
     WHERE ($1::boolean = TRUE OR status = 'active')
     ORDER BY price_monthly ASC, created_at ASC`,
    [includeInactive]
  );
  return result.rows.map(toWorkspacePlan);
}

export async function getPlanByCode(code: WorkspacePlanCode): Promise<WorkspacePlan | null> {
  const result = await pool.query<WorkspacePlanRow>(
    `SELECT id, code, name, price_monthly, monthly_credits, agent_limit, whatsapp_number_limit, status, created_at, updated_at
     FROM plans
     WHERE code = $1
     LIMIT 1`,
    [code]
  );
  const row = result.rows[0];
  return row ? toWorkspacePlan(row) : null;
}

export async function createPlan(input: {
  code: string;
  name: string;
  priceMonthly: number;
  monthlyCredits: number;
  agentLimit: number;
  whatsappNumberLimit: number;
  status?: "active" | "inactive";
}): Promise<WorkspacePlan> {
  const code = normalizePlanCode(input.code.trim().toLowerCase());
  const status = input.status ?? "active";
  const result = await pool.query<WorkspacePlanRow>(
    `INSERT INTO plans (
       code,
       name,
       price_monthly,
       monthly_credits,
       agent_limit,
       whatsapp_number_limit,
       status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, code, name, price_monthly, monthly_credits, agent_limit, whatsapp_number_limit, status, created_at, updated_at`,
    [
      code,
      input.name.trim(),
      Math.max(0, Math.floor(input.priceMonthly)),
      Math.max(0, Math.floor(input.monthlyCredits)),
      Math.max(0, Math.floor(input.agentLimit)),
      Math.max(0, Math.floor(input.whatsappNumberLimit)),
      status
    ]
  );
  return toWorkspacePlan(result.rows[0]);
}

export async function updatePlan(
  planId: string,
  patch: {
    name?: string;
    priceMonthly?: number;
    monthlyCredits?: number;
    agentLimit?: number;
    whatsappNumberLimit?: number;
    status?: "active" | "inactive";
  }
): Promise<WorkspacePlan> {
  const currentResult = await pool.query<WorkspacePlanRow>(
    `SELECT id, code, name, price_monthly, monthly_credits, agent_limit, whatsapp_number_limit, status, created_at, updated_at
     FROM plans
     WHERE id = $1
     LIMIT 1`,
    [planId]
  );
  const current = currentResult.rows[0];
  if (!current) {
    throw new Error("Plan not found");
  }

  const result = await pool.query<WorkspacePlanRow>(
    `UPDATE plans
     SET name = $2,
         price_monthly = $3,
         monthly_credits = $4,
         agent_limit = $5,
         whatsapp_number_limit = $6,
         status = $7
     WHERE id = $1
     RETURNING id, code, name, price_monthly, monthly_credits, agent_limit, whatsapp_number_limit, status, created_at, updated_at`,
    [
      planId,
      patch.name?.trim() || current.name,
      Math.max(0, Math.floor(patch.priceMonthly ?? current.price_monthly)),
      Math.max(0, Math.floor(patch.monthlyCredits ?? current.monthly_credits)),
      Math.max(0, Math.floor(patch.agentLimit ?? current.agent_limit)),
      Math.max(0, Math.floor(patch.whatsappNumberLimit ?? current.whatsapp_number_limit)),
      patch.status ?? current.status
    ]
  );

  return toWorkspacePlan(result.rows[0]);
}

export async function evaluateConversationCredit(input: {
  userId: string;
  customerIdentifier: string;
  channelType?: "web" | "qr" | "api";
}): Promise<ConversationCreditDecision> {
  const nowIso = new Date().toISOString();
  const conversationWindowHours = Math.max(1, env.CONVERSATION_WINDOW_HOURS);
  const windowMs = conversationWindowHours * 60 * 60 * 1000;

  return withTransaction(async (client) => {
    const context = await ensureWorkspaceContext(client, input.userId);
    if (context.workspace.status !== "active") {
      return {
        allowed: false,
        deducted: false,
        sessionId: null,
        workspaceId: context.workspace.id,
        totalCredits: context.wallet.total_credits,
        usedCredits: context.wallet.used_credits,
        remainingCredits: context.wallet.remaining_credits,
        lowCredit: computeLowCredit(context.wallet.total_credits, context.wallet.remaining_credits),
        blockMessage: "AI paused. Please upgrade plan."
      };
    }

    const lockKey = `${context.workspace.id}:${input.customerIdentifier}`;
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [lockKey]);

    const walletResult = await client.query<CreditWalletRow>(
      `SELECT id, workspace_id, total_credits, used_credits, remaining_credits, last_reset_date, updated_at
       FROM credit_wallet
       WHERE workspace_id = $1
       LIMIT 1
       FOR UPDATE`,
      [context.workspace.id]
    );
    const wallet = walletResult.rows[0];
    if (!wallet) {
      throw new Error("Credit wallet not found");
    }

    const latestSessionResult = await client.query<{ id: string; last_message_time: string }>(
      `SELECT id, last_message_time
       FROM conversation_sessions
       WHERE workspace_id = $1
         AND customer_phone = $2
       ORDER BY last_message_time DESC
       LIMIT 1
       FOR UPDATE`,
      [context.workspace.id, input.customerIdentifier]
    );
    const latestSession = latestSessionResult.rows[0];
    const latestTimeMs = latestSession?.last_message_time ? Date.parse(latestSession.last_message_time) : 0;
    const currentTimeMs = Date.parse(nowIso);
    const isNewSession = !latestSession || currentTimeMs - latestTimeMs >= windowMs;

    if (!isNewSession) {
      await client.query(
        `UPDATE conversation_sessions
         SET last_message_time = $1::timestamptz
         WHERE id = $2`,
        [nowIso, latestSession.id]
      );
      return {
        allowed: true,
        deducted: false,
        sessionId: latestSession.id,
        workspaceId: context.workspace.id,
        totalCredits: wallet.total_credits,
        usedCredits: wallet.used_credits,
        remainingCredits: wallet.remaining_credits,
        lowCredit: computeLowCredit(wallet.total_credits, wallet.remaining_credits),
        blockMessage: null
      };
    }

    if (wallet.remaining_credits <= 0) {
      return {
        allowed: false,
        deducted: false,
        sessionId: null,
        workspaceId: context.workspace.id,
        totalCredits: wallet.total_credits,
        usedCredits: wallet.used_credits,
        remainingCredits: wallet.remaining_credits,
        lowCredit: computeLowCredit(wallet.total_credits, wallet.remaining_credits),
        blockMessage: "AI paused. Please upgrade plan."
      };
    }

    await client.query(
      `UPDATE conversation_sessions
       SET status = 'expired'
       WHERE workspace_id = $1
         AND customer_phone = $2
         AND status = 'active'`,
      [context.workspace.id, input.customerIdentifier]
    );

    const insertedSessionResult = await client.query<{ id: string }>(
      `INSERT INTO conversation_sessions (
         workspace_id,
         customer_phone,
         start_time,
         last_message_time,
         credit_deducted,
         status
       )
       VALUES ($1, $2, $3::timestamptz, $3::timestamptz, TRUE, 'active')
       RETURNING id`,
      [context.workspace.id, input.customerIdentifier, nowIso]
    );
    const sessionId = insertedSessionResult.rows[0]?.id;
    if (!sessionId) {
      throw new Error("Failed to create conversation session");
    }

    const updatedWalletResult = await client.query<CreditWalletRow>(
      `UPDATE credit_wallet
       SET remaining_credits = remaining_credits - 1,
           used_credits = used_credits + 1,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, workspace_id, total_credits, used_credits, remaining_credits, last_reset_date, updated_at`,
      [wallet.id]
    );
    const updatedWallet = updatedWalletResult.rows[0];
    if (!updatedWallet) {
      throw new Error("Failed to update credit wallet");
    }

    await client.query(
      `INSERT INTO credit_transactions (
         workspace_id,
         type,
         credits,
         reference_id,
         reason,
         metadata_json
       )
       VALUES ($1, 'deduction', -1, $2, $3, $4::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        context.workspace.id,
        sessionId,
        `Conversation credit deduction (${conversationWindowHours}h window)`,
        JSON.stringify({
          customerIdentifier: input.customerIdentifier,
          deductedAt: nowIso,
          channelType: input.channelType ?? "unknown"
        })
      ]
    );

    return {
      allowed: true,
      deducted: true,
      sessionId,
      workspaceId: context.workspace.id,
      totalCredits: updatedWallet.total_credits,
      usedCredits: updatedWallet.used_credits,
      remainingCredits: updatedWallet.remaining_credits,
      lowCredit: computeLowCredit(updatedWallet.total_credits, updatedWallet.remaining_credits),
      blockMessage: null
    };
  });
}

export async function syncWorkspaceSubscriptionFromBillingEvent(input: {
  userId: string;
  billingPlanCode: string;
  billingStatus: string;
  paymentGatewayId?: string | null;
  nextBillingDate?: string | null;
  source?: string;
}): Promise<void> {
  await withTransaction(async (client) => {
    const context = await ensureWorkspaceContext(client, input.userId);
    const targetPlanCode = normalizePlanCode(input.billingPlanCode);
    const targetPlan = await getWorkspacePlanByCode(client, targetPlanCode);
    if (!targetPlan) {
      throw new Error(`Plan not found for code: ${targetPlanCode}`);
    }

    const mappedStatus = mapBillingStatus(input.billingStatus);
    const previousSubscriptionResult = await client.query<WorkspaceSubscriptionRow>(
      `SELECT id, workspace_id, plan_id, status, start_date, next_billing_date, payment_gateway_id, updated_at
       FROM subscriptions
       WHERE workspace_id = $1
       LIMIT 1`,
      [context.workspace.id]
    );
    const previousSubscription = previousSubscriptionResult.rows[0] ?? null;
    const previousPlanId = previousSubscription?.plan_id ?? context.workspace.plan_id;
    const previousStatus = normalizeStatus(previousSubscription?.status ?? "trial");

    await client.query(
      `UPDATE workspaces
       SET plan_id = $2
       WHERE id = $1`,
      [context.workspace.id, targetPlan.id]
    );

    const trialDays = Math.max(1, env.TRIAL_DAYS);
    const defaultNextBillingDate =
      mappedStatus === "trial"
        ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString()
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await client.query(
      `INSERT INTO subscriptions (
         workspace_id,
         plan_id,
         status,
         start_date,
         next_billing_date,
         payment_gateway_id,
         metadata_json
       )
       VALUES ($1, $2, $3, NOW(), $4::timestamptz, $5, $6::jsonb)
       ON CONFLICT (workspace_id) DO UPDATE SET
         plan_id = EXCLUDED.plan_id,
         status = EXCLUDED.status,
         next_billing_date = COALESCE(EXCLUDED.next_billing_date, subscriptions.next_billing_date),
         payment_gateway_id = COALESCE(EXCLUDED.payment_gateway_id, subscriptions.payment_gateway_id),
         metadata_json = COALESCE(subscriptions.metadata_json, '{}'::jsonb) || EXCLUDED.metadata_json,
         updated_at = NOW()`,
      [
        context.workspace.id,
        targetPlan.id,
        mappedStatus,
        input.nextBillingDate ?? defaultNextBillingDate,
        input.paymentGatewayId ?? null,
        JSON.stringify({
          source: input.source ?? "billing_service",
          billingStatus: input.billingStatus,
          syncedAt: new Date().toISOString()
        })
      ]
    );

    const hasActivated = mappedStatus === "active" && previousStatus !== "active";
    const hasPlanChanged = previousPlanId !== targetPlan.id;
    if (!hasActivated && !hasPlanChanged) {
      return;
    }

    const walletResult = await client.query<CreditWalletRow>(
      `SELECT id, workspace_id, total_credits, used_credits, remaining_credits, last_reset_date, updated_at
       FROM credit_wallet
       WHERE workspace_id = $1
       LIMIT 1
       FOR UPDATE`,
      [context.workspace.id]
    );
    const wallet = walletResult.rows[0];
    const nextCredits = Math.max(0, targetPlan.monthly_credits);

    if (!wallet) {
      await client.query(
        `INSERT INTO credit_wallet (
           workspace_id,
           total_credits,
           used_credits,
           remaining_credits,
           last_reset_date
         )
         VALUES ($1, $2, 0, $2, NOW())`,
        [context.workspace.id, nextCredits]
      );
    } else {
      await client.query(
        `UPDATE credit_wallet
         SET total_credits = $2,
             used_credits = 0,
             remaining_credits = $2,
             last_reset_date = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [wallet.id, nextCredits]
      );
    }

    await client.query(
      `INSERT INTO credit_transactions (
         workspace_id,
         type,
         credits,
         reference_id,
         reason,
         metadata_json
       )
       VALUES ($1, 'subscription', $2, $3, $4, $5::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        context.workspace.id,
        nextCredits,
        `subscription-sync:${context.workspace.id}:${targetPlan.code}:${Date.now()}`,
        "Subscription sync credit allocation",
        JSON.stringify({
          source: input.source ?? "billing_service",
          billingStatus: input.billingStatus
        })
      ]
    );
  });
}

export async function applyAddonCredits(input: {
  userId: string;
  credits: number;
  referenceId: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}): Promise<WorkspaceCreditSummary> {
  const credits = Math.max(0, Math.floor(input.credits));
  if (credits <= 0) {
    throw new Error("Credits must be greater than zero");
  }

  return withTransaction(async (client) => {
    const context = await ensureWorkspaceContext(client, input.userId);
    const walletResult = await client.query<CreditWalletRow>(
      `SELECT id, workspace_id, total_credits, used_credits, remaining_credits, last_reset_date, updated_at
       FROM credit_wallet
       WHERE workspace_id = $1
       LIMIT 1
       FOR UPDATE`,
      [context.workspace.id]
    );
    const wallet = walletResult.rows[0];
    if (!wallet) {
      throw new Error("Credit wallet not found");
    }

    const transactionResult = await client.query<{ id: string }>(
      `INSERT INTO credit_transactions (
         workspace_id,
         type,
         credits,
         reference_id,
         reason,
         metadata_json
       )
       VALUES ($1, 'addon_purchase', $2, $3, $4, $5::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        context.workspace.id,
        credits,
        input.referenceId,
        input.reason ?? "Add-on credit purchase",
        JSON.stringify(input.metadata ?? {})
      ]
    );

    const wasInserted = Boolean(transactionResult.rows[0]?.id);
    if (wasInserted) {
      await client.query(
        `UPDATE credit_wallet
         SET total_credits = total_credits + $2,
             remaining_credits = remaining_credits + $2,
             updated_at = NOW()
         WHERE id = $1`,
        [wallet.id, credits]
      );
    }

    const refreshedResult = await client.query<CreditWalletRow>(
      `SELECT id, workspace_id, total_credits, used_credits, remaining_credits, last_reset_date, updated_at
       FROM credit_wallet
       WHERE id = $1
       LIMIT 1`,
      [wallet.id]
    );
    const refreshed = refreshedResult.rows[0] ?? wallet;
    return toCreditSummary(context.workspace.id, refreshed);
  });
}

export async function renewDueWorkspaceCredits(options?: {
  now?: Date;
  limit?: number;
}): Promise<{ processed: number; renewed: number }> {
  const now = options?.now ?? new Date();
  const limit = clamp(options?.limit ?? 500, 1, 5000);
  const advisoryKey = 921347712;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lockResult = await client.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_xact_lock($1) AS acquired`,
      [advisoryKey]
    );
    if (!lockResult.rows[0]?.acquired) {
      await client.query("ROLLBACK");
      return { processed: 0, renewed: 0 };
    }

    const dueResult = await client.query<
      WorkspaceSubscriptionRow & {
        monthly_credits: number;
      }
    >(
      `SELECT
         s.id,
         s.workspace_id,
         s.plan_id,
         s.status,
         s.start_date,
         s.next_billing_date,
         s.payment_gateway_id,
         s.updated_at,
         p.monthly_credits
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.status = 'active'
         AND s.next_billing_date IS NOT NULL
         AND s.next_billing_date <= $1::timestamptz
       ORDER BY s.next_billing_date ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [now.toISOString(), limit]
    );

    let renewed = 0;
    for (const row of dueResult.rows) {
      const monthlyCredits = Math.max(0, Number(row.monthly_credits ?? 0));
      const renewalReference = `renewal:${row.id}:${new Date(now).toISOString().slice(0, 10)}`;

      await client.query(
        `INSERT INTO credit_transactions (
           workspace_id,
           type,
           credits,
           reference_id,
           reason,
           metadata_json
         )
         VALUES ($1, 'renewal', $2, $3, $4, $5::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          row.workspace_id,
          monthlyCredits,
          renewalReference,
          "Monthly credit renewal",
          JSON.stringify({
            subscriptionId: row.id,
            renewedAt: now.toISOString()
          })
        ]
      );

      await client.query(
        `INSERT INTO credit_wallet (
           workspace_id,
           total_credits,
           used_credits,
           remaining_credits,
           last_reset_date
         )
         VALUES ($1, $2, 0, $2, $3::timestamptz)
         ON CONFLICT (workspace_id) DO UPDATE SET
           total_credits = EXCLUDED.total_credits,
           used_credits = 0,
           remaining_credits = EXCLUDED.remaining_credits,
           last_reset_date = EXCLUDED.last_reset_date,
           updated_at = NOW()`,
        [row.workspace_id, monthlyCredits, now.toISOString()]
      );

      await client.query(
        `UPDATE subscriptions
         SET next_billing_date = (COALESCE(next_billing_date, $2::timestamptz) + INTERVAL '30 days'),
             updated_at = NOW()
         WHERE id = $1`,
        [row.id, now.toISOString()]
      );

      renewed += 1;
    }

    await client.query("COMMIT");
    return {
      processed: dueResult.rows.length,
      renewed
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listAdminWorkspaces(options?: {
  limit?: number;
  status?: "active" | "suspended" | "deleted";
}): Promise<AdminWorkspaceSummary[]> {
  const limit = clamp(options?.limit ?? 200, 1, 1000);
  const status = options?.status ?? null;

  const result = await pool.query<{
    workspace_id: string;
    workspace_name: string;
    workspace_status: "active" | "suspended" | "deleted";
    owner_id: string;
    owner_name: string;
    owner_email: string;
    plan_code: WorkspacePlanCode | null;
    plan_name: string | null;
    subscription_status: WorkspaceSubscriptionStatus | null;
    next_billing_date: string | null;
    total_credits: string | null;
    used_credits: string | null;
    remaining_credits: string | null;
    wallet_updated_at: string | null;
  }>(
    `SELECT
       w.id AS workspace_id,
       w.name AS workspace_name,
       w.status AS workspace_status,
       u.id AS owner_id,
       u.name AS owner_name,
       u.email AS owner_email,
       p.code AS plan_code,
       p.name AS plan_name,
       s.status AS subscription_status,
       s.next_billing_date,
       cw.total_credits::text,
       cw.used_credits::text,
       cw.remaining_credits::text,
       cw.updated_at::text AS wallet_updated_at
     FROM workspaces w
     JOIN users u ON u.id = w.owner_id
     LEFT JOIN plans p ON p.id = w.plan_id
     LEFT JOIN subscriptions s ON s.workspace_id = w.id
     LEFT JOIN credit_wallet cw ON cw.workspace_id = w.id
     WHERE ($1::text IS NULL OR w.status = $1::text)
     ORDER BY w.created_at DESC
     LIMIT $2`,
    [status, limit]
  );

  return result.rows.map((row) => ({
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    workspaceStatus: row.workspace_status,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    planCode: row.plan_code,
    planName: row.plan_name,
    subscriptionStatus: row.subscription_status,
    nextBillingDate: row.next_billing_date,
    totalCredits: Number(row.total_credits ?? 0),
    usedCredits: Number(row.used_credits ?? 0),
    remainingCredits: Number(row.remaining_credits ?? 0),
    updatedAt: row.wallet_updated_at
  }));
}

export async function setWorkspaceStatusByAdmin(input: {
  workspaceId: string;
  status: "active" | "suspended" | "deleted";
  adminUserId?: string | null;
  reason?: string;
}): Promise<AdminWorkspaceSummary> {
  return withTransaction(async (client) => {
    const updatedResult = await client.query<WorkspaceRow>(
      `UPDATE workspaces
       SET status = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, owner_id, plan_id, status, created_at, updated_at`,
      [input.workspaceId, input.status]
    );
    const updated = updatedResult.rows[0];
    if (!updated) {
      throw new Error("Workspace not found");
    }

    if (input.status !== "active") {
      await client.query(
        `UPDATE users
         SET ai_active = FALSE
         WHERE id = $1`,
        [updated.owner_id]
      );
    }

    await client.query(
      `INSERT INTO admin_audit_logs (
         admin_user_id,
         action,
         workspace_id,
         target_user_id,
         details_json
       )
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        input.adminUserId ?? null,
        "workspace.status_changed",
        updated.id,
        updated.owner_id,
        JSON.stringify({
          status: input.status,
          reason: input.reason ?? null
        })
      ]
    );

    const refreshedResult = await client.query<{
      workspace_id: string;
      workspace_name: string;
      workspace_status: "active" | "suspended" | "deleted";
      owner_id: string;
      owner_name: string;
      owner_email: string;
      plan_code: WorkspacePlanCode | null;
      plan_name: string | null;
      subscription_status: WorkspaceSubscriptionStatus | null;
      next_billing_date: string | null;
      total_credits: string | null;
      used_credits: string | null;
      remaining_credits: string | null;
      wallet_updated_at: string | null;
    }>(
      `SELECT
         w.id AS workspace_id,
         w.name AS workspace_name,
         w.status AS workspace_status,
         u.id AS owner_id,
         u.name AS owner_name,
         u.email AS owner_email,
         p.code AS plan_code,
         p.name AS plan_name,
         s.status AS subscription_status,
         s.next_billing_date,
         cw.total_credits::text,
         cw.used_credits::text,
         cw.remaining_credits::text,
         cw.updated_at::text AS wallet_updated_at
       FROM workspaces w
       JOIN users u ON u.id = w.owner_id
       LEFT JOIN plans p ON p.id = w.plan_id
       LEFT JOIN subscriptions s ON s.workspace_id = w.id
       LEFT JOIN credit_wallet cw ON cw.workspace_id = w.id
       WHERE w.id = $1
       LIMIT 1`,
      [updated.id]
    );

    const row = refreshedResult.rows[0];
    if (!row) {
      throw new Error("Failed to refresh workspace summary");
    }

    return {
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      workspaceStatus: row.workspace_status,
      ownerId: row.owner_id,
      ownerName: row.owner_name,
      ownerEmail: row.owner_email,
      planCode: row.plan_code,
      planName: row.plan_name,
      subscriptionStatus: row.subscription_status,
      nextBillingDate: row.next_billing_date,
      totalCredits: Number(row.total_credits ?? 0),
      usedCredits: Number(row.used_credits ?? 0),
      remainingCredits: Number(row.remaining_credits ?? 0),
      updatedAt: row.wallet_updated_at
    };
  });
}

export async function adjustWorkspaceCreditsByAdmin(input: {
  workspaceId: string;
  deltaCredits: number;
  reason?: string;
  adminUserId?: string | null;
}): Promise<WorkspaceCreditSummary> {
  const delta = Math.trunc(input.deltaCredits);
  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error("deltaCredits must be a non-zero integer");
  }

  return withTransaction(async (client) => {
    const walletResult = await client.query<CreditWalletRow>(
      `SELECT id, workspace_id, total_credits, used_credits, remaining_credits, last_reset_date, updated_at
       FROM credit_wallet
       WHERE workspace_id = $1
       LIMIT 1
       FOR UPDATE`,
      [input.workspaceId]
    );
    const wallet = walletResult.rows[0];
    if (!wallet) {
      throw new Error("Credit wallet not found");
    }

    const nextTotal = Math.max(0, wallet.total_credits + delta);
    const nextRemaining = clamp(wallet.remaining_credits + delta, 0, nextTotal);
    const nextUsed = Math.max(0, nextTotal - nextRemaining);
    const effectiveDelta = nextRemaining - wallet.remaining_credits;

    const updatedWalletResult = await client.query<CreditWalletRow>(
      `UPDATE credit_wallet
       SET total_credits = $2,
           used_credits = $3,
           remaining_credits = $4,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, workspace_id, total_credits, used_credits, remaining_credits, last_reset_date, updated_at`,
      [wallet.id, nextTotal, nextUsed, nextRemaining]
    );
    const updatedWallet = updatedWalletResult.rows[0];
    if (!updatedWallet) {
      throw new Error("Failed to update wallet");
    }

    await client.query(
      `INSERT INTO credit_transactions (
         workspace_id,
         type,
         credits,
         reference_id,
         reason,
         actor_user_id,
         metadata_json
       )
       VALUES ($1, 'admin_adjustment', $2, $3, $4, $5, $6::jsonb)`,
      [
        input.workspaceId,
        effectiveDelta,
        `admin-adjustment:${input.workspaceId}:${Date.now()}`,
        input.reason ?? "Admin credit adjustment",
        input.adminUserId ?? null,
        JSON.stringify({
          requestedDelta: delta,
          effectiveDelta
        })
      ]
    );

    await client.query(
      `INSERT INTO admin_audit_logs (
         admin_user_id,
         action,
         workspace_id,
         details_json
       )
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        input.adminUserId ?? null,
        "workspace.credits_adjusted",
        input.workspaceId,
        JSON.stringify({
          requestedDelta: delta,
          effectiveDelta,
          reason: input.reason ?? null
        })
      ]
    );

    return toCreditSummary(input.workspaceId, updatedWallet);
  });
}

export async function resetWorkspaceWalletByAdmin(input: {
  workspaceId: string;
  adminUserId?: string | null;
  reason?: string;
}): Promise<WorkspaceCreditSummary> {
  return withTransaction(async (client) => {
    const workspaceResult = await client.query<WorkspaceRow>(
      `SELECT id, name, owner_id, plan_id, status, created_at, updated_at
       FROM workspaces
       WHERE id = $1
       LIMIT 1`,
      [input.workspaceId]
    );
    const workspace = workspaceResult.rows[0];
    if (!workspace) {
      throw new Error("Workspace not found");
    }
    if (!workspace.plan_id) {
      throw new Error("Workspace has no assigned plan");
    }

    const plan = await getWorkspacePlanById(client, workspace.plan_id);
    if (!plan) {
      throw new Error("Workspace plan not found");
    }
    const monthlyCredits = Math.max(0, plan.monthly_credits);

    const updatedWalletResult = await client.query<CreditWalletRow>(
      `INSERT INTO credit_wallet (
         workspace_id,
         total_credits,
         used_credits,
         remaining_credits,
         last_reset_date
       )
       VALUES ($1, $2, 0, $2, NOW())
       ON CONFLICT (workspace_id) DO UPDATE SET
         total_credits = EXCLUDED.total_credits,
         used_credits = 0,
         remaining_credits = EXCLUDED.remaining_credits,
         last_reset_date = EXCLUDED.last_reset_date,
         updated_at = NOW()
       RETURNING id, workspace_id, total_credits, used_credits, remaining_credits, last_reset_date, updated_at`,
      [workspace.id, monthlyCredits]
    );
    const wallet = updatedWalletResult.rows[0];

    await client.query(
      `INSERT INTO credit_transactions (
         workspace_id,
         type,
         credits,
         reference_id,
         reason,
         actor_user_id,
         metadata_json
       )
       VALUES ($1, 'renewal', $2, $3, $4, $5, $6::jsonb)`,
      [
        workspace.id,
        monthlyCredits,
        `admin-wallet-reset:${workspace.id}:${Date.now()}`,
        input.reason ?? "Admin wallet reset",
        input.adminUserId ?? null,
        JSON.stringify({
          source: "admin_reset"
        })
      ]
    );

    await client.query(
      `INSERT INTO admin_audit_logs (
         admin_user_id,
         action,
         workspace_id,
         target_user_id,
         details_json
       )
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        input.adminUserId ?? null,
        "workspace.wallet_reset",
        workspace.id,
        workspace.owner_id,
        JSON.stringify({
          reason: input.reason ?? null
        })
      ]
    );

    return toCreditSummary(workspace.id, wallet);
  });
}

export async function getWorkspaceIdByUserId(userId: string): Promise<string> {
  const workspace = await ensureWorkspaceForUser(userId);
  return workspace.id;
}

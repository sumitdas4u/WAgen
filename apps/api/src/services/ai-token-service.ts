/**
 * ai-token-service.ts — AI credit / token ledger
 *
 * Design principles:
 *  1. Balance updates and ledger inserts are ALWAYS in the same transaction.
 *  2. Row-level locking (SELECT … FOR UPDATE) prevents race conditions under
 *     concurrent requests.
 *  3. Ledger rows with a reference_id are idempotent — duplicate charges for
 *     the same reference are silently ignored (UNIQUE constraint).
 *  4. AI features should be checked before work starts (requireAiCredit).
 *  5. The central charge path refuses to push wallets beyond the grace buffer.
 *
 * External callers should use chargeUser() instead of deductTokens() directly.
 */

import { env } from "../config/env.js";
import { firstRow } from "../db/sql-helpers.js";
import { pool } from "../db/pool.js";
import { estimateInrCost } from "./usage-cost-service.js";

export const AI_CREDIT_GRACE_LIMIT = -5;
const TOKENS_PER_AI_CREDIT = 8_000;
const DEFAULT_MAX_TOKENS_PER_ACTION = 8_000;
const MAX_TOKENS_PER_ACTION: Partial<Record<AiTokenAction, number>> = {
  chatbot_reply: 8_000,
  auto_reply: 8_000,
  ai_agent_flow: 8_000,
  rag_query: 12_000,
  rag_embed_query: 2_000,
  kb_ingest_chunk: 4_000,
  template_generate: 6_000,
  onboarding_autofill: 6_000,
  flow_draft_generate: 10_000,
  flow_generation: 10_000,
  image_analyze: 12_000,
  image_analysis: 12_000,
  ai_text_assist: 4_000,
  ai_lead_summary: 8_000,
  summary: 8_000,
  ai_intent_classify: 4_000,
};

type AiUsageMetadata = {
  workspaceId?: string | null;
  module?: string | null;
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  estimatedCreditsReserved?: number | null;
  status?: "reserved" | "finalized" | "reversed" | "failed" | "credit";
};

type AiCreditRequirementInput = {
  creditsRequired?: number | null;
  estimatedTokens?: number | null;
};

// ── Action cost table ─────────────────────────────────────────────────────────
export const AI_TOKEN_COSTS = {
  auto_reply: 1,
  flow_decision: 1,
  lead_scoring: 1,
  summary: 1,
  translation: 1,
  rewrite: 1,
  campaign_personalization: 2,
  rag_query: 1,
  image_analysis: 4,
  flow_generation: 8,
  background_summary: 1,
  background_tagging: 1,
  rag_reindex: 1,

  // Legacy action names kept while callers migrate to the clearer AIActionType names.
  chatbot_reply: 1,
  rag_embed_query: 1,
  kb_ingest_chunk: 1,
  template_generate: 8,
  onboarding_autofill: 8,
  flow_draft_generate: 8,
  ai_agent_flow: 1,
  image_analyze: 4,
  ai_text_assist: 1,
  ai_lead_summary: 1,
  ai_intent_classify: 1,
} as const;

export type AiTokenAction = keyof typeof AI_TOKEN_COSTS;
export type AIActionType =
  | "auto_reply"
  | "flow_decision"
  | "lead_scoring"
  | "summary"
  | "translation"
  | "rewrite"
  | "campaign_personalization"
  | "rag_query"
  | "image_analysis"
  | "flow_generation"
  | "background_summary"
  | "background_tagging"
  | "rag_reindex";

// ── Monthly quota per plan ────────────────────────────────────────────────────
export const AI_TOKEN_PLAN_QUOTA: Record<string, number> = {
  trial:    50,
  starter:  300,
  pro:      700,
  business: 1500,
};

// Hard-gated: creation features blocked at balance ≤ 0
const HARD_GATED_ACTIONS = new Set<AiTokenAction>([
  "template_generate",
  "flow_draft_generate",
  "onboarding_autofill",
  "kb_ingest_chunk",
  "flow_generation",
  "rag_reindex",
]);

// ── Error types ───────────────────────────────────────────────────────────────
export class AiTokensDepletedError extends Error {
  readonly code = "ai_tokens_depleted";
  readonly balance: number;
  constructor(balance: number) {
    super("AI credits depleted. Recharge, upgrade your plan, or wait for the monthly reset.");
    this.name = "AiTokensDepletedError";
    this.balance = balance;
  }
}

export class InvalidAiActionError extends Error {
  constructor(action: string) {
    super(`Unknown AI action: "${action}". Add it to AI_TOKEN_COSTS.`);
    this.name = "InvalidAiActionError";
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function assertValidAction(action: string): asserts action is AiTokenAction {
  if (!(action in AI_TOKEN_COSTS)) {
    throw new InvalidAiActionError(action);
  }
}

export class AiTokenLimitExceededError extends Error {
  readonly code = "ai_token_limit_exceeded";
  readonly action: AiTokenAction;
  readonly maxTokens: number;
  readonly estimatedTokens: number;

  constructor(action: AiTokenAction, estimatedTokens: number, maxTokens: number) {
    super(`AI action "${action}" exceeds the max token guard.`);
    this.name = "AiTokenLimitExceededError";
    this.action = action;
    this.estimatedTokens = estimatedTokens;
    this.maxTokens = maxTokens;
  }
}

function toNonNegativeInteger(value: number | null | undefined): number {
  if (!Number.isFinite(Number(value))) {
    return 0;
  }
  return Math.max(0, Math.floor(Number(value)));
}

export function getCreditsForAction(action: AiTokenAction): number {
  assertValidAction(action);
  return AI_TOKEN_COSTS[action];
}

function estimateCreditsFromTokens(action: AiTokenAction, totalTokens: number): number {
  const weightedActionCredits = getCreditsForAction(action);
  const tokenCredits = Math.ceil(toNonNegativeInteger(totalTokens) / TOKENS_PER_AI_CREDIT);
  return Math.max(weightedActionCredits, tokenCredits || 1);
}

export function getMaxTokensForAction(action: AiTokenAction | string): number {
  assertValidAction(action);
  return MAX_TOKENS_PER_ACTION[action] ?? DEFAULT_MAX_TOKENS_PER_ACTION;
}

export function assertMaxTokensForAction(
  action: AiTokenAction | string,
  estimatedTokens: number | null | undefined
): void {
  assertValidAction(action);
  const normalizedTokens = toNonNegativeInteger(estimatedTokens);
  if (normalizedTokens === 0) return;
  const maxTokens = getMaxTokensForAction(action);
  if (normalizedTokens > maxTokens) {
    throw new AiTokenLimitExceededError(action, normalizedTokens, maxTokens);
  }
}

export function estimateRequiredCredits(
  action: AiTokenAction | string,
  input?: { estimatedTokens?: number | null }
): number {
  assertValidAction(action);
  assertMaxTokensForAction(action, input?.estimatedTokens);
  return estimateCreditsFromTokens(action, toNonNegativeInteger(input?.estimatedTokens));
}

export function estimateTextTokens(value: string | null | undefined): number {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function defaultModuleForAction(action: AiTokenAction): string {
  if (action.includes("flow")) return "flows";
  if (action.includes("template")) return "templates";
  if (action.includes("campaign")) return "campaigns";
  if (action.includes("rag") || action.includes("kb_")) return "knowledge";
  if (action.includes("image")) return "media";
  if (action.includes("summary") || action.includes("intent") || action.includes("lead")) return "inbox";
  if (action.includes("text") || action.includes("translation") || action.includes("rewrite")) return "inbox";
  return "ai";
}

function resolveUsageMetadata(action: AiTokenAction, metadata?: AiUsageMetadata): Required<AiUsageMetadata> {
  const promptTokens = toNonNegativeInteger(metadata?.promptTokens);
  const completionTokens = toNonNegativeInteger(metadata?.completionTokens);
  const totalTokens = toNonNegativeInteger(metadata?.totalTokens) || promptTokens + completionTokens;
  const model = metadata?.model?.trim() || env.OPENAI_CHAT_MODEL;

  return {
    workspaceId: metadata?.workspaceId ?? null,
    module: metadata?.module?.trim() || defaultModuleForAction(action),
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    estimatedCreditsReserved: toNonNegativeInteger(metadata?.estimatedCreditsReserved),
    status: metadata?.status ?? "finalized"
  };
}

// ── Core balance read ─────────────────────────────────────────────────────────

export async function getTokenBalance(userId: string): Promise<number> {
  const result = await pool.query<{ ai_token_balance: number }>(
    `SELECT ai_token_balance FROM users WHERE id = $1`,
    [userId]
  );
  return firstRow(result)?.ai_token_balance ?? 0;
}

// ── Gate check ────────────────────────────────────────────────────────────────

/**
 * Call BEFORE any AI work begins so the caller gets an immediate 402.
 */
export async function requireAiCredit(
  userId: string,
  action: AiTokenAction | string,
  requirement?: number | AiCreditRequirementInput
): Promise<void> {
  assertValidAction(action);
  const estimatedTokens =
    typeof requirement === "object" ? toNonNegativeInteger(requirement.estimatedTokens) : 0;
  assertMaxTokensForAction(action, estimatedTokens);
  const required = Math.max(
    1,
    Math.floor(
      typeof requirement === "number"
        ? requirement
        : requirement?.creditsRequired ?? estimateRequiredCredits(action, { estimatedTokens })
    )
  );
  const balance = await getTokenBalance(userId);
  if (balance - required < AI_CREDIT_GRACE_LIMIT) {
    throw new AiTokensDepletedError(balance);
  }

  if (HARD_GATED_ACTIONS.has(action as AiTokenAction) && balance <= AI_CREDIT_GRACE_LIMIT) {
    throw new AiTokensDepletedError(balance);
  }
}

// ── Central charge function ───────────────────────────────────────────────────

/**
 * chargeUser() — the ONE place to deduct AI credits.
 *
 * - Validates the action is known.
 * - Opens a transaction, locks the user row, deducts, inserts ledger.
 * - If referenceId is provided the ledger insert is idempotent (ON CONFLICT DO NOTHING),
 *   so retried requests cannot double-charge.
 * - Never throws on DB error for soft features — logs a warning and returns 0.
 *
 * @param userId      - user to charge
 * @param action      - must be a key in AI_TOKEN_COSTS
 * @param referenceId - stable id for the work unit (messageId, jobId, etc.)
 *                      supply this whenever the caller can be retried
 */
export async function chargeUser(
  userId: string,
  action: AiTokenAction,
  referenceIdOrMetadata?: string | AiUsageMetadata,
  maybeMetadata?: AiUsageMetadata
): Promise<{ balanceAfter: number }> {
  assertValidAction(action);
  const referenceId = typeof referenceIdOrMetadata === "string" ? referenceIdOrMetadata : undefined;
  const metadata = typeof referenceIdOrMetadata === "object" ? referenceIdOrMetadata : maybeMetadata;
  const resolvedMetadata = resolveUsageMetadata(action, metadata);
  const cost = Math.max(
    getCreditsForAction(action),
    estimateCreditsFromTokens(action, resolvedMetadata.totalTokens ?? 0)
  );
  const estimatedCostInr = estimateInrCost(
    resolvedMetadata.model,
    resolvedMetadata.promptTokens ?? 0,
    resolvedMetadata.completionTokens ?? 0
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the row so concurrent requests for this user's wallet queue here.
    const lockResult = await client.query<{ ai_token_balance: number; workspace_id: string | null }>(
      `SELECT ai_token_balance, workspace_id FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    const lockedUser = firstRow(lockResult);
    const current = lockedUser?.ai_token_balance ?? 0;
    const workspaceId = resolvedMetadata.workspaceId ?? lockedUser?.workspace_id ?? null;

    if (referenceId) {
      const existing = await client.query<{ balance_after: number }>(
        `SELECT balance_after
         FROM ai_token_ledger
         WHERE user_id = $1 AND reference_id = $2
         LIMIT 1`,
        [userId, referenceId]
      );
      if (firstRow(existing)) {
        await client.query("COMMIT");
        return { balanceAfter: current };
      }
    }

    if (current - cost < AI_CREDIT_GRACE_LIMIT) {
      await client.query("COMMIT");
      return { balanceAfter: current };
    }

    const newBalance = current - cost;

    await client.query(
      `UPDATE users SET ai_token_balance = $1 WHERE id = $2`,
      [newBalance, userId]
    );

    // Idempotent ledger insert: if the same referenceId already exists, skip
    if (referenceId) {
      await client.query(
        `INSERT INTO ai_token_ledger (
           user_id,
           workspace_id,
           amount,
           action_type,
           module,
           reference_id,
           balance_after,
           prompt_tokens,
           completion_tokens,
           total_tokens,
           model,
           estimated_cost_inr,
           estimated_credits_reserved,
           credits_deducted,
           status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (user_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`,
        [
          userId,
          workspaceId,
          -cost,
          action,
          resolvedMetadata.module,
          referenceId,
          newBalance,
          resolvedMetadata.promptTokens,
          resolvedMetadata.completionTokens,
          resolvedMetadata.totalTokens,
          resolvedMetadata.model,
          estimatedCostInr,
          resolvedMetadata.estimatedCreditsReserved,
          cost,
          resolvedMetadata.status
        ]
      );
    } else {
      await client.query(
        `INSERT INTO ai_token_ledger (
           user_id,
           workspace_id,
           amount,
           action_type,
           module,
           reference_id,
           balance_after,
           prompt_tokens,
           completion_tokens,
           total_tokens,
           model,
           estimated_cost_inr,
           estimated_credits_reserved,
           credits_deducted,
           status
         )
         VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          userId,
          workspaceId,
          -cost,
          action,
          resolvedMetadata.module,
          newBalance,
          resolvedMetadata.promptTokens,
          resolvedMetadata.completionTokens,
          resolvedMetadata.totalTokens,
          resolvedMetadata.model,
          estimatedCostInr,
          resolvedMetadata.estimatedCreditsReserved,
          cost,
          resolvedMetadata.status
        ]
      );
    }

    await client.query("COMMIT");
    return { balanceAfter: newBalance };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.warn(`[AiTokens] chargeUser failed user=${userId} action=${action}:`, err);
    return { balanceAfter: 0 };
  } finally {
    client.release();
  }
}

// ── Legacy alias (kept for callers that haven't migrated to chargeUser yet) ───
// chargeUser validates the action and is transactional — prefer it for new code.

/**
 * @deprecated Use chargeUser() instead. Kept for backward compatibility.
 */
export async function deductTokens(
  userId: string,
  action: AiTokenAction | string,
  cost: number,        // ignored — cost is sourced from AI_TOKEN_COSTS inside chargeUser
  referenceId?: string
): Promise<{ balanceAfter: number }> {
  // Validate action before delegating
  assertValidAction(action);
  // Cost parameter is ignored intentionally — chargeUser reads from AI_TOKEN_COSTS
  return chargeUser(userId as string, action as AiTokenAction, referenceId);
}

// ── Credit helpers ────────────────────────────────────────────────────────────

/**
 * Credit tokens in a transaction (plan activation, admin grant, top-up).
 * Balance is set or incremented depending on `mode`.
 *
 * mode "add"   — balance += amount  (top-up, admin grant)
 * mode "reset" — balance  = amount  (monthly reset, plan activation)
 */
async function creditTokensInternal(
  userId: string,
  action: string,
  amount: number,
  referenceId?: string,
  mode: "add" | "reset" = "add"
): Promise<{ balanceAfter: number }> {
  if (amount <= 0) return { balanceAfter: await getTokenBalance(userId) };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `SELECT ai_token_balance FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );

    const updateResult = await client.query<{ ai_token_balance: number }>(
      mode === "reset"
        ? `UPDATE users SET ai_token_balance = $1 WHERE id = $2 RETURNING ai_token_balance`
        : `UPDATE users SET ai_token_balance = ai_token_balance + $1 WHERE id = $2 RETURNING ai_token_balance`,
      [amount, userId]
    );
    const balanceAfter = firstRow(updateResult)?.ai_token_balance ?? amount;

    if (referenceId) {
      await client.query(
        `INSERT INTO ai_token_ledger (user_id, amount, action_type, reference_id, balance_after)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`,
        [userId, amount, action, referenceId, balanceAfter]
      );
    } else {
      await client.query(
        `INSERT INTO ai_token_ledger (user_id, amount, action_type, reference_id, balance_after)
         VALUES ($1, $2, $3, NULL, $4)`,
        [userId, amount, action, balanceAfter]
      );
    }

    await client.query("COMMIT");
    return { balanceAfter };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.warn("[AiTokens] credit failed", { userId, action }, err);
    return { balanceAfter: amount };
  } finally {
    client.release();
  }
}

export async function creditTokens(
  userId: string,
  action: string,
  amount: number,
  referenceId?: string
): Promise<{ balanceAfter: number }> {
  return creditTokensInternal(userId, action, amount, referenceId, "add");
}

/**
 * Reset balance to the plan's monthly quota.
 * Called on plan activation and monthly Razorpay renewal.
 */
export async function creditMonthlyTokens(
  userId: string,
  planCode: string,
  referenceId?: string
): Promise<{ balanceAfter: number }> {
  const quota = AI_TOKEN_PLAN_QUOTA[planCode] ?? AI_TOKEN_PLAN_QUOTA.trial;
  return creditTokensInternal(userId, "plan_monthly_reset", quota, referenceId, "reset");
}

/**
 * Credit signup free tokens for a brand-new user.
 */
export async function creditSignupTokens(userId: string): Promise<void> {
  const quota = AI_TOKEN_PLAN_QUOTA.trial;
  await creditTokensInternal(userId, "plan_signup_credit", quota, `signup-${userId}`, "add");
}

// ── Analytics ─────────────────────────────────────────────────────────────────

/**
 * AI credit status summary for the AI Credits page.
 */
export async function getTokenStatus(userId: string, planCode: string): Promise<{
  balance: number;
  planCode: string;
  monthlyQuota: number;
  canUseAiGeneration: boolean;
  isLow: boolean;
}> {
  const balance = await getTokenBalance(userId);
  const monthlyQuota = AI_TOKEN_PLAN_QUOTA[planCode] ?? AI_TOKEN_PLAN_QUOTA.trial;
  return {
    balance,
    planCode,
    monthlyQuota,
    canUseAiGeneration: balance > 0,
    isLow: balance > 0 && balance < Math.ceil(monthlyQuota * 0.1),
  };
}

/**
 * Paginated AI credit ledger for the AI Credits page (most recent first).
 */
export async function getTokenLedger(
  userId: string,
  limit = 50,
  before?: string
): Promise<Array<{
  id: string;
  amount: number;
  action_type: string;
  reference_id: string | null;
  balance_after: number;
  created_at: string;
}>> {
  const result = await pool.query(
    `SELECT id, amount, action_type, reference_id, balance_after, created_at
     FROM ai_token_ledger
     WHERE user_id = $1
       AND ($2::timestamptz IS NULL OR created_at < $2)
     ORDER BY created_at DESC
     LIMIT $3`,
    [userId, before ?? null, limit]
  );
  return result.rows;
}

/**
 * Usage grouped by action type for the last N days (debits only).
 * tokens_used is kept as a compatibility alias for older clients; values are AI credits.
 */
export async function getTokenUsageByAction(
  userId: string,
  days = 30
): Promise<Array<{ action_type: string; credits_used: number; tokens_used: number; calls: number }>> {
  const result = await pool.query(
    `SELECT
       action_type,
       ABS(SUM(amount))::int AS credits_used,
       ABS(SUM(amount))::int AS tokens_used,
       COUNT(*)::int         AS calls
     FROM ai_token_ledger
     WHERE user_id = $1
       AND amount < 0
       AND created_at >= NOW() - ($2 || ' days')::interval
     GROUP BY action_type
     ORDER BY credits_used DESC`,
    [userId, days]
  );
  return result.rows;
}

/**
 * Daily AI credit burn for the last N days.
 * tokens_used is kept as a compatibility alias for older clients; values are AI credits.
 * Returns one row per day; days with zero usage are omitted.
 */
export async function getTokenUsageByDay(
  userId: string,
  days = 30
): Promise<Array<{ day: string; credits_used: number; tokens_used: number; calls: number }>> {
  const result = await pool.query(
    `SELECT
       DATE_TRUNC('day', created_at)::date::text AS day,
       ABS(SUM(amount))::int                     AS credits_used,
       ABS(SUM(amount))::int                     AS tokens_used,
       COUNT(*)::int                             AS calls
     FROM ai_token_ledger
     WHERE user_id = $1
       AND amount < 0
       AND created_at >= NOW() - ($2 || ' days')::interval
     GROUP BY DATE_TRUNC('day', created_at)
     ORDER BY day ASC`,
    [userId, days]
  );
  return result.rows;
}

/**
 * ai-token-service.ts — AI credit / token ledger
 *
 * Design principles:
 *  1. Balance updates and ledger inserts are ALWAYS in the same transaction.
 *  2. Row-level locking (SELECT … FOR UPDATE) prevents race conditions under
 *     concurrent requests.
 *  3. Ledger rows with a reference_id are idempotent — duplicate charges for
 *     the same reference are silently ignored (UNIQUE constraint).
 *  4. Hard-gated features are blocked before any AI work starts (requireAiCredit).
 *  5. Soft features (chatbot, RAG, agent) are never blocked but still deducted.
 *
 * External callers should use chargeUser() instead of deductTokens() directly.
 */

import { firstRow } from "../db/sql-helpers.js";
import { pool } from "../db/pool.js";

// ── Action cost table ─────────────────────────────────────────────────────────
export const AI_TOKEN_COSTS = {
  chatbot_reply:        2,   // per inbound message handled by buildSalesReply
  rag_embed_query:      1,   // per knowledge retrieval (embed + vector search)
  kb_ingest_chunk:      1,   // per chunk stored during knowledge base ingestion
  template_generate:   10,   // POST /api/meta/templates/ai-generate
  onboarding_autofill: 10,   // POST /api/onboarding/autofill
  flow_draft_generate: 15,   // POST /api/flows/generate-draft
  ai_agent_flow:        3,   // per aiAgent flow-block execution / calendar booking parse
  image_analyze:        5,   // per inbound image analysed
  ai_text_assist:       3,   // per rewrite/translate in conversation editor
  ai_lead_summary:      5,   // per lead conversation summary generated
  ai_intent_classify:   1,   // per inbound message intent classification (LLM path)
} as const;

export type AiTokenAction = keyof typeof AI_TOKEN_COSTS;

// ── Monthly quota per plan ────────────────────────────────────────────────────
export const AI_TOKEN_PLAN_QUOTA: Record<string, number> = {
  trial:    50,
  starter:  500,
  pro:      2000,
  business: 10000,
};

// Hard-gated: creation features blocked at balance ≤ 0
const HARD_GATED_ACTIONS = new Set<AiTokenAction>([
  "template_generate",
  "flow_draft_generate",
  "onboarding_autofill",
  "kb_ingest_chunk",
]);

// ── Error types ───────────────────────────────────────────────────────────────
export class AiTokensDepletedError extends Error {
  readonly code = "ai_tokens_depleted";
  readonly balance: number;
  constructor(balance: number) {
    super("AI tokens depleted. Upgrade your plan or wait for the monthly reset.");
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
 * For hard-gated features: throw AiTokensDepletedError if balance ≤ 0.
 * For soft features (chatbot, RAG, agent, image): always passes through.
 * Call BEFORE any AI work begins so the caller gets an immediate 402.
 */
export async function requireAiCredit(userId: string, action: AiTokenAction | string): Promise<void> {
  assertValidAction(action);
  if (!HARD_GATED_ACTIONS.has(action as AiTokenAction)) return;
  const balance = await getTokenBalance(userId);
  if (balance <= 0) throw new AiTokensDepletedError(balance);
}

// ── Central charge function ───────────────────────────────────────────────────

/**
 * chargeUser() — the ONE place to deduct AI tokens.
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
  referenceId?: string
): Promise<{ balanceAfter: number }> {
  assertValidAction(action);
  const cost = AI_TOKEN_COSTS[action];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the row so concurrent requests queue up here
    const lockResult = await client.query<{ ai_token_balance: number }>(
      `SELECT ai_token_balance FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    const current = firstRow(lockResult)?.ai_token_balance ?? 0;
    const newBalance = current - cost;

    await client.query(
      `UPDATE users SET ai_token_balance = $1 WHERE id = $2`,
      [newBalance, userId]
    );

    // Idempotent ledger insert: if the same referenceId already exists, skip
    if (referenceId) {
      await client.query(
        `INSERT INTO ai_token_ledger (user_id, amount, action_type, reference_id, balance_after)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`,
        [userId, -cost, action, referenceId, newBalance]
      );
    } else {
      await client.query(
        `INSERT INTO ai_token_ledger (user_id, amount, action_type, reference_id, balance_after)
         VALUES ($1, $2, $3, NULL, $4)`,
        [userId, -cost, action, newBalance]
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
 * Token status summary for the AI Wallet page.
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
 * Paginated ledger for the AI Wallet page (most recent first).
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
 */
export async function getTokenUsageByAction(
  userId: string,
  days = 30
): Promise<Array<{ action_type: string; tokens_used: number; calls: number }>> {
  const result = await pool.query(
    `SELECT
       action_type,
       ABS(SUM(amount))::int AS tokens_used,
       COUNT(*)::int         AS calls
     FROM ai_token_ledger
     WHERE user_id = $1
       AND amount < 0
       AND created_at >= NOW() - ($2 || ' days')::interval
     GROUP BY action_type
     ORDER BY tokens_used DESC`,
    [userId, days]
  );
  return result.rows;
}

/**
 * Daily token burn for the last N days — use this to build usage charts.
 * Returns one row per day; days with zero usage are omitted.
 */
export async function getTokenUsageByDay(
  userId: string,
  days = 30
): Promise<Array<{ day: string; tokens_used: number; calls: number }>> {
  const result = await pool.query(
    `SELECT
       DATE_TRUNC('day', created_at)::date::text AS day,
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

import { pool } from "../db/pool.js";

// ── Token cost table ──────────────────────────────────────────────────────────
// Every AI action that calls OpenAI must have an entry here.
export const AI_TOKEN_COSTS = {
  chatbot_reply:       2,   // per inbound message handled by buildSalesReply
  rag_embed_query:     1,   // per knowledge retrieval (embed + vector search)
  kb_ingest_chunk:     1,   // per chunk stored during knowledge base ingestion
  template_generate:  10,   // POST /api/meta/templates/ai-generate
  onboarding_autofill: 10,  // POST /api/onboarding/autofill
  flow_draft_generate: 15,  // POST /api/flows/generate
  ai_agent_flow:        3,  // per aiAgent flow-block execution
  image_analyze:        5,  // per inbound image analysed
} as const;

export type AiTokenAction = keyof typeof AI_TOKEN_COSTS;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Atomically deduct `cost` tokens from the user's balance and append a ledger
 * row.  The deduction is a "soft" deduct — it allows the balance to go
 * negative.  Hard gating (rejecting calls when the balance is 0) is enforced
 * at the route / service layer using `checkBalance` or `requireTokens`.
 *
 * The ledger insert is fire-and-forget so a DB hiccup never blocks the AI
 * response path.
 */
export async function deductTokens(
  userId: string,
  action: AiTokenAction | string,
  cost: number,
  referenceId?: string
): Promise<{ balanceAfter: number }> {
  if (cost <= 0) return { balanceAfter: await getTokenBalance(userId) };

  let balanceAfter = 0;
  try {
    const result = await pool.query<{ ai_token_balance: number }>(
      `UPDATE users
       SET ai_token_balance = ai_token_balance - $1
       WHERE id = $2
       RETURNING ai_token_balance`,
      [cost, userId]
    );
    balanceAfter = result.rows[0]?.ai_token_balance ?? 0;
  } catch (err) {
    console.warn(`[AiTokens] deduct failed user=${userId} action=${action}:`, err);
    return { balanceAfter: 0 };
  }

  // Fire-and-forget ledger write — never block the caller
  pool.query(
    `INSERT INTO ai_token_ledger (user_id, amount, action_type, reference_id, balance_after)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, -cost, action, referenceId ?? null, balanceAfter]
  ).catch((err) =>
    console.warn(`[AiTokens] ledger insert failed user=${userId}:`, err)
  );

  return { balanceAfter };
}

/**
 * Credit tokens to a user (plan refill, top-up purchase, admin grant).
 */
export async function creditTokens(
  userId: string,
  action: string,
  amount: number,
  referenceId?: string
): Promise<{ balanceAfter: number }> {
  if (amount <= 0) return { balanceAfter: await getTokenBalance(userId) };

  let balanceAfter = 0;
  try {
    const result = await pool.query<{ ai_token_balance: number }>(
      `UPDATE users
       SET ai_token_balance = ai_token_balance + $1
       WHERE id = $2
       RETURNING ai_token_balance`,
      [amount, userId]
    );
    balanceAfter = result.rows[0]?.ai_token_balance ?? 0;
  } catch (err) {
    console.warn(`[AiTokens] credit failed user=${userId} action=${action}:`, err);
    return { balanceAfter: 0 };
  }

  pool.query(
    `INSERT INTO ai_token_ledger (user_id, amount, action_type, reference_id, balance_after)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, amount, action, referenceId ?? null, balanceAfter]
  ).catch((err) =>
    console.warn(`[AiTokens] ledger insert failed user=${userId}:`, err)
  );

  return { balanceAfter };
}

/**
 * Read the current token balance without modifying it.
 */
export async function getTokenBalance(userId: string): Promise<number> {
  const result = await pool.query<{ ai_token_balance: number }>(
    `SELECT ai_token_balance FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0]?.ai_token_balance ?? 0;
}

/**
 * Paginated ledger for the AI Wallet page.
 */
export async function getTokenLedger(
  userId: string,
  limit = 50,
  before?: string   // ISO timestamp cursor
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
 * Usage grouped by action type for the last N days.
 */
export async function getTokenUsageByAction(
  userId: string,
  days = 30
): Promise<Array<{ action_type: string; tokens_used: number; calls: number }>> {
  const result = await pool.query(
    `SELECT
       action_type,
       ABS(SUM(amount))::int    AS tokens_used,
       COUNT(*)::int            AS calls
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

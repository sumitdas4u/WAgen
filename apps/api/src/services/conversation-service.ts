import { pool } from "../db/pool.js";
import { clamp } from "../utils/index.js";
import type { Conversation } from "../types/models.js";
import { estimateInrCost, estimateUsdCost, normalizeModelName } from "./usage-cost-service.js";

function scoreMessage(text: string): number {
  const normalized = text.toLowerCase();

  const highIntentSignals = ["price", "pricing", "buy", "purchase", "subscribe", "book", "demo", "trial", "interested"];
  const objectionSignals = ["expensive", "later", "not now", "busy", "not interested"];

  let delta = 0;
  for (const token of highIntentSignals) {
    if (normalized.includes(token)) {
      delta += 12;
    }
  }

  for (const token of objectionSignals) {
    if (normalized.includes(token)) {
      delta -= 7;
    }
  }

  if (normalized.length > 120) {
    delta += 6;
  }

  return clamp(delta, -20, 40);
}

function stageFromScore(score: number): string {
  if (score >= 75) {
    return "hot";
  }
  if (score >= 40) {
    return "warm";
  }
  return "cold";
}

export async function getOrCreateConversation(userId: string, phoneNumber: string): Promise<Conversation> {
  const existing = await pool.query<Conversation>(
    `SELECT * FROM conversations WHERE user_id = $1 AND phone_number = $2`,
    [userId, phoneNumber]
  );

  if ((existing.rowCount ?? 0) > 0) {
    return existing.rows[0];
  }

  const created = await pool.query<Conversation>(
    `INSERT INTO conversations (user_id, phone_number, stage, score)
     VALUES ($1, $2, 'cold', 0)
     RETURNING *`,
    [userId, phoneNumber]
  );

  return created.rows[0];
}

export async function getConversationById(conversationId: string): Promise<Conversation | null> {
  const result = await pool.query<Conversation>(
    `SELECT *
     FROM conversations
     WHERE id = $1
     LIMIT 1`,
    [conversationId]
  );

  return result.rows[0] ?? null;
}

export async function trackInboundMessage(
  userId: string,
  phoneNumber: string,
  message: string,
  senderName?: string
): Promise<Conversation> {
  const conversation = await getOrCreateConversation(userId, phoneNumber);
  const delta = scoreMessage(message);
  const score = clamp(conversation.score + delta, 0, 100);
  const stage = stageFromScore(score);

  const updated = await pool.query<Conversation>(
    `UPDATE conversations
     SET score = $1,
         stage = $2,
         last_message = $3,
         last_message_at = NOW()
     WHERE id = $4
     RETURNING *`,
    [score, stage, message, conversation.id]
  );

  await pool.query(
    `INSERT INTO conversation_messages (conversation_id, direction, sender_name, message_text)
     VALUES ($1, 'inbound', $2, $3)`,
    [conversation.id, senderName ?? null, message]
  );

  return updated.rows[0];
}

export async function trackOutboundMessage(
  conversationId: string,
  message: string,
  usage?: {
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    aiModel?: string | null;
    retrievalChunks?: number | null;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO conversation_messages (
       conversation_id,
       direction,
       message_text,
       prompt_tokens,
       completion_tokens,
       total_tokens,
       ai_model,
       retrieval_chunks
     )
     VALUES ($1, 'outbound', $2, $3, $4, $5, $6, $7)`,
    [
      conversationId,
      message,
      usage?.promptTokens ?? null,
      usage?.completionTokens ?? null,
      usage?.totalTokens ?? null,
      usage?.aiModel ?? null,
      usage?.retrievalChunks ?? null
    ]
  );

  await pool.query(
    `UPDATE conversations
     SET last_message = $1,
         last_message_at = NOW(),
         last_ai_reply_at = NOW()
     WHERE id = $2`,
    [message, conversationId]
  );
}

export async function listConversations(userId: string): Promise<Conversation[]> {
  const result = await pool.query<Conversation & { contact_name: string | null }>(
    `SELECT
       c.*,
       (
         SELECT cm.sender_name
         FROM conversation_messages cm
         WHERE cm.conversation_id = c.id
           AND cm.direction = 'inbound'
           AND cm.sender_name IS NOT NULL
         ORDER BY cm.created_at DESC
         LIMIT 1
       ) AS contact_name
     FROM conversations c
     WHERE c.user_id = $1
     ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC`,
    [userId]
  );

  return result.rows;
}

export interface ConversationMessage {
  id: string;
  direction: "inbound" | "outbound";
  sender_name: string | null;
  message_text: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  ai_model: string | null;
  retrieval_chunks: number | null;
  created_at: string;
}

export async function listConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
  const result = await pool.query<ConversationMessage>(
    `SELECT
       id,
       direction,
       sender_name,
       message_text,
       prompt_tokens,
       completion_tokens,
       total_tokens,
       ai_model,
       retrieval_chunks,
       created_at
     FROM conversation_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversationId]
  );

  return result.rows;
}

export async function setManualTakeover(userId: string, conversationId: string, enabled: boolean): Promise<void> {
  await pool.query(
    `UPDATE conversations
     SET manual_takeover = $1
     WHERE id = $2 AND user_id = $3`,
    [enabled, conversationId, userId]
  );
}

export async function setConversationAIPaused(userId: string, conversationId: string, paused: boolean): Promise<void> {
  await pool.query(
    `UPDATE conversations
     SET ai_paused = $1
     WHERE id = $2 AND user_id = $3`,
    [paused, conversationId, userId]
  );
}

export async function getDashboardOverview(userId: string): Promise<{
  leadsToday: number;
  hotLeads: number;
  warmLeads: number;
  closedDeals: number;
}> {
  const result = await pool.query<{
    leads_today: string;
    hot_leads: string;
    warm_leads: string;
    closed_deals: string;
  }>(
    `SELECT
      COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) AS leads_today,
      COUNT(*) FILTER (WHERE stage = 'hot') AS hot_leads,
      COUNT(*) FILTER (WHERE stage = 'warm') AS warm_leads,
      COUNT(*) FILTER (WHERE stage = 'closed') AS closed_deals
     FROM conversations
     WHERE user_id = $1`,
    [userId]
  );

  const row = result.rows[0];

  return {
    leadsToday: Number(row?.leads_today ?? 0),
    hotLeads: Number(row?.hot_leads ?? 0),
    warmLeads: Number(row?.warm_leads ?? 0),
    closedDeals: Number(row?.closed_deals ?? 0)
  };
}

export async function getConversationHistoryForPrompt(
  conversationId: string,
  limit = 10
): Promise<Array<{ direction: "inbound" | "outbound"; message_text: string }>> {
  const result = await pool.query<{
    direction: "inbound" | "outbound";
    message_text: string;
  }>(
    `SELECT direction, message_text
     FROM conversation_messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [conversationId, limit]
  );

  return result.rows.reverse();
}

export interface UsageMessageCost {
  message_id: string;
  conversation_id: string;
  conversation_phone: string;
  ai_model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  estimated_cost_inr: number;
  created_at: string;
}

export interface UsageDailyCost {
  day: string;
  messages: number;
  total_tokens: number;
  estimated_cost_usd: number;
  estimated_cost_inr: number;
}

export interface UsageAnalytics {
  range_days: number;
  messages: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  estimated_cost_inr: number;
  by_model: Array<{
    ai_model: string;
    messages: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
    estimated_cost_inr: number;
  }>;
  daily: UsageDailyCost[];
  recent_messages: UsageMessageCost[];
}

export async function getUsageAnalytics(
  userId: string,
  options?: { days?: number; limit?: number }
): Promise<UsageAnalytics> {
  const days = Math.max(1, Math.min(120, options?.days ?? 30));
  const limit = Math.max(20, Math.min(500, options?.limit ?? 200));

  const rows = await pool.query<{
    message_id: string;
    conversation_id: string;
    conversation_phone: string;
    ai_model: string | null;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
    created_at: string;
  }>(
    `SELECT
       cm.id AS message_id,
       c.id AS conversation_id,
       c.phone_number AS conversation_phone,
       cm.ai_model,
       cm.prompt_tokens,
       cm.completion_tokens,
       cm.total_tokens,
       cm.created_at
     FROM conversation_messages cm
     INNER JOIN conversations c ON c.id = cm.conversation_id
     WHERE c.user_id = $1
       AND cm.direction = 'outbound'
       AND cm.total_tokens IS NOT NULL
       AND cm.created_at >= NOW() - ($2::text || ' days')::interval
     ORDER BY cm.created_at DESC
     LIMIT $3`,
    [userId, String(days), limit]
  );

  const recentMessages: UsageMessageCost[] = rows.rows.map((row) => {
    const promptTokens = Number(row.prompt_tokens ?? 0);
    const completionTokens = Number(row.completion_tokens ?? 0);
    const totalTokens =
      Number(row.total_tokens ?? 0) || promptTokens + completionTokens;
    const model = normalizeModelName(row.ai_model);

    return {
      message_id: row.message_id,
      conversation_id: row.conversation_id,
      conversation_phone: row.conversation_phone,
      ai_model: model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      estimated_cost_usd: estimateUsdCost(model, promptTokens, completionTokens),
      estimated_cost_inr: estimateInrCost(model, promptTokens, completionTokens),
      created_at: row.created_at
    };
  });

  const summary = recentMessages.reduce(
    (acc, row) => {
      acc.messages += 1;
      acc.prompt_tokens += row.prompt_tokens;
      acc.completion_tokens += row.completion_tokens;
      acc.total_tokens += row.total_tokens;
      acc.estimated_cost_usd += row.estimated_cost_usd;
      acc.estimated_cost_inr += row.estimated_cost_inr;
      return acc;
    },
    {
      messages: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      estimated_cost_usd: 0,
      estimated_cost_inr: 0
    }
  );

  const modelMap = new Map<
    string,
    {
      ai_model: string;
      messages: number;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      estimated_cost_usd: number;
      estimated_cost_inr: number;
    }
  >();

  const dayMap = new Map<
    string,
    { day: string; messages: number; total_tokens: number; estimated_cost_usd: number; estimated_cost_inr: number }
  >();

  for (const row of recentMessages) {
    const modelBucket = modelMap.get(row.ai_model) ?? {
      ai_model: row.ai_model,
      messages: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      estimated_cost_usd: 0,
      estimated_cost_inr: 0
    };

    modelBucket.messages += 1;
    modelBucket.prompt_tokens += row.prompt_tokens;
    modelBucket.completion_tokens += row.completion_tokens;
    modelBucket.total_tokens += row.total_tokens;
    modelBucket.estimated_cost_usd += row.estimated_cost_usd;
    modelBucket.estimated_cost_inr += row.estimated_cost_inr;
    modelMap.set(row.ai_model, modelBucket);

    const day = new Date(row.created_at).toISOString().slice(0, 10);
    const dayBucket = dayMap.get(day) ?? {
      day,
      messages: 0,
      total_tokens: 0,
      estimated_cost_usd: 0,
      estimated_cost_inr: 0
    };
    dayBucket.messages += 1;
    dayBucket.total_tokens += row.total_tokens;
    dayBucket.estimated_cost_usd += row.estimated_cost_usd;
    dayBucket.estimated_cost_inr += row.estimated_cost_inr;
    dayMap.set(day, dayBucket);
  }

  return {
    range_days: days,
    ...summary,
    by_model: [...modelMap.values()].sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd),
    daily: [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
    recent_messages: recentMessages
  };
}

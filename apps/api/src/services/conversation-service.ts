import { pool } from "../db/pool.js";
import { clamp } from "../utils/index.js";
import type { Conversation } from "../types/models.js";

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

export async function trackOutboundMessage(conversationId: string, message: string): Promise<void> {
  await pool.query(
    `INSERT INTO conversation_messages (conversation_id, direction, message_text)
     VALUES ($1, 'outbound', $2)`,
    [conversationId, message]
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
  const result = await pool.query<Conversation>(
    `SELECT * FROM conversations
     WHERE user_id = $1
     ORDER BY last_message_at DESC NULLS LAST, created_at DESC`,
    [userId]
  );

  return result.rows;
}

export interface ConversationMessage {
  id: string;
  direction: "inbound" | "outbound";
  sender_name: string | null;
  message_text: string;
  created_at: string;
}

export async function listConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
  const result = await pool.query<ConversationMessage>(
    `SELECT id, direction, sender_name, message_text, created_at
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

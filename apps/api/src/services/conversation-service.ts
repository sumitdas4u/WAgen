import { pool, withTransaction } from "../db/pool.js";
import { clamp } from "../utils/index.js";
import type { Conversation } from "../types/models.js";
import { estimateInrCost, estimateUsdCost, normalizeModelName } from "./usage-cost-service.js";
import { openAIService } from "./openai-service.js";

function scoreMessageBase(text: string): number {
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

function extractSearchTerms(text: string): string {
  const tokens = (text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])
    .filter((token) => !["the", "and", "for", "with", "from", "that", "have", "this", "what", "when", "where"].includes(token));
  const unique = Array.from(new Set(tokens)).slice(0, 14);
  return unique.join(" ");
}

async function scoreKnowledgeIntent(userId: string, text: string): Promise<number> {
  const terms = extractSearchTerms(text);
  if (!terms) {
    return 0;
  }

  const result = await pool.query<{ hits: string }>(
    `SELECT COUNT(*)::text AS hits
     FROM knowledge_base
     WHERE user_id = $1
       AND to_tsvector('simple', content_chunk) @@ plainto_tsquery('simple', $2)`,
    [userId, terms]
  );

  const hits = Number(result.rows[0]?.hits ?? 0);
  if (hits >= 5) {
    return 14;
  }
  if (hits >= 2) {
    return 8;
  }
  if (hits >= 1) {
    return 4;
  }
  return 0;
}

function scoreFromRetrievalChunks(retrievalChunks: number | null | undefined): number {
  if (!retrievalChunks || retrievalChunks <= 0) {
    return 0;
  }
  if (retrievalChunks >= 4) {
    return 5;
  }
  if (retrievalChunks >= 2) {
    return 3;
  }
  return 2;
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

export async function reconcileConversationPhone(
  userId: string,
  previousPhoneNumber: string,
  canonicalPhoneNumber: string
): Promise<void> {
  const previous = previousPhoneNumber.replace(/\D/g, "");
  const canonical = canonicalPhoneNumber.replace(/\D/g, "");

  if (!previous || !canonical || previous === canonical) {
    return;
  }

  await withTransaction(async (client) => {
    const sourceResult = await client.query<Conversation>(
      `SELECT * FROM conversations
       WHERE user_id = $1 AND phone_number = $2
       LIMIT 1`,
      [userId, previous]
    );
    const source = sourceResult.rows[0];
    if (!source) {
      return;
    }

    const targetResult = await client.query<Conversation>(
      `SELECT * FROM conversations
       WHERE user_id = $1 AND phone_number = $2
       LIMIT 1`,
      [userId, canonical]
    );
    const target = targetResult.rows[0];

    if (!target) {
      await client.query(
        `UPDATE conversations
         SET phone_number = $1
         WHERE id = $2`,
        [canonical, source.id]
      );
      return;
    }

    if (target.id === source.id) {
      return;
    }

    await client.query(
      `UPDATE conversation_messages
       SET conversation_id = $1
       WHERE conversation_id = $2`,
      [target.id, source.id]
    );

    await client.query(
      `INSERT INTO lead_summaries (conversation_id, summary_text, source_last_message_at, model, updated_at)
       SELECT $1, ls.summary_text, ls.source_last_message_at, ls.model, ls.updated_at
       FROM lead_summaries ls
       WHERE ls.conversation_id = $2
       ON CONFLICT (conversation_id) DO UPDATE SET
         summary_text = CASE
           WHEN lead_summaries.updated_at >= EXCLUDED.updated_at THEN lead_summaries.summary_text
           ELSE EXCLUDED.summary_text
         END,
         source_last_message_at = GREATEST(
           lead_summaries.source_last_message_at,
           EXCLUDED.source_last_message_at
         ),
         model = CASE
           WHEN lead_summaries.updated_at >= EXCLUDED.updated_at THEN lead_summaries.model
           ELSE EXCLUDED.model
         END,
         updated_at = GREATEST(lead_summaries.updated_at, EXCLUDED.updated_at)`,
      [target.id, source.id]
    );

    const targetLastMessageAt = target.last_message_at ? new Date(target.last_message_at).getTime() : 0;
    const sourceLastMessageAt = source.last_message_at ? new Date(source.last_message_at).getTime() : 0;
    const useSourceLastMessage = sourceLastMessageAt > targetLastMessageAt;
    const mergedLastMessage = useSourceLastMessage ? source.last_message : target.last_message;
    const mergedLastMessageAt = useSourceLastMessage ? source.last_message_at : target.last_message_at;

    const targetLastAiReplyAt = target.last_ai_reply_at ? new Date(target.last_ai_reply_at).getTime() : 0;
    const sourceLastAiReplyAt = source.last_ai_reply_at ? new Date(source.last_ai_reply_at).getTime() : 0;
    const mergedLastAiReplyAt =
      sourceLastAiReplyAt > targetLastAiReplyAt ? source.last_ai_reply_at : target.last_ai_reply_at;

    const mergedScore = Math.max(target.score, source.score);

    await client.query(
      `UPDATE conversations
       SET score = $1,
           stage = $2,
           last_message = $3,
           last_message_at = $4,
           last_ai_reply_at = $5
       WHERE id = $6`,
      [mergedScore, stageFromScore(mergedScore), mergedLastMessage, mergedLastMessageAt, mergedLastAiReplyAt, target.id]
    );

    await client.query(`DELETE FROM lead_summaries WHERE conversation_id = $1`, [source.id]);
    await client.query(`DELETE FROM conversations WHERE id = $1`, [source.id]);
  });
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
  const [intentDelta, knowledgeDelta] = await Promise.all([
    Promise.resolve(scoreMessageBase(message)),
    scoreKnowledgeIntent(userId, message)
  ]);
  const delta = intentDelta + knowledgeDelta;
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

  const retrievalDelta = scoreFromRetrievalChunks(usage?.retrievalChunks);
  await pool.query(
    `UPDATE conversations
     SET last_message = $1,
         last_message_at = NOW(),
         last_ai_reply_at = NOW(),
         score = LEAST(100, GREATEST(0, score + $3)),
         stage = CASE
           WHEN LEAST(100, GREATEST(0, score + $3)) >= 75 THEN 'hot'
           WHEN LEAST(100, GREATEST(0, score + $3)) >= 40 THEN 'warm'
           ELSE 'cold'
         END
     WHERE id = $2`,
    [message, conversationId, retrievalDelta]
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

export interface LeadConversation extends Conversation {
  contact_name: string | null;
  ai_summary: string;
  summary_status: "ready" | "missing" | "stale";
  summary_updated_at: string | null;
}

function fallbackLeadSummary(
  conversation: { stage: string; score: number; last_message: string | null },
  messages: Array<{ direction: "inbound" | "outbound"; message_text: string }>
): string {
  const latestInbound = [...messages].reverse().find((item) => item.direction === "inbound")?.message_text ?? "";
  const latestOutbound = [...messages].reverse().find((item) => item.direction === "outbound")?.message_text ?? "";
  const userNeed = latestInbound ? latestInbound.slice(0, 180) : conversation.last_message?.slice(0, 180) ?? "No clear intent yet.";
  const nextStep = latestOutbound
    ? `Continue with follow-up around: ${latestOutbound.slice(0, 120)}`
    : "Ask one clarifying question and offer next action.";
  return `Stage ${conversation.stage} (score ${conversation.score}). Customer asked: ${userNeed}. ${nextStep}`;
}

async function generateLeadSummary(
  conversation: { stage: string; score: number; phone_number: string; last_message: string | null },
  messages: Array<{ direction: "inbound" | "outbound"; message_text: string; created_at: string }>
): Promise<{ summary: string; model: string | null }> {
  const clipped = messages
    .slice(-10)
    .map((item) => `${item.direction === "inbound" ? "Customer" : "Agent"}: ${item.message_text.replace(/\s+/g, " ").trim().slice(0, 180)}`)
    .join("\n");

  if (!clipped) {
    return {
      summary: fallbackLeadSummary(conversation, []),
      model: null
    };
  }

  if (!openAIService.isConfigured()) {
    return {
      summary: fallbackLeadSummary(conversation, messages),
      model: null
    };
  }

  const systemPrompt = [
    "You summarize customer lead conversations for CRM teams.",
    "Return plain text only.",
    "Keep response under 70 words.",
    "Include: intent, objections/risk, and next best action."
  ].join("\n");
  const userPrompt = [
    `Lead stage: ${conversation.stage}`,
    `Lead score: ${conversation.score}`,
    `Phone: ${conversation.phone_number}`,
    "Conversation:",
    clipped
  ].join("\n");

  try {
    const response = await openAIService.generateReply(systemPrompt, userPrompt);
    return { summary: response.content, model: response.model };
  } catch {
    return {
      summary: fallbackLeadSummary(conversation, messages),
      model: null
    };
  }
}

async function getRecentMessagesForSummary(
  conversationId: string,
  limit = 10
): Promise<Array<{ direction: "inbound" | "outbound"; message_text: string; created_at: string }>> {
  const result = await pool.query<{
    direction: "inbound" | "outbound";
    message_text: string;
    created_at: string;
  }>(
    `SELECT direction, message_text, created_at
     FROM conversation_messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [conversationId, limit]
  );

  return result.rows.reverse();
}

async function upsertLeadSummary(
  conversationId: string,
  summary: string,
  sourceLastMessageAt: string | null,
  model: string | null
): Promise<void> {
  await pool.query(
    `INSERT INTO lead_summaries (conversation_id, summary_text, source_last_message_at, model, updated_at)
     VALUES ($1, $2, $3::timestamptz, $4, NOW())
     ON CONFLICT (conversation_id)
     DO UPDATE SET
       summary_text = EXCLUDED.summary_text,
       source_last_message_at = EXCLUDED.source_last_message_at,
       model = EXCLUDED.model,
       updated_at = NOW()`,
    [conversationId, summary, sourceLastMessageAt, model]
  );
}

type LeadSummaryRow = Conversation & {
  contact_name: string | null;
  ai_summary: string | null;
  summary_source_last_message_at: string | null;
  summary_updated_at: string | null;
};

function getLeadSummaryStatus(row: LeadSummaryRow): "ready" | "missing" | "stale" {
  const hasSummary = typeof row.ai_summary === "string" && row.ai_summary.trim().length > 0;
  if (!hasSummary) {
    return "missing";
  }

  const lastMessageAt = row.last_message_at ? new Date(row.last_message_at).getTime() : 0;
  const summaryForMessageAt = row.summary_source_last_message_at
    ? new Date(row.summary_source_last_message_at).getTime()
    : 0;
  if (summaryForMessageAt < lastMessageAt) {
    return "stale";
  }

  return "ready";
}

async function listLeadSummaryRows(userId: string, limit: number): Promise<LeadSummaryRow[]> {
  return pool.query<LeadSummaryRow>(
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
       ) AS contact_name,
       ls.summary_text AS ai_summary,
       ls.source_last_message_at::text AS summary_source_last_message_at,
       ls.updated_at::text AS summary_updated_at
     FROM conversations c
     LEFT JOIN lead_summaries ls ON ls.conversation_id = c.id
     WHERE c.user_id = $1
     ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
     LIMIT $2`,
    [userId, limit]
  ).then((result) => result.rows);
}

export async function listLeadsWithSummary(userId: string, limit = 250): Promise<LeadConversation[]> {
  const clampedLimit = Math.max(1, Math.min(500, limit));
  const rows = await listLeadSummaryRows(userId, clampedLimit);
  return rows.map((row) => ({
    ...row,
    contact_name: row.contact_name,
    ai_summary: row.ai_summary?.trim() || "",
    summary_status: getLeadSummaryStatus(row),
    summary_updated_at: row.summary_updated_at
  }));
}

export async function summarizeLeadConversations(
  userId: string,
  options?: { limit?: number; forceAll?: boolean }
): Promise<{ processed: number; updated: number; skipped: number; failed: number }> {
  const clampedLimit = Math.max(1, Math.min(500, options?.limit ?? 250));
  const rows = await listLeadSummaryRows(userId, clampedLimit);

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const status = getLeadSummaryStatus(row);
    const shouldProcess = options?.forceAll ? true : status !== "ready";
    if (!shouldProcess) {
      skipped += 1;
      continue;
    }

    processed += 1;
    try {
      const history = await getRecentMessagesForSummary(row.id, 10);
      const generated = await generateLeadSummary(row, history);
      const summary = generated.summary.trim() || fallbackLeadSummary(row, history);
      await upsertLeadSummary(row.id, summary, row.last_message_at, generated.model);
      updated += 1;
    } catch {
      failed += 1;
    }
  }

  return { processed, updated, skipped, failed };
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

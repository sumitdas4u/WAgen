import { pool, withTransaction } from "../db/pool.js";
import { firstRow, requireRow } from "../db/sql-helpers.js";
import { fanoutEvent } from "./event-fanout-service.js";
import { realtimeHub } from "./realtime-hub.js";
import { clamp } from "../utils/index.js";
import type { AgentChannelType, Conversation, ConversationKind } from "../types/models.js";
import {
  upsertConversationInsight,
  deriveSentiment,
  type InsightType
} from "./conversation-insight-service.js";
import { estimateInrCost, estimateUsdCost, normalizeModelName } from "./usage-cost-service.js";
import { aiService } from "./ai-service.js";
import { chargeUser } from "./ai-token-service.js";
import { createAgentNotification } from "./agent-notification-service.js";
import { resolveAgentProfileForChannel, type AgentProfileRecord } from "./agent-profile-service.js";
import { extractCapturedProfileDetails, reconcileContactPhone, syncConversationContact } from "./contacts-service.js";
import { isWidgetVisitorConnected } from "./widget-connection-registry.js";
import {
  deriveRendererMessageType,
  type FlowMessagePayload,
  validateFlowMessagePayload
} from "./outbound-message-types.js";

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

  const hits = Number(firstRow(result)?.hits ?? 0);
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

const LEAD_KIND_KEYWORDS: Record<ConversationKind, string[]> = {
  lead: [
    "price",
    "pricing",
    "cost",
    "buy",
    "purchase",
    "plan",
    "quote",
    "trial",
    "demo",
    "interested",
    "subscribe"
  ],
  feedback: [
    "feedback",
    "review",
    "rating",
    "suggestion",
    "improve",
    "feature request",
    "experience",
    "recommendation"
  ],
  complaint: [
    "complaint",
    "issue",
    "problem",
    "delay",
    "bad",
    "angry",
    "refund",
    "cancel",
    "not working",
    "poor support",
    "worst"
  ],
  other: []
};

const KIND_PRIORITY_DELTA: Record<ConversationKind, number> = {
  lead: 8,
  feedback: 2,
  complaint: 12,
  other: 0
};

function inferKindFromHeuristics(
  message: string,
  objectiveType: AgentProfileRecord["objectiveType"] | null
): { kind: ConversationKind; confidence: number; ambiguous: boolean } {
  const normalized = message.toLowerCase();
  const scores: Record<ConversationKind, number> = {
    lead: 0,
    feedback: 0,
    complaint: 0,
    other: 0
  };

  for (const [kind, keywords] of Object.entries(LEAD_KIND_KEYWORDS) as Array<[ConversationKind, string[]]>) {
    for (const keyword of keywords) {
      if (normalized.includes(keyword)) {
        scores[kind] += 2;
      }
    }
  }

  if (message.length > 120) {
    scores.lead += 1;
    scores.feedback += 1;
  }

  if (objectiveType && objectiveType !== "hybrid") {
    scores[objectiveType] += 2;
  }

  const sorted = (Object.entries(scores) as Array<[ConversationKind, number]>).sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  const second = sorted[1];

  if (!top || top[1] <= 0) {
    return { kind: objectiveType && objectiveType !== "hybrid" ? objectiveType : "lead", confidence: 46, ambiguous: true };
  }

  const confidence = clamp(54 + top[1] * 10 - (second?.[1] ?? 0) * 6, 35, 94);
  return { kind: top[0], confidence, ambiguous: top[1] - (second?.[1] ?? 0) <= 1 };
}

function parseClassificationKind(value: unknown): ConversationKind | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "lead" || normalized === "feedback" || normalized === "complaint" || normalized === "other") {
    return normalized;
  }
  return null;
}

async function classifyInboundMessage(input: {
  message: string;
  agentProfile: AgentProfileRecord | null;
  userId?: string;
}): Promise<{ kind: ConversationKind; confidence: number }> {
  const heuristic = inferKindFromHeuristics(input.message, input.agentProfile?.objectiveType ?? null);

  const shouldUseLlm =
    aiService.isConfigured() &&
    input.message.trim().length >= 8 &&
    (heuristic.ambiguous || input.message.length >= 160);

  if (!shouldUseLlm) {
    return { kind: heuristic.kind, confidence: heuristic.confidence };
  }

  try {
    const payload = await aiService.generateJson(
      [
        "Classify customer chat intent.",
        "Return valid JSON only.",
        "Schema: {\"kind\":\"lead|feedback|complaint|other\",\"confidence\":number}.",
        "confidence must be integer from 0 to 100."
      ].join("\n"),
      [
        `Agent objective: ${input.agentProfile?.objectiveType ?? "hybrid"}`,
        `Agent task description: ${input.agentProfile?.taskDescription ?? "N/A"}`,
        `Customer message: ${input.message}`
      ].join("\n")
    );

    const kind = parseClassificationKind(payload.kind);
    if (!kind) {
      return { kind: heuristic.kind, confidence: heuristic.confidence };
    }

    const confidenceRaw = Number(payload.confidence);
    const confidence = Number.isFinite(confidenceRaw)
      ? clamp(Math.round(confidenceRaw), 20, 99)
      : heuristic.confidence;

    if (input.userId) void chargeUser(input.userId, "ai_intent_classify");
    return { kind, confidence };
  } catch {
    return { kind: heuristic.kind, confidence: heuristic.confidence };
  }
}

export async function getOrCreateConversation(
  userId: string,
  phoneNumber: string,
  options?: {
    channelType?: AgentChannelType;
    channelLinkedNumber?: string | null;
    assignedAgentProfileId?: string | null;
  }
): Promise<Conversation> {
  const existing = await pool.query<Conversation>(
    `SELECT * FROM conversations WHERE user_id = $1 AND phone_number = $2`,
    [userId, phoneNumber]
  );

  const existingRow = firstRow(existing);
  if (existingRow) {
    const row = existingRow;
    const nextChannelType = options?.channelType ?? row.channel_type ?? "qr";
    const nextChannelLinkedNumber = options?.channelLinkedNumber ?? row.channel_linked_number ?? null;
    const nextAssignedAgentId = options?.assignedAgentProfileId ?? row.assigned_agent_profile_id ?? null;

    if (
      row.channel_type !== nextChannelType ||
      row.channel_linked_number !== nextChannelLinkedNumber ||
      row.assigned_agent_profile_id !== nextAssignedAgentId
    ) {
      const updated = await pool.query<Conversation>(
        `UPDATE conversations
         SET channel_type = $1,
             channel_linked_number = $2,
             assigned_agent_profile_id = $3
         WHERE id = $4
         RETURNING *`,
        [nextChannelType, nextChannelLinkedNumber, nextAssignedAgentId, row.id]
      );
      return firstRow(updated) ?? row;
    }

    return row;
  }

  const created = await pool.query<Conversation>(
    `INSERT INTO conversations (
       user_id,
       phone_number,
       lead_kind,
       classification_confidence,
       channel_type,
       channel_linked_number,
       assigned_agent_profile_id,
       stage,
       score
     )
     VALUES ($1, $2, 'lead', 50, $3, $4, $5, 'cold', 0)
     RETURNING *`,
    [
      userId,
      phoneNumber,
      options?.channelType ?? "qr",
      options?.channelLinkedNumber ?? null,
      options?.assignedAgentProfileId ?? null
    ]
  );

  return requireRow(created, "Expected conversation row to be created");
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
    const source = firstRow(sourceResult);
    if (!source) {
      return;
    }

    const targetResult = await client.query<Conversation>(
      `SELECT * FROM conversations
       WHERE user_id = $1 AND phone_number = $2
       LIMIT 1`,
      [userId, canonical]
    );
    const target = firstRow(targetResult);

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
    const mergedKindPriority = Math.max(
      KIND_PRIORITY_DELTA[target.lead_kind ?? "lead"] ?? 0,
      KIND_PRIORITY_DELTA[source.lead_kind ?? "lead"] ?? 0
    );
    const mergedKind =
      (Object.entries(KIND_PRIORITY_DELTA).find(([, weight]) => weight === mergedKindPriority)?.[0] as
        | ConversationKind
        | undefined) ?? target.lead_kind ?? "lead";

    const mergedClassificationConfidence = Math.max(
      Number(target.classification_confidence ?? 0),
      Number(source.classification_confidence ?? 0)
    );

    const mergedChannelType = target.channel_type || source.channel_type || "qr";
    const mergedChannelLinkedNumber = target.channel_linked_number || source.channel_linked_number || null;
    const mergedAssignedAgentProfileId = target.assigned_agent_profile_id || source.assigned_agent_profile_id || null;
    const mergedLastClassifiedAt = target.last_classified_at || source.last_classified_at || null;

    await client.query(
      `UPDATE conversations
       SET score = $1,
           stage = $2,
           lead_kind = $3,
           classification_confidence = $4,
           channel_type = $5,
           channel_linked_number = $6,
           assigned_agent_profile_id = $7,
           last_message = $8,
           last_message_at = $9,
           last_ai_reply_at = $10,
           last_classified_at = $11
       WHERE id = $12`,
      [
        mergedScore,
        stageFromScore(mergedScore),
        mergedKind,
        mergedClassificationConfidence,
        mergedChannelType,
        mergedChannelLinkedNumber,
        mergedAssignedAgentProfileId,
        mergedLastMessage,
        mergedLastMessageAt,
        mergedLastAiReplyAt,
        mergedLastClassifiedAt,
        target.id
      ]
    );

    await client.query(`DELETE FROM lead_summaries WHERE conversation_id = $1`, [source.id]);
    await client.query(`DELETE FROM conversations WHERE id = $1`, [source.id]);
  });

  await reconcileContactPhone(userId, previous, canonical);
}

export async function getConversationById(conversationId: string): Promise<Conversation | null> {
  const result = await pool.query<Conversation>(
    `SELECT *
     FROM conversations
     WHERE id = $1
     LIMIT 1`,
    [conversationId]
  );

  return firstRow(result);
}

export async function getConversationForUser(
  userId: string,
  conversationId: string
): Promise<
  | (Conversation & {
      contact_name: string | null;
      contact_phone: string | null;
      contact_email: string | null;
      assigned_agent_name: string | null;
      unread_count: number;
      visitor_online: boolean;
    })
  | null
> {
  const result = await pool.query<
    Conversation & {
      contact_name: string | null;
      contact_phone: string | null;
      contact_email: string | null;
      assigned_agent_name: string | null;
      unread_count: number;
    }
  >(
    `SELECT
       c.*,
       COALESCE(ct.contact_type, c.lead_kind) AS lead_kind,
       ap.name AS assigned_agent_name,
       COALESCE(crs.unread_count, 0) AS unread_count,
       COALESCE(
         ct.display_name,
         (
           SELECT cm.sender_name
           FROM conversation_messages cm
           WHERE cm.conversation_id = c.id
             AND cm.direction = 'inbound'
             AND cm.sender_name IS NOT NULL
           ORDER BY cm.created_at DESC
           LIMIT 1
         ),
         (
           SELECT (regexp_match(cm.message_text, 'Name=([^,]+)'))[1]
           FROM conversation_messages cm
           WHERE cm.conversation_id = c.id
             AND cm.direction = 'inbound'
             AND cm.message_text LIKE 'Lead details captured:%'
           ORDER BY cm.created_at DESC
           LIMIT 1
         )
       ) AS contact_name,
       COALESCE(
         ct.phone_number,
         (
           SELECT (regexp_match(cm.message_text, 'Phone=([0-9]{8,15})'))[1]
           FROM conversation_messages cm
           WHERE cm.conversation_id = c.id
             AND cm.direction = 'inbound'
             AND cm.message_text LIKE 'Lead details captured:%'
           ORDER BY cm.created_at DESC
           LIMIT 1
         ),
         c.phone_number
       ) AS contact_phone,
       COALESCE(
         ct.email,
         (
           SELECT (regexp_match(cm.message_text, 'Email=([^,\\s]+)'))[1]
           FROM conversation_messages cm
           WHERE cm.conversation_id = c.id
             AND cm.direction = 'inbound'
             AND cm.message_text LIKE 'Lead details captured:%'
           ORDER BY cm.created_at DESC
           LIMIT 1
         )
       ) AS contact_email
     FROM conversations c
     LEFT JOIN agent_profiles ap ON ap.id = c.assigned_agent_profile_id
     LEFT JOIN conversation_read_state crs
       ON crs.user_id = c.user_id
      AND crs.conversation_id = c.id
     LEFT JOIN LATERAL (
       SELECT *
       FROM contacts ct
       WHERE ct.user_id = c.user_id
         AND (ct.linked_conversation_id = c.id OR ct.phone_number = c.phone_number)
       ORDER BY CASE WHEN ct.linked_conversation_id = c.id THEN 0 ELSE 1 END, ct.updated_at DESC
       LIMIT 1
     ) ct ON TRUE
     WHERE c.user_id = $1
       AND c.id = $2
     LIMIT 1`,
    [userId, conversationId]
  );

  const row = firstRow(result);
  if (!row) {
    return null;
  }

  return {
    ...row,
    unread_count: Number(row.unread_count ?? 0),
    visitor_online: row.channel_type === "web" ? isWidgetVisitorConnected(userId, row.phone_number) : false
  };
}

export async function incrementConversationUnreadCount(userId: string, conversationId: string): Promise<number> {
  const result = await pool.query<{ unread_count: number }>(
    `INSERT INTO conversation_read_state (user_id, conversation_id, unread_count, last_read_at, updated_at)
     VALUES ($1, $2, 1, NULL, NOW())
     ON CONFLICT (user_id, conversation_id)
     DO UPDATE SET
       unread_count = conversation_read_state.unread_count + 1,
       updated_at = NOW()
     RETURNING unread_count`,
    [userId, conversationId]
  );
  return firstRow(result)?.unread_count ?? 1;
}

export async function markConversationRead(userId: string, conversationId: string): Promise<number> {
  await pool.query(
    `INSERT INTO conversation_read_state (user_id, conversation_id, unread_count, last_read_at, updated_at)
     VALUES ($1, $2, 0, NOW(), NOW())
     ON CONFLICT (user_id, conversation_id)
     DO UPDATE SET
       unread_count = 0,
       last_read_at = NOW(),
       updated_at = NOW()`,
    [userId, conversationId]
  );
  await pool.query(
    `UPDATE agent_notifications
     SET read_at = NOW()
     WHERE user_id = $1
       AND conversation_id = $2
       AND read_at IS NULL`,
    [userId, conversationId]
  );
  realtimeHub.broadcastConversationRead(userId, conversationId);
  void fanoutEvent(userId, "chats.update", {
    id: conversationId,
    unreadCount: 0
  });
  return 0;
}

export async function trackInboundMessage(
  userId: string,
  phoneNumber: string,
  message: string,
  senderName?: string,
  options?: {
    channelType?: AgentChannelType;
    channelLinkedNumber?: string | null;
    mediaUrl?: string | null;
    payloadJson?: unknown;
  }
): Promise<Conversation> {
  const channelType = options?.channelType ?? "qr";
  const channelLinkedNumber = options?.channelLinkedNumber ?? null;
  const agentProfile = await resolveAgentProfileForChannel(userId, channelType, channelLinkedNumber);
  const conversation = await getOrCreateConversation(userId, phoneNumber, {
    channelType,
    channelLinkedNumber,
    assignedAgentProfileId: agentProfile?.id ?? null
  });

  const classification = await classifyInboundMessage({
    message,
    agentProfile,
    userId
  });

  const [intentDelta, knowledgeDelta] = await Promise.all([
    Promise.resolve(scoreMessageBase(message)),
    scoreKnowledgeIntent(userId, message)
  ]);
  const delta = intentDelta + knowledgeDelta + KIND_PRIORITY_DELTA[classification.kind];
  const score = clamp(conversation.score + delta, 0, 100);
  const stage = stageFromScore(score);

  const updated = await pool.query<Conversation>(
    `UPDATE conversations
     SET score = $1,
         stage = $2,
         lead_kind = $3,
         classification_confidence = $4,
         channel_type = $5,
         channel_linked_number = $6,
         assigned_agent_profile_id = $7,
         last_message = $8,
         last_message_at = NOW(),
         last_classified_at = NOW()
     WHERE id = $9
     RETURNING *`,
    [
      score,
      stage,
      classification.kind,
      classification.confidence,
      channelType,
      channelLinkedNumber,
      agentProfile?.id ?? conversation.assigned_agent_profile_id ?? null,
      message,
      conversation.id
    ]
  );

  const inboundMediaUrl = options?.mediaUrl ?? null;
  const payloadJsonStr = options?.payloadJson != null ? JSON.stringify(options.payloadJson) : null;
  if (inboundMediaUrl) {
    try {
      await pool.query(
        `INSERT INTO conversation_messages (conversation_id, direction, sender_name, message_text, media_url, payload_json)
         VALUES ($1, 'inbound', $2, $3, $4, $5::jsonb)`,
        [conversation.id, senderName ?? null, message, inboundMediaUrl, payloadJsonStr]
      );
    } catch {
      await pool.query(
        `INSERT INTO conversation_messages (conversation_id, direction, sender_name, message_text)
         VALUES ($1, 'inbound', $2, $3)`,
        [conversation.id, senderName ?? null, message]
      );
    }
  } else {
    await pool.query(
      `INSERT INTO conversation_messages (conversation_id, direction, sender_name, message_text, payload_json)
       VALUES ($1, 'inbound', $2, $3, $4::jsonb)`,
      [conversation.id, senderName ?? null, message, payloadJsonStr]
    );
  }
  const newUnreadCount = await incrementConversationUnreadCount(userId, conversation.id);
  void createAgentNotification({
    userId,
    type: "message",
    conversationId: conversation.id,
    actorName: senderName ?? phoneNumber,
    body: `${senderName ?? phoneNumber}: ${message}`
  });
  const updatedConv = firstRow(updated);
  void fanoutEvent(userId, "chats.upsert", {
    id: conversation.id,
    phoneNumber,
    channelType: options?.channelType ?? "qr",
    unreadCount: newUnreadCount,
    lastMessage: message,
    lastMessageAt: new Date().toISOString(),
    score: updatedConv?.score ?? conversation.score,
    stage: updatedConv?.stage ?? conversation.stage
  });

  // inbox-v2: typed batched WS events
  type InboundRealtimeRow = {
    id: string;
    created_at: Date;
    media_url: string | null;
    payload_json: Record<string, unknown> | null;
  };
  let inboundMsg: InboundRealtimeRow | undefined;
  try {
    const inboundMsgRow = await pool.query<InboundRealtimeRow>(
      `SELECT id, created_at, media_url, payload_json
       FROM conversation_messages
       WHERE conversation_id = $1 AND direction = 'inbound'
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [conversation.id]
    );
    inboundMsg = inboundMsgRow.rows[0];
  } catch {
    const inboundMsgRow = await pool.query<{ id: string; created_at: Date }>(
      `SELECT id, created_at
       FROM conversation_messages
       WHERE conversation_id = $1 AND direction = 'inbound'
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [conversation.id]
    );
    const row = inboundMsgRow.rows[0];
    inboundMsg = row ? { ...row, media_url: null, payload_json: null } : undefined;
  }
  if (inboundMsg) {
    realtimeHub.broadcastMessageCreated(userId, {
      conversationId: conversation.id,
      message: {
        id: inboundMsg.id,
        conversation_id: conversation.id,
        direction: "inbound",
        sender_name: senderName ?? null,
        message_text: message,
        content_type: "text",
        is_private: false,
        in_reply_to_id: null,
        echo_id: null,
        delivery_status: "delivered",
        error_code: null,
        error_message: null,
        retry_count: 0,
        payload_json: inboundMsg.payload_json ?? null,
        media_url: inboundMsg.media_url ?? null,
        message_type: null,
        message_content: null,
        source_type: null,
        created_at: inboundMsg.created_at.toISOString()
      }
    });
  }
  realtimeHub.broadcastConversationUpdated(userId, {
    id: conversation.id,
    last_message: { text: message, sent_at: new Date().toISOString(), direction: "inbound" },
    unread_count: newUnreadCount,
    score: updatedConv?.score ?? conversation.score
  });

  const capturedProfile = extractCapturedProfileDetails(message);
  const contactPhoneNumber = capturedProfile.phoneNumber ?? phoneNumber;
  if (contactPhoneNumber.replace(/\D/g, "").length >= 8) {
    try {
      await syncConversationContact({
        userId,
        phoneNumber: contactPhoneNumber,
        displayName: capturedProfile.displayName ?? senderName ?? undefined,
        email: capturedProfile.email ?? undefined,
        contactType: classification.kind,
        sourceType: channelType,
        linkedConversationId: conversation.id
      });
    } catch (error) {
      console.warn(`[Contacts] contact sync failed for conversation ${conversation.id}`, error);
    }
  }

  // Write insight record for daily email report — non-fatal
  const insightType = classification.kind as InsightType;
  if (insightType === "lead" || insightType === "complaint" || insightType === "feedback") {
    try {
      await upsertConversationInsight(conversation.id, userId, {
        type: insightType,
        summary: message.slice(0, 150),
        sentiment: deriveSentiment(insightType, score),
        priority_score: score,
        status: "open"
      });
    } catch (insightError) {
      console.warn(`[ConversationInsight] upsert failed for ${conversation.id}`, insightError);
    }
  }

  return requireRow(updated, "Expected updated conversation row");
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
    markAsAiReply?: boolean;
    senderName?: string | null;
    sourceType?: "manual" | "broadcast" | "sequence" | "bot" | "api" | "system" | null;
    webhookUrl?: string | null;
    echoId?: string | null;
  },
  mediaUrl?: string | null,
  payload?: FlowMessagePayload | null,
  wamid?: string | null
): Promise<void> {
  // echo_id dedup: return early if this outbound message was already inserted
  if (usage?.echoId) {
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM conversation_messages WHERE conversation_id = $1 AND echo_id = $2 LIMIT 1`,
      [conversationId, usage.echoId]
    );
    if ((existing.rowCount ?? 0) > 0) return;
  }
  const validatedPayload = payload ? validateFlowMessagePayload(payload) : null;
  const msgType = validatedPayload ? deriveRendererMessageType(validatedPayload) : "text";
  const msgContent = validatedPayload ? JSON.stringify(validatedPayload) : null;

  // Try with new columns; fall back if migration not yet applied.
  try {
    await pool.query(
      `INSERT INTO conversation_messages (
         conversation_id,
         direction,
         sender_name,
         message_text,
         prompt_tokens,
         completion_tokens,
         total_tokens,
         ai_model,
         retrieval_chunks,
         media_url,
         message_type,
         message_content,
         wamid,
         sent_at,
         source_type,
         webhook_url,
         echo_id
       )
       VALUES ($1, 'outbound', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, NOW(), $13, $14, $15)`,
      [
        conversationId,
        usage?.senderName ?? null,
        message,
        usage?.promptTokens ?? null,
        usage?.completionTokens ?? null,
        usage?.totalTokens ?? null,
        usage?.aiModel ?? null,
        usage?.retrievalChunks ?? null,
        mediaUrl ?? null,
        msgType,
        msgContent,
        wamid ?? null,
        usage?.sourceType ?? "manual",
        usage?.webhookUrl ?? null,
        usage?.echoId ?? null
      ]
    );
  } catch {
    // message_type / message_content missing (migration 0016 not yet applied).
    // Preserve media_url from migration 0015 so images survive.
    try {
      await pool.query(
        `INSERT INTO conversation_messages (
           conversation_id,
           direction,
           sender_name,
           message_text,
           prompt_tokens,
           completion_tokens,
           total_tokens,
           ai_model,
           retrieval_chunks,
           media_url
         )
         VALUES ($1, 'outbound', $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          conversationId,
          usage?.senderName ?? null,
          message,
          usage?.promptTokens ?? null,
          usage?.completionTokens ?? null,
          usage?.totalTokens ?? null,
          usage?.aiModel ?? null,
          usage?.retrievalChunks ?? null,
          mediaUrl ?? null
        ]
      );
    } catch {
      // Last resort: pre-0015 schema without media_url
      await pool.query(
        `INSERT INTO conversation_messages (
           conversation_id,
           direction,
           sender_name,
           message_text,
           prompt_tokens,
           completion_tokens,
           total_tokens,
           ai_model,
           retrieval_chunks
         )
         VALUES ($1, 'outbound', $2, $3, $4, $5, $6, $7, $8)`,
        [
          conversationId,
          usage?.senderName ?? null,
          message,
          usage?.promptTokens ?? null,
          usage?.completionTokens ?? null,
          usage?.totalTokens ?? null,
          usage?.aiModel ?? null,
          usage?.retrievalChunks ?? null
        ]
      );
    }
  }

  const retrievalDelta = scoreFromRetrievalChunks(usage?.retrievalChunks);
  const markAsAiReply = usage?.markAsAiReply ?? false;
  const outboundUpdated = await pool.query<{ id: string; user_id: string }>(
    `UPDATE conversations
     SET last_message = $1,
         last_message_at = NOW(),
         last_ai_reply_at = CASE WHEN $4 THEN NOW() ELSE last_ai_reply_at END,
         score = LEAST(100, GREATEST(0, score + $3)),
         stage = CASE
           WHEN LEAST(100, GREATEST(0, score + $3)) >= 75 THEN 'hot'
           WHEN LEAST(100, GREATEST(0, score + $3)) >= 40 THEN 'warm'
           ELSE 'cold'
         END
     WHERE id = $2
     RETURNING id, user_id`,
    [message, conversationId, retrievalDelta, markAsAiReply]
  );
  const outboundConv = firstRow(outboundUpdated);
  if (outboundConv) {
    void fanoutEvent(outboundConv.user_id, "chats.update", {
      id: outboundConv.id,
      lastMessage: message,
      lastMessageAt: new Date().toISOString()
    });

    // inbox-v2: typed batched WS event for outbound
    type OutboundRealtimeRow = {
      id: string;
      created_at: Date;
      echo_id: string | null;
      sender_name: string | null;
      media_url: string | null;
      message_type: string | null;
      message_content: Record<string, unknown> | null;
      delivery_status: string | null;
      error_code: string | null;
      error_message: string | null;
      source_type: string | null;
    };
    let outboundMsg: OutboundRealtimeRow | undefined;
    try {
      const outboundMsgRow = await pool.query<OutboundRealtimeRow>(
        `SELECT
           id,
           created_at,
           echo_id,
           sender_name,
           media_url,
           message_type,
           message_content,
           delivery_status,
           error_code,
           error_message,
           COALESCE(source_type, 'manual') AS source_type
         FROM conversation_messages
         WHERE conversation_id = $1 AND direction = 'outbound'
         ORDER BY created_at DESC, id DESC LIMIT 1`,
        [conversationId]
      );
      outboundMsg = outboundMsgRow.rows[0];
    } catch {
      const outboundMsgRow = await pool.query<{
        id: string;
        created_at: Date;
        echo_id: string | null;
        sender_name: string | null;
      }>(
        `SELECT id, created_at, echo_id, sender_name
         FROM conversation_messages
         WHERE conversation_id = $1 AND direction = 'outbound'
         ORDER BY created_at DESC, id DESC LIMIT 1`,
        [conversationId]
      );
      const row = outboundMsgRow.rows[0];
      outboundMsg = row
        ? {
            ...row,
            media_url: null,
            message_type: null,
            message_content: null,
            delivery_status: "sent",
            error_code: null,
            error_message: null,
            source_type: "manual"
          }
        : undefined;
    }
    if (outboundMsg) {
      realtimeHub.broadcastMessageCreated(outboundConv.user_id, {
        conversationId,
        message: {
          id: outboundMsg.id,
          conversation_id: conversationId,
          direction: "outbound",
          sender_name: outboundMsg.sender_name ?? usage?.senderName ?? null,
          message_text: message,
          content_type: outboundMsg.message_type === "file" ? "document" : outboundMsg.message_type ?? "text",
          is_private: false,
          in_reply_to_id: null,
          echo_id: outboundMsg.echo_id,
          delivery_status: outboundMsg.delivery_status ?? "sent",
          error_code: outboundMsg.error_code ?? null,
          error_message: outboundMsg.error_message ?? null,
          retry_count: 0,
          media_url: outboundMsg.media_url ?? null,
          message_type: outboundMsg.message_type ?? null,
          message_content: outboundMsg.message_content ?? null,
          source_type: outboundMsg.source_type ?? null,
          created_at: outboundMsg.created_at.toISOString()
        }
      });
    }
    realtimeHub.broadcastConversationUpdated(outboundConv.user_id, {
      id: conversationId,
      last_message: { text: message, sent_at: new Date().toISOString(), direction: "outbound" }
    });
  }
}

interface CursorStamp {
  timestamp: string | null;
  id: string;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

function encodeCursor(value: CursorStamp): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null | undefined): CursorStamp | null {
  if (!cursor) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<CursorStamp>;
    if (typeof parsed?.id !== "string" || !parsed.id.trim()) {
      return null;
    }
    if (parsed.timestamp !== null && typeof parsed.timestamp !== "string") {
      return null;
    }
    return {
      timestamp: parsed.timestamp ?? null,
      id: parsed.id.trim()
    };
  } catch {
    return null;
  }
}

export async function listConversations(
  userId: string
): Promise<
  Array<
    Conversation & {
      contact_name: string | null;
      contact_phone: string | null;
      contact_email: string | null;
      assigned_agent_name: string | null;
      unread_count: number;
      visitor_online: boolean;
    }
  >
> {
  const result = await pool.query<
    Conversation & {
      contact_name: string | null;
      contact_phone: string | null;
      contact_email: string | null;
      assigned_agent_name: string | null;
      unread_count: number;
    }
  >(
    `SELECT
       c.*,
       COALESCE(ct.contact_type, c.lead_kind) AS lead_kind,
       ap.name AS assigned_agent_name,
       COALESCE(crs.unread_count, 0) AS unread_count,
       COALESCE(
         ct.display_name,
         (
           SELECT cm.sender_name
           FROM conversation_messages cm
           WHERE cm.conversation_id = c.id
             AND cm.direction = 'inbound'
             AND cm.sender_name IS NOT NULL
           ORDER BY cm.created_at DESC
           LIMIT 1
         ),
         (
           SELECT (regexp_match(cm.message_text, 'Name=([^,]+)'))[1]
           FROM conversation_messages cm
           WHERE cm.conversation_id = c.id
             AND cm.direction = 'inbound'
             AND cm.message_text LIKE 'Lead details captured:%'
           ORDER BY cm.created_at DESC
           LIMIT 1
         )
       ) AS contact_name,
       COALESCE(
         ct.phone_number,
         (
           SELECT (regexp_match(cm.message_text, 'Phone=([0-9]{8,15})'))[1]
           FROM conversation_messages cm
           WHERE cm.conversation_id = c.id
             AND cm.direction = 'inbound'
             AND cm.message_text LIKE 'Lead details captured:%'
           ORDER BY cm.created_at DESC
           LIMIT 1
         ),
         c.phone_number
       ) AS contact_phone,
       COALESCE(
         ct.email,
         (
           SELECT (regexp_match(cm.message_text, 'Email=([^,\\s]+)'))[1]
           FROM conversation_messages cm
           WHERE cm.conversation_id = c.id
             AND cm.direction = 'inbound'
             AND cm.message_text LIKE 'Lead details captured:%'
           ORDER BY cm.created_at DESC
           LIMIT 1
         )
       ) AS contact_email
     FROM conversations c
     LEFT JOIN agent_profiles ap ON ap.id = c.assigned_agent_profile_id
     LEFT JOIN conversation_read_state crs
       ON crs.user_id = c.user_id
      AND crs.conversation_id = c.id
     LEFT JOIN LATERAL (
       SELECT *
       FROM contacts ct
       WHERE ct.user_id = c.user_id
         AND (ct.linked_conversation_id = c.id OR ct.phone_number = c.phone_number)
       ORDER BY CASE WHEN ct.linked_conversation_id = c.id THEN 0 ELSE 1 END, ct.updated_at DESC
       LIMIT 1
     ) ct ON TRUE
     WHERE c.user_id = $1
     ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC`,
    [userId]
  );

  return result.rows.map((row) => ({
    ...row,
    unread_count: Number(row.unread_count ?? 0),
    visitor_online: row.channel_type === "web" ? isWidgetVisitorConnected(userId, row.phone_number) : false
  }));
}

export async function listConversationsPage(
  userId: string,
  options?: {
    limit?: number;
    cursor?: string | null;
    search?: string | null;
  }
): Promise<
  PaginatedResult<
    Conversation & {
      contact_name: string | null;
      contact_phone: string | null;
      contact_email: string | null;
      assigned_agent_name: string | null;
      unread_count: number;
      visitor_online: boolean;
    }
  >
> {
  const clampedLimit = Math.max(1, Math.min(100, options?.limit ?? 20));
  const cursor = decodeCursor(options?.cursor);
  const search = options?.search?.trim().toLowerCase() ?? "";
  const values: Array<string | number | null> = [userId];
  const where: string[] = ["c.user_id = $1"];

  if (search) {
    values.push(`%${search}%`);
    const searchParam = `$${values.length}`;
    where.push(`(
      LOWER(COALESCE(c.phone_number, '')) LIKE ${searchParam}
      OR LOWER(COALESCE(c.last_message, '')) LIKE ${searchParam}
      OR LOWER(COALESCE(ap.name, '')) LIKE ${searchParam}
      OR LOWER(COALESCE(c.channel_type, '')) LIKE ${searchParam}
      OR LOWER(COALESCE(COALESCE(ct.contact_type, c.lead_kind)::text, '')) LIKE ${searchParam}
      OR LOWER(COALESCE(ct.display_name, '')) LIKE ${searchParam}
      OR LOWER(COALESCE(ct.email, '')) LIKE ${searchParam}
    )`);
  }

  if (cursor) {
    values.push(cursor.timestamp);
    const timestampParam = `$${values.length}`;
    values.push(cursor.id);
    const idParam = `$${values.length}`;
    if (cursor.timestamp) {
      where.push(`(
        c.last_message_at IS NULL
        OR c.last_message_at < ${timestampParam}::timestamptz
        OR (c.last_message_at = ${timestampParam}::timestamptz AND c.id < ${idParam}::uuid)
      )`);
    } else {
      where.push(`c.last_message_at IS NULL AND c.id < ${idParam}::uuid`);
    }
  }

  values.push(clampedLimit + 1);
  const limitParam = `$${values.length}`;
  const result = await pool.query<
    Conversation & {
      contact_name: string | null;
      contact_phone: string | null;
      contact_email: string | null;
      assigned_agent_name: string | null;
      unread_count: number;
    }
  >(
    `SELECT
       c.*,
       COALESCE(ct.contact_type, c.lead_kind) AS lead_kind,
       ap.name AS assigned_agent_name,
       COALESCE(crs.unread_count, 0) AS unread_count,
       COALESCE(
         ct.display_name,
         (
           SELECT cm.sender_name
           FROM conversation_messages cm
           WHERE cm.conversation_id = c.id
             AND cm.direction = 'inbound'
             AND cm.sender_name IS NOT NULL
           ORDER BY cm.created_at DESC
           LIMIT 1
         ),
         (
           SELECT (regexp_match(cm.message_text, 'Name=([^,]+)'))[1]
           FROM conversation_messages cm
           WHERE cm.conversation_id = c.id
             AND cm.direction = 'inbound'
             AND cm.message_text LIKE 'Lead details captured:%'
           ORDER BY cm.created_at DESC
           LIMIT 1
         )
       ) AS contact_name,
       COALESCE(
         ct.phone_number,
         (
           SELECT (regexp_match(cm.message_text, 'Phone=([0-9]{8,15})'))[1]
           FROM conversation_messages cm
           WHERE cm.conversation_id = c.id
             AND cm.direction = 'inbound'
             AND cm.message_text LIKE 'Lead details captured:%'
           ORDER BY cm.created_at DESC
           LIMIT 1
         ),
         c.phone_number
       ) AS contact_phone,
       COALESCE(
         ct.email,
         (
           SELECT (regexp_match(cm.message_text, 'Email=([^,\\s]+)'))[1]
           FROM conversation_messages cm
           WHERE cm.conversation_id = c.id
             AND cm.direction = 'inbound'
             AND cm.message_text LIKE 'Lead details captured:%'
           ORDER BY cm.created_at DESC
           LIMIT 1
         )
       ) AS contact_email
     FROM conversations c
     LEFT JOIN agent_profiles ap ON ap.id = c.assigned_agent_profile_id
     LEFT JOIN conversation_read_state crs
       ON crs.user_id = c.user_id
      AND crs.conversation_id = c.id
     LEFT JOIN LATERAL (
       SELECT *
       FROM contacts ct
       WHERE ct.user_id = c.user_id
         AND (ct.linked_conversation_id = c.id OR ct.phone_number = c.phone_number)
       ORDER BY CASE WHEN ct.linked_conversation_id = c.id THEN 0 ELSE 1 END, ct.updated_at DESC
       LIMIT 1
     ) ct ON TRUE
     WHERE ${where.join(" AND ")}
     ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC
     LIMIT ${limitParam}`,
    values
  );

  const hasMore = result.rows.length > clampedLimit;
  const pageRows = hasMore ? result.rows.slice(0, clampedLimit) : result.rows;
  const items = pageRows.map((row) => ({
    ...row,
    unread_count: Number(row.unread_count ?? 0),
    visitor_online: row.channel_type === "web" ? isWidgetVisitorConnected(userId, row.phone_number) : false
  }));
  const nextRow = pageRows.at(-1);
  return {
    items,
    hasMore,
    nextCursor: hasMore && nextRow
      ? encodeCursor({
          timestamp: nextRow.last_message_at ?? null,
          id: nextRow.id
        })
      : null
  };
}

export interface LeadConversation extends Conversation {
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  assigned_agent_name: string | null;
  requires_reply: boolean;
  ai_summary: string;
  summary_status: "ready" | "missing" | "stale";
  summary_updated_at: string | null;
}

function fallbackLeadSummary(
  conversation: { stage: string; score: number; lead_kind?: ConversationKind; last_message: string | null },
  messages: Array<{ direction: "inbound" | "outbound"; message_text: string }>
): string {
  const latestInbound = [...messages].reverse().find((item) => item.direction === "inbound")?.message_text ?? "";
  const latestOutbound = [...messages].reverse().find((item) => item.direction === "outbound")?.message_text ?? "";
  const userNeed = latestInbound ? latestInbound.slice(0, 180) : conversation.last_message?.slice(0, 180) ?? "No clear intent yet.";
  const nextStep = latestOutbound
    ? `Continue with follow-up around: ${latestOutbound.slice(0, 120)}`
    : "Ask one clarifying question and offer next action.";
  return `Type ${conversation.lead_kind ?? "lead"}, stage ${conversation.stage} (score ${conversation.score}). Customer asked: ${userNeed}. ${nextStep}`;
}

async function generateLeadSummary(
  conversation: { stage: string; score: number; lead_kind: ConversationKind; phone_number: string; last_message: string | null },
  messages: Array<{ direction: "inbound" | "outbound"; message_text: string; created_at: string }>,
  userId?: string
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

  if (!aiService.isConfigured()) {
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
    `Conversation type: ${conversation.lead_kind}`,
    `Lead stage: ${conversation.stage}`,
    `Lead score: ${conversation.score}`,
    `Phone: ${conversation.phone_number}`,
    "Conversation:",
    clipped
  ].join("\n");

  try {
    const response = await aiService.generateReply(systemPrompt, userPrompt);
    if (userId) void chargeUser(userId, "ai_lead_summary");
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
  contact_phone: string | null;
  contact_email: string | null;
  assigned_agent_name: string | null;
  ai_summary: string | null;
  summary_source_last_message_at: string | null;
  summary_updated_at: string | null;
};

function needsReply(row: Pick<LeadSummaryRow, "lead_kind" | "stage">): boolean {
  return row.lead_kind === "complaint" || row.stage === "hot";
}

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

async function listLeadSummaryRows(
  userId: string,
  limit: number,
  filters?: {
    stage?: "hot" | "warm" | "cold";
    kind?: ConversationKind;
    channelType?: AgentChannelType;
    todayOnly?: boolean;
  }
): Promise<LeadSummaryRow[]> {
  const where: string[] = ["c.user_id = $1"];
  const values: Array<string | number | boolean> = [userId];

  if (filters?.stage) {
    values.push(filters.stage);
    where.push(`c.stage = $${values.length}`);
  }
  if (filters?.kind) {
    values.push(filters.kind);
    where.push(`COALESCE(ct.contact_type, c.lead_kind) = $${values.length}`);
  }
  if (filters?.channelType) {
    values.push(filters.channelType);
    where.push(`c.channel_type = $${values.length}`);
  }
  if (filters?.todayOnly) {
    where.push(`c.last_message_at::date = CURRENT_DATE`);
  }

  values.push(limit);
  const limitParam = `$${values.length}`;

  const sql = `SELECT
       c.*,
       COALESCE(ct.contact_type, c.lead_kind) AS lead_kind,
       ap.name AS assigned_agent_name,
       COALESCE(
         ct.display_name,
         (
           SELECT cm.sender_name
           FROM conversation_messages cm
           WHERE cm.conversation_id = c.id
             AND cm.direction = 'inbound'
             AND cm.sender_name IS NOT NULL
           ORDER BY cm.created_at DESC
           LIMIT 1
         ),
         (
           SELECT (regexp_match(cm.message_text, 'Name=([^,]+)'))[1]
           FROM conversation_messages cm
           WHERE cm.conversation_id = c.id
             AND cm.direction = 'inbound'
             AND cm.message_text LIKE 'Lead details captured:%'
           ORDER BY cm.created_at DESC
           LIMIT 1
         )
       ) AS contact_name,
       COALESCE(
         ct.phone_number,
         (
           SELECT (regexp_match(cm.message_text, 'Phone=([0-9]{8,15})'))[1]
           FROM conversation_messages cm
           WHERE cm.conversation_id = c.id
             AND cm.direction = 'inbound'
             AND cm.message_text LIKE 'Lead details captured:%'
           ORDER BY cm.created_at DESC
           LIMIT 1
         ),
         c.phone_number
       ) AS contact_phone,
       COALESCE(
         ct.email,
         (
           SELECT (regexp_match(cm.message_text, 'Email=([^,\\s]+)'))[1]
           FROM conversation_messages cm
           WHERE cm.conversation_id = c.id
             AND cm.direction = 'inbound'
             AND cm.message_text LIKE 'Lead details captured:%'
           ORDER BY cm.created_at DESC
           LIMIT 1
         )
       ) AS contact_email,
       ls.summary_text AS ai_summary,
       ls.source_last_message_at::text AS summary_source_last_message_at,
       ls.updated_at::text AS summary_updated_at
     FROM conversations c
     LEFT JOIN agent_profiles ap ON ap.id = c.assigned_agent_profile_id
     LEFT JOIN LATERAL (
       SELECT *
       FROM contacts ct
       WHERE ct.user_id = c.user_id
         AND (ct.linked_conversation_id = c.id OR ct.phone_number = c.phone_number)
       ORDER BY CASE WHEN ct.linked_conversation_id = c.id THEN 0 ELSE 1 END, ct.updated_at DESC
       LIMIT 1
     ) ct ON TRUE
     LEFT JOIN lead_summaries ls ON ls.conversation_id = c.id
     WHERE ${where.join(" AND ")}
     ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
     LIMIT ${limitParam}`;

  return pool.query<LeadSummaryRow>(sql, values).then((result) => result.rows);
}

export async function listLeadsWithSummary(
  userId: string,
  limit = 250,
  filters?: {
    stage?: "hot" | "warm" | "cold";
    kind?: ConversationKind;
    channelType?: AgentChannelType;
    todayOnly?: boolean;
    requiresReply?: boolean;
  }
): Promise<LeadConversation[]> {
  const clampedLimit = Math.max(1, Math.min(500, limit));
  const rows = await listLeadSummaryRows(userId, clampedLimit, {
    stage: filters?.stage,
    kind: filters?.kind,
    channelType: filters?.channelType,
    todayOnly: filters?.todayOnly
  });
  const mapped = rows.map((row) => ({
    ...row,
    contact_name: row.contact_name,
    contact_phone: row.contact_phone,
    contact_email: row.contact_email,
    assigned_agent_name: row.assigned_agent_name,
    requires_reply: needsReply(row),
    ai_summary: row.ai_summary?.trim() || "",
    summary_status: getLeadSummaryStatus(row),
    summary_updated_at: row.summary_updated_at
  }));

  return mapped.filter((row) => {
    if (filters?.requiresReply && !row.requires_reply) {
      return false;
    }
    return true;
  });
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
      const generated = await generateLeadSummary(row, history, userId);
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
  media_url: string | null;
  message_type: string;
  message_content: Record<string, unknown> | null;
  wamid?: string | null;
  delivery_status?: "sent" | "delivered" | "read" | "failed" | null;
  sent_at?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  source_type?: "manual" | "broadcast" | "sequence" | "bot" | "api" | "system" | null;
  created_at: string;
}

export interface ConversationMessageSnapshot {
  direction: "inbound" | "outbound";
  message_text: string;
  created_at: string;
}

export async function listRecentConversationMessages(
  conversationId: string,
  limit = 20
): Promise<ConversationMessageSnapshot[]> {
  const clampedLimit = Math.max(1, Math.min(100, limit));
  const result = await pool.query<ConversationMessageSnapshot>(
    `SELECT direction, message_text, created_at
     FROM conversation_messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [conversationId, clampedLimit]
  );

  return result.rows.reverse();
}

export async function listConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
  // Try with all columns first; fall back gracefully if new columns don't exist yet (pre-migration).
  try {
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
         media_url,
         message_type,
         message_content,
         wamid,
         delivery_status,
         sent_at,
         delivered_at,
         read_at,
         error_code,
         error_message,
         COALESCE(source_type, 'manual') AS source_type,
         created_at
       FROM conversation_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [conversationId]
    );
    return result.rows;
  } catch {
    // message_type / message_content columns missing (migration 0016 not yet applied).
    // media_url is available from migration 0015 — use it so images still resolve.
    try {
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
           media_url,
           'text'::text        AS message_type,
           NULL::jsonb         AS message_content,
           created_at
         FROM conversation_messages
         WHERE conversation_id = $1
         ORDER BY created_at ASC`,
        [conversationId]
      );
      return result.rows;
    } catch {
      // media_url also missing (pre-migration 0015) — last resort.
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
           NULL::text          AS media_url,
           'text'::text        AS message_type,
           NULL::jsonb         AS message_content,
           created_at
         FROM conversation_messages
         WHERE conversation_id = $1
         ORDER BY created_at ASC`,
        [conversationId]
      );
      return result.rows;
    }
  }
}

export async function listConversationMessagesPage(
  conversationId: string,
  options?: {
    limit?: number;
    before?: string | null;
  }
): Promise<PaginatedResult<ConversationMessage>> {
  const clampedLimit = Math.max(1, Math.min(50, options?.limit ?? 5));
  const cursor = decodeCursor(options?.before);
  const values: Array<string | number | null> = [conversationId];
  let beforeClause = "";

  if (cursor?.timestamp) {
    values.push(cursor.timestamp);
    const timestampParam = `$${values.length}`;
    values.push(cursor.id);
    const idParam = `$${values.length}`;
    beforeClause = `AND (
      created_at < ${timestampParam}::timestamptz
      OR (created_at = ${timestampParam}::timestamptz AND id < ${idParam}::uuid)
    )`;
  }

  values.push(clampedLimit + 1);
  const limitParam = `$${values.length}`;

  try {
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
         media_url,
         message_type,
         message_content,
         wamid,
         delivery_status,
         sent_at,
         delivered_at,
         read_at,
         error_code,
         error_message,
         COALESCE(source_type, 'manual') AS source_type,
         created_at
       FROM conversation_messages
       WHERE conversation_id = $1
       ${beforeClause}
       ORDER BY created_at DESC, id DESC
       LIMIT ${limitParam}`,
      values
    );
    const hasMore = result.rows.length > clampedLimit;
    const rowsDesc = hasMore ? result.rows.slice(0, clampedLimit) : result.rows;
    const oldestRow = rowsDesc.at(-1);
    return {
      items: [...rowsDesc].reverse(),
      hasMore,
      nextCursor: hasMore && oldestRow
        ? encodeCursor({
            timestamp: oldestRow.created_at,
            id: oldestRow.id
          })
        : null
    };
  } catch {
    try {
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
           media_url,
           'text'::text AS message_type,
           NULL::jsonb AS message_content,
           NULL::text AS wamid,
           NULL::text AS delivery_status,
           NULL::timestamptz AS sent_at,
           NULL::timestamptz AS delivered_at,
           NULL::timestamptz AS read_at,
           NULL::text AS error_code,
           NULL::text AS error_message,
           'manual'::text AS source_type,
           created_at
         FROM conversation_messages
         WHERE conversation_id = $1
         ${beforeClause}
         ORDER BY created_at DESC, id DESC
         LIMIT ${limitParam}`,
        values
      );
      const hasMore = result.rows.length > clampedLimit;
      const rowsDesc = hasMore ? result.rows.slice(0, clampedLimit) : result.rows;
      const oldestRow = rowsDesc.at(-1);
      return {
        items: [...rowsDesc].reverse(),
        hasMore,
        nextCursor: hasMore && oldestRow
          ? encodeCursor({
              timestamp: oldestRow.created_at,
              id: oldestRow.id
            })
          : null
      };
    } catch {
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
           NULL::text AS media_url,
           'text'::text AS message_type,
           NULL::jsonb AS message_content,
           NULL::text AS wamid,
           NULL::text AS delivery_status,
           NULL::timestamptz AS sent_at,
           NULL::timestamptz AS delivered_at,
           NULL::timestamptz AS read_at,
           NULL::text AS error_code,
           NULL::text AS error_message,
           'manual'::text AS source_type,
           created_at
         FROM conversation_messages
         WHERE conversation_id = $1
         ${beforeClause}
         ORDER BY created_at DESC, id DESC
         LIMIT ${limitParam}`,
        values
      );
      const hasMore = result.rows.length > clampedLimit;
      const rowsDesc = hasMore ? result.rows.slice(0, clampedLimit) : result.rows;
      const oldestRow = rowsDesc.at(-1);
      return {
        items: [...rowsDesc].reverse(),
        hasMore,
        nextCursor: hasMore && oldestRow
          ? encodeCursor({
              timestamp: oldestRow.created_at,
              id: oldestRow.id
            })
          : null
      };
    }
  }
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

export async function setConversationManualAndPaused(userId: string, conversationId: string): Promise<void> {
  await pool.query(
    `UPDATE conversations
     SET manual_takeover = TRUE,
         ai_paused = TRUE
     WHERE id = $1
       AND user_id = $2
       AND (manual_takeover = FALSE OR ai_paused = FALSE)`,
    [conversationId, userId]
  );
}

import { InMemoryCache } from "../utils/cache.js";

const dashboardOverviewCache = new InMemoryCache<{
  leadsToday: number;
  hotLeads: number;
  warmLeads: number;
  closedDeals: number;
}>(15_000);

export async function getDashboardOverview(userId: string): Promise<{
  leadsToday: number;
  hotLeads: number;
  warmLeads: number;
  closedDeals: number;
}> {
  const cacheKey = `dashboard:${userId}`;
  const cached = dashboardOverviewCache.get(cacheKey);
  if (cached) {
    return cached;
  }

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

  const row = firstRow(result);

  const overview = {
    leadsToday: Number(row?.leads_today ?? 0),
    hotLeads: Number(row?.hot_leads ?? 0),
    warmLeads: Number(row?.warm_leads ?? 0),
    closedDeals: Number(row?.closed_deals ?? 0)
  };

  dashboardOverviewCache.set(cacheKey, overview);
  return overview;
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

export async function updateMessageDeliveryStatus(
  wamid: string,
  status: "delivered" | "read" | "failed",
  errorCode?: string | null
): Promise<void> {
  await pool.query(
    `UPDATE conversation_messages
     SET delivery_status = $2,
         delivered_at    = CASE WHEN $2 = 'delivered' THEN NOW() ELSE delivered_at END,
         read_at         = CASE WHEN $2 = 'read'      THEN NOW() ELSE read_at      END,
         error_code      = COALESCE($3, error_code)
     WHERE wamid = $1`,
    [wamid, status, errorCode ?? null]
  );
}

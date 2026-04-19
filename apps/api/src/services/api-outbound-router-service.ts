import { pool } from "../db/pool.js";
import { getContactByPhoneForUser } from "./contacts-service.js";
import { getConversationById } from "./conversation-service.js";
import { queueConversationOutboundMessage, queueConversationTemplateMessage } from "./outbound-message-service.js";
import { summarizeFlowMessage, type FlowMessagePayload, validateFlowMessagePayload } from "./outbound-message-types.js";
import { evaluateOutboundTemplatePolicy, summarizeOutboundPolicyReasons } from "./outbound-policy-service.js";
import { getMessageTemplate } from "./template-service.js";

export type ApiOutboundMode = "session" | "template_required";
export type ApiOutboundSource = "chat" | "ai" | "manual" | "campaign" | "sequence" | "test";

export interface ApiOutboundPolicyResult {
  mode: ApiOutboundMode;
  allowed: boolean;
  reasonCodes: string[];
  templateId: string | null;
  nextAllowedAt: string | null;
  duplicateBlocked: boolean;
}

const RECENT_DUPLICATE_WINDOW_MINUTES = 30;
const INTENT_TEMPLATE_MAP: Record<string, string> = {};

function computeSessionMode(lastIncomingAt: string | null): ApiOutboundMode {
  if (!lastIncomingAt) {
    return "template_required";
  }
  const parsed = Date.parse(lastIncomingAt);
  if (!Number.isFinite(parsed)) {
    return "template_required";
  }
  return parsed >= Date.now() - 24 * 60 * 60_000 ? "session" : "template_required";
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}


async function isDuplicateConversationContent(input: {
  conversationId: string;
  summaryText: string;
}): Promise<boolean> {
  const normalized = normalizeText(input.summaryText);
  if (!normalized) {
    return false;
  }

  const result = await pool.query<{ recent_match: string }>(
    `SELECT COUNT(*)::text AS recent_match
     FROM conversation_messages
     WHERE conversation_id = $1
       AND direction = 'outbound'
       AND LOWER(regexp_replace(message_text, '\s+', ' ', 'g')) = $2
       AND created_at >= NOW() - ($3::text || ' minutes')::interval`,
    [input.conversationId, normalized, String(RECENT_DUPLICATE_WINDOW_MINUTES)]
  );
  return Number(result.rows[0]?.recent_match ?? 0) > 0;
}


function resolveMappedTemplateId(intent: string | null | undefined): string | null {
  if (!intent) {
    return null;
  }
  return INTENT_TEMPLATE_MAP[intent.trim().toLowerCase()] ?? null;
}

async function resolveTemplateIdFromPayload(input: {
  userId: string;
  templateName: string;
  language: string;
}): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    `SELECT id
     FROM message_templates
     WHERE user_id = $1
       AND LOWER(name) = LOWER($2)
       AND language = $3
       AND status = 'APPROVED'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [input.userId, input.templateName, input.language]
  );
  return result.rows[0]?.id ?? null;
}

export async function queueApiConversationSend(input: {
  userId: string;
  conversationId: string;
  source: ApiOutboundSource;
  payload?: FlowMessagePayload;
  templateId?: string | null;
  intent?: string | null;
  variableValues?: Record<string, string>;
  senderName?: string | null;
  usage?: {
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    aiModel?: string | null;
    retrievalChunks?: number | null;
    markAsAiReply?: boolean;
  };
}): Promise<{
  queuedMessageId: string;
  channelType: "api";
  summaryText: string;
  policy: ApiOutboundPolicyResult;
}> {
  const conversation = await getConversationById(input.conversationId);
  if (!conversation || conversation.user_id !== input.userId) {
    throw new Error("Conversation not found.");
  }
  if (conversation.channel_type !== "api") {
    throw new Error("This outbound router only handles WhatsApp API conversations.");
  }

  const contact = await getContactByPhoneForUser(input.userId, conversation.phone_number);
  const mode = computeSessionMode(contact?.last_incoming_message_at ?? null);
  const payloadTemplateId =
    input.payload?.type === "template"
      ? await resolveTemplateIdFromPayload({
          userId: input.userId,
          templateName: input.payload.templateName,
          language: input.payload.language
        })
      : null;
  const explicitTemplateId = input.templateId?.trim() || payloadTemplateId || resolveMappedTemplateId(input.intent) || null;

  if (input.payload) {
    const canonicalPayload = validateFlowMessagePayload(input.payload);
    if (canonicalPayload.type === "template") {
      if (!explicitTemplateId) {
        throw new Error("Template payload could not be matched to an approved local template.");
      }
      const template = await getMessageTemplate(input.userId, explicitTemplateId);
      const policy = await evaluateOutboundTemplatePolicy({
        userId: input.userId,
        phoneNumber: conversation.phone_number,
        category: template.category,
        contact,
        marketingEnabled: true
      });
      if (!policy.allowed) {
        throw new Error(summarizeOutboundPolicyReasons(policy.reasonCodes).join(" "));
      }
      const queuedTemplate = await queueConversationTemplateMessage({
        userId: input.userId,
        conversationId: conversation.id,
        templateId: explicitTemplateId,
        variableValues: {},
        senderName: input.senderName ?? null,
        scheduledAt: undefined
      });
      return {
        queuedMessageId: queuedTemplate.queuedMessageId,
        channelType: "api",
        summaryText: canonicalPayload.previewText ?? canonicalPayload.templateName,
        policy: {
          mode,
          allowed: true,
          reasonCodes: [],
          templateId: explicitTemplateId,
          nextAllowedAt: policy.nextAllowedAt,
          duplicateBlocked: false
        }
      };
    }

    if (mode !== "session") {
      throw new Error("This contact is outside the 24-hour session window. Use an approved template instead of freeform content.");
    }

    const summaryText = summarizeFlowMessage(canonicalPayload);
    const duplicateBlocked = await isDuplicateConversationContent({
      conversationId: conversation.id,
      summaryText
    });
    if (duplicateBlocked) {
      throw new Error("Duplicate outbound message blocked for this conversation.");
    }

    const queued = await queueConversationOutboundMessage({
      userId: input.userId,
      conversationId: conversation.id,
      payload: canonicalPayload,
      displayText: summaryText,
      senderName: input.senderName ?? null,
      usage: input.usage
    });

    return {
      queuedMessageId: queued.queuedMessageId,
      channelType: "api",
      summaryText: queued.summaryText,
      policy: {
        mode,
        allowed: true,
        reasonCodes: [],
        templateId: null,
        nextAllowedAt: null,
        duplicateBlocked: false
      }
    };
  }

  if (!explicitTemplateId) {
    throw new Error("Template send required. No approved template mapping exists for this request.");
  }

  const template = await getMessageTemplate(input.userId, explicitTemplateId);
  const policy = await evaluateOutboundTemplatePolicy({
    userId: input.userId,
    phoneNumber: conversation.phone_number,
    category: template.category,
    contact,
    marketingEnabled: true
  });
  if (!policy.allowed) {
    throw new Error(summarizeOutboundPolicyReasons(policy.reasonCodes).join(" "));
  }

  const variableValues = input.variableValues ?? {};

  const queued = await queueConversationTemplateMessage({
    userId: input.userId,
    conversationId: conversation.id,
    templateId: explicitTemplateId,
    variableValues,
    senderName: input.senderName ?? null,
    scheduledAt: undefined
  });

  return {
    queuedMessageId: queued.queuedMessageId,
    channelType: "api",
    summaryText: template.name,
    policy: {
      mode,
      allowed: true,
      reasonCodes: [],
      templateId: explicitTemplateId,
      nextAllowedAt: policy.nextAllowedAt,
      duplicateBlocked: false
    }
  };
}

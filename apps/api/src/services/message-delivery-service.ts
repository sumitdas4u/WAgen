import { env } from "../config/env.js";
import { firstRow } from "../db/sql-helpers.js";
import { pool } from "../db/pool.js";
import type { Conversation } from "../types/models.js";
import {
  deferCampaignMessageToNextDay,
  markCampaignMessageFailed,
  markCampaignMessageSent,
  type Campaign,
  type CampaignMessage
} from "./campaign-service.js";
import {
  getConversationById,
  getOrCreateConversation,
  setConversationManualAndPaused,
  trackOutboundMessage
} from "./conversation-service.js";
import {
  getContactByPhoneForUser,
  markContactTemplateOutboundActivity
} from "./contacts-service.js";
import {
  applyDeliveryAttemptWebhookStatusUpdate,
  applyCampaignDeliveryStatusUpdate,
  applyConversationDeliveryStatusUpdate,
  applySequenceDeliveryStatusUpdate,
  claimWebhookStatusEvent,
  classifyDeliveryFailure,
  markDeliveryAttemptFailure,
  markDeliveryAttemptSuccess,
  markWebhookStatusEventProcessed,
  recordDeliveryAttemptStart,
  retryDelayMs,
  upsertRecipientSuppression
} from "./message-delivery-data-service.js";
import { sendMetaFlowMessageDirect } from "./meta-whatsapp-service.js";
import {
  evaluateOutboundTemplatePolicy,
  summarizeOutboundPolicyReasons
} from "./outbound-policy-service.js";
import type { FlowMessagePayload } from "./outbound-message-types.js";
import { getQueueRedisConnection } from "./queue-service.js";
import { realtimeHub } from "./realtime-hub.js";
import { dispatchTemplateMessage, getMessageTemplate } from "./template-service.js";

const MAX_RETRIES = 1;
const rateLimitLocks = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tierDailyCap(tier: string | null | undefined): number {
  switch (tier) {
    case "TIER_1K":   return 1_000;
    case "TIER_10K":  return 10_000;
    case "TIER_100K": return 100_000;
    case "TIER_250":
    default:          return 250;
  }
}

async function countTodayOutboundSentForConnection(connectionId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM message_delivery_attempts
     WHERE connection_id = $1
       AND status = 'sent'
       AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')`,
    [connectionId]
  );
  return parseInt(firstRow(result)?.count ?? "0", 10);
}

async function getConnectionTier(connectionId: string): Promise<string | null> {
  const result = await pool.query<{ tier: string | null }>(
    `SELECT metadata_json->'metaHealth'->>'messagingLimitTier' AS tier
     FROM whatsapp_business_connections
     WHERE id = $1`,
    [connectionId]
  );
  return firstRow(result)?.tier ?? null;
}

function buildRateLimitKey(input: {
  userId: string;
  connectionId?: string | null;
  linkedNumber?: string | null;
  phoneNumberId?: string | null;
}): string {
  return [
    input.userId,
    input.connectionId?.trim() || "",
    input.phoneNumberId?.trim() || "",
    input.linkedNumber?.replace(/\D/g, "") || ""
  ].join(":");
}

export async function checkConnectionDailyCap(connectionId: string): Promise<{
  exceeded: boolean;
  cap: number;
  sentToday: number;
}> {
  const tier = await getConnectionTier(connectionId);
  const cap = tierDailyCap(tier);
  const sentToday = await countTodayOutboundSentForConnection(connectionId);
  return { exceeded: sentToday >= cap, cap, sentToday };
}

export async function waitForRateLimit(input: {
  userId: string;
  connectionId?: string | null;
  linkedNumber?: string | null;
  phoneNumberId?: string | null;
}): Promise<void> {
  const key = buildRateLimitKey(input);
  const minDelayMs = Math.ceil(1000 / Math.max(1, env.DELIVERY_PER_CONNECTION_RATE_LIMIT));
  const redis = getQueueRedisConnection();

  if (!redis) {
    const now = Date.now();
    const nextAllowedAt = rateLimitLocks.get(key) ?? 0;
    const waitMs = Math.max(0, nextAllowedAt - now);
    rateLimitLocks.set(key, Math.max(now, nextAllowedAt) + minDelayMs);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    return;
  }

  const redisKey = `delivery-rate:${env.QUEUE_PREFIX}:${key}`;
  while (true) {
    await redis.watch(redisKey);
    const now = Date.now();
    const currentRaw = await redis.get(redisKey);
    const currentNextAllowedAt = Number(currentRaw ?? 0);
    const nextAllowedAt = Number.isFinite(currentNextAllowedAt) ? currentNextAllowedAt : 0;
    const reservedStart = Math.max(now, nextAllowedAt);
    const reservedUntil = reservedStart + minDelayMs;
    const transaction = redis.multi();
    transaction.set(redisKey, String(reservedUntil), "PX", Math.max(60_000, minDelayMs * 5));
    const result = await transaction.exec();
    if (result) {
      const waitMs = Math.max(0, reservedStart - now);
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      return;
    }
  }
}

function flowMessageKind(payload: FlowMessagePayload): "conversation_flow" | "conversation_text" {
  return payload.type === "text" ? "conversation_text" : "conversation_flow";
}

async function lookupContactId(userId: string, phoneNumber: string): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    `SELECT id
     FROM contacts
     WHERE user_id = $1
       AND phone_number = $2
     LIMIT 1`,
    [userId, phoneNumber.replace(/\D/g, "")]
  );
  return firstRow(result)?.id ?? null;
}

export async function sendTrackedApiConversationFlowMessage(input: {
  userId: string;
  conversation: Conversation;
  payload: FlowMessagePayload;
  summaryText: string;
  mediaUrl?: string | null;
  senderName?: string | null;
  track?: boolean;
  usage?: {
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    aiModel?: string | null;
    retrievalChunks?: number | null;
    markAsAiReply?: boolean;
    echoId?: string | null;
  };
}): Promise<{ messageId: string | null }> {
  const lastInboundContact = await getContactByPhoneForUser(input.userId, input.conversation.phone_number);
  const lastInboundAt = lastInboundContact?.last_incoming_message_at
    ? Date.parse(lastInboundContact.last_incoming_message_at)
    : Number.NaN;
  if (!Number.isFinite(lastInboundAt) || lastInboundAt < Date.now() - 24 * 60 * 60_000) {
    throw new Error("Freeform WhatsApp API replies are only allowed within 24 hours of the customer's latest inbound message.");
  }

  const attempt = await recordDeliveryAttemptStart({
    userId: input.userId,
    conversationId: input.conversation.id,
    phoneNumber: input.conversation.phone_number,
    linkedNumber: input.conversation.channel_linked_number,
    messageKind: flowMessageKind(input.payload),
    attemptNumber: 1,
    payload: {
      type: input.payload.type,
      summaryText: input.summaryText
    }
  });

  try {
    await waitForRateLimit({
      userId: input.userId,
      linkedNumber: input.conversation.channel_linked_number
    });

    const sent = await sendMetaFlowMessageDirect({
      userId: input.userId,
      to: input.conversation.phone_number,
      payload: input.payload,
      linkedNumber: input.conversation.channel_linked_number
    });

    await markDeliveryAttemptSuccess({
      attemptId: attempt.id,
      userId: input.userId,
      providerMessageId: sent.messageId ?? null,
      connectionId: sent.connection.id,
      linkedNumber: sent.connection.linkedNumber,
      phoneNumberId: sent.connection.phoneNumberId,
      response: {
        summaryText: sent.summaryText,
        payloadType: input.payload.type
      }
    });

    if (input.track !== false) {
      await trackOutboundMessage(
        input.conversation.id,
        input.summaryText,
        {
          ...input.usage,
          senderName: input.senderName ?? null
        },
        input.mediaUrl ?? null,
        input.payload,
        sent.messageId ?? null
      );
    }

    return { messageId: sent.messageId ?? null };
  } catch (error) {
    const classification = classifyDeliveryFailure(error);
    const contactId = await lookupContactId(input.userId, input.conversation.phone_number);

    await markDeliveryAttemptFailure({
      attemptId: attempt.id,
      userId: input.userId,
      classification,
      linkedNumber: input.conversation.channel_linked_number,
      response: {
        payloadType: input.payload.type
      }
    });

    if (classification.suppressionReason) {
      await upsertRecipientSuppression({
        userId: input.userId,
        phoneNumber: input.conversation.phone_number,
        contactId,
        reason: classification.suppressionReason,
        source: "send_failure",
        metadata: {
          conversationId: input.conversation.id,
          messageType: input.payload.type
        }
      });
    }

    throw error;
  }
}

export async function deliverConversationTemplateMessage(input: {
  userId: string;
  conversationId: string;
  templateId: string;
  variableValues: Record<string, string>;
  senderName?: string | null;
}): Promise<{ messageId: string | null }> {
  const conversation = await getConversationById(input.conversationId);
  if (!conversation || conversation.user_id !== input.userId) {
    throw new Error("Conversation not found.");
  }
  if (conversation.channel_type !== "api") {
    throw new Error("Templates can only be sent on the API (Meta) channel.");
  }

  const template = await getMessageTemplate(input.userId, input.templateId);
  const contact = await getContactByPhoneForUser(input.userId, conversation.phone_number);
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

  if (template.connectionId) {
    const dailyCap = await checkConnectionDailyCap(template.connectionId);
    if (dailyCap.exceeded) {
      throw new Error(`Daily tier limit (${dailyCap.cap}) reached for this connection.`);
    }
  }

  const attempt = await recordDeliveryAttemptStart({
    userId: input.userId,
    conversationId: conversation.id,
    phoneNumber: conversation.phone_number,
    connectionId: template.connectionId,
    linkedNumber: template.linkedNumber,
    phoneNumberId: template.phoneNumberId,
    messageKind: "conversation_template",
    attemptNumber: 1,
    payload: {
      templateId: template.id,
      templateName: template.name,
      language: template.language,
      variableKeys: Object.keys(input.variableValues ?? {})
    }
  });

  try {
    await waitForRateLimit({
      userId: input.userId,
      connectionId: template.connectionId,
      linkedNumber: template.linkedNumber
    });

    const result = await dispatchTemplateMessage(input.userId, {
      templateId: input.templateId,
      to: conversation.phone_number,
      variableValues: input.variableValues,
      expectedLinkedNumber: conversation.channel_linked_number
    });

    await markDeliveryAttemptSuccess({
      attemptId: attempt.id,
      userId: input.userId,
      providerMessageId: result.messageId ?? null,
      connectionId: result.connection.id,
      linkedNumber: result.connection.linkedNumber,
      phoneNumberId: result.connection.phoneNumberId,
      response: {
        summaryText: result.summaryText,
        templateName: result.template.name
      }
    });

    await trackOutboundMessage(
      conversation.id,
      result.summaryText,
      { senderName: input.senderName ?? null },
      result.messagePayload.headerMediaUrl ?? null,
      result.messagePayload,
      result.messageId ?? null
    );
    await markContactTemplateOutboundActivity(input.userId, conversation.phone_number, result.template.category);
    await setConversationManualAndPaused(input.userId, conversation.id);

    realtimeHub.broadcast(input.userId, "conversation.updated", {
      conversationId: conversation.id,
      phoneNumber: conversation.phone_number,
      direction: "outbound",
      message: result.summaryText,
      createdAt: new Date().toISOString(),
      affectsListOrder: true,
      score: conversation.score,
      stage: conversation.stage
    });

    return { messageId: result.messageId ?? null };
  } catch (error) {
    const classification = classifyDeliveryFailure(error);
    const contactId = await lookupContactId(input.userId, conversation.phone_number);

    await markDeliveryAttemptFailure({
      attemptId: attempt.id,
      userId: input.userId,
      classification,
      connectionId: template.connectionId,
      linkedNumber: template.linkedNumber,
      phoneNumberId: template.phoneNumberId,
      response: {
        templateId: template.id,
        templateName: template.name
      }
    });

    if (classification.suppressionReason) {
      await upsertRecipientSuppression({
        userId: input.userId,
        phoneNumber: conversation.phone_number,
        contactId,
        reason: classification.suppressionReason,
        source: "send_failure",
        metadata: {
          conversationId: conversation.id,
          templateId: template.id,
          templateName: template.name
        }
      });
    }

    throw error;
  }
}

export async function deliverCampaignMessage(input: {
  userId: string;
  campaign: Campaign;
  message: CampaignMessage;
  senderName: string;
}): Promise<{
  status: "sent" | "retrying" | "failed";
  errorMessage?: string | null;
}> {
  if (!input.campaign.template_id) {
    throw new Error("Campaign has no template selected.");
  }

  const template = await getMessageTemplate(input.userId, input.campaign.template_id);
  const contact = input.message.contact_id
    ? await getContactByPhoneForUser(input.userId, input.message.phone_number)
    : await getContactByPhoneForUser(input.userId, input.message.phone_number);
  const policy = await evaluateOutboundTemplatePolicy({
    userId: input.userId,
    phoneNumber: input.message.phone_number,
    category: template.category,
    contact,
    marketingEnabled: true,
    enforceConsentPolicy: input.campaign.enforce_marketing_policy
  });
  if (!policy.allowed) {
    const policyMessage = summarizeOutboundPolicyReasons(policy.reasonCodes).join(" ");
    await markCampaignMessageFailed(input.message.id, "POLICY_BLOCK", policyMessage, true);
    return { status: "failed", errorMessage: policyMessage };
  }

  if (input.campaign.connection_id) {
    const dailyCap = await checkConnectionDailyCap(input.campaign.connection_id);
    if (dailyCap.exceeded) {
      await deferCampaignMessageToNextDay(input.message.id);
      return { status: "retrying", errorMessage: `Daily tier limit (${dailyCap.cap}) reached. Deferred to next day.` };
    }
  }

  const attempt = await recordDeliveryAttemptStart({
    userId: input.userId,
    campaignId: input.campaign.id,
    campaignMessageId: input.message.id,
    contactId: input.message.contact_id,
    phoneNumber: input.message.phone_number,
    connectionId: template.connectionId,
    linkedNumber: template.linkedNumber,
    phoneNumberId: template.phoneNumberId,
    messageKind: "campaign_template",
    attemptNumber: input.message.retry_count + 1,
    payload: {
      templateId: template.id,
      templateName: template.name,
      language: template.language,
      resolvedVariables: input.message.resolved_variables_json ?? {}
    }
  });

  try {
    await waitForRateLimit({
      userId: input.userId,
      connectionId: template.connectionId,
      linkedNumber: template.linkedNumber
    });

    const sent = await dispatchTemplateMessage(input.userId, {
      templateId: input.campaign.template_id,
      to: input.message.phone_number,
      variableValues: input.message.resolved_variables_json ?? {}
    });

    await markCampaignMessageSent(input.message.id, sent.messageId ?? null);
    await markDeliveryAttemptSuccess({
      attemptId: attempt.id,
      userId: input.userId,
      providerMessageId: sent.messageId ?? null,
      connectionId: sent.connection.id,
      linkedNumber: sent.connection.linkedNumber,
      phoneNumberId: sent.connection.phoneNumberId,
      campaignId: input.campaign.id,
      response: {
        summaryText: sent.summaryText,
        templateName: sent.template.name
      }
    });

    const conversation = await getOrCreateConversation(input.userId, input.message.phone_number, {
      channelType: "api",
      channelLinkedNumber: sent.connection.linkedNumber
    });

    await trackOutboundMessage(
      conversation.id,
      sent.summaryText,
      { senderName: input.senderName, sourceType: "broadcast" },
      sent.messagePayload.headerMediaUrl ?? null,
      sent.messagePayload,
      sent.messageId ?? null
    );
    await markContactTemplateOutboundActivity(input.userId, input.message.phone_number, sent.template.category);

    realtimeHub.broadcast(input.userId, "conversation.updated", {
      conversationId: conversation.id,
      phoneNumber: input.message.phone_number,
      direction: "outbound",
      message: sent.summaryText,
      createdAt: new Date().toISOString(),
      affectsListOrder: true,
      score: conversation.score,
      stage: conversation.stage
    });
    return { status: "sent" };
  } catch (error) {
    const classification = classifyDeliveryFailure(error);
    const shouldRetry = classification.category === "transient" && classification.retryable && input.message.retry_count < MAX_RETRIES;
    const nextRetryAt = shouldRetry ? new Date(Date.now() + retryDelayMs(input.message.retry_count)) : null;

    await markCampaignMessageFailed(
      input.message.id,
      classification.errorCode,
      classification.errorMessage,
      !nextRetryAt,
      nextRetryAt ?? undefined
    );
    await markDeliveryAttemptFailure({
      attemptId: attempt.id,
      userId: input.userId,
      classification,
      nextRetryAt: nextRetryAt?.toISOString() ?? null,
      connectionId: template.connectionId,
      linkedNumber: template.linkedNumber,
      phoneNumberId: template.phoneNumberId,
      campaignId: input.campaign.id,
      response: {
        templateId: template.id,
        templateName: template.name
      }
    });

    if (classification.suppressionReason) {
      await upsertRecipientSuppression({
        userId: input.userId,
        phoneNumber: input.message.phone_number,
        contactId: input.message.contact_id,
        reason: classification.suppressionReason,
        source: "send_failure",
        metadata: {
          campaignId: input.campaign.id,
          campaignMessageId: input.message.id,
          templateId: template.id,
          templateName: template.name
        }
      });
    }

    return {
      status: shouldRetry ? "retrying" : "failed",
      errorMessage: classification.errorMessage
    };
  }
}

function statusTimestampToIso(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  if (/^\d+$/.test(value.trim())) {
    return new Date(Number(value.trim()) * 1000).toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function readWebhookError(raw: Record<string, unknown>): { code: string | null; message: string | null } {
  const errors = Array.isArray(raw.errors) ? (raw.errors as Array<Record<string, unknown>>) : [];
  const first = errors[0] ?? {};
  const code = first.code != null ? String(first.code) : null;
  const errorData = first.error_data && typeof first.error_data === "object" ? (first.error_data as Record<string, unknown>) : null;
  const details =
    typeof errorData?.details === "string"
      ? errorData.details.trim()
      : typeof first.details === "string"
        ? first.details.trim()
        : null;
  const baseMessage =
    typeof first.message === "string"
      ? first.message.trim()
      : typeof first.title === "string"
        ? first.title.trim()
        : null;
  const message =
    baseMessage && details && baseMessage.toLowerCase() !== details.toLowerCase()
      ? `${baseMessage}: ${details}`
      : baseMessage ?? details ?? null;
  return { code, message };
}

export interface MetaDeliveryStatusEvent {
  wamid: string;
  status: "sent" | "delivered" | "read" | "failed";
  errorCode: string | null;
  errorMessage: string | null;
  eventTimestamp: string | null;
  payload: Record<string, unknown>;
}

export function extractMetaDeliveryStatusEvents(payload: unknown): MetaDeliveryStatusEvent[] {
  const parsed = payload as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          statuses?: Array<Record<string, unknown>>;
        };
      }>;
    }>;
  };

  const events: MetaDeliveryStatusEvent[] = [];
  for (const entry of parsed.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const statuses = change.value?.statuses;
      if (!Array.isArray(statuses) || statuses.length === 0) {
        continue;
      }

      for (const raw of statuses) {
        const wamid = typeof raw.id === "string" ? raw.id : null;
        const status = typeof raw.status === "string" ? raw.status : null;
        if (!wamid || !status) {
          continue;
        }
        if (status !== "sent" && status !== "delivered" && status !== "read" && status !== "failed") {
          continue;
        }

        const error = readWebhookError(raw);
        events.push({
          wamid,
          status,
          errorCode: error.code,
          errorMessage: error.message,
          eventTimestamp: statusTimestampToIso(raw.timestamp),
          payload: raw
        });
      }
    }
  }

  return events;
}

export async function processMetaDeliveryStatusEvent(event: MetaDeliveryStatusEvent): Promise<void> {
  const claimed = await claimWebhookStatusEvent({
    wamid: event.wamid,
    status: event.status,
    errorCode: event.errorCode,
    eventTimestamp: event.eventTimestamp,
    payload: event.payload
  });
  if (!claimed.shouldProcess || !claimed.eventId) {
    return;
  }

  try {
    await applyDeliveryAttemptWebhookStatusUpdate({
      wamid: event.wamid,
      status: event.status,
      errorCode: event.errorCode,
      errorMessage: event.errorMessage,
      eventTimestamp: event.eventTimestamp,
      payload: event.payload
    });
    await applyConversationDeliveryStatusUpdate({
      wamid: event.wamid,
      status: event.status,
      errorCode: event.errorCode,
      errorMessage: event.errorMessage,
      eventTimestamp: event.eventTimestamp
    });
    await applyCampaignDeliveryStatusUpdate({
      wamid: event.wamid,
      status: event.status,
      errorCode: event.errorCode,
      errorMessage: event.errorMessage,
      eventTimestamp: event.eventTimestamp
    });
    await applySequenceDeliveryStatusUpdate({ wamid: event.wamid, status: event.status });
    await markWebhookStatusEventProcessed(claimed.eventId);
    void firePerMessageWebhook(event);
  } catch (error) {
    console.error("[DeliveryWebhook] status processing failed", error);
  }
}

async function firePerMessageWebhook(event: MetaDeliveryStatusEvent): Promise<void> {
  try {
    const result = await pool.query<{ webhook_url: string }>(
      `SELECT webhook_url
       FROM conversation_messages
       WHERE wamid = $1
         AND webhook_url IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [event.wamid]
    );
    const webhookUrl = firstRow(result)?.webhook_url;
    if (!webhookUrl) {
      return;
    }

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wamid: event.wamid,
        status: event.status,
        errorCode: event.errorCode ?? null,
        errorMessage: event.errorMessage ?? null,
        timestamp: event.eventTimestamp ?? new Date().toISOString()
      }),
      signal: AbortSignal.timeout(10_000)
    });
  } catch (error) {
    console.warn(`[DeliveryWebhook] per-message webhook fire failed wamid=${event.wamid}`, error);
  }
}

export async function processMetaDeliveryStatuses(payload: unknown): Promise<void> {
  for (const event of extractMetaDeliveryStatusEvents(payload)) {
    await processMetaDeliveryStatusEvent(event);
  }
}

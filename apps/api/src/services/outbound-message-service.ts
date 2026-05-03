import { randomUUID } from "node:crypto";
import { DelayedError, Job, QueueEvents, UnrecoverableError, Worker, type JobsOptions } from "bullmq";
import { env } from "../config/env.js";
import { firstRow, requireRow } from "../db/sql-helpers.js";
import { pool } from "../db/pool.js";
import {
  getConversationById,
  getOrCreateConversation,
  setConversationResolved,
  trackOutboundMessage
} from "./conversation-service.js";
import { getContactByPhoneForUser } from "./contacts-service.js";
import { clearFrequencyCapSend } from "./outbound-policy-service.js";
import { deliverCampaignMessage, deliverConversationTemplateMessage, sendTrackedApiConversationFlowMessage } from "./message-delivery-service.js";
import { registerChannelAdapter, getChannelAdapter, type ConversationChannelAdapter } from "./channel-adapter.js";
import { realtimeHub } from "./realtime-hub.js";
import {
  createQueueWorkerConnection,
  getOutboundExecutionQueue,
  getOutboundQrExecutionQueue,
  getQueueRedisConnection
} from "./queue-service.js";
import { sendWidgetConversationMessage } from "./widget-chat-gateway-service.js";
import { whatsappSessionManager } from "./whatsapp-session-manager.js";
import { getPayloadMediaUrl, summarizeFlowMessage, type FlowMessagePayload, validateFlowMessagePayload } from "./outbound-message-types.js";
import { classifyDeliveryFailure } from "./message-delivery-data-service.js";
import type { Campaign, CampaignMessage } from "./campaign-service.js";
import { executeQueuedGenericWebhookLog } from "./generic-webhook-service.js";
import { executeSequenceOutboundMessage } from "./sequence-execution-service.js";

type OutboundMessageType =
  | "conversation_api"
  | "conversation_qr"
  | "conversation_web"
  | "template_api"
  | "campaign_send"
  | "sequence_send"
  | "generic_webhook";

type OutboundChannel = "api" | "qr" | "web" | "webhook";
type OutboundMessageStatus = "queued" | "processing" | "completed" | "failed";

interface OutboundMessageRow {
  id: string;
  user_id: string;
  type: OutboundMessageType;
  channel: OutboundChannel;
  status: OutboundMessageStatus;
  job_key: string;
  conversation_id: string | null;
  template_id: string | null;
  campaign_message_id: string | null;
  sequence_enrollment_id: string | null;
  sequence_step_index: number | null;
  generic_webhook_log_id: string | null;
  scheduled_at: string;
  grouping_key: string | null;
  sender_name: string | null;
  display_text: string | null;
  media_url: string | null;
  media_mime_type: string | null;
  payload_json: Record<string, unknown>;
  variable_values_json: Record<string, string>;
  usage_json: Record<string, unknown>;
  provider_message_id: string | null;
  error_message: string | null;
  attempt_count: number;
  created_at: string;
  updated_at: string;
}

type OutboundJobPayload =
  | { type: "conversation_api"; messageId: string }
  | { type: "conversation_qr"; messageId: string }
  | { type: "conversation_web"; messageId: string }
  | { type: "template_api"; messageId: string }
  | { type: "campaign_send"; campaignMessageId: string }
  | { type: "sequence_send"; enrollmentId: string; stepIndex: number }
  | { type: "generic_webhook"; logId: string };

interface OutboundConversationUsage {
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  aiModel?: string | null;
  retrievalChunks?: number | null;
  markAsAiReply?: boolean;
  echoId?: string | null;
}

interface CampaignExecutionRow {
  id: string;
  campaign_id: string;
  contact_id: string | null;
  phone_number: string;
  wamid: string | null;
  status: CampaignMessage["status"];
  retry_count: number;
  next_retry_at: string | null;
  error_code: string | null;
  error_message: string | null;
  resolved_variables_json: Record<string, string> | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
  updated_at: string;
  campaign_user_id: string;
  campaign_name: string;
  campaign_status: Campaign["status"];
  broadcast_type: Campaign["broadcast_type"];
  connection_id: string | null;
  template_id: string | null;
  template_variables: Campaign["template_variables"];
  target_segment_id: string | null;
  source_campaign_id: string | null;
  retarget_status: Campaign["retarget_status"];
  audience_source_json: Campaign["audience_source_json"];
  media_overrides_json: Campaign["media_overrides_json"];
  campaign_scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  total_count: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  skipped_count: number;
  enforce_marketing_policy: boolean;
  smart_retry_enabled: boolean;
  smart_retry_until: string | null;
  campaign_created_at: string;
  campaign_updated_at: string;
  sender_name: string | null;
}

let worker: Worker<OutboundJobPayload> | null = null;
let qrWorker: Worker<OutboundJobPayload> | null = null;
let queueEvents: QueueEvents | null = null;
let qrQueueEvents: QueueEvents | null = null;
let reconciliationTimer: ReturnType<typeof setInterval> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jobOptions(payload: OutboundJobPayload, scheduledAt?: string | null): JobsOptions {
  const delayMs = scheduledAt ? Math.max(0, Date.parse(scheduledAt) - Date.now()) : 0;
  const attempts = payload.type === "campaign_send" || payload.type === "sequence_send" ? 1 : 5;
  return {
    attempts,
    backoff: {
      type: "exponential",
      delay: 3000
    },
    delay: Number.isFinite(delayMs) ? delayMs : 0,
    removeOnComplete: 5000,
    removeOnFail: 10000
  };
}

function hasRemainingAttempts(job: Job<OutboundJobPayload>, maxAttempts?: number): boolean {
  const configured = typeof maxAttempts === "number" ? maxAttempts : Number(job.opts.attempts ?? 1);
  return job.attemptsMade + 1 < configured;
}

function toBullMqSafeJobId(value: string): string {
  return value.replace(/:/g, "-");
}

function buildOutboundJobKey(channel: string, entityId: string): string {
  return toBullMqSafeJobId(`outbound-${channel}-${entityId}`);
}

function buildConversationJobPayload(type: "conversation_api" | "conversation_qr" | "conversation_web" | "template_api", messageId: string): OutboundJobPayload {
  return { type, messageId } as OutboundJobPayload;
}

function isConversationJobType(type: OutboundMessageType): type is "conversation_api" | "conversation_qr" | "conversation_web" | "template_api" {
  return type === "conversation_api" || type === "conversation_qr" || type === "conversation_web" || type === "template_api";
}

function parseUsage(row: OutboundMessageRow): OutboundConversationUsage {
  return row.usage_json as OutboundConversationUsage;
}

async function insertOutboundMessage(input: {
  id?: string;
  userId: string;
  type: OutboundMessageType;
  channel: OutboundChannel;
  jobKey: string;
  conversationId?: string | null;
  templateId?: string | null;
  campaignMessageId?: string | null;
  sequenceEnrollmentId?: string | null;
  sequenceStepIndex?: number | null;
  genericWebhookLogId?: string | null;
  scheduledAt?: string | null;
  groupingKey?: string | null;
  senderName?: string | null;
  displayText?: string | null;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  payloadJson?: Record<string, unknown>;
  variableValues?: Record<string, string>;
  usage?: Record<string, unknown>;
}): Promise<OutboundMessageRow> {
  const id = input.id ?? randomUUID();
  const result = await pool.query<OutboundMessageRow>(
    `INSERT INTO outbound_messages (
       id,
       user_id,
       type,
       channel,
       job_key,
       conversation_id,
       template_id,
       campaign_message_id,
       sequence_enrollment_id,
       sequence_step_index,
       generic_webhook_log_id,
       scheduled_at,
       grouping_key,
       sender_name,
       display_text,
       media_url,
       media_mime_type,
       payload_json,
       variable_values_json,
       usage_json
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, NOW()), $13, $14, $15, $16, $17,
       $18::jsonb, $19::jsonb, $20::jsonb
     )
     ON CONFLICT (job_key)
     DO UPDATE SET
       scheduled_at = LEAST(outbound_messages.scheduled_at, COALESCE(EXCLUDED.scheduled_at, outbound_messages.scheduled_at)),
       updated_at = NOW()
     RETURNING *`,
    [
      id,
      input.userId,
      input.type,
      input.channel,
      input.jobKey,
      input.conversationId ?? null,
      input.templateId ?? null,
      input.campaignMessageId ?? null,
      input.sequenceEnrollmentId ?? null,
      input.sequenceStepIndex ?? null,
      input.genericWebhookLogId ?? null,
      input.scheduledAt ?? null,
      input.groupingKey ?? null,
      input.senderName ?? null,
      input.displayText ?? null,
      input.mediaUrl ?? null,
      input.mediaMimeType ?? null,
      JSON.stringify(input.payloadJson ?? {}),
      JSON.stringify(input.variableValues ?? {}),
      JSON.stringify(input.usage ?? {})
    ]
  );
  return requireRow(result, "Expected outbound message row");
}

async function loadOutboundMessageByConversationId(messageId: string): Promise<OutboundMessageRow | null> {
  const result = await pool.query<OutboundMessageRow>(
    `SELECT * FROM outbound_messages WHERE id = $1 LIMIT 1`,
    [messageId]
  );
  return firstRow(result);
}

async function loadOutboundMessageByCampaignMessageId(campaignMessageId: string): Promise<OutboundMessageRow | null> {
  const result = await pool.query<OutboundMessageRow>(
    `SELECT * FROM outbound_messages WHERE campaign_message_id = $1 LIMIT 1`,
    [campaignMessageId]
  );
  return firstRow(result);
}

async function loadOutboundMessageBySequenceKey(enrollmentId: string, stepIndex: number): Promise<OutboundMessageRow | null> {
  const result = await pool.query<OutboundMessageRow>(
    `SELECT *
     FROM outbound_messages
     WHERE sequence_enrollment_id = $1
       AND sequence_step_index = $2
     LIMIT 1`,
    [enrollmentId, stepIndex]
  );
  return firstRow(result);
}

async function loadOutboundMessageByWebhookLogId(logId: string): Promise<OutboundMessageRow | null> {
  const result = await pool.query<OutboundMessageRow>(
    `SELECT * FROM outbound_messages WHERE generic_webhook_log_id = $1 LIMIT 1`,
    [logId]
  );
  return firstRow(result);
}

async function updateOutboundMessageState(input: {
  id: string;
  status?: OutboundMessageStatus;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  attemptCount?: number;
}): Promise<void> {
  const result = await pool.query<{
    type: OutboundMessageType;
    generic_webhook_log_id: string | null;
    conversation_id: string | null;
    user_id: string;
    status: OutboundMessageStatus;
    provider_message_id: string | null;
    error_message: string | null;
  }>(
    `UPDATE outbound_messages
     SET status = COALESCE($2, status),
         provider_message_id = COALESCE($3, provider_message_id),
         error_message = $4,
         attempt_count = COALESCE($5, attempt_count)
     WHERE id = $1
     RETURNING type, generic_webhook_log_id, conversation_id, user_id, status, provider_message_id, error_message`,
    [
      input.id,
      input.status ?? null,
      input.providerMessageId ?? null,
      input.errorMessage ?? null,
      input.attemptCount ?? null
    ]
  );

  const row = firstRow(result);
  if (!row) return;

  // When a conversation job fails permanently, flip any pending conversation_messages
  // row back to failed so the retry spinner resolves and the user sees the error.
  if (
    row.status === "failed" &&
    row.conversation_id &&
    isConversationJobType(row.type)
  ) {
    const failedMsgs = await pool.query<{ id: string }>(
      `UPDATE conversation_messages
       SET delivery_status = 'failed',
           error_message = COALESCE($2, error_message)
       WHERE conversation_id = $1
         AND delivery_status = 'pending'
       RETURNING id`,
      [row.conversation_id, row.error_message ?? null]
    );
    for (const fm of failedMsgs.rows) {
      realtimeHub.broadcastMessageUpdated(row.user_id, {
        conversationId: row.conversation_id,
        messageId: fm.id,
        deliveryStatus: "failed",
        errorMessage: row.error_message ?? undefined
      });
    }
  }

  if (!row.generic_webhook_log_id || row.type !== "template_api") {
    return;
  }

  if (row.status === "completed" || row.status === "failed") {
    await pool.query(
      `UPDATE generic_webhook_logs
       SET status = $2,
           provider_message_id = COALESCE($3, provider_message_id),
           error_message = $4
       WHERE id = $1`,
      [
        row.generic_webhook_log_id,
        row.status,
        row.provider_message_id,
        row.error_message
      ]
    );
  }
}

async function enqueueOutboundJob(payload: OutboundJobPayload, jobKey: string, scheduledAt?: string | null): Promise<void> {
  const queue =
    payload.type === "conversation_qr"
      ? getOutboundQrExecutionQueue()
      : getOutboundExecutionQueue();
  if (!queue) {
    throw new Error("Outbound execution queue is unavailable because REDIS_URL is not configured.");
  }

  await queue.add("execute-outbound", payload, {
    jobId: toBullMqSafeJobId(jobKey),
    ...jobOptions(payload, scheduledAt)
  });
}

async function withGroupingLock<T>(groupingKey: string | null | undefined, run: () => Promise<T>): Promise<T> {
  const redis = getQueueRedisConnection();
  if (!redis || !groupingKey) {
    return run();
  }

  const lockKey = `outbound-order:${groupingKey}`;
  const lockValue = randomUUID();
  const acquired = await redis.set(lockKey, lockValue, "PX", 30_000, "NX");
  if (!acquired) {
    throw new Error("Outbound ordering lock busy.");
  }

  try {
    return await run();
  } finally {
    const current = await redis.get(lockKey);
    if (current === lockValue) {
      await redis.del(lockKey);
    }
  }
}

function classifyOutboundError(row: OutboundMessageRow | null, error: unknown): { retryable: boolean; errorMessage: string } {
  if (error instanceof UnrecoverableError) {
    return {
      retryable: false,
      errorMessage: error.message || "Unrecoverable outbound failure"
    };
  }

  const message = error instanceof Error ? error.message : String(error ?? "Unknown outbound failure");
  const normalized = message.toLowerCase();
  const isQrExecution = row?.channel === "qr" || (
    row?.type === "generic_webhook" &&
    String((row.payload_json as Record<string, unknown> | null)?.channelMode ?? "").toLowerCase() === "qr"
  );
  if (isQrExecution && (
    normalized.includes("whatsapp qr session is not connected") ||
    normalized.includes("connection closed") ||
    normalized.includes("logged out")
  )) {
    return { retryable: false, errorMessage: message };
  }

  const deliveryFailure = classifyDeliveryFailure(error);
  return {
    retryable: deliveryFailure.retryable,
    errorMessage: deliveryFailure.errorMessage
  };
}

async function loadCampaignExecutionInput(campaignMessageId: string): Promise<{ campaign: Campaign; message: CampaignMessage; userId: string; senderName: string } | null> {
  const result = await pool.query<CampaignExecutionRow>(
    `SELECT
       cm.*,
       c.user_id AS campaign_user_id,
       c.name AS campaign_name,
       c.status AS campaign_status,
       c.broadcast_type,
       c.connection_id,
       c.template_id,
       c.template_variables,
       c.target_segment_id,
       c.source_campaign_id,
       c.retarget_status,
       c.audience_source_json,
       c.media_overrides_json,
       c.scheduled_at AS campaign_scheduled_at,
       c.started_at,
       c.completed_at,
       c.total_count,
       c.sent_count,
       c.delivered_count,
       c.read_count,
       c.failed_count,
       c.skipped_count,
       c.enforce_marketing_policy,
       c.smart_retry_enabled,
       c.smart_retry_until,
       c.created_at AS campaign_created_at,
       c.updated_at AS campaign_updated_at,
       u.name AS sender_name
     FROM campaign_messages cm
     JOIN campaigns c ON c.id = cm.campaign_id
     JOIN users u ON u.id = c.user_id
     WHERE cm.id = $1
     LIMIT 1`,
    [campaignMessageId]
  );
  const row = firstRow(result);
  if (!row) return null;

  const campaign: Campaign = {
    id: row.campaign_id,
    user_id: row.campaign_user_id,
    name: row.campaign_name,
    status: row.campaign_status,
    broadcast_type: row.broadcast_type,
    connection_id: row.connection_id ?? null,
    template_id: row.template_id,
    template_variables: (row as unknown as Campaign).template_variables,
    target_segment_id: row.target_segment_id,
    source_campaign_id: row.source_campaign_id,
    retarget_status: row.retarget_status,
    audience_source_json: row.audience_source_json,
    media_overrides_json: row.media_overrides_json,
    scheduled_at: row.campaign_scheduled_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    total_count: row.total_count,
    sent_count: row.sent_count,
    delivered_count: row.delivered_count,
    read_count: row.read_count,
    failed_count: row.failed_count,
    skipped_count: row.skipped_count,
    enforce_marketing_policy: row.enforce_marketing_policy ?? true,
    smart_retry_enabled: row.smart_retry_enabled ?? false,
    smart_retry_until: row.smart_retry_until ?? null,
    created_at: row.campaign_created_at,
    updated_at: row.campaign_updated_at
  };

  const message: CampaignMessage = {
    id: row.id,
    campaign_id: row.campaign_id,
    contact_id: row.contact_id,
    phone_number: row.phone_number,
    wamid: row.wamid,
    status: row.status,
    retry_count: row.retry_count,
    next_retry_at: row.next_retry_at,
    error_code: row.error_code,
    error_message: row.error_message,
    resolved_variables_json: row.resolved_variables_json,
    sent_at: row.sent_at,
    delivered_at: row.delivered_at,
    read_at: row.read_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };

  return {
    campaign,
    message,
    userId: row.campaign_user_id,
    senderName: row.sender_name?.trim() || "Agent"
  };
}

async function broadcastConversationUpdate(conversationId: string, summaryText: string): Promise<void> {
  const conversation = await getConversationById(conversationId);
  if (!conversation) {
    return;
  }
  realtimeHub.broadcast(conversation.user_id, "conversation.updated", {
    conversationId: conversation.id,
    phoneNumber: conversation.phone_number,
    direction: "outbound",
    message: summaryText,
    createdAt: new Date().toISOString(),
    affectsListOrder: true,
    score: conversation.score,
    stage: conversation.stage
  });
}

async function loadOutboundMessageForConversationRetry(input: {
  userId: string;
  conversationId: string;
  messageId: string;
}): Promise<OutboundMessageRow | null> {
  const result = await pool.query<OutboundMessageRow>(
    `SELECT om.*
     FROM conversation_messages cm
     JOIN outbound_messages om
       ON om.conversation_id = cm.conversation_id
      AND (
        om.id = NULLIF(cm.echo_id, '')::uuid
        OR om.provider_message_id = cm.wamid
      )
     WHERE cm.id = $1
       AND cm.conversation_id = $2
       AND om.user_id = $3
       AND om.type IN ('conversation_api', 'conversation_qr', 'conversation_web', 'template_api')
     ORDER BY om.updated_at DESC
     LIMIT 1`,
    [input.messageId, input.conversationId, input.userId]
  );
  return firstRow(result);
}

async function attachConversationProviderMessageId(row: OutboundMessageRow, providerMessageId: string | null): Promise<void> {
  if (!row.conversation_id || !providerMessageId) {
    return;
  }

  const usage = parseUsage(row);
  const echoId = usage.echoId?.trim() || row.id;
  await pool.query(
    `UPDATE conversation_messages
     SET wamid = COALESCE(wamid, $3),
         delivery_status = CASE
           WHEN delivery_status IN ('delivered', 'read', 'failed') THEN delivery_status
           ELSE 'sent'
         END,
         sent_at = COALESCE(sent_at, NOW()),
         error_code = NULL,
         error_message = NULL
     WHERE conversation_id = $1
       AND direction = 'outbound'
       AND echo_id = $2`,
    [row.conversation_id, echoId, providerMessageId]
  );
}

async function ensureQrSessionReady(userId: string): Promise<void> {
  const maxAttempts = 5;
  const waitMs = 2_000;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await whatsappSessionManager.getStatus(userId);
    if (status.status === "connected") {
      return;
    }
    if (status.status === "disconnected" || status.status === "degraded") {
      throw new Error(status.statusMessage?.trim() || "WhatsApp QR session is not connected.");
    }
    if (attempt < maxAttempts - 1) {
      await sleep(waitMs);
    }
  }

  throw new Error("WhatsApp QR session connection timed out.");
}

// --- Channel adapter registrations ---
// To add a new outbound channel: implement ConversationChannelAdapter and call
// registerChannelAdapter() with your implementation. The worker will route to it
// automatically based on the conversation's channel_type.

const metaConversationAdapter: ConversationChannelAdapter = {
  channelType: "api",
  async send({ userId, conversation, payload, summaryText, mediaUrl, senderName, usage }) {
    // Message was already pre-tracked to conversation_messages by the API server
    // process at queue time (channel-outbound-service). Skip re-inserting.
    const result = await sendTrackedApiConversationFlowMessage({
      userId,
      conversation,
      payload,
      summaryText,
      mediaUrl,
      senderName,
      usage,
      track: false
    });
    return { messageId: result.messageId, tracked: true };
  }
};

const baileysConversationAdapter: ConversationChannelAdapter = {
  channelType: "qr",
  async send({ userId, conversation, payload }) {
    await ensureQrSessionReady(userId);
    await whatsappSessionManager.sendFlowMessage({
      userId,
      phoneNumber: conversation.phone_number,
      payload
    });
    return { messageId: null, tracked: false };
  }
};

const webConversationAdapter: ConversationChannelAdapter = {
  channelType: "web",
  async send({ userId, conversation, summaryText }) {
    const delivered = await sendWidgetConversationMessage({
      userId,
      customerIdentifier: conversation.phone_number,
      text: summaryText
    });
    if (!delivered) {
      throw new Error("Web visitor is offline. History is still available, but replies can only be sent while the visitor is connected.");
    }
    return { messageId: null, tracked: false };
  }
};

registerChannelAdapter(metaConversationAdapter);
registerChannelAdapter(baileysConversationAdapter);
registerChannelAdapter(webConversationAdapter);

async function processConversationChannel(row: OutboundMessageRow): Promise<void> {
  const conversation = await getConversationById(row.conversation_id ?? "");
  if (!conversation || conversation.user_id !== row.user_id) {
    throw new Error("Conversation not found.");
  }

  const payload = validateFlowMessagePayload(row.payload_json as FlowMessagePayload);
  const summaryText = row.display_text?.trim() || summarizeFlowMessage(payload);
  if (!summaryText) {
    throw new Error("Message text is required.");
  }

  const adapter = getChannelAdapter(row.channel);
  if (!adapter) {
    throw new Error(`No channel adapter registered for channel: ${row.channel}`);
  }

  const mediaUrl = row.media_url ?? getPayloadMediaUrl(payload) ?? null;
  const usage = parseUsage(row);

  const result = await adapter.send({
    userId: row.user_id,
    conversation,
    payload,
    summaryText,
    mediaUrl,
    senderName: row.sender_name ?? null,
    usage
  });

  if (!result.tracked) {
    await trackOutboundMessage(
      conversation.id,
      summaryText,
      { ...usage, senderName: row.sender_name ?? null },
      mediaUrl,
      payload,
      null
    );
  }

  await updateOutboundMessageState({
    id: row.id,
    status: "completed",
    providerMessageId: result.messageId ?? null,
    errorMessage: null
  });
  await attachConversationProviderMessageId(row, result.messageId);
  await broadcastConversationUpdate(conversation.id, summaryText);
}

async function processTemplateApi(row: OutboundMessageRow, job: Job<OutboundJobPayload>, token?: string): Promise<void> {
  if (!row.conversation_id || !row.template_id) {
    throw new Error("Template outbound message is missing execution context.");
  }

  const result = await deliverConversationTemplateMessage({
    userId: row.user_id,
    conversationId: row.conversation_id,
    templateId: row.template_id,
    variableValues: row.variable_values_json ?? {},
    senderName: row.sender_name ?? null
  });

  if (result.deferred) {
    await pool.query(
      `UPDATE outbound_messages SET status = 'queued', scheduled_at = $2 WHERE id = $1`,
      [row.id, result.delayUntil]
    );
    await job.moveToDelayed(Date.parse(result.delayUntil), token);
    throw new DelayedError();
  }

  await updateOutboundMessageState({
    id: row.id,
    status: "completed",
    providerMessageId: result.messageId ?? null,
    errorMessage: null
  });

  if (row.generic_webhook_log_id && row.conversation_id) {
    await setConversationResolved(row.user_id, row.conversation_id);
  }
}

async function processCampaignSend(row: OutboundMessageRow, job: Job<OutboundJobPayload>, token?: string): Promise<void> {
  if (!row.campaign_message_id) {
    throw new Error("Campaign outbound message is missing campaign message context.");
  }
  const input = await loadCampaignExecutionInput(row.campaign_message_id);
  if (!input) {
    throw new Error("Campaign message not found.");
  }
  const outcome = await deliverCampaignMessage({
    userId: input.userId,
    campaign: input.campaign,
    message: input.message,
    senderName: input.senderName
  });
  if (outcome.status === "retrying" && outcome.retryAt) {
    // Use BullMQ native delayed job — no reconciliation polling needed.
    // DB scheduled_at is updated for visibility and crash recovery only.
    await pool.query(
      `UPDATE outbound_messages SET status = 'queued', scheduled_at = $2 WHERE id = $1`,
      [row.id, outcome.retryAt]
    );
    await job.moveToDelayed(Date.parse(outcome.retryAt), token);
    throw new DelayedError();
  }
  if (outcome.status === "failed") {
    await updateOutboundMessageState({
      id: row.id,
      status: "failed",
      errorMessage: outcome.errorMessage ?? null
    });
    return;
  }
  await updateOutboundMessageState({
    id: row.id,
    status: "completed",
    errorMessage: null
  });
}

async function processSequenceSend(row: OutboundMessageRow): Promise<void> {
  if (!row.sequence_enrollment_id || row.sequence_step_index == null) {
    throw new Error("Sequence outbound message is missing enrollment context.");
  }
  const outcome = await executeSequenceOutboundMessage({
    enrollmentId: row.sequence_enrollment_id,
    stepIndex: row.sequence_step_index
  });
  if (outcome.status === "retrying" || outcome.status === "failed") {
    throw new UnrecoverableError(outcome.errorMessage ?? "Sequence delivery did not complete.");
  }
  await updateOutboundMessageState({
    id: row.id,
    status: "completed",
    errorMessage: null
  });
}

async function processGenericWebhook(row: OutboundMessageRow): Promise<void> {
  if (!row.generic_webhook_log_id) {
    throw new Error("Generic webhook outbound message is missing log context.");
  }
  await executeQueuedGenericWebhookLog(row.generic_webhook_log_id);
  await updateOutboundMessageState({
    id: row.id,
    status: "completed",
    errorMessage: null
  });
}

async function resolveOutboundRow(payload: OutboundJobPayload): Promise<OutboundMessageRow | null> {
  switch (payload.type) {
    case "conversation_api":
    case "conversation_qr":
    case "conversation_web":
    case "template_api":
      return loadOutboundMessageByConversationId(payload.messageId);
    case "campaign_send":
      return loadOutboundMessageByCampaignMessageId(payload.campaignMessageId);
    case "sequence_send":
      return loadOutboundMessageBySequenceKey(payload.enrollmentId, payload.stepIndex);
    case "generic_webhook":
      return loadOutboundMessageByWebhookLogId(payload.logId);
    default:
      return null;
  }
}

async function executeOutboundJob(job: Job<OutboundJobPayload>, token?: string): Promise<void> {
  const row = await resolveOutboundRow(job.data);
  if (!row) {
    return;
  }

  await updateOutboundMessageState({
    id: row.id,
    status: "processing",
    attemptCount: job.attemptsMade + 1,
    errorMessage: null
  });

  await withGroupingLock(row.grouping_key, async () => {
    switch (job.data.type) {
      case "conversation_api":
      case "conversation_qr":
      case "conversation_web":
        await processConversationChannel(row);
        return;
      case "template_api":
        await processTemplateApi(row, job, token);
        return;
      case "campaign_send":
        await processCampaignSend(row, job, token);
        return;
      case "sequence_send":
        await processSequenceSend(row);
        return;
      case "generic_webhook":
        await processGenericWebhook(row);
        return;
    }
  });
}

async function reconcileOutboundQueue(limit = 100): Promise<void> {
  const queue = getOutboundExecutionQueue();
  const qrQueue = getOutboundQrExecutionQueue();
  if (!queue || !qrQueue) {
    return;
  }

  const timeoutSeconds = Math.max(30, Math.floor(env.QUEUE_STALLED_JOB_TIMEOUT_MS / 1000));
  await pool.query(
    `UPDATE outbound_messages
     SET status = 'queued',
         updated_at = NOW()
     WHERE status = 'processing'
       AND updated_at <= NOW() - ($1::text || ' seconds')::interval`,
    [String(timeoutSeconds)]
  );

  const result = await pool.query<OutboundMessageRow>(
    `SELECT *
     FROM outbound_messages
     WHERE status = 'queued'
     ORDER BY scheduled_at ASC
     LIMIT $1`,
    [limit]
  );

  for (const row of result.rows) {
    const targetQueue = row.type === "conversation_qr" ? qrQueue : queue;
    const normalizedJobKey = toBullMqSafeJobId(row.job_key);
    const existing = await targetQueue.getJob(normalizedJobKey);
    if (existing) {
      const state = await existing.getState();
      if (state === "waiting" || state === "delayed" || state === "active" || state === "waiting-children") {
        continue; // Job is in-flight — don't re-enqueue
      }
      // Job is completed/failed — remove stale record so we can re-enqueue below
      await existing.remove().catch(() => undefined);
    }

    const payload: OutboundJobPayload =
      row.type === "campaign_send" && row.campaign_message_id
        ? { type: "campaign_send", campaignMessageId: row.campaign_message_id }
        : row.type === "sequence_send" && row.sequence_enrollment_id && row.sequence_step_index != null
          ? { type: "sequence_send", enrollmentId: row.sequence_enrollment_id, stepIndex: row.sequence_step_index }
          : row.type === "generic_webhook" && row.generic_webhook_log_id
            ? { type: "generic_webhook", logId: row.generic_webhook_log_id }
            : buildConversationJobPayload(row.type as "conversation_api" | "conversation_qr" | "conversation_web" | "template_api", row.id);

    await enqueueOutboundJob(payload, normalizedJobKey, row.scheduled_at);
  }
}

export async function queueConversationOutboundMessage(input: {
  userId: string;
  conversationId: string;
  payload: FlowMessagePayload;
  displayText?: string;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  senderName?: string | null;
  usage?: OutboundConversationUsage;
  scheduledAt?: string | null;
}): Promise<{ queuedMessageId: string; channelType: "api" | "qr" | "web"; summaryText: string }> {
  const conversation = await getConversationById(input.conversationId);
  if (!conversation || conversation.user_id !== input.userId) {
    throw new Error("Conversation not found.");
  }

  const canonicalPayload = validateFlowMessagePayload(input.payload);
  const type: OutboundMessageType =
    conversation.channel_type === "api"
      ? "conversation_api"
      : conversation.channel_type === "qr"
        ? "conversation_qr"
        : "conversation_web";
  const channel = conversation.channel_type;
  const messageId = randomUUID();
  const summaryText = input.displayText ?? summarizeFlowMessage(canonicalPayload);
  const row = await insertOutboundMessage({
    id: messageId,
    userId: input.userId,
    type,
    channel,
    jobKey: buildOutboundJobKey(channel, messageId),
    conversationId: conversation.id,
    groupingKey: conversation.id,
    senderName: input.senderName ?? null,
    displayText: summaryText,
    mediaUrl: input.mediaUrl ?? getPayloadMediaUrl(canonicalPayload) ?? null,
    mediaMimeType: input.mediaMimeType ?? null,
    payloadJson: canonicalPayload as Record<string, unknown>,
    usage: (input.usage ?? {}) as Record<string, unknown>,
    scheduledAt: input.scheduledAt ?? null
  });
  await enqueueOutboundJob(buildConversationJobPayload(type as "conversation_api" | "conversation_qr" | "conversation_web", row.id), row.job_key, row.scheduled_at);
  return {
    queuedMessageId: row.id,
    channelType: conversation.channel_type,
    summaryText
  };
}

export async function queueConversationTemplateMessage(input: {
  userId: string;
  conversationId: string;
  templateId: string;
  variableValues: Record<string, string>;
  genericWebhookLogId?: string | null;
  senderName?: string | null;
  scheduledAt?: string | null;
}): Promise<{ queuedMessageId: string; channelType: "api" }> {
  const conversation = await getConversationById(input.conversationId);
  if (!conversation || conversation.user_id !== input.userId) {
    throw new Error("Conversation not found.");
  }
  if (conversation.channel_type !== "api") {
    throw new Error("Templates can only be sent on the API (Meta) channel.");
  }

  const messageId = randomUUID();
  const row = await insertOutboundMessage({
    id: messageId,
    userId: input.userId,
    type: "template_api",
    channel: "api",
    jobKey: buildOutboundJobKey("api", messageId),
    conversationId: conversation.id,
    templateId: input.templateId,
    genericWebhookLogId: input.genericWebhookLogId ?? null,
    groupingKey: conversation.id,
    senderName: input.senderName ?? null,
    variableValues: input.variableValues,
    scheduledAt: input.scheduledAt ?? null
  });
  await enqueueOutboundJob({ type: "template_api", messageId: row.id }, row.job_key, row.scheduled_at);
  return {
    queuedMessageId: row.id,
    channelType: "api"
  };
}

export async function queueCampaignOutboundMessage(input: {
  userId: string;
  campaignMessageId: string;
  scheduledAt?: string | null;
  groupingKey?: string | null;
}): Promise<void> {
  const row = await insertOutboundMessage({
    userId: input.userId,
    type: "campaign_send",
    channel: "api",
    jobKey: buildOutboundJobKey("campaign", input.campaignMessageId),
    campaignMessageId: input.campaignMessageId,
    scheduledAt: input.scheduledAt ?? null,
    groupingKey: input.groupingKey ?? null
  });
  await enqueueOutboundJob({ type: "campaign_send", campaignMessageId: input.campaignMessageId }, row.job_key, row.scheduled_at);
}

export async function queueSequenceOutboundMessage(input: {
  userId: string;
  enrollmentId: string;
  stepIndex: number;
  groupingKey?: string | null;
}): Promise<void> {
  const row = await insertOutboundMessage({
    userId: input.userId,
    type: "sequence_send",
    channel: "api",
    jobKey: buildOutboundJobKey("sequence", `${input.enrollmentId}:${input.stepIndex}`),
    sequenceEnrollmentId: input.enrollmentId,
    sequenceStepIndex: input.stepIndex,
    groupingKey: input.groupingKey ?? null
  });
  await enqueueOutboundJob({ type: "sequence_send", enrollmentId: input.enrollmentId, stepIndex: input.stepIndex }, row.job_key, row.scheduled_at);
}

export async function queueGenericWebhookOutboundMessage(input: {
  userId: string;
  logId: string;
  scheduledAt?: string | null;
  groupingKey?: string | null;
  payloadJson?: Record<string, unknown>;
  variableValues?: Record<string, string>;
}): Promise<void> {
  const row = await insertOutboundMessage({
    userId: input.userId,
    type: "generic_webhook",
    channel: "webhook",
    jobKey: buildOutboundJobKey("webhook", input.logId),
    genericWebhookLogId: input.logId,
    scheduledAt: input.scheduledAt ?? null,
    groupingKey: input.groupingKey ?? null,
    payloadJson: input.payloadJson ?? {},
    variableValues: input.variableValues ?? {}
  });
  await enqueueOutboundJob({ type: "generic_webhook", logId: input.logId }, row.job_key, row.scheduled_at);
}

export async function retryConversationOutboundMessage(input: {
  userId: string;
  conversationId: string;
  messageId: string;
  maxRetries?: number;
}): Promise<{ retryCount: number; deliveryStatus: "pending"; outboundMessageId: string }> {
  const maxRetries = input.maxRetries ?? 3;
  const result = await pool.query<{
    retry_count: number;
    delivery_status: string;
    direction: string;
  }>(
    `SELECT m.retry_count, m.delivery_status, m.direction
     FROM conversation_messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE m.id = $1
       AND m.conversation_id = $2
       AND c.user_id = $3
     LIMIT 1`,
    [input.messageId, input.conversationId, input.userId]
  );
  const message = firstRow(result);
  if (!message) {
    throw new Error("Message not found");
  }
  if (message.direction !== "outbound") {
    throw new Error("Only outbound messages can be retried.");
  }
  if (message.delivery_status !== "failed") {
    throw new Error("Message is not in failed state.");
  }
  if (Number(message.retry_count ?? 0) >= maxRetries) {
    throw new Error("Max retries exceeded. Contact support.");
  }

  const outbound = await loadOutboundMessageForConversationRetry(input);
  if (!outbound) {
    throw new Error("Original outbound queue record was not found for this message.");
  }
  if (!isConversationJobType(outbound.type)) {
    throw new Error("This message type cannot be retried from Inbox.");
  }

  const retryCount = Number(message.retry_count ?? 0) + 1;
  await pool.query(
    `UPDATE conversation_messages
     SET delivery_status = 'pending',
         retry_count = retry_count + 1,
         error_code = NULL,
         error_message = NULL
     WHERE id = $1`,
    [input.messageId]
  );

  await updateOutboundMessageState({
    id: outbound.id,
    status: "queued",
    errorMessage: null
  });
  await pool.query(
    `UPDATE outbound_messages
     SET scheduled_at = NOW(),
         attempt_count = 0,
         updated_at = NOW()
     WHERE id = $1`,
    [outbound.id]
  );

  // Manual retry should never be blocked by a stale freq cap key (the original
  // message failed — it never reached the recipient). Clear it proactively so
  // the send goes through immediately instead of deferring 12-24 h.
  if (outbound.template_id && outbound.conversation_id) {
    const conv = await getConversationById(outbound.conversation_id);
    if (conv) {
      const contact = await getContactByPhoneForUser(outbound.user_id, conv.phone_number);
      if (contact?.id) {
        await clearFrequencyCapSend(contact.id, outbound.template_id);
      }
    }
  }

  const queue =
    outbound.type === "conversation_qr"
      ? getOutboundQrExecutionQueue()
      : getOutboundExecutionQueue();
  if (!queue) {
    throw new Error("Outbound execution queue is unavailable because REDIS_URL is not configured.");
  }
  const normalizedJobKey = toBullMqSafeJobId(outbound.job_key);
  const existingJob = await queue.getJob(normalizedJobKey);
  if (existingJob) {
    try {
      await existingJob.remove();
    } catch (error) {
      const state = await existingJob.getState().catch(() => "unknown");
      if (state === "active" || state === "waiting" || state === "delayed") {
        return {
          retryCount,
          deliveryStatus: "pending",
          outboundMessageId: outbound.id
        };
      }
      throw error;
    }
  }
  await enqueueOutboundJob(buildConversationJobPayload(outbound.type, outbound.id), outbound.job_key, null);

  return {
    retryCount,
    deliveryStatus: "pending",
    outboundMessageId: outbound.id
  };
}

export function startOutboundWorker(): void {
  if (!env.REDIS_URL) {
    console.warn("[OutboundWorker] REDIS_URL is not configured; BullMQ outbound worker is disabled");
    return;
  }

  if (!worker) {
    const connection = createQueueWorkerConnection();
    if (!connection) {
      throw new Error("Failed to create BullMQ connection for outbound worker.");
    }

    worker = new Worker<OutboundJobPayload>(
      "outbound-execution",
      async (job, token) => {
        const row = await resolveOutboundRow(job.data);
        try {
          await executeOutboundJob(job, token);
        } catch (error) {
          if (error instanceof DelayedError) {
            throw error; // BullMQ handles the delayed state natively
          }
          const classified = classifyOutboundError(row, error);
          const shouldRetry = classified.retryable && hasRemainingAttempts(job);
          if (row) {
            await updateOutboundMessageState({
              id: row.id,
              status: shouldRetry ? "queued" : "failed",
              errorMessage: classified.errorMessage,
              attemptCount: job.attemptsMade + 1
            });
          }
          if (shouldRetry) {
            throw error;
          }
          throw new UnrecoverableError(classified.errorMessage);
        }
      },
      {
        connection,
        prefix: env.QUEUE_PREFIX?.trim() || undefined,
        concurrency: Math.max(1, env.OUTBOUND_QUEUE_CONCURRENCY)
      }
    );

    worker.on("failed", (job, error) => {
      console.error(`[OutboundWorker] job failed id=${job?.id ?? "unknown"}`, error);
    });
  }

  if (!queueEvents) {
    const connection = createQueueWorkerConnection();
    if (!connection) {
      throw new Error("Failed to create BullMQ connection for outbound queue events.");
    }
    queueEvents = new QueueEvents("outbound-execution", {
      connection,
      prefix: env.QUEUE_PREFIX?.trim() || undefined
    });
    queueEvents.on("completed", ({ jobId }) => {
      console.info(`[OutboundWorker] completed job=${jobId}`);
    });
    queueEvents.on("failed", ({ jobId, failedReason }) => {
      console.error(`[OutboundWorker] failed job=${jobId} reason=${failedReason}`);
    });
  }

  if (!reconciliationTimer) {
    reconciliationTimer = setInterval(() => {
      void reconcileOutboundQueue();
    }, 60_000);
  }

  void reconcileOutboundQueue();
}

export function startQrOutboundWorker(): void {
  if (!env.REDIS_URL) {
    console.warn("[QrOutboundWorker] REDIS_URL is not configured; BullMQ QR outbound worker is disabled");
    return;
  }

  if (!qrWorker) {
    const connection = createQueueWorkerConnection();
    if (!connection) {
      throw new Error("Failed to create BullMQ connection for QR outbound worker.");
    }

    qrWorker = new Worker<OutboundJobPayload>(
      "outbound-qr-execution",
      async (job, token) => {
        const row = await resolveOutboundRow(job.data);
        try {
          await executeOutboundJob(job, token);
        } catch (error) {
          if (error instanceof DelayedError) {
            throw error;
          }
          const classified = classifyOutboundError(row, error);
          const shouldRetry = classified.retryable && hasRemainingAttempts(job);
          if (row) {
            await updateOutboundMessageState({
              id: row.id,
              status: shouldRetry ? "queued" : "failed",
              errorMessage: classified.errorMessage,
              attemptCount: job.attemptsMade + 1
            });
          }
          if (shouldRetry) {
            throw error;
          }
          throw new UnrecoverableError(classified.errorMessage);
        }
      },
      {
        connection,
        prefix: env.QUEUE_PREFIX?.trim() || undefined,
        concurrency: Math.max(1, env.OUTBOUND_QUEUE_CONCURRENCY)
      }
    );

    qrWorker.on("failed", (job, error) => {
      console.error(`[QrOutboundWorker] job failed id=${job?.id ?? "unknown"}`, error);
    });
  }

  if (!qrQueueEvents) {
    const connection = createQueueWorkerConnection();
    if (!connection) {
      throw new Error("Failed to create BullMQ connection for QR outbound queue events.");
    }
    qrQueueEvents = new QueueEvents("outbound-qr-execution", {
      connection,
      prefix: env.QUEUE_PREFIX?.trim() || undefined
    });
    qrQueueEvents.on("completed", ({ jobId }) => {
      console.info(`[QrOutboundWorker] completed job=${jobId}`);
    });
    qrQueueEvents.on("failed", ({ jobId, failedReason }) => {
      console.error(`[QrOutboundWorker] failed job=${jobId} reason=${failedReason}`);
    });
  }

  if (!reconciliationTimer) {
    reconciliationTimer = setInterval(() => {
      void reconcileOutboundQueue();
    }, 60_000);
  }

  void reconcileOutboundQueue();
}

export async function stopOutboundWorker(): Promise<void> {
  if (reconciliationTimer) {
    clearInterval(reconciliationTimer);
    reconciliationTimer = null;
  }

  if (queueEvents) {
    const activeQueueEvents = queueEvents;
    queueEvents = null;
    await activeQueueEvents.close();
  }

  if (qrQueueEvents) {
    const activeQrQueueEvents = qrQueueEvents;
    qrQueueEvents = null;
    await activeQrQueueEvents.close();
  }

  if (worker) {
    const activeWorker = worker;
    worker = null;
    await activeWorker.close();
  }

  if (qrWorker) {
    const activeQrWorker = qrWorker;
    qrWorker = null;
    await activeQrWorker.close();
  }
}

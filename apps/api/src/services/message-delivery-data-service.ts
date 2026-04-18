import { env } from "../config/env.js";
import { pool, withTransaction } from "../db/pool.js";

export type DeliveryAttemptStatus = "sending" | "sent" | "failed" | "retry_scheduled";
export type DeliveryFailureCategory = "transient" | "permanent" | "business_logic" | "unknown";
export type DeliveryAlertType = "high_failure_rate" | "webhook_delay" | "api_downtime";
export type DeliveryAlertSeverity = "info" | "warning" | "critical";
export type DeliveryAlertStatus = "open" | "resolved";
export type DeliverySuppressionSource = "send_failure" | "webhook_failure" | "manual";
export type DeliverySuppressionReason = "blocked" | "opt_out" | "invalid_number";
export type DeliveryMessageKind =
  | "campaign_template"
  | "conversation_template"
  | "conversation_flow"
  | "conversation_text"
  | "direct_text"
  | "test_template";
export type CampaignDeliveryStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "skipped";

export interface DeliveryFailureClassification {
  retryable: boolean;
  category: DeliveryFailureCategory;
  errorCode: string | null;
  errorMessage: string;
  suppressionReason: DeliverySuppressionReason | null;
}

export interface DeliveryAttemptRecord {
  id: string;
  user_id: string;
  campaign_id: string | null;
  campaign_message_id: string | null;
  conversation_id: string | null;
  contact_id: string | null;
  connection_id: string | null;
  phone_number: string;
  linked_number: string | null;
  phone_number_id: string | null;
  message_kind: DeliveryMessageKind;
  status: DeliveryAttemptStatus;
  attempt_number: number;
  retryable: boolean;
  error_category: DeliveryFailureCategory | null;
  error_code: string | null;
  error_message: string | null;
  provider_message_id: string | null;
  requested_payload_json: Record<string, unknown>;
  provider_response_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DeliveryAlert {
  id: string;
  user_id: string;
  campaign_id: string | null;
  connection_id: string | null;
  alert_type: DeliveryAlertType;
  severity: DeliveryAlertSeverity;
  status: DeliveryAlertStatus;
  summary: string;
  details_json: Record<string, unknown>;
  triggered_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeliveryOverview {
  windowSeconds: number;
  attempts: {
    total: number;
    sent: number;
    failed: number;
    retryScheduled: number;
    successRate: number;
  };
  queuedCampaignMessages: number;
  openAlerts: number;
  suppressedRecipients: number;
}

export interface CampaignDeliveryAnalytics {
  campaignId: string;
  counts: {
    total: number;
    queued: number;
    sending: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    skipped: number;
  };
  retries: {
    totalAttempts: number;
    retryAttempts: number;
    pendingRetries: number;
  };
  failureRate: number;
  topErrors: Array<{
    errorCode: string | null;
    errorMessage: string | null;
    count: number;
  }>;
}

export interface ContactDeliverySuppression {
  id: string;
  user_id: string;
  contact_id: string | null;
  phone_number: string;
  reason_code: string;
  reason_label: string;
  source: DeliverySuppressionSource;
  metadata_json: Record<string, unknown>;
  last_failed_at: string;
  created_at: string;
  updated_at: string;
}

const WEBHOOK_LOCK_TIMEOUT_MS = 5 * 60_000;
const HIGH_FAILURE_MIN_ATTEMPTS = 20;
const HEALTHY_ECOSYSTEM_REMARK = "This message was not delivered to maintain healthy ecosystem engagement.";
const UNKNOWN_WEBHOOK_FAILURE_REMARK =
  "Meta marked this message as failed but did not include a reason in the delivery webhook.";
const UNKNOWN_TEMPLATE_WEBHOOK_FAILURE_REMARK =
  "Meta marked this template message as failed but did not include a reason in the delivery webhook.";
const UNKNOWN_MARKETING_TEMPLATE_WEBHOOK_FAILURE_REMARK =
  "Meta marked this marketing template as failed without a detailed reason. Marketing deliveries can be blocked by recipient engagement policy even when the template is approved.";

const PERMANENT_META_CODES = new Set(["131026", "131047", "132000", "132001", "133010", "131051"]);
const BUSINESS_LOGIC_META_CODES = new Set(["132000", "132001", "131051"]);
const HEALTHY_ECOSYSTEM_META_CODES = new Set(["131049"]);
const INVALID_NUMBER_META_CODES = new Set(["133010"]);

function normalizePhoneDigits(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    return null;
  }
  return digits;
}

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function computeSuccessRate(total: number, failed: number): number {
  if (total <= 0) {
    return 100;
  }
  const successful = Math.max(0, total - failed);
  return Number(((successful / total) * 100).toFixed(2));
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return String(error ?? "Unknown delivery failure");
}

function parseProviderErrorMetadata(errorMessage: string | null | undefined): {
  baseMessage: string | null;
  metaCode: string | null;
  subcode: string | null;
  statusCode: string | null;
} {
  const trimmedMessage = trimToNull(errorMessage);
  if (!trimmedMessage) {
    return {
      baseMessage: null,
      metaCode: null,
      subcode: null,
      statusCode: null
    };
  }

  const metaCode = trimmedMessage.match(/\bcode=(\d{1,10})\b/i)?.[1] ?? null;
  const subcode = trimmedMessage.match(/\bsubcode=(\d{1,16})\b/i)?.[1] ?? null;
  const statusCode = trimmedMessage.match(/\bstatus=(\d{3})\b/i)?.[1] ?? null;
  const bracketDetails = /\s*\[[^\]]*\]\s*$/i;
  const baseMessage = trimToNull(trimmedMessage.replace(bracketDetails, "")) ?? trimmedMessage;

  return {
    baseMessage,
    metaCode,
    subcode,
    statusCode
  };
}

function extractErrorCode(error: unknown): string | null {
  if (error instanceof Error) {
    const metadata = parseProviderErrorMetadata(error.message);
    if (metadata.metaCode) {
      return metadata.metaCode;
    }
    const match = error.message.match(/\b(13\d{4})\b/);
    if (match?.[1]) {
      return match[1];
    }
    if (metadata.statusCode) {
      return metadata.statusCode;
    }
  }
  return null;
}

function isRetryableHttpStatus(message: string): boolean {
  return /\b(429|500|502|503|504)\b/.test(message);
}

export function isHealthyEcosystemFailure(errorCode?: string | null, errorMessage?: string | null): boolean {
  if (errorCode && HEALTHY_ECOSYSTEM_META_CODES.has(errorCode)) {
    return true;
  }

  const normalizedMessage = (errorMessage ?? "").toLowerCase();
  return (
    normalizedMessage.includes("healthy ecosystem") ||
    normalizedMessage.includes("ecosystem engagement") ||
    normalizedMessage.includes("maintain healthy ecosystem")
  );
}

export function normalizeDeliveryFailureMessage(errorCode?: string | null, errorMessage?: string | null): string {
  const trimmedMessage = trimToNull(errorMessage);
  if (isHealthyEcosystemFailure(errorCode, trimmedMessage)) {
    return HEALTHY_ECOSYSTEM_REMARK;
  }

  const metadata = parseProviderErrorMetadata(trimmedMessage);
  const baseMessage = metadata.baseMessage ?? trimmedMessage ?? "Unknown delivery failure";
  const displayCode =
    metadata.metaCode ??
    ((errorCode ?? "").match(/^\d{1,10}$/) && errorCode !== metadata.statusCode ? errorCode ?? null : null) ??
    errorCode ??
    null;

  if (displayCode && baseMessage.toLowerCase().startsWith(`meta code ${displayCode}`.toLowerCase())) {
    return baseMessage;
  }

  if (displayCode) {
    const subcodeSuffix = metadata.subcode ? ` (subcode ${metadata.subcode})` : "";
    return `Meta code ${displayCode}${subcodeSuffix}: ${baseMessage}`;
  }

  return baseMessage;
}

export function resolveWebhookFailureMessage(input: {
  errorCode?: string | null;
  errorMessage?: string | null;
  messageKind?: DeliveryMessageKind | null;
  templateCategory?: string | null;
}): string {
  const explicitMessage = trimToNull(input.errorMessage);
  if (explicitMessage) {
    return explicitMessage;
  }

  const errorCode = trimToNull(input.errorCode);
  if (errorCode) {
    return `Meta delivery failed with code ${errorCode}.`;
  }

  if ((input.templateCategory ?? "").toUpperCase() === "MARKETING") {
    return UNKNOWN_MARKETING_TEMPLATE_WEBHOOK_FAILURE_REMARK;
  }

  if (
    input.messageKind === "campaign_template" ||
    input.messageKind === "conversation_template" ||
    input.messageKind === "test_template"
  ) {
    return UNKNOWN_TEMPLATE_WEBHOOK_FAILURE_REMARK;
  }

  return UNKNOWN_WEBHOOK_FAILURE_REMARK;
}

export function retryDelayMs(retryCount: number): number {
  switch (retryCount) {
    case 0:
      return 30_000;
    case 1:
      return 2 * 60_000;
    case 2:
      return 10 * 60_000;
    default:
      return 60 * 60_000;
  }
}

export async function applyDeliveryAttemptWebhookStatusUpdate(input: {
  wamid: string;
  status: "sent" | "delivered" | "read" | "failed";
  errorCode?: string | null;
  errorMessage?: string | null;
  eventTimestamp?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const attemptResult = await pool.query<{
    attempt_id: string;
    user_id: string;
    campaign_id: string | null;
    connection_id: string | null;
    current_status: DeliveryAttemptStatus;
    message_kind: DeliveryMessageKind;
    template_category: string | null;
  }>(
    `SELECT
       mda.id AS attempt_id,
       mda.user_id,
       mda.campaign_id,
       mda.connection_id,
       mda.status AS current_status,
       mda.message_kind,
       mt.category AS template_category
     FROM message_delivery_attempts mda
     LEFT JOIN message_templates mt
       ON mt.id::text = NULLIF(mda.requested_payload_json->>'templateId', '')
     WHERE mda.provider_message_id = $1
     ORDER BY mda.created_at DESC
     LIMIT 1`,
    [input.wamid]
  );
  const attempt = attemptResult.rows[0];
  if (!attempt) {
    return;
  }

  const webhookSnapshot = {
    lastWebhookStatus: input.status,
    ...(input.eventTimestamp ? { lastWebhookStatusAt: input.eventTimestamp } : {}),
    ...(input.payload ? { lastWebhookPayload: input.payload } : {})
  };

  if (input.status === "failed") {
    const webhookFailureMessage = resolveWebhookFailureMessage({
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      messageKind: attempt.message_kind,
      templateCategory: attempt.template_category
    });
    const failure = classifyDeliveryFailure(new Error(webhookFailureMessage), input.errorCode);

    await pool.query(
      `UPDATE message_delivery_attempts
       SET status = 'failed',
           retryable = FALSE,
           error_category = $2,
           error_code = COALESCE($3, error_code),
           error_message = COALESCE($4, error_message),
           provider_response_json = COALESCE(provider_response_json, '{}'::jsonb) || $5::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [
        attempt.attempt_id,
        failure.category,
        failure.errorCode ?? input.errorCode ?? null,
        failure.errorMessage,
        JSON.stringify(webhookSnapshot)
      ]
    );

    await refreshApiDowntimeAlert(attempt.user_id, attempt.connection_id ?? null);
    await refreshFailureRateAlert(attempt.user_id, attempt.campaign_id ?? null);
    return;
  }

  const nextAttemptStatus: DeliveryAttemptStatus =
    attempt.current_status === "failed" ? "failed" : "sent";

  await pool.query(
    `UPDATE message_delivery_attempts
     SET status = $2,
         retryable = CASE WHEN $2 = 'failed' THEN retryable ELSE FALSE END,
         provider_response_json = COALESCE(provider_response_json, '{}'::jsonb) || $3::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [attempt.attempt_id, nextAttemptStatus, JSON.stringify(webhookSnapshot)]
  );
}

export function classifyDeliveryFailure(error: unknown, explicitCode?: string | null): DeliveryFailureClassification {
  const rawErrorMessage = extractErrorMessage(error);
  const errorCode = explicitCode ?? extractErrorCode(error);
  const errorMessage = normalizeDeliveryFailureMessage(errorCode, rawErrorMessage);
  const normalizedMessage = rawErrorMessage.toLowerCase();

  if (
    normalizedMessage.includes("timeout") ||
    normalizedMessage.includes("network") ||
    normalizedMessage.includes("econnreset") ||
    normalizedMessage.includes("enotfound") ||
    normalizedMessage.includes("fetch failed") ||
    isRetryableHttpStatus(rawErrorMessage)
  ) {
    return {
      retryable: true,
      category: "transient",
      errorCode,
      errorMessage,
      suppressionReason: null
    };
  }

  if (isHealthyEcosystemFailure(errorCode, rawErrorMessage)) {
    return {
      retryable: false,
      category: "business_logic",
      errorCode,
      errorMessage,
      suppressionReason: null
    };
  }

  if (errorCode && BUSINESS_LOGIC_META_CODES.has(errorCode)) {
    return {
      retryable: false,
      category: "business_logic",
      errorCode,
      errorMessage,
      suppressionReason: null
    };
  }

  if (
    errorCode === "100" ||
    normalizedMessage.includes("invalid parameter") ||
    (normalizedMessage.includes("template") &&
      (normalizedMessage.includes("missing") ||
        normalizedMessage.includes("rejected") ||
        normalizedMessage.includes("mismatch") ||
        normalizedMessage.includes("not found")))
  ) {
    return {
      retryable: false,
      category: "business_logic",
      errorCode,
      errorMessage,
      suppressionReason: null
    };
  }

  if (normalizedMessage.includes("blocked")) {
    return {
      retryable: false,
      category: "permanent",
      errorCode,
      errorMessage,
      suppressionReason: "blocked"
    };
  }

  if (normalizedMessage.includes("opted out") || normalizedMessage.includes("opt-out")) {
    return {
      retryable: false,
      category: "permanent",
      errorCode,
      errorMessage,
      suppressionReason: "opt_out"
    };
  }

  if (
    normalizedMessage.includes("not a valid whatsapp") ||
    normalizedMessage.includes("invalid number") ||
    normalizedMessage.includes("not valid") ||
    (errorCode != null && INVALID_NUMBER_META_CODES.has(errorCode))
  ) {
    return {
      retryable: false,
      category: "permanent",
      errorCode,
      errorMessage,
      suppressionReason: "invalid_number"
    };
  }

  if (errorCode && PERMANENT_META_CODES.has(errorCode)) {
    return {
      retryable: false,
      category: "permanent",
      errorCode,
      errorMessage,
      suppressionReason: null
    };
  }

  return {
    retryable: true,
    category: "unknown",
    errorCode,
    errorMessage,
    suppressionReason: null
  };
}

export async function findSuppressedRecipients(
  userId: string,
  phoneNumbers: string[]
): Promise<Map<string, ContactDeliverySuppression>> {
  const normalized = Array.from(new Set(phoneNumbers.map((value) => normalizePhoneDigits(value)).filter(Boolean))) as string[];
  if (normalized.length === 0) {
    return new Map();
  }

  const result = await pool.query<ContactDeliverySuppression>(
    `SELECT *
     FROM contact_delivery_suppressions
     WHERE user_id = $1
       AND phone_number = ANY($2::text[])`,
    [userId, normalized]
  );

  return new Map(result.rows.map((row) => [normalizePhoneDigits(row.phone_number) ?? row.phone_number, row]));
}

export async function upsertRecipientSuppression(input: {
  userId: string;
  phoneNumber: string;
  contactId?: string | null;
  reason: DeliverySuppressionReason;
  source: DeliverySuppressionSource;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const phoneNumber = normalizePhoneDigits(input.phoneNumber);
  if (!phoneNumber) {
    return;
  }

  const reasonLabel =
    input.reason === "blocked"
      ? "Recipient blocked messages"
      : input.reason === "opt_out"
        ? "Recipient opted out"
        : "Recipient phone number is invalid";

  await pool.query(
    `INSERT INTO contact_delivery_suppressions (
       user_id,
       contact_id,
       phone_number,
       reason_code,
       reason_label,
       source,
       metadata_json,
       last_failed_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
     ON CONFLICT (user_id, phone_number)
     DO UPDATE SET
       contact_id = COALESCE(EXCLUDED.contact_id, contact_delivery_suppressions.contact_id),
       reason_code = EXCLUDED.reason_code,
       reason_label = EXCLUDED.reason_label,
       source = EXCLUDED.source,
       metadata_json = contact_delivery_suppressions.metadata_json || EXCLUDED.metadata_json,
       last_failed_at = NOW(),
       updated_at = NOW()`,
    [
      input.userId,
      input.contactId ?? null,
      phoneNumber,
      input.reason,
      reasonLabel,
      input.source,
      JSON.stringify(input.metadata ?? {})
    ]
  );
}

export async function removeOptOutSuppression(userId: string, phoneNumber: string): Promise<void> {
  const digits = phoneNumber.replace(/\D/g, "");
  if (!digits) {
    return;
  }
  await pool.query(
    `DELETE FROM contact_delivery_suppressions
     WHERE user_id = $1 AND phone_number = $2 AND reason_code = 'opt_out'`,
    [userId, digits]
  );
}

async function openOrRefreshAlert(input: {
  userId: string;
  alertType: DeliveryAlertType;
  severity: DeliveryAlertSeverity;
  summary: string;
  details: Record<string, unknown>;
  campaignId?: string | null;
  connectionId?: string | null;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO message_delivery_alerts (
         user_id,
         campaign_id,
         connection_id,
         alert_type,
         severity,
         summary,
         details_json
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        input.userId,
        input.campaignId ?? null,
        input.connectionId ?? null,
        input.alertType,
        input.severity,
        input.summary,
        JSON.stringify(input.details)
      ]
    );
    return;
  } catch (error) {
    const cause = error as { code?: string };
    if (cause?.code !== "23505") {
      throw error;
    }
  }

  await pool.query(
    `UPDATE message_delivery_alerts
     SET severity = $5,
         summary = $6,
         details_json = $7::jsonb,
         updated_at = NOW()
     WHERE user_id = $1
       AND alert_type = $2
       AND status = 'open'
       AND campaign_id IS NOT DISTINCT FROM $3
       AND connection_id IS NOT DISTINCT FROM $4`,
    [
      input.userId,
      input.alertType,
      input.campaignId ?? null,
      input.connectionId ?? null,
      input.severity,
      input.summary,
      JSON.stringify(input.details)
    ]
  );
}

async function resolveAlerts(input: {
  userId: string;
  alertType: DeliveryAlertType;
  campaignId?: string | null;
  connectionId?: string | null;
}): Promise<void> {
  await pool.query(
    `UPDATE message_delivery_alerts
     SET status = 'resolved',
         resolved_at = NOW(),
         updated_at = NOW()
     WHERE user_id = $1
       AND alert_type = $2
       AND status = 'open'
       AND campaign_id IS NOT DISTINCT FROM $3
       AND connection_id IS NOT DISTINCT FROM $4`,
    [input.userId, input.alertType, input.campaignId ?? null, input.connectionId ?? null]
  );
}

async function refreshFailureRateAlert(userId: string, campaignId?: string | null): Promise<void> {
  const params: unknown[] = [userId, `${env.DELIVERY_ALERT_WINDOW_SECONDS} seconds`];
  let campaignClause = "";
  if (campaignId) {
    params.push(campaignId);
    campaignClause = `AND campaign_id = $${params.length}`;
  }

  const result = await pool.query<{ total: string; failed: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('sent', 'failed', 'retry_scheduled'))::text AS total,
       COUNT(*) FILTER (WHERE status IN ('failed', 'retry_scheduled'))::text AS failed
     FROM message_delivery_attempts
     WHERE user_id = $1
       AND created_at >= NOW() - $2::interval
       ${campaignClause}`,
    params
  );

  const total = Number(result.rows[0]?.total ?? 0);
  const failed = Number(result.rows[0]?.failed ?? 0);
  const failureRate = total > 0 ? Number(((failed / total) * 100).toFixed(2)) : 0;

  if (total >= HIGH_FAILURE_MIN_ATTEMPTS && failureRate > env.DELIVERY_FAILURE_ALERT_THRESHOLD_PERCENT) {
    if (campaignId && failureRate >= Math.max(20, env.DELIVERY_FAILURE_ALERT_THRESHOLD_PERCENT)) {
      await pool.query(
        `UPDATE campaigns
         SET status = 'paused',
             updated_at = NOW()
         WHERE id = $1
           AND status = 'running'`,
        [campaignId]
      );
    }
    await openOrRefreshAlert({
      userId,
      campaignId,
      alertType: "high_failure_rate",
      severity: failureRate >= 20 ? "critical" : "warning",
      summary: `High delivery failure rate detected: ${failureRate}% over the last ${env.DELIVERY_ALERT_WINDOW_SECONDS} seconds.`,
      details: {
        totalAttempts: total,
        failedAttempts: failed,
        failureRate,
        windowSeconds: env.DELIVERY_ALERT_WINDOW_SECONDS
      }
    });
    return;
  }

  await resolveAlerts({
    userId,
    campaignId,
    alertType: "high_failure_rate"
  });
}

async function refreshApiDowntimeAlert(userId: string, connectionId?: string | null): Promise<void> {
  const params: unknown[] = [userId, `${env.DELIVERY_ALERT_WINDOW_SECONDS} seconds`];
  let connectionClause = "";
  if (connectionId) {
    params.push(connectionId);
    connectionClause = `AND connection_id = $${params.length}`;
  }

  const result = await pool.query<{ failures: string }>(
    `SELECT COUNT(*)::text AS failures
     FROM message_delivery_attempts
     WHERE user_id = $1
       AND retryable = TRUE
       AND status IN ('failed', 'retry_scheduled')
       AND created_at >= NOW() - $2::interval
       ${connectionClause}`,
    params
  );

  const failures = Number(result.rows[0]?.failures ?? 0);
  if (failures >= env.DELIVERY_API_DOWNTIME_FAILURE_THRESHOLD) {
    await openOrRefreshAlert({
      userId,
      connectionId,
      alertType: "api_downtime",
      severity: "critical",
      summary: `WhatsApp API instability detected after ${failures} transient delivery failures.`,
      details: {
        transientFailures: failures,
        threshold: env.DELIVERY_API_DOWNTIME_FAILURE_THRESHOLD,
        windowSeconds: env.DELIVERY_ALERT_WINDOW_SECONDS
      }
    });
    return;
  }

  await resolveAlerts({
    userId,
    connectionId,
    alertType: "api_downtime"
  });
}

async function maybeOpenWebhookDelayAlert(input: {
  userId: string;
  connectionId?: string | null;
  campaignId?: string | null;
  wamid: string;
  sentAt: string | null;
  eventTimestamp: string | null;
}): Promise<void> {
  if (!input.sentAt || !input.eventTimestamp) {
    return;
  }

  const sentMs = Date.parse(input.sentAt);
  const eventMs = Date.parse(input.eventTimestamp);
  if (!Number.isFinite(sentMs) || !Number.isFinite(eventMs) || eventMs <= sentMs) {
    return;
  }

  const delaySeconds = Math.round((eventMs - sentMs) / 1000);
  if (delaySeconds <= env.DELIVERY_WEBHOOK_DELAY_SECONDS) {
    return;
  }

  await openOrRefreshAlert({
    userId: input.userId,
    connectionId: input.connectionId,
    campaignId: input.campaignId,
    alertType: "webhook_delay",
    severity: "warning",
    summary: `Webhook delivery updates are delayed by ${delaySeconds} seconds.`,
    details: {
      wamid: input.wamid,
      sentAt: input.sentAt,
      eventTimestamp: input.eventTimestamp,
      delaySeconds,
      thresholdSeconds: env.DELIVERY_WEBHOOK_DELAY_SECONDS
    }
  });
}

export async function recordDeliveryAttemptStart(input: {
  userId: string;
  phoneNumber: string;
  messageKind: DeliveryMessageKind;
  attemptNumber: number;
  campaignId?: string | null;
  campaignMessageId?: string | null;
  conversationId?: string | null;
  contactId?: string | null;
  connectionId?: string | null;
  linkedNumber?: string | null;
  phoneNumberId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<DeliveryAttemptRecord> {
  const result = await pool.query<DeliveryAttemptRecord>(
    `INSERT INTO message_delivery_attempts (
       user_id,
       campaign_id,
       campaign_message_id,
       conversation_id,
       contact_id,
       connection_id,
       phone_number,
       linked_number,
       phone_number_id,
       message_kind,
       attempt_number,
       requested_payload_json
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
     RETURNING *`,
    [
      input.userId,
      input.campaignId ?? null,
      input.campaignMessageId ?? null,
      input.conversationId ?? null,
      input.contactId ?? null,
      input.connectionId ?? null,
      normalizePhoneDigits(input.phoneNumber) ?? input.phoneNumber,
      normalizePhoneDigits(input.linkedNumber) ?? trimToNull(input.linkedNumber),
      trimToNull(input.phoneNumberId),
      input.messageKind,
      input.attemptNumber,
      JSON.stringify(input.payload ?? {})
    ]
  );

  return result.rows[0]!;
}

export async function markDeliveryAttemptSuccess(input: {
  attemptId: string;
  userId: string;
  providerMessageId?: string | null;
  connectionId?: string | null;
  linkedNumber?: string | null;
  phoneNumberId?: string | null;
  response?: Record<string, unknown>;
  campaignId?: string | null;
}): Promise<void> {
  await pool.query(
    `UPDATE message_delivery_attempts
     SET status = 'sent',
         retryable = FALSE,
         error_category = NULL,
         error_code = NULL,
         error_message = NULL,
         connection_id = COALESCE($3, connection_id),
         linked_number = COALESCE($4, linked_number),
         phone_number_id = COALESCE($5, phone_number_id),
         provider_message_id = COALESCE($2, provider_message_id),
         provider_response_json = $6::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [
      input.attemptId,
      input.providerMessageId ?? null,
      input.connectionId ?? null,
      normalizePhoneDigits(input.linkedNumber) ?? trimToNull(input.linkedNumber),
      trimToNull(input.phoneNumberId),
      JSON.stringify(input.response ?? {})
    ]
  );

  await refreshApiDowntimeAlert(input.userId, input.connectionId ?? null);
  await refreshFailureRateAlert(input.userId, input.campaignId ?? null);
}

export async function markDeliveryAttemptFailure(input: {
  attemptId: string;
  userId: string;
  classification: DeliveryFailureClassification;
  nextRetryAt?: string | null;
  response?: Record<string, unknown>;
  connectionId?: string | null;
  linkedNumber?: string | null;
  phoneNumberId?: string | null;
  campaignId?: string | null;
}): Promise<void> {
  await pool.query(
    `UPDATE message_delivery_attempts
     SET status = $2,
         retryable = $3,
         error_category = $4,
         error_code = $5,
         error_message = $6,
         connection_id = COALESCE($7, connection_id),
         linked_number = COALESCE($8, linked_number),
         phone_number_id = COALESCE($9, phone_number_id),
         provider_response_json = $10::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [
      input.attemptId,
      input.nextRetryAt ? "retry_scheduled" : "failed",
      input.classification.retryable,
      input.classification.category,
      input.classification.errorCode,
      input.classification.errorMessage,
      input.connectionId ?? null,
      normalizePhoneDigits(input.linkedNumber) ?? trimToNull(input.linkedNumber),
      trimToNull(input.phoneNumberId),
      JSON.stringify({
        ...(input.response ?? {}),
        ...(input.nextRetryAt ? { nextRetryAt: input.nextRetryAt } : {})
      })
    ]
  );

  await refreshApiDowntimeAlert(input.userId, input.connectionId ?? null);
  await refreshFailureRateAlert(input.userId, input.campaignId ?? null);
}

export async function claimWebhookStatusEvent(input: {
  wamid: string;
  status: "sent" | "delivered" | "read" | "failed";
  errorCode?: string | null;
  eventTimestamp?: string | null;
  payload?: Record<string, unknown>;
}): Promise<{ eventId: string; shouldProcess: boolean }> {
  const eventKey = `${input.wamid}:${input.status}:${input.eventTimestamp ?? "none"}:${input.errorCode ?? "none"}`;

  return withTransaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO delivery_webhook_events (
         wamid,
         status,
         error_code,
         event_timestamp,
         event_key,
         payload_json,
         processing_started_at
       )
       VALUES ($1, $2, $3, $4::timestamptz, $5, $6::jsonb, NOW())
       ON CONFLICT (event_key) DO NOTHING
       RETURNING id`,
      [
        input.wamid,
        input.status,
        input.errorCode ?? null,
        input.eventTimestamp ?? null,
        eventKey,
        JSON.stringify(input.payload ?? {})
      ]
    );

    if (inserted.rows[0]?.id) {
      return { eventId: inserted.rows[0].id, shouldProcess: true };
    }

    const existing = await client.query<{ id: string; processed_at: string | null; processing_started_at: string | null }>(
      `SELECT id, processed_at, processing_started_at
       FROM delivery_webhook_events
       WHERE event_key = $1
       FOR UPDATE`,
      [eventKey]
    );
    const row = existing.rows[0];
    if (!row) {
      return { eventId: "", shouldProcess: false };
    }

    const processingMs = row.processing_started_at ? Date.parse(row.processing_started_at) : 0;
    const staleLock =
      !row.processing_started_at || !Number.isFinite(processingMs) || Date.now() - processingMs > WEBHOOK_LOCK_TIMEOUT_MS;

    if (row.processed_at || !staleLock) {
      return { eventId: row.id, shouldProcess: false };
    }

    await client.query(
      `UPDATE delivery_webhook_events
       SET processing_started_at = NOW()
       WHERE id = $1`,
      [row.id]
    );
    return { eventId: row.id, shouldProcess: true };
  });
}

export async function markWebhookStatusEventProcessed(eventId: string): Promise<void> {
  await pool.query(
    `UPDATE delivery_webhook_events
     SET processed_at = NOW()
     WHERE id = $1`,
    [eventId]
  );
}

function shouldApplyConversationStatus(currentStatus: string | null, nextStatus: "sent" | "delivered" | "read" | "failed"): boolean {
  if (!currentStatus) {
    return true;
  }
  if (currentStatus === "read") {
    return false;
  }
  if (nextStatus === "read") {
    return currentStatus !== "read";
  }
  if (nextStatus === "delivered") {
    return currentStatus === "sent";
  }
  if (nextStatus === "failed") {
    return currentStatus === "sent";
  }
  return currentStatus === "sent";
}

function shouldApplyCampaignStatus(currentStatus: CampaignDeliveryStatus, nextStatus: "sent" | "delivered" | "read" | "failed"): boolean {
  if (currentStatus === "read") {
    return false;
  }
  if (nextStatus === "sent") {
    return currentStatus === "queued" || currentStatus === "sending";
  }
  if (nextStatus === "delivered") {
    return currentStatus === "sent";
  }
  if (nextStatus === "read") {
    return currentStatus === "sent" || currentStatus === "delivered";
  }
  return currentStatus === "queued" || currentStatus === "sending" || currentStatus === "sent";
}

async function markCampaignCompletedIfIdle(client: import("pg").PoolClient, campaignId: string): Promise<void> {
  const pending = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM campaign_messages
     WHERE campaign_id = $1
       AND status IN ('queued', 'sending')`,
    [campaignId]
  );
  if (Number(pending.rows[0]?.count ?? 0) > 0) {
    return;
  }

  await client.query(
    `UPDATE campaigns
     SET status = CASE WHEN status = 'running' THEN 'completed' ELSE status END,
         completed_at = CASE WHEN status = 'running' THEN NOW() ELSE completed_at END
     WHERE id = $1`,
    [campaignId]
  );
}

async function incrementCampaignCounterForTransition(
  client: import("pg").PoolClient,
  campaignId: string,
  previousStatus: CampaignDeliveryStatus,
  nextStatus: "sent" | "delivered" | "read" | "failed"
): Promise<void> {
  if (nextStatus === "sent" && previousStatus !== "sent" && previousStatus !== "delivered" && previousStatus !== "read") {
    await client.query(`UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = $1`, [campaignId]);
    return;
  }
  if (nextStatus === "delivered" && previousStatus !== "delivered" && previousStatus !== "read") {
    await client.query(`UPDATE campaigns SET delivered_count = delivered_count + 1 WHERE id = $1`, [campaignId]);
    return;
  }
  if (nextStatus === "read" && previousStatus !== "read") {
    await client.query(`UPDATE campaigns SET read_count = read_count + 1 WHERE id = $1`, [campaignId]);
    return;
  }
  if (nextStatus === "failed" && previousStatus !== "failed") {
    await client.query(`UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = $1`, [campaignId]);
  }
}

export async function applyConversationDeliveryStatusUpdate(input: {
  wamid: string;
  status: "sent" | "delivered" | "read" | "failed";
  errorCode?: string | null;
  errorMessage?: string | null;
  eventTimestamp?: string | null;
}): Promise<void> {
  const webhookFailureMessage =
    input.status === "failed"
      ? resolveWebhookFailureMessage({
          errorCode: input.errorCode,
          errorMessage: input.errorMessage
        })
      : trimToNull(input.errorMessage);
  const failure =
    input.status === "failed"
      ? classifyDeliveryFailure(new Error(webhookFailureMessage ?? "Meta delivery failed"), input.errorCode)
      : null;
  const normalizedErrorMessage = failure?.errorMessage ?? webhookFailureMessage;

  await withTransaction(async (client) => {
    const rowResult = await client.query<{
      message_id: string;
      user_id: string;
      phone_number: string;
      contact_id: string | null;
      current_status: string | null;
      sent_at: string | null;
      connection_id: string | null;
    }>(
      `SELECT
         cm.id AS message_id,
         c.user_id,
         c.phone_number,
         ct.id AS contact_id,
         cm.delivery_status AS current_status,
         cm.sent_at::text AS sent_at,
         (
           SELECT mda.connection_id
           FROM message_delivery_attempts mda
           WHERE mda.provider_message_id = $1
           ORDER BY mda.created_at DESC
           LIMIT 1
         ) AS connection_id
       FROM conversation_messages cm
       JOIN conversations c ON c.id = cm.conversation_id
       LEFT JOIN contacts ct
         ON ct.user_id = c.user_id
        AND ct.phone_number = c.phone_number
       WHERE cm.wamid = $1
       ORDER BY cm.created_at DESC
       LIMIT 1`,
      [input.wamid]
    );
    const row = rowResult.rows[0];
    if (!row || !shouldApplyConversationStatus(row.current_status, input.status)) {
      return;
    }

    await client.query(
      `UPDATE conversation_messages
       SET delivery_status = $2,
           delivered_at = CASE WHEN $2 = 'delivered' THEN NOW() ELSE delivered_at END,
           read_at = CASE WHEN $2 = 'read' THEN NOW() ELSE read_at END,
           error_code = COALESCE($3, error_code),
           error_message = COALESCE($4, error_message)
       WHERE id = $1`,
      [row.message_id, input.status, input.errorCode ?? null, normalizedErrorMessage]
    );

    if (failure?.suppressionReason) {
      await upsertRecipientSuppression({
        userId: row.user_id,
        phoneNumber: row.phone_number,
        contactId: row.contact_id,
        reason: failure.suppressionReason,
        source: "webhook_failure",
        metadata: {
          wamid: input.wamid,
          errorCode: input.errorCode ?? null,
          errorMessage: normalizedErrorMessage
        }
      });
    }

    await maybeOpenWebhookDelayAlert({
      userId: row.user_id,
      connectionId: row.connection_id,
      wamid: input.wamid,
      sentAt: row.sent_at,
      eventTimestamp: input.eventTimestamp ?? null
    });
  });
}

export async function applyCampaignDeliveryStatusUpdate(input: {
  wamid: string;
  status: "sent" | "delivered" | "read" | "failed";
  errorCode?: string | null;
  errorMessage?: string | null;
  eventTimestamp?: string | null;
}): Promise<void> {
  const webhookFailureMessage =
    input.status === "failed"
      ? resolveWebhookFailureMessage({
          errorCode: input.errorCode,
          errorMessage: input.errorMessage
        })
      : trimToNull(input.errorMessage);
  const failure =
    input.status === "failed"
      ? classifyDeliveryFailure(new Error(webhookFailureMessage ?? "Meta delivery failed"), input.errorCode)
      : null;
  const normalizedErrorMessage = failure?.errorMessage ?? webhookFailureMessage;

  await withTransaction(async (client) => {
    const rowResult = await client.query<{
      campaign_message_id: string;
      campaign_id: string;
      user_id: string;
      contact_id: string | null;
      phone_number: string;
      current_status: CampaignDeliveryStatus;
      sent_at: string | null;
      connection_id: string | null;
    }>(
      `SELECT
         cm.id AS campaign_message_id,
         cm.campaign_id,
         c.user_id,
         cm.contact_id,
         cm.phone_number,
         cm.status AS current_status,
         cm.sent_at::text AS sent_at,
         (
           SELECT mda.connection_id
           FROM message_delivery_attempts mda
           WHERE mda.provider_message_id = $1
           ORDER BY mda.created_at DESC
           LIMIT 1
         ) AS connection_id
       FROM campaign_messages cm
       JOIN campaigns c ON c.id = cm.campaign_id
       WHERE cm.wamid = $1
       LIMIT 1`,
      [input.wamid]
    );
    const row = rowResult.rows[0];
    if (!row || !shouldApplyCampaignStatus(row.current_status, input.status)) {
      return;
    }

    await client.query(
      `UPDATE campaign_messages
       SET status = $2,
           delivered_at = CASE WHEN $2 = 'delivered' THEN NOW() ELSE delivered_at END,
           read_at = CASE WHEN $2 = 'read' THEN NOW() ELSE read_at END,
           error_code = COALESCE($3, error_code),
           error_message = COALESCE($4, error_message),
           next_retry_at = NULL
       WHERE id = $1`,
       [
        row.campaign_message_id,
        input.status,
        input.errorCode ?? null,
        normalizedErrorMessage
      ]
    );

    await incrementCampaignCounterForTransition(client, row.campaign_id, row.current_status, input.status);
    await markCampaignCompletedIfIdle(client, row.campaign_id);

    if (failure?.suppressionReason) {
      await upsertRecipientSuppression({
        userId: row.user_id,
        phoneNumber: row.phone_number,
        contactId: row.contact_id,
        reason: failure.suppressionReason,
        source: "webhook_failure",
        metadata: {
          campaignId: row.campaign_id,
          wamid: input.wamid,
          errorCode: input.errorCode ?? null,
          errorMessage: normalizedErrorMessage
        }
      });
    }

    await maybeOpenWebhookDelayAlert({
      userId: row.user_id,
      connectionId: row.connection_id,
      campaignId: row.campaign_id,
      wamid: input.wamid,
      sentAt: row.sent_at,
      eventTimestamp: input.eventTimestamp ?? null
    });
  });
}

export async function listDeliveryAlerts(
  userId: string,
  options?: { status?: DeliveryAlertStatus; limit?: number }
): Promise<DeliveryAlert[]> {
  const params: unknown[] = [userId];
  let statusClause = "";
  if (options?.status) {
    params.push(options.status);
    statusClause = `AND status = $${params.length}`;
  }

  params.push(Math.max(1, Math.min(200, options?.limit ?? 50)));
  const limitParam = `$${params.length}`;

  const result = await pool.query<DeliveryAlert>(
    `SELECT *
     FROM message_delivery_alerts
     WHERE user_id = $1
       ${statusClause}
     ORDER BY triggered_at DESC
     LIMIT ${limitParam}`,
    params
  );
  return result.rows;
}

export async function resolveDeliveryAlert(userId: string, alertId: string): Promise<DeliveryAlert | null> {
  const result = await pool.query<DeliveryAlert>(
    `UPDATE message_delivery_alerts
     SET status = 'resolved',
         resolved_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
       AND user_id = $2
     RETURNING *`,
    [alertId, userId]
  );
  return result.rows[0] ?? null;
}

export async function getDeliveryOverview(userId: string): Promise<DeliveryOverview> {
  const [attemptResult, queuedResult, alertResult, suppressionResult] = await Promise.all([
    pool.query<{ total: string; sent: string; failed: string; retry_scheduled: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('sent', 'failed', 'retry_scheduled'))::text AS total,
         COUNT(*) FILTER (WHERE status = 'sent')::text AS sent,
         COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
         COUNT(*) FILTER (WHERE status = 'retry_scheduled')::text AS retry_scheduled
       FROM message_delivery_attempts
       WHERE user_id = $1
         AND created_at >= NOW() - ($2::text || ' seconds')::interval`,
      [userId, String(env.DELIVERY_ALERT_WINDOW_SECONDS)]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM campaign_messages cm
       JOIN campaigns c ON c.id = cm.campaign_id
       WHERE c.user_id = $1
         AND cm.status IN ('queued', 'sending')`,
      [userId]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM message_delivery_alerts
       WHERE user_id = $1
         AND status = 'open'`,
      [userId]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM contact_delivery_suppressions
       WHERE user_id = $1`,
      [userId]
    )
  ]);

  const total = Number(attemptResult.rows[0]?.total ?? 0);
  const failed = Number(attemptResult.rows[0]?.failed ?? 0) + Number(attemptResult.rows[0]?.retry_scheduled ?? 0);

  return {
    windowSeconds: env.DELIVERY_ALERT_WINDOW_SECONDS,
    attempts: {
      total,
      sent: Number(attemptResult.rows[0]?.sent ?? 0),
      failed: Number(attemptResult.rows[0]?.failed ?? 0),
      retryScheduled: Number(attemptResult.rows[0]?.retry_scheduled ?? 0),
      successRate: computeSuccessRate(total, failed)
    },
    queuedCampaignMessages: Number(queuedResult.rows[0]?.count ?? 0),
    openAlerts: Number(alertResult.rows[0]?.count ?? 0),
    suppressedRecipients: Number(suppressionResult.rows[0]?.count ?? 0)
  };
}

export async function getCampaignDeliveryAnalytics(
  userId: string,
  campaignId: string
): Promise<CampaignDeliveryAnalytics | null> {
  const campaignExists = await pool.query<{ id: string }>(
    `SELECT id
     FROM campaigns
     WHERE id = $1
       AND user_id = $2
     LIMIT 1`,
    [campaignId, userId]
  );
  if (!campaignExists.rows[0]?.id) {
    return null;
  }

  const [countResult, attemptResult, errorResult] = await Promise.all([
    pool.query<{
      total: string;
      queued: string;
      sending: string;
      sent: string;
      delivered: string;
      read: string;
      failed: string;
      skipped: string;
    }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE status = 'queued')::text AS queued,
         COUNT(*) FILTER (WHERE status = 'sending')::text AS sending,
         COUNT(*) FILTER (WHERE status = 'sent')::text AS sent,
         COUNT(*) FILTER (WHERE status = 'delivered')::text AS delivered,
         COUNT(*) FILTER (WHERE status = 'read')::text AS read,
         COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
         COUNT(*) FILTER (WHERE status = 'skipped')::text AS skipped
       FROM campaign_messages
       WHERE campaign_id = $1`,
      [campaignId]
    ),
    pool.query<{ total_attempts: string; retry_attempts: string; pending_retries: string }>(
      `SELECT
         COUNT(*)::text AS total_attempts,
         COUNT(*) FILTER (WHERE attempt_number > 1)::text AS retry_attempts,
         COUNT(*) FILTER (WHERE status = 'retry_scheduled')::text AS pending_retries
       FROM message_delivery_attempts
       WHERE campaign_id = $1`,
      [campaignId]
    ),
    pool.query<{ error_code: string | null; error_message: string | null; count: string }>(
      `SELECT error_code, error_message, COUNT(*)::text AS count
       FROM campaign_messages
       WHERE campaign_id = $1
         AND error_message IS NOT NULL
       GROUP BY error_code, error_message
       ORDER BY COUNT(*) DESC, error_message ASC
       LIMIT 5`,
      [campaignId]
    )
  ]);

  const counts = countResult.rows[0]!;
  const total = Number(counts.total ?? 0);
  const failed = Number(counts.failed ?? 0);
  const skipped = Number(counts.skipped ?? 0);

  return {
    campaignId,
    counts: {
      total,
      queued: Number(counts.queued ?? 0),
      sending: Number(counts.sending ?? 0),
      sent: Number(counts.sent ?? 0),
      delivered: Number(counts.delivered ?? 0),
      read: Number(counts.read ?? 0),
      failed,
      skipped
    },
    retries: {
      totalAttempts: Number(attemptResult.rows[0]?.total_attempts ?? 0),
      retryAttempts: Number(attemptResult.rows[0]?.retry_attempts ?? 0),
      pendingRetries: Number(attemptResult.rows[0]?.pending_retries ?? 0)
    },
    failureRate: total > 0 ? Number((((failed + skipped) / total) * 100).toFixed(2)) : 0,
    topErrors: errorResult.rows.map((row) => ({
      errorCode: row.error_code ?? null,
      errorMessage: row.error_message ?? null,
      count: Number(row.count ?? 0)
    }))
  };
}

// Status progression order — never go backwards (e.g. don't overwrite "read" with "delivered").
const SEQUENCE_STATUS_RANK: Record<string, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4
};

function shouldApplySequenceStatus(current: string | null, incoming: string): boolean {
  if (!current) return true;
  return (SEQUENCE_STATUS_RANK[incoming] ?? 0) > (SEQUENCE_STATUS_RANK[current] ?? 0);
}

export async function applySequenceDeliveryStatusUpdate(input: {
  wamid: string;
  status: "sent" | "delivered" | "read" | "failed";
}): Promise<void> {
  const result = await pool.query<{
    id: string;
    current_status: string | null;
  }>(
    `SELECT id, last_delivery_status AS current_status
     FROM sequence_enrollments
     WHERE last_message_id = $1
     LIMIT 1`,
    [input.wamid]
  );

  const row = result.rows[0];
  if (!row || !shouldApplySequenceStatus(row.current_status, input.status)) {
    return;
  }

  await pool.query(
    `UPDATE sequence_enrollments
     SET last_delivery_status = $2,
         updated_at = NOW()
     WHERE id = $1`,
    [row.id, input.status]
  );
}

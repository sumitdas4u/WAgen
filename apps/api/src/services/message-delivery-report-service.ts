import { pool } from "../db/pool.js";
import { normalizeDeliveryFailureMessage } from "./message-delivery-data-service.js";

const HEALTHY_ECOSYSTEM_REMARK = "This message was not delivered to maintain healthy ecosystem engagement.";

export type DeliveryReportStatus = "sending" | "sent" | "delivered" | "read" | "failed" | "retrying";

export interface DeliveryReportChannel {
  key: string;
  label: string;
  messages: number;
  failed: number;
}

export interface DeliverySummaryCard {
  label: string;
  count: number;
  percentage: number;
}

export interface DeliverySummaryDay {
  day: string;
  sent: number;
  delivered: number;
  engaged: number;
  failed: number;
}

export interface DeliveryFailureReason {
  errorCode: string | null;
  message: string;
  count: number;
}

export interface DeliveryReportSummary {
  rangeDays: number;
  cards: {
    recipients: DeliverySummaryCard;
    sent: DeliverySummaryCard;
    delivered: DeliverySummaryCard;
    engaged: DeliverySummaryCard;
    notInWhatsApp: DeliverySummaryCard;
    frequencyLimit: DeliverySummaryCard;
    failed: DeliverySummaryCard;
  };
  channels: DeliveryReportChannel[];
  daily: DeliverySummaryDay[];
  topFailureReasons: DeliveryFailureReason[];
}

export interface DeliveryLogRow {
  rowId: string;
  messageId: string;
  status: DeliveryReportStatus;
  sender: string;
  channelKey: string;
  channelLabel: string;
  messageContent: string;
  to: string;
  dateTime: string;
  remarks: string | null;
  errorCode: string | null;
}

interface DeliveryEnrichedRow {
  row_id: string;
  message_id: string;
  final_status: DeliveryReportStatus;
  sender_label: string;
  channel_key: string;
  channel_label: string;
  message_content: string;
  phone_number: string;
  occurred_at: string;
  remarks: string | null;
  error_code: string | null;
  is_not_in_whatsapp: boolean;
  is_frequency_limit: boolean;
}

function buildPercentage(count: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Number(((count / total) * 100).toFixed(1));
}

function normalizeDisplayPhone(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "Default channel";
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }
  return trimmed;
}

function healthyEcosystemFailureSql(alias: string): string {
  return `(
    ${alias}.error_code = '131049'
    OR LOWER(COALESCE(${alias}.error_message, '')) LIKE '%healthy ecosystem%'
    OR LOWER(COALESCE(${alias}.error_message, '')) LIKE '%ecosystem engagement%'
    OR LOWER(COALESCE(${alias}.error_message, '')) LIKE '%maintain healthy ecosystem%'
  )`;
}

function buildDeliveryEnrichedCte(input: {
  userId: string;
  days: number;
  channelKey?: string | null;
  status?: DeliveryReportStatus | null;
  failuresOnly?: boolean;
}) {
  const params: unknown[] = [input.userId, String(input.days)];
  const filters: string[] = [];

  if (input.channelKey?.trim()) {
    params.push(input.channelKey.trim());
    filters.push(`channel_key = $${params.length}`);
  }

  if (input.failuresOnly) {
    filters.push(`final_status = 'failed'`);
  } else if (input.status) {
    params.push(input.status);
    filters.push(`final_status = $${params.length}`);
  }

  const filterSql = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

  return {
    params,
    filterSql,
    // Normalize known Meta failure reasons here so older rows render with the same remarks as new rows.
    sql: `WITH ranked_attempts AS (
      SELECT
        mda.id,
        mda.user_id,
        mda.campaign_id,
        mda.campaign_message_id,
        mda.conversation_id,
        mda.contact_id,
        mda.connection_id,
        mda.phone_number,
        mda.linked_number,
        mda.phone_number_id,
        mda.message_kind,
        mda.status AS attempt_status,
        mda.attempt_number,
        mda.retryable,
        mda.error_category,
        mda.error_code,
        mda.error_message,
        mda.provider_message_id,
        mda.requested_payload_json,
        mda.provider_response_json,
        mda.created_at,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(mda.campaign_message_id::text, mda.provider_message_id, mda.id::text)
          ORDER BY mda.created_at DESC, mda.attempt_number DESC, mda.id DESC
        ) AS row_number
      FROM message_delivery_attempts mda
      WHERE mda.user_id = $1
        AND mda.message_kind <> 'test_template'
        AND mda.created_at >= NOW() - ($2::text || ' days')::interval
    ),
    latest_attempts AS (
      SELECT *
      FROM ranked_attempts
      WHERE row_number = 1
    ),
    enriched_logs AS (
      SELECT
        COALESCE(latest_attempts.provider_message_id, latest_attempts.id::text) AS message_id,
        COALESCE(latest_attempts.campaign_message_id::text, latest_attempts.provider_message_id, latest_attempts.id::text) AS row_id,
        latest_attempts.phone_number,
        COALESCE(
          NULLIF(REGEXP_REPLACE(COALESCE(wbc.display_phone_number, ''), '\D', '', 'g'), ''),
          NULLIF(REGEXP_REPLACE(COALESCE(latest_attempts.linked_number, ''), '\D', '', 'g'), ''),
          NULLIF(REGEXP_REPLACE(COALESCE(conv.channel_linked_number, ''), '\D', '', 'g'), ''),
          'default'
        ) AS channel_key,
        COALESCE(
          NULLIF(wbc.display_phone_number, ''),
          NULLIF(latest_attempts.linked_number, ''),
          NULLIF(conv.channel_linked_number, ''),
          'Default channel'
        ) AS channel_label,
        COALESCE(
          NULLIF(cm.sender_name, ''),
          CASE
            WHEN latest_attempts.message_kind IN ('campaign_template', 'conversation_template') THEN 'Notification'
            WHEN latest_attempts.message_kind = 'conversation_text' THEN 'Default'
            ELSE 'Automation'
          END
        ) AS sender_label,
        COALESCE(
          NULLIF(cm.message_text, ''),
          NULLIF(latest_attempts.requested_payload_json->>'summaryText', ''),
          NULLIF(latest_attempts.requested_payload_json->>'templateName', ''),
          '[Message]'
        ) AS message_content,
        CASE
          WHEN camp_msg.status IN ('sending', 'sent', 'delivered', 'read', 'failed') THEN camp_msg.status
          WHEN cm.delivery_status IN ('sent', 'delivered', 'read', 'failed') THEN cm.delivery_status
          WHEN latest_attempts.attempt_status = 'retry_scheduled' THEN 'retrying'
          WHEN latest_attempts.attempt_status = 'failed' THEN 'failed'
          WHEN latest_attempts.attempt_status = 'sending' THEN 'sending'
          ELSE 'sent'
        END AS final_status,
        COALESCE(cm.sent_at, camp_msg.sent_at, latest_attempts.created_at)::text AS occurred_at,
        CASE
          WHEN latest_attempts.attempt_status = 'retry_scheduled' THEN
            COALESCE(latest_attempts.provider_response_json->>'nextRetryAt', 'Retry scheduled')
          WHEN ${healthyEcosystemFailureSql("latest_attempts")} THEN '${HEALTHY_ECOSYSTEM_REMARK}'
          ELSE latest_attempts.error_message
        END AS remarks,
        latest_attempts.error_code,
        (
          latest_attempts.error_code = '133010'
          OR LOWER(COALESCE(latest_attempts.error_message, '')) LIKE '%not a valid whatsapp%'
          OR LOWER(COALESCE(latest_attempts.error_message, '')) LIKE '%invalid number%'
          OR LOWER(COALESCE(latest_attempts.error_message, '')) LIKE '%not valid%'
        ) AS is_not_in_whatsapp,
        (
          latest_attempts.error_code = '429'
          OR ${healthyEcosystemFailureSql("latest_attempts")}
          OR LOWER(COALESCE(latest_attempts.error_message, '')) LIKE '%429%'
          OR LOWER(COALESCE(latest_attempts.error_message, '')) LIKE '%rate limit%'
          OR LOWER(COALESCE(latest_attempts.error_message, '')) LIKE '%frequency%'
        ) AS is_frequency_limit
      FROM latest_attempts
      LEFT JOIN campaign_messages camp_msg ON camp_msg.id = latest_attempts.campaign_message_id
      LEFT JOIN conversation_messages cm ON cm.wamid = latest_attempts.provider_message_id
      LEFT JOIN conversations conv ON conv.id = COALESCE(latest_attempts.conversation_id, cm.conversation_id)
      LEFT JOIN whatsapp_business_connections wbc ON wbc.id = latest_attempts.connection_id
    )`
  };
}

export async function getDeliveryReportSummary(
  userId: string,
  options?: { days?: number; channelKey?: string | null }
): Promise<DeliveryReportSummary> {
  const days = Math.max(1, Math.min(90, options?.days ?? 7));
  const { params, filterSql, sql } = buildDeliveryEnrichedCte({
    userId,
    days,
    channelKey: options?.channelKey ?? null
  });

  const [summaryResult, dailyResult, channelResult, failureResult] = await Promise.all([
    pool.query<{
      recipients: string;
      sent: string;
      delivered: string;
      engaged: string;
      not_in_whatsapp: string;
      frequency_limit: string;
      failed: string;
    }>(
      `${sql}
       SELECT
         COUNT(DISTINCT phone_number)::text AS recipients,
         COUNT(*) FILTER (WHERE final_status IN ('sent', 'delivered', 'read', 'failed'))::text AS sent,
         COUNT(*) FILTER (WHERE final_status IN ('delivered', 'read'))::text AS delivered,
         COUNT(*) FILTER (WHERE final_status = 'read')::text AS engaged,
         COUNT(*) FILTER (WHERE final_status = 'failed' AND is_not_in_whatsapp)::text AS not_in_whatsapp,
         COUNT(*) FILTER (WHERE final_status = 'failed' AND is_frequency_limit)::text AS frequency_limit,
         COUNT(*) FILTER (WHERE final_status = 'failed')::text AS failed
       FROM enriched_logs
       ${filterSql}`,
      params
    ),
    pool.query<{ day: string; sent: string; delivered: string; engaged: string; failed: string }>(
      `${sql}
       SELECT
         TO_CHAR(DATE_TRUNC('day', occurred_at::timestamptz), 'YYYY-MM-DD') AS day,
         COUNT(*) FILTER (WHERE final_status IN ('sent', 'delivered', 'read', 'failed'))::text AS sent,
         COUNT(*) FILTER (WHERE final_status IN ('delivered', 'read'))::text AS delivered,
         COUNT(*) FILTER (WHERE final_status = 'read')::text AS engaged,
         COUNT(*) FILTER (WHERE final_status = 'failed')::text AS failed
       FROM enriched_logs
       ${filterSql}
       GROUP BY DATE_TRUNC('day', occurred_at::timestamptz)
       ORDER BY DATE_TRUNC('day', occurred_at::timestamptz) ASC`,
      params
    ),
    pool.query<{ channel_key: string; channel_label: string; messages: string; failed: string }>(
      `${sql}
       SELECT
         channel_key,
         channel_label,
         COUNT(*)::text AS messages,
         COUNT(*) FILTER (WHERE final_status = 'failed')::text AS failed
       FROM enriched_logs
       ${filterSql}
       GROUP BY channel_key, channel_label
       ORDER BY COUNT(*) DESC, channel_label ASC`,
      params
    ),
    pool.query<{ error_code: string | null; remarks: string | null; count: string }>(
      `${sql}
       SELECT
         error_code,
         remarks,
         COUNT(*)::text AS count
       FROM enriched_logs
       WHERE final_status = 'failed'
         ${filterSql ? `AND ${filterSql.replace(/^WHERE\s+/i, "")}` : ""}
       GROUP BY error_code, remarks
       ORDER BY COUNT(*) DESC, remarks ASC NULLS LAST
       LIMIT 5`,
      params
    )
  ]);

  const summary = summaryResult.rows[0] ?? {
    recipients: "0",
    sent: "0",
    delivered: "0",
    engaged: "0",
    not_in_whatsapp: "0",
    frequency_limit: "0",
    failed: "0"
  };

  const recipients = Number(summary.recipients ?? 0);
  const sent = Number(summary.sent ?? 0);
  const delivered = Number(summary.delivered ?? 0);
  const engaged = Number(summary.engaged ?? 0);
  const notInWhatsApp = Number(summary.not_in_whatsapp ?? 0);
  const frequencyLimit = Number(summary.frequency_limit ?? 0);
  const failed = Number(summary.failed ?? 0);

  return {
    rangeDays: days,
    cards: {
      recipients: { label: "Recipients", count: recipients, percentage: 0 },
      sent: { label: "Sent", count: sent, percentage: buildPercentage(sent, recipients) },
      delivered: { label: "Delivered", count: delivered, percentage: buildPercentage(delivered, sent) },
      engaged: { label: "Engaged", count: engaged, percentage: buildPercentage(engaged, sent) },
      notInWhatsApp: {
        label: "Not in WhatsApp",
        count: notInWhatsApp,
        percentage: buildPercentage(notInWhatsApp, recipients)
      },
      frequencyLimit: {
        label: "Frequency limit",
        count: frequencyLimit,
        percentage: buildPercentage(frequencyLimit, recipients)
      },
      failed: { label: "Failed", count: failed, percentage: buildPercentage(failed, sent) }
    },
    channels: channelResult.rows.map((row) => ({
      key: row.channel_key,
      label: normalizeDisplayPhone(row.channel_label),
      messages: Number(row.messages ?? 0),
      failed: Number(row.failed ?? 0)
    })),
    daily: dailyResult.rows.map((row) => ({
      day: row.day,
      sent: Number(row.sent ?? 0),
      delivered: Number(row.delivered ?? 0),
      engaged: Number(row.engaged ?? 0),
      failed: Number(row.failed ?? 0)
    })),
    topFailureReasons: failureResult.rows.map((row) => ({
      errorCode: row.error_code ?? null,
      message: normalizeDeliveryFailureMessage(row.error_code ?? null, row.remarks),
      count: Number(row.count ?? 0)
    }))
  };
}

export async function listDeliveryLogs(
  userId: string,
  options?: {
    days?: number;
    channelKey?: string | null;
    status?: DeliveryReportStatus | null;
    failuresOnly?: boolean;
    limit?: number;
    offset?: number;
  }
): Promise<{ rows: DeliveryLogRow[]; total: number }> {
  const days = Math.max(1, Math.min(90, options?.days ?? 7));
  const limit = Math.max(1, Math.min(200, options?.limit ?? 50));
  const offset = Math.max(0, options?.offset ?? 0);
  const { params, filterSql, sql } = buildDeliveryEnrichedCte({
    userId,
    days,
    channelKey: options?.channelKey ?? null,
    status: options?.status ?? null,
    failuresOnly: options?.failuresOnly
  });

  const pagedParams = [...params, limit, offset];
  const [rowResult, countResult] = await Promise.all([
    pool.query<DeliveryEnrichedRow>(
      `${sql}
       SELECT
         row_id,
         message_id,
         final_status,
         sender_label,
         channel_key,
         channel_label,
         message_content,
         phone_number,
         occurred_at,
         remarks,
         error_code,
         is_not_in_whatsapp,
         is_frequency_limit
       FROM enriched_logs
       ${filterSql}
       ORDER BY occurred_at::timestamptz DESC
       LIMIT $${pagedParams.length - 1}
       OFFSET $${pagedParams.length}`,
      pagedParams
    ),
    pool.query<{ count: string }>(
      `${sql}
       SELECT COUNT(*)::text AS count
       FROM enriched_logs
       ${filterSql}`,
      params
    )
  ]);

  return {
    rows: rowResult.rows.map((row) => ({
      rowId: row.row_id,
      messageId: row.message_id,
      status: row.final_status,
      sender: row.sender_label,
      channelKey: row.channel_key,
      channelLabel: normalizeDisplayPhone(row.channel_label),
      messageContent: row.message_content,
      to: normalizeDisplayPhone(row.phone_number),
      dateTime: row.occurred_at,
      remarks: row.final_status === "failed" ? normalizeDeliveryFailureMessage(row.error_code ?? null, row.remarks) : row.remarks,
      errorCode: row.error_code ?? null
    })),
    total: Number(countResult.rows[0]?.count ?? 0)
  };
}

import { randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";
import { createSegment, type ContactSegment } from "./contact-segments-service.js";
import {
  getCampaign,
  listCampaignMessages,
  listCampaigns,
  type Campaign,
  type CampaignMessage,
  type CampaignMessageStatus,
  type RetargetStatus
} from "./campaign-service.js";
import {
  importContactsWorkbook,
  previewContactsWorkbookImport,
  type ContactImportPreview,
  type ContactImportResult
} from "./contacts-service.js";
import type { Contact } from "../types/models.js";

export interface BroadcastSummary {
  totalBroadcasts: number;
  recipients: number;
  sent: number;
  delivered: number;
  engaged: number;
  failed: number;
  suppressed: number;
  frequencyLimited: number;
}

export interface BroadcastRetargetPreview {
  campaign: Campaign;
  status: RetargetStatus;
  recipients: Contact[];
  count: number;
}

export interface BroadcastReport {
  campaign: Campaign;
  messages: CampaignMessage[];
  total: number;
  buckets: Record<RetargetStatus, number>;
}

function buildRetargetClause(status: RetargetStatus): string {
  switch (status) {
    case "sent":
      return "cm.sent_at IS NOT NULL";
    case "delivered":
      return "(cm.delivered_at IS NOT NULL OR cm.status IN ('delivered', 'read'))";
    case "read":
      return "(cm.read_at IS NOT NULL OR cm.status = 'read')";
    case "failed":
      return "cm.status = 'failed'";
    case "skipped":
      return "cm.status = 'skipped'";
    default:
      return "FALSE";
  }
}

export async function getBroadcastSummary(userId: string): Promise<BroadcastSummary> {
  const result = await pool.query<{
    total_broadcasts: string;
    recipients: string;
    sent: string;
    delivered: string;
    engaged: string;
    failed: string;
    suppressed: string;
  }>(
    `SELECT
       COUNT(*)::text AS total_broadcasts,
       COALESCE(SUM(total_count), 0)::text AS recipients,
       COALESCE(SUM(sent_count), 0)::text AS sent,
       COALESCE(SUM(delivered_count), 0)::text AS delivered,
       COALESCE(SUM(read_count), 0)::text AS engaged,
       COALESCE(SUM(failed_count), 0)::text AS failed,
       COALESCE(SUM(skipped_count), 0)::text AS suppressed
     FROM campaigns
     WHERE user_id = $1`,
    [userId]
  );

  const row = result.rows[0];
  return {
    totalBroadcasts: Number(row?.total_broadcasts ?? 0),
    recipients: Number(row?.recipients ?? 0),
    sent: Number(row?.sent ?? 0),
    delivered: Number(row?.delivered ?? 0),
    engaged: Number(row?.engaged ?? 0),
    failed: Number(row?.failed ?? 0),
    suppressed: Number(row?.suppressed ?? 0),
    frequencyLimited: 0
  };
}

export async function getBroadcastReport(
  userId: string,
  campaignId: string,
  options?: { limit?: number; offset?: number; status?: CampaignMessageStatus }
): Promise<BroadcastReport | null> {
  const campaign = await getCampaign(userId, campaignId);
  if (!campaign) {
    return null;
  }

  const [messagesResult, bucketResult] = await Promise.all([
    listCampaignMessages(userId, campaignId, options),
    pool.query<{
      sent_count: string;
      delivered_count: string;
      read_count: string;
      failed_count: string;
      skipped_count: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE sent_at IS NOT NULL)::text AS sent_count,
         COUNT(*) FILTER (WHERE delivered_at IS NOT NULL OR status IN ('delivered', 'read'))::text AS delivered_count,
         COUNT(*) FILTER (WHERE read_at IS NOT NULL OR status = 'read')::text AS read_count,
         COUNT(*) FILTER (WHERE status = 'failed')::text AS failed_count,
         COUNT(*) FILTER (WHERE status = 'skipped')::text AS skipped_count
       FROM campaign_messages
       WHERE campaign_id = $1`,
      [campaignId]
    )
  ]);

  const buckets = bucketResult.rows[0];
  return {
    campaign,
    messages: messagesResult.messages,
    total: messagesResult.total,
    buckets: {
      sent: Number(buckets?.sent_count ?? 0),
      delivered: Number(buckets?.delivered_count ?? 0),
      read: Number(buckets?.read_count ?? 0),
      failed: Number(buckets?.failed_count ?? 0),
      skipped: Number(buckets?.skipped_count ?? 0)
    }
  };
}

export async function previewRetargetAudience(
  userId: string,
  campaignId: string,
  status: RetargetStatus
): Promise<BroadcastRetargetPreview | null> {
  const campaign = await getCampaign(userId, campaignId);
  if (!campaign) {
    return null;
  }

  const clause = buildRetargetClause(status);
  const contactsResult = await pool.query<Contact & { custom_field_values: [] }>(
    `SELECT DISTINCT
       c.*,
       '[]'::jsonb AS custom_field_values
     FROM campaign_messages cm
     LEFT JOIN contacts c ON c.id = cm.contact_id
     WHERE cm.campaign_id = $1
       AND ${clause}
       AND c.id IS NOT NULL
     ORDER BY c.updated_at DESC, c.created_at DESC
     LIMIT 1000`,
    [campaignId]
  );

  return {
    campaign,
    status,
    recipients: contactsResult.rows,
    count: contactsResult.rowCount ?? 0
  };
}

export async function importBroadcastAudienceWorkbook(
  userId: string,
  fileBuffer: Buffer,
  segmentName?: string | null,
  options?: {
    phoneNumberFormat?: "with_country_code" | "without_country_code";
    defaultCountryCode?: string | null;
    marketingOptIn?: boolean;
    columnMapping?: Record<string, string>;
  }
): Promise<{ importResult: ContactImportResult; segment: ContactSegment; batchTag: string }> {
  const batchTag = `broadcast-audience-${randomUUID().slice(0, 8)}`;
  const importResult = await importContactsWorkbook(userId, fileBuffer, {
    extraTags: [batchTag],
    phoneNumberFormat: options?.phoneNumberFormat,
    defaultCountryCode: options?.defaultCountryCode,
    marketingOptIn: options?.marketingOptIn,
    columnMapping: options?.columnMapping
  });

  const finalName =
    segmentName?.trim() || `Broadcast audience ${new Date().toISOString().slice(0, 10)}`;
  const segment = await createSegment(userId, finalName, [
    { field: "tags", op: "contains", value: batchTag }
  ]);

  return {
    importResult,
    segment,
    batchTag
  };
}

export function previewBroadcastAudienceWorkbookImport(fileBuffer: Buffer): ContactImportPreview {
  return previewContactsWorkbookImport(fileBuffer);
}

export async function uploadBroadcastMedia(
  userId: string,
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<{ mediaId: string; url: string; mimeType: string }> {
  const mediaId = randomUUID();
  await pool.query(
    `INSERT INTO media_uploads (id, user_id, mime_type, filename, data, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [mediaId, userId, mimeType, fileName, fileBuffer.toString("base64"), fileBuffer.length]
  );

  return {
    mediaId,
    url: `/api/media/${mediaId}`,
    mimeType
  };
}

export async function listBroadcasts(userId: string): Promise<Campaign[]> {
  return listCampaigns(userId);
}

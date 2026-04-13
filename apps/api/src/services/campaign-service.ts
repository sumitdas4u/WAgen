import { pool, withTransaction } from "../db/pool.js";
import type { Contact } from "../types/models.js";
import { getSegmentContacts } from "./contact-segments-service.js";
import { findSuppressedRecipients } from "./message-delivery-data-service.js";
import { requireMetaConnection } from "./meta-whatsapp-service.js";
import { getMessageTemplate, resolveTemplatePayload } from "./template-service.js";

export type CampaignStatus = "draft" | "scheduled" | "running" | "paused" | "completed" | "cancelled";
export type CampaignMessageStatus = "queued" | "sending" | "sent" | "delivered" | "read" | "failed" | "skipped";
export type CampaignTemplateVariableSource = "contact" | "static";
export type BroadcastType = "standard" | "retarget";
export type RetargetStatus = Extract<CampaignMessageStatus, "sent" | "delivered" | "read" | "failed" | "skipped">;

export interface CampaignTemplateVariableBinding {
  source: CampaignTemplateVariableSource;
  field?: string;
  value?: string;
  fallback?: string;
}

export type CampaignTemplateVariables = Record<string, CampaignTemplateVariableBinding>;
export type CampaignAudienceSource = Record<string, unknown>;
export type CampaignMediaOverrides = Record<string, string>;

export interface Campaign {
  id: string;
  user_id: string;
  name: string;
  status: CampaignStatus;
  broadcast_type: BroadcastType;
  connection_id: string | null;
  template_id: string | null;
  template_variables: CampaignTemplateVariables;
  target_segment_id: string | null;
  source_campaign_id: string | null;
  retarget_status: RetargetStatus | null;
  audience_source_json: CampaignAudienceSource;
  media_overrides_json: CampaignMediaOverrides;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  total_count: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  skipped_count: number;
  created_at: string;
  updated_at: string;
}

export interface CampaignMessage {
  id: string;
  campaign_id: string;
  contact_id: string | null;
  phone_number: string;
  wamid: string | null;
  status: CampaignMessageStatus;
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
}

export interface CreateCampaignInput {
  name: string;
  broadcastType?: BroadcastType;
  connectionId?: string | null;
  templateId?: string | null;
  templateVariables?: CampaignTemplateVariables;
  targetSegmentId?: string | null;
  sourceCampaignId?: string | null;
  retargetStatus?: RetargetStatus | null;
  audienceSource?: CampaignAudienceSource;
  mediaOverrides?: CampaignMediaOverrides;
  scheduledAt?: string | null;
}

async function validateCampaignConnection(
  userId: string,
  connectionId: string | null | undefined,
  templateId: string | null | undefined
): Promise<void> {
  if (!connectionId) {
    throw new Error("Select a WhatsApp API connection.");
  }

  await requireMetaConnection(userId, connectionId, { allowDisconnected: true });

  if (!templateId) {
    return;
  }

  const template = await getMessageTemplate(userId, templateId);
  if (template.connectionId !== connectionId) {
    throw new Error("Selected template does not belong to the chosen WhatsApp API connection.");
  }
}

function normalizePlaceholderKey(raw: string): string {
  const inner = raw.replace(/^\{\{\s*|\s*\}\}$/g, "").trim();
  return `{{${inner}}}`;
}

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
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

async function getCampaignAudienceContacts(userId: string, campaign: Campaign): Promise<Contact[]> {
  if (campaign.source_campaign_id && campaign.retarget_status) {
    const clause = buildRetargetClause(campaign.retarget_status);
    const result = await pool.query<Contact>(
      `SELECT DISTINCT c.*
       FROM campaign_messages cm
       JOIN contacts c ON c.id = cm.contact_id
       JOIN campaigns src ON src.id = cm.campaign_id
       WHERE src.user_id = $1
         AND src.id = $2
         AND ${clause}
       ORDER BY c.updated_at DESC, c.created_at DESC
       LIMIT 1000`,
      [userId, campaign.source_campaign_id]
    );
    return result.rows;
  }

  if (!campaign.target_segment_id) {
    throw new Error("Campaign has no target audience.");
  }

  return getSegmentContacts(userId, campaign.target_segment_id);
}

function getContactFieldValue(contact: Contact, field: string): string | null {
  const normalized = field.trim();
  if (!normalized) {
    return null;
  }

  switch (normalized) {
    case "display_name":
      return trimToNull(contact.display_name);
    case "phone_number":
      return trimToNull(contact.phone_number);
    case "email":
      return trimToNull(contact.email);
    case "contact_type":
      return trimToNull(contact.contact_type);
    case "tags":
      return trimToNull(contact.tags.join(", "));
    case "source_type":
      return trimToNull(contact.source_type);
    case "source_id":
      return trimToNull(contact.source_id);
    case "source_url":
      return trimToNull(contact.source_url);
    case "created_at":
      return trimToNull(contact.created_at);
    case "updated_at":
      return trimToNull(contact.updated_at);
    default:
      break;
  }

  if (!normalized.startsWith("custom:")) {
    return null;
  }

  const customFieldName = normalized.slice("custom:".length).trim().toLowerCase();
  if (!customFieldName) {
    return null;
  }

  const match = contact.custom_field_values.find((fieldValue) => fieldValue.field_name.toLowerCase() === customFieldName);
  return trimToNull(match?.value);
}

function resolveCampaignVariablesForContact(
  contact: Contact,
  bindings: CampaignTemplateVariables
): { values: Record<string, string>; missing: string[] } {
  const values: Record<string, string> = {};
  const missing = new Set<string>();

  for (const [rawKey, binding] of Object.entries(bindings ?? {})) {
    const key = normalizePlaceholderKey(rawKey);
    if (!binding || typeof binding !== "object") {
      missing.add(key);
      continue;
    }

    let resolved: string | null = null;
    if (binding.source === "static") {
      resolved = trimToNull(binding.value);
    } else if (binding.source === "contact" && binding.field) {
      resolved = getContactFieldValue(contact, binding.field);
    }

    resolved = resolved ?? trimToNull(binding.fallback);
    if (!resolved) {
      missing.add(key);
      continue;
    }

    values[key] = resolved;
  }

  return {
    values,
    missing: Array.from(missing).sort()
  };
}

export async function createCampaign(userId: string, input: CreateCampaignInput): Promise<Campaign> {
  await validateCampaignConnection(userId, input.connectionId, input.templateId ?? null);
  const result = await pool.query<Campaign>(
    `INSERT INTO campaigns (
       user_id,
       name,
       status,
       broadcast_type,
       connection_id,
       template_id,
       template_variables,
       target_segment_id,
       source_campaign_id,
       retarget_status,
       audience_source_json,
       media_overrides_json,
       scheduled_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11::jsonb, $12::jsonb, $13)
     RETURNING *`,
    [
      userId,
      input.name,
      input.scheduledAt ? "scheduled" : "draft",
      input.broadcastType ?? "standard",
      input.connectionId ?? null,
      input.templateId ?? null,
      JSON.stringify(input.templateVariables ?? {}),
      input.targetSegmentId ?? null,
      input.sourceCampaignId ?? null,
      input.retargetStatus ?? null,
      JSON.stringify(input.audienceSource ?? {}),
      JSON.stringify(input.mediaOverrides ?? {}),
      input.scheduledAt ?? null
    ]
  );
  return result.rows[0]!;
}

export async function listCampaigns(userId: string): Promise<Campaign[]> {
  const result = await pool.query<Campaign>(
    `SELECT * FROM campaigns WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
    [userId]
  );
  return result.rows;
}

export async function getCampaign(userId: string, campaignId: string): Promise<Campaign | null> {
  const result = await pool.query<Campaign>(
    `SELECT * FROM campaigns WHERE user_id = $1 AND id = $2 LIMIT 1`,
    [userId, campaignId]
  );
  return result.rows[0] ?? null;
}

export async function updateCampaign(
  userId: string,
  campaignId: string,
  patch: Partial<Pick<CreateCampaignInput, "name" | "broadcastType" | "connectionId" | "templateId" | "templateVariables" | "targetSegmentId" | "sourceCampaignId" | "retargetStatus" | "audienceSource" | "mediaOverrides" | "scheduledAt">>
): Promise<Campaign | null> {
  const current = await getCampaign(userId, campaignId);
  if (!current || (current.status !== "draft" && current.status !== "scheduled")) {
    return null;
  }

  const nextConnectionId = patch.connectionId ?? current.connection_id;
  const nextTemplateId = patch.templateId === undefined ? current.template_id : patch.templateId;
  await validateCampaignConnection(userId, nextConnectionId, nextTemplateId);

  const result = await pool.query<Campaign>(
    `UPDATE campaigns
     SET name = COALESCE($3, name),
         broadcast_type = COALESCE($4, broadcast_type),
         connection_id = COALESCE($5, connection_id),
         template_id = COALESCE($6, template_id),
         template_variables = COALESCE($7::jsonb, template_variables),
         target_segment_id = COALESCE($8, target_segment_id),
         source_campaign_id = COALESCE($9, source_campaign_id),
         retarget_status = COALESCE($10, retarget_status),
         audience_source_json = COALESCE($11::jsonb, audience_source_json),
         media_overrides_json = COALESCE($12::jsonb, media_overrides_json),
         status = CASE
           WHEN COALESCE($13, scheduled_at) IS NOT NULL THEN 'scheduled'
           ELSE 'draft'
         END,
         scheduled_at = COALESCE($13, scheduled_at)
     WHERE user_id = $1
       AND id = $2
     RETURNING *`,
    [
      userId,
      campaignId,
      patch.name ?? null,
      patch.broadcastType ?? null,
      patch.connectionId ?? null,
      patch.templateId ?? null,
      patch.templateVariables != null ? JSON.stringify(patch.templateVariables) : null,
      patch.targetSegmentId ?? null,
      patch.sourceCampaignId ?? null,
      patch.retargetStatus ?? null,
      patch.audienceSource != null ? JSON.stringify(patch.audienceSource) : null,
      patch.mediaOverrides != null ? JSON.stringify(patch.mediaOverrides) : null,
      patch.scheduledAt ?? null
    ]
  );
  return result.rows[0] ?? null;
}

export async function launchCampaign(userId: string, campaignId: string): Promise<Campaign | null> {
  const campaign = await getCampaign(userId, campaignId);
  if (!campaign || (campaign.status !== "draft" && campaign.status !== "scheduled")) {
    return null;
  }
  if (!campaign.connection_id) {
    throw new Error("Campaign is missing its WhatsApp API connection.");
  }
  if (!campaign.template_id) {
    throw new Error("Campaign has no template selected.");
  }

  await requireMetaConnection(userId, campaign.connection_id, { requireActive: true });

  const contacts = await getCampaignAudienceContacts(userId, campaign);
  if (contacts.length === 0) {
    throw new Error("Target audience has no contacts.");
  }

  const eligibleContacts = contacts.filter((contact) => trimToNull(contact.phone_number));
  if (eligibleContacts.length === 0) {
    throw new Error("No contacts with phone numbers in the selected segment.");
  }
  const suppressedRecipients = await findSuppressedRecipients(
    userId,
    eligibleContacts.map((contact) => contact.phone_number)
  );

  const template = await getMessageTemplate(userId, campaign.template_id);
  if (template.connectionId !== campaign.connection_id) {
    throw new Error("Campaign template does not belong to the selected WhatsApp API connection.");
  }
  if (template.status !== "APPROVED") {
    throw new Error("Only approved templates can be used for broadcasts.");
  }

  await pool.query(`DELETE FROM campaign_messages WHERE campaign_id = $1`, [campaignId]);

  let queuedCount = 0;
  let skippedCount = 0;

  for (const contact of eligibleContacts) {
    const resolved = resolveCampaignVariablesForContact(contact, campaign.template_variables ?? {});
    const phoneNumber = trimToNull(contact.phone_number);
    if (!phoneNumber) {
      continue;
    }

    let status: CampaignMessageStatus = "queued";
    let errorMessage: string | null = null;
    let resolvedVariablesJson: Record<string, string> = {
      ...resolved.values,
      ...(campaign.media_overrides_json ?? {})
    };
    const normalizedPhoneNumber = phoneNumber.replace(/\D/g, "");
    const suppression = suppressedRecipients.get(normalizedPhoneNumber);

    if (suppression) {
      status = "skipped";
      errorMessage = `Recipient suppressed: ${suppression.reason_label}`;
    }

    if (status === "queued" && resolved.missing.length > 0) {
      status = "skipped";
      errorMessage = `Missing campaign bindings for ${resolved.missing.join(", ")}`;
    } else if (status === "queued") {
      try {
        const preparedPayload = resolveTemplatePayload(template, resolvedVariablesJson);
        resolvedVariablesJson = preparedPayload.resolvedVariables;
      } catch (error) {
        status = "skipped";
        errorMessage = error instanceof Error ? error.message : "Failed to resolve template variables.";
      }
    }

    if (status === "queued") {
      queuedCount += 1;
    } else {
      skippedCount += 1;
    }

    await pool.query(
      `INSERT INTO campaign_messages (
         campaign_id,
         contact_id,
         phone_number,
         status,
         error_message,
         resolved_variables_json
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        campaignId,
        contact.id,
        phoneNumber,
        status,
        errorMessage,
        JSON.stringify(resolvedVariablesJson)
      ]
    );
  }

  const result = await pool.query<Campaign>(
    `UPDATE campaigns
     SET status = 'running',
         started_at = NOW(),
         completed_at = NULL,
         total_count = $3,
         sent_count = 0,
         delivered_count = 0,
         read_count = 0,
         failed_count = 0,
         skipped_count = $4
     WHERE user_id = $1
       AND id = $2
     RETURNING *`,
    [userId, campaignId, eligibleContacts.length, skippedCount]
  );

  if (queuedCount === 0) {
    await markCampaignCompleted(campaignId);
    return getCampaign(userId, campaignId);
  }

  return result.rows[0] ?? null;
}

export async function cancelCampaign(userId: string, campaignId: string): Promise<Campaign | null> {
  const result = await pool.query<Campaign>(
    `UPDATE campaigns
     SET status = 'cancelled'
     WHERE user_id = $1
       AND id = $2
       AND status IN ('draft', 'scheduled', 'running', 'paused')
     RETURNING *`,
    [userId, campaignId]
  );
  return result.rows[0] ?? null;
}

export async function listCampaignMessages(
  userId: string,
  campaignId: string,
  opts?: { limit?: number; offset?: number; status?: CampaignMessageStatus }
): Promise<{ messages: CampaignMessage[]; total: number }> {
  const campaign = await getCampaign(userId, campaignId);
  if (!campaign) {
    return { messages: [], total: 0 };
  }

  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const params: unknown[] = [campaignId];

  let statusClause = "";
  if (opts?.status) {
    params.push(opts.status);
    statusClause = `AND status = $${params.length}`;
  }

  const [messageResult, countResult] = await Promise.all([
    pool.query<CampaignMessage>(
      `SELECT *
       FROM campaign_messages
       WHERE campaign_id = $1 ${statusClause}
       ORDER BY created_at ASC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM campaign_messages
       WHERE campaign_id = $1 ${statusClause}`,
      params
    )
  ]);

  return {
    messages: messageResult.rows,
    total: Number(countResult.rows[0]?.count ?? 0)
  };
}

export async function markCampaignMessageSent(
  campaignMessageId: string,
  wamid: string | null
): Promise<void> {
  await withTransaction(async (client) => {
    const current = await client.query<{ campaign_id: string; status: CampaignMessageStatus }>(
      `SELECT campaign_id, status
       FROM campaign_messages
       WHERE id = $1
       LIMIT 1
       FOR UPDATE`,
      [campaignMessageId]
    );
    const row = current.rows[0];
    if (!row || row.status === "sent" || row.status === "delivered" || row.status === "read") {
      return;
    }

    await client.query(
      `UPDATE campaign_messages
       SET status = 'sent',
           wamid = COALESCE($2, wamid),
           sent_at = COALESCE(sent_at, NOW()),
           next_retry_at = NULL,
           error_code = NULL,
           error_message = NULL
       WHERE id = $1`,
      [campaignMessageId, wamid]
    );

    await client.query(`UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = $1`, [row.campaign_id]);
  });
}

export async function markCampaignMessageFailed(
  campaignMessageId: string,
  errorCode: string | null,
  errorMessage: string | null,
  permanent: boolean,
  nextRetryAt?: Date
): Promise<void> {
  await withTransaction(async (client) => {
    const current = await client.query<{ campaign_id: string; status: CampaignMessageStatus }>(
      `SELECT campaign_id, status
       FROM campaign_messages
       WHERE id = $1
       LIMIT 1
       FOR UPDATE`,
      [campaignMessageId]
    );
    const row = current.rows[0];
    if (!row) {
      return;
    }

    if (permanent || !nextRetryAt) {
      if (row.status !== "failed") {
        await client.query(
          `UPDATE campaign_messages
           SET status = 'failed',
               error_code = $2,
               error_message = $3,
               next_retry_at = NULL
           WHERE id = $1`,
          [campaignMessageId, errorCode, errorMessage]
        );
        await client.query(`UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = $1`, [row.campaign_id]);
      }
      return;
    }

    await client.query(
      `UPDATE campaign_messages
       SET status = 'queued',
           retry_count = retry_count + 1,
           next_retry_at = $2,
           error_code = $3,
           error_message = $4
       WHERE id = $1`,
      [campaignMessageId, nextRetryAt.toISOString(), errorCode, errorMessage]
    );
  });
}

export async function updateCampaignMessageDelivery(
  wamid: string,
  status: "delivered" | "read" | "failed",
  errorCode?: string | null
): Promise<void> {
  const result = await pool.query<{ id: string; campaign_id: string }>(
    `UPDATE campaign_messages
     SET status = $2,
         delivered_at = CASE WHEN $2 = 'delivered' THEN NOW() ELSE delivered_at END,
         read_at = CASE WHEN $2 = 'read' THEN NOW() ELSE read_at END,
         error_code = COALESCE($3, error_code)
     WHERE wamid = $1
       AND status NOT IN ('read', 'failed')
     RETURNING id, campaign_id`,
    [wamid, status, errorCode ?? null]
  );

  if (result.rowCount === 0) {
    return;
  }

  for (const row of result.rows) {
    if (status === "delivered") {
      await pool.query(`UPDATE campaigns SET delivered_count = delivered_count + 1 WHERE id = $1`, [row.campaign_id]);
    } else if (status === "read") {
      await pool.query(`UPDATE campaigns SET read_count = read_count + 1 WHERE id = $1`, [row.campaign_id]);
    } else if (status === "failed") {
      await pool.query(`UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = $1`, [row.campaign_id]);
    }
  }
}

export async function markCampaignCompleted(campaignId: string): Promise<void> {
  await pool.query(
    `UPDATE campaigns
     SET status = 'completed',
         completed_at = NOW()
     WHERE id = $1
       AND status = 'running'
       AND NOT EXISTS (
         SELECT 1
         FROM campaign_messages
         WHERE campaign_id = $1
           AND status IN ('queued', 'sending')
       )`,
    [campaignId]
  );
}

export async function fetchQueuedCampaignMessages(
  campaignId: string,
  batchSize = 100
): Promise<CampaignMessage[]> {
  return claimQueuedCampaignMessages(campaignId, batchSize);
}

export async function claimQueuedCampaignMessages(
  campaignId: string,
  batchSize = 100
): Promise<CampaignMessage[]> {
  return withTransaction(async (client) => {
    const result = await client.query<CampaignMessage>(
      `WITH next_messages AS (
         SELECT id
         FROM campaign_messages
         WHERE campaign_id = $1
           AND status = 'queued'
           AND (retry_count = 0 OR next_retry_at <= NOW())
         ORDER BY created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE campaign_messages cm
       SET status = 'sending',
           next_retry_at = NULL
       FROM next_messages
       WHERE cm.id = next_messages.id
       RETURNING cm.*`,
      [campaignId, batchSize]
    );
    return result.rows;
  });
}

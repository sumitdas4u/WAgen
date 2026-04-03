import { pool } from "../db/pool.js";
import { getSegmentContacts } from "./contact-segments-service.js";

export type CampaignStatus = "draft" | "scheduled" | "running" | "paused" | "completed" | "cancelled";
export type CampaignMessageStatus = "queued" | "sent" | "delivered" | "read" | "failed" | "skipped";

export interface Campaign {
  id: string;
  user_id: string;
  name: string;
  status: CampaignStatus;
  template_id: string | null;
  template_variables: Record<string, unknown>;
  target_segment_id: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  total_count: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
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
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCampaignInput {
  name: string;
  templateId?: string | null;
  templateVariables?: Record<string, unknown>;
  targetSegmentId?: string | null;
  scheduledAt?: string | null;
}

export async function createCampaign(userId: string, input: CreateCampaignInput): Promise<Campaign> {
  const result = await pool.query<Campaign>(
    `INSERT INTO campaigns (user_id, name, template_id, template_variables, target_segment_id, scheduled_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     RETURNING *`,
    [
      userId,
      input.name,
      input.templateId ?? null,
      JSON.stringify(input.templateVariables ?? {}),
      input.targetSegmentId ?? null,
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
  patch: Partial<Pick<CreateCampaignInput, "name" | "templateId" | "templateVariables" | "targetSegmentId" | "scheduledAt">>
): Promise<Campaign | null> {
  const current = await getCampaign(userId, campaignId);
  if (!current || current.status !== "draft") {
    return null;
  }
  const result = await pool.query<Campaign>(
    `UPDATE campaigns
     SET name                = COALESCE($3, name),
         template_id         = COALESCE($4, template_id),
         template_variables  = COALESCE($5::jsonb, template_variables),
         target_segment_id   = COALESCE($6, target_segment_id),
         scheduled_at        = COALESCE($7, scheduled_at)
     WHERE user_id = $1 AND id = $2
     RETURNING *`,
    [
      userId,
      campaignId,
      patch.name ?? null,
      patch.templateId ?? null,
      patch.templateVariables != null ? JSON.stringify(patch.templateVariables) : null,
      patch.targetSegmentId ?? null,
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
  if (!campaign.target_segment_id) {
    throw new Error("Campaign has no target segment.");
  }
  if (!campaign.template_id) {
    throw new Error("Campaign has no template selected.");
  }

  const contacts = await getSegmentContacts(userId, campaign.target_segment_id);
  if (contacts.length === 0) {
    throw new Error("Target segment has no contacts.");
  }

  // Seed campaign_messages for each contact with a phone number
  const eligible = contacts.filter((c) => c.phone_number);
  if (eligible.length === 0) {
    throw new Error("No contacts with phone numbers in the selected segment.");
  }

  // Insert all campaign messages
  const values = eligible
    .map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`)
    .join(", ");
  const params: unknown[] = [campaignId];
  for (const contact of eligible) {
    params.push(contact.id, contact.phone_number);
  }

  await pool.query(
    `INSERT INTO campaign_messages (campaign_id, contact_id, phone_number)
     VALUES ${values}
     ON CONFLICT DO NOTHING`,
    params
  );

  // Transition campaign to running
  const result = await pool.query<Campaign>(
    `UPDATE campaigns
     SET status      = 'running',
         started_at  = NOW(),
         total_count = $3
     WHERE user_id = $1 AND id = $2
     RETURNING *`,
    [userId, campaignId, eligible.length]
  );
  return result.rows[0] ?? null;
}

export async function cancelCampaign(userId: string, campaignId: string): Promise<Campaign | null> {
  const result = await pool.query<Campaign>(
    `UPDATE campaigns
     SET status = 'cancelled'
     WHERE user_id = $1 AND id = $2
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
  // Verify ownership
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

  const [msgResult, countResult] = await Promise.all([
    pool.query<CampaignMessage>(
      `SELECT * FROM campaign_messages
       WHERE campaign_id = $1 ${statusClause}
       ORDER BY created_at ASC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM campaign_messages WHERE campaign_id = $1 ${statusClause}`,
      params
    )
  ]);

  return {
    messages: msgResult.rows,
    total: Number(countResult.rows[0]?.count ?? 0)
  };
}

// Called by the campaign worker after a successful send
export async function markCampaignMessageSent(
  campaignMessageId: string,
  wamid: string | null
): Promise<void> {
  await pool.query(
    `UPDATE campaign_messages
     SET status  = 'sent',
         wamid   = COALESCE($2, wamid),
         sent_at = NOW()
     WHERE id = $1`,
    [campaignMessageId, wamid]
  );
  await pool.query(
    `UPDATE campaigns
     SET sent_count = sent_count + 1
     WHERE id = (SELECT campaign_id FROM campaign_messages WHERE id = $1)`,
    [campaignMessageId]
  );
}

// Called by the campaign worker on send failure
export async function markCampaignMessageFailed(
  campaignMessageId: string,
  errorCode: string | null,
  errorMessage: string | null,
  permanent: boolean,
  nextRetryAt?: Date
): Promise<void> {
  if (permanent || !nextRetryAt) {
    await pool.query(
      `UPDATE campaign_messages
       SET status        = 'failed',
           error_code    = $2,
           error_message = $3
       WHERE id = $1`,
      [campaignMessageId, errorCode, errorMessage]
    );
    await pool.query(
      `UPDATE campaigns
       SET failed_count = failed_count + 1
       WHERE id = (SELECT campaign_id FROM campaign_messages WHERE id = $1)`,
      [campaignMessageId]
    );
  } else {
    await pool.query(
      `UPDATE campaign_messages
       SET retry_count   = retry_count + 1,
           next_retry_at = $2,
           error_code    = $3,
           error_message = $4
       WHERE id = $1`,
      [campaignMessageId, nextRetryAt.toISOString(), errorCode, errorMessage]
    );
  }
}

// Called from processDeliveryStatuses when webhook delivers a status for a campaign message
export async function updateCampaignMessageDelivery(
  wamid: string,
  status: "delivered" | "read" | "failed",
  errorCode?: string | null
): Promise<void> {
  const result = await pool.query<{ id: string; campaign_id: string; status: string }>(
    `UPDATE campaign_messages
     SET status        = $2,
         delivered_at  = CASE WHEN $2 = 'delivered' THEN NOW() ELSE delivered_at END,
         read_at       = CASE WHEN $2 = 'read'      THEN NOW() ELSE read_at      END,
         error_code    = COALESCE($3, error_code)
     WHERE wamid = $1
       AND status NOT IN ('read', 'failed')
     RETURNING id, campaign_id, status`,
    [wamid, status, errorCode ?? null]
  );

  if (result.rowCount === 0) {
    return;
  }

  for (const row of result.rows) {
    if (status === "delivered") {
      await pool.query(
        `UPDATE campaigns SET delivered_count = delivered_count + 1 WHERE id = $1`,
        [row.campaign_id]
      );
    } else if (status === "read") {
      await pool.query(
        `UPDATE campaigns SET read_count = read_count + 1 WHERE id = $1`,
        [row.campaign_id]
      );
    } else if (status === "failed") {
      await pool.query(
        `UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = $1`,
        [row.campaign_id]
      );
    }
  }
}

// Called by the worker when all queued messages are processed
export async function markCampaignCompleted(campaignId: string): Promise<void> {
  await pool.query(
    `UPDATE campaigns
     SET status       = 'completed',
         completed_at = NOW()
     WHERE id = $1 AND status = 'running'`,
    [campaignId]
  );
}

// Fetch queued messages ready to send (including due retries)
export async function fetchQueuedCampaignMessages(
  campaignId: string,
  batchSize = 100
): Promise<CampaignMessage[]> {
  const result = await pool.query<CampaignMessage>(
    `SELECT * FROM campaign_messages
     WHERE campaign_id = $1
       AND status = 'queued'
       AND (retry_count = 0 OR next_retry_at <= NOW())
     ORDER BY created_at ASC
     LIMIT $2`,
    [campaignId, batchSize]
  );
  return result.rows;
}

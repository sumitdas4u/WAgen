import { pool, withTransaction } from "../db/pool.js";

export type EngagementEventType =
  | "clicked_button"
  | "clicked_url"
  | "replied_any"
  | "replied_quote";

export interface BroadcastEngagementInput {
  eventType: EngagementEventType;
  wamid: string | null;
  contactId: string | null;
  campaignMsgId?: string;
}

export interface EngagementTimelineBucket {
  period: string;
  clicked_button: number;
  clicked_url: number;
  replied_any: number;
  replied_quote: number;
}

interface CampaignMessageRow {
  id: string;
  campaign_id: string;
  contact_id: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  quote_replied_at: string | null;
}

async function findCampaignMessage(
  wamid: string | null,
  contactId: string | null,
  eventType: EngagementEventType,
  campaignMsgId?: string
): Promise<CampaignMessageRow | null> {
  if (campaignMsgId) {
    const result = await pool.query<CampaignMessageRow>(
      `SELECT id, campaign_id, contact_id, clicked_at, replied_at, quote_replied_at
       FROM campaign_messages
       WHERE id = $1
       LIMIT 1`,
      [campaignMsgId]
    );
    return result.rows[0] ?? null;
  }

  if (wamid) {
    const result = await pool.query<CampaignMessageRow>(
      `SELECT id, campaign_id, contact_id, clicked_at, replied_at, quote_replied_at
       FROM campaign_messages
       WHERE wamid = $1
       LIMIT 1`,
      [wamid]
    );
    return result.rows[0] ?? null;
  }

  if (contactId && eventType === "replied_any") {
    const result = await pool.query<CampaignMessageRow>(
      `SELECT id, campaign_id, contact_id, clicked_at, replied_at, quote_replied_at
       FROM campaign_messages
       WHERE contact_id = $1
         AND sent_at IS NOT NULL
         AND sent_at > NOW() - INTERVAL '7 days'
       ORDER BY sent_at DESC
       LIMIT 1`,
      [contactId]
    );
    return result.rows[0] ?? null;
  }

  return null;
}

function timestampColumnFor(eventType: EngagementEventType): string {
  if (eventType === "clicked_button" || eventType === "clicked_url") return "clicked_at";
  if (eventType === "replied_quote") return "quote_replied_at";
  return "replied_at";
}

function counterColumnFor(eventType: EngagementEventType): string {
  if (eventType === "clicked_button" || eventType === "clicked_url") return "clicked_count";
  if (eventType === "replied_quote") return "quote_replied_count";
  return "replied_count";
}

export async function recordBroadcastEngagement(
  input: BroadcastEngagementInput
): Promise<void> {
  const row = await findCampaignMessage(input.wamid, input.contactId, input.eventType, input.campaignMsgId);
  if (!row) {
    return;
  }

  const tsCol = timestampColumnFor(input.eventType);
  const counterCol = counterColumnFor(input.eventType);
  const isFirstEvent = row[tsCol as keyof CampaignMessageRow] === null;

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO campaign_engagement_events
         (campaign_id, campaign_msg_id, contact_id, event_type)
       VALUES ($1, $2, $3, $4)`,
      [row.campaign_id, row.id, row.contact_id, input.eventType]
    );

    await client.query(
      `UPDATE campaign_messages
       SET ${tsCol} = COALESCE(${tsCol}, NOW())
       WHERE id = $1`,
      [row.id]
    );

    if (isFirstEvent) {
      await client.query(
        `UPDATE campaigns
         SET ${counterCol} = ${counterCol} + 1
         WHERE id = $1`,
        [row.campaign_id]
      );
    }
  });
}

export async function getBroadcastEngagementTimeline(
  campaignId: string,
  granularity: "hour" | "day" | "week"
): Promise<EngagementTimelineBucket[]> {
  const safeGranularity = granularity === "hour" || granularity === "week" ? granularity : "day";

  const result = await pool.query<{
    period: string;
    clicked_button: string;
    clicked_url: string;
    replied_any: string;
    replied_quote: string;
  }>(
    `SELECT
       date_trunc('${safeGranularity}', occurred_at) AS period,
       COUNT(*) FILTER (WHERE event_type = 'clicked_button')::text AS clicked_button,
       COUNT(*) FILTER (WHERE event_type = 'clicked_url')::text   AS clicked_url,
       COUNT(*) FILTER (WHERE event_type = 'replied_any')::text   AS replied_any,
       COUNT(*) FILTER (WHERE event_type = 'replied_quote')::text AS replied_quote
     FROM campaign_engagement_events
     WHERE campaign_id = $1
     GROUP BY 1
     ORDER BY 1`,
    [campaignId]
  );

  return result.rows.map((row) => ({
    period: row.period,
    clicked_button: Number(row.clicked_button),
    clicked_url: Number(row.clicked_url),
    replied_any: Number(row.replied_any),
    replied_quote: Number(row.replied_quote),
  }));
}

import { pool } from "../db/pool.js";
import { getOrCreateConversation, trackOutboundMessage } from "./conversation-service.js";
import {
  fetchQueuedCampaignMessages,
  markCampaignCompleted,
  markCampaignMessageFailed,
  markCampaignMessageSent,
  type Campaign
} from "./campaign-service.js";
import { realtimeHub } from "./realtime-hub.js";
import { dispatchTemplateMessage } from "./template-service.js";

const PERMANENT_META_CODES = new Set([
  "131026",
  "131047",
  "132000",
  "132001",
  "133010",
  "131051"
]);

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return true;
  }

  const message = error.message;
  if (message.includes("429") || message.includes("503") || message.includes("502") || message.includes("500")) {
    return true;
  }

  for (const code of PERMANENT_META_CODES) {
    if (message.includes(code)) {
      return false;
    }
  }

  if (
    message.includes("not a valid WhatsApp") ||
    message.includes("opted out") ||
    message.includes("blocked") ||
    (message.includes("template") && message.includes("not")) ||
    message.includes("invalid number")
  ) {
    return false;
  }

  return true;
}

function retryDelayMs(retryCount: number): number {
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

const MAX_RETRIES = 4;
const SEND_DELAY_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RunningCampaignJob {
  campaignId: string;
  userId: string;
}

const pendingJobs = new Map<string, RunningCampaignJob>();
const pendingQueue: string[] = [];
const runningJobs = new Set<string>();
let queueLoopRunning = false;

function extractMetaErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const match = error.message.match(/\b(13\d{4})\b/);
  return match?.[1] ?? null;
}

async function processCampaignJob(job: RunningCampaignJob): Promise<void> {
  runningJobs.add(job.campaignId);

  try {
    const campaignResult = await pool.query<Campaign>(
      `SELECT * FROM campaigns WHERE id = $1 AND status = 'running' LIMIT 1`,
      [job.campaignId]
    );
    const campaign = campaignResult.rows[0];
    if (!campaign) {
      return;
    }
    if (!campaign.template_id) {
      console.error(`[CampaignWorker] no template_id on campaign=${job.campaignId}`);
      return;
    }

    const userRow = await pool.query<{ name: string }>(
      `SELECT name FROM users WHERE id = $1 LIMIT 1`,
      [job.userId]
    );
    const senderName = userRow.rows[0]?.name?.trim() || "Agent";

    while (true) {
      const statusCheck = await pool.query<{ status: string }>(
        `SELECT status FROM campaigns WHERE id = $1 LIMIT 1`,
        [job.campaignId]
      );
      if (statusCheck.rows[0]?.status !== "running") {
        break;
      }

      const messages = await fetchQueuedCampaignMessages(job.campaignId, 100);
      if (messages.length === 0) {
        break;
      }

      for (const message of messages) {
        const nextStatusCheck = await pool.query<{ status: string }>(
          `SELECT status FROM campaigns WHERE id = $1 LIMIT 1`,
          [job.campaignId]
        );
        if (nextStatusCheck.rows[0]?.status !== "running") {
          return;
        }

        try {
          const sent = await dispatchTemplateMessage(job.userId, {
            templateId: campaign.template_id,
            to: message.phone_number,
            variableValues: message.resolved_variables_json ?? {}
          });

          await markCampaignMessageSent(message.id, sent.messageId ?? null);

          const conversation = await getOrCreateConversation(job.userId, message.phone_number, {
            channelType: "api",
            channelLinkedNumber: sent.connection.linkedNumber
          });

          await trackOutboundMessage(
            conversation.id,
            sent.summaryText,
            { senderName },
            sent.messagePayload.headerMediaUrl ?? null,
            sent.messagePayload,
            sent.messageId ?? null
          );

          realtimeHub.broadcast(job.userId, "conversation.updated", {
            conversationId: conversation.id,
            phoneNumber: message.phone_number,
            direction: "outbound",
            message: sent.summaryText,
            score: conversation.score,
            stage: conversation.stage
          });
        } catch (error) {
          const retryable = isRetryableError(error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorCode = extractMetaErrorCode(error);

          if (retryable && message.retry_count < MAX_RETRIES) {
            const delay = retryDelayMs(message.retry_count);
            const nextRetryAt = new Date(Date.now() + delay);
            await markCampaignMessageFailed(message.id, errorCode, errorMessage, false, nextRetryAt);
            console.warn(
              `[CampaignWorker] retryable error for msg=${message.id} attempt=${message.retry_count}, retry at ${nextRetryAt.toISOString()}: ${errorMessage}`
            );
          } else {
            await markCampaignMessageFailed(message.id, errorCode, errorMessage, true);
            console.warn(`[CampaignWorker] permanent failure for msg=${message.id}: ${errorMessage}`);
          }
        }

        await sleep(SEND_DELAY_MS);
      }
    }

    const remaining = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM campaign_messages
       WHERE campaign_id = $1
         AND status = 'queued'`,
      [job.campaignId]
    );
    const queuedCount = Number(remaining.rows[0]?.count ?? 0);
    if (queuedCount === 0) {
      await markCampaignCompleted(job.campaignId);
      console.info(`[CampaignWorker] campaign=${job.campaignId} completed`);
    }
  } catch (error) {
    console.error(`[CampaignWorker] job failed for campaign=${job.campaignId}`, error);
  } finally {
    pendingJobs.delete(job.campaignId);
    runningJobs.delete(job.campaignId);
  }
}

async function runQueueLoop(): Promise<void> {
  if (queueLoopRunning) {
    return;
  }
  queueLoopRunning = true;

  try {
    while (pendingQueue.length > 0) {
      const nextId = pendingQueue.shift();
      if (!nextId) {
        continue;
      }
      const job = pendingJobs.get(nextId);
      if (!job || runningJobs.has(nextId)) {
        continue;
      }
      await processCampaignJob(job);
    }
  } finally {
    queueLoopRunning = false;
    if (pendingQueue.length > 0) {
      void runQueueLoop();
    }
  }
}

export function enqueueCampaign(campaignId: string, userId: string): void {
  if (runningJobs.has(campaignId) || pendingJobs.has(campaignId)) {
    return;
  }
  pendingJobs.set(campaignId, { campaignId, userId });
  pendingQueue.push(campaignId);
  setImmediate(() => {
    if (!queueLoopRunning) {
      void runQueueLoop();
    }
  });
}

async function retrySweep(): Promise<void> {
  try {
    const result = await pool.query<{ campaign_id: string; user_id: string }>(
      `SELECT DISTINCT cm.campaign_id, c.user_id
       FROM campaign_messages cm
       JOIN campaigns c ON c.id = cm.campaign_id
       WHERE cm.status = 'queued'
         AND cm.retry_count > 0
         AND cm.next_retry_at <= NOW()
         AND c.status = 'running'`
    );
    for (const row of result.rows) {
      enqueueCampaign(row.campaign_id, row.user_id);
    }
  } catch (error) {
    console.error("[CampaignWorker] retry sweep failed", error);
  }
}

let retrySweepTimer: ReturnType<typeof setInterval> | null = null;

export function startCampaignWorker(): void {
  if (retrySweepTimer) {
    return;
  }
  retrySweepTimer = setInterval(() => void retrySweep(), 60_000);
  console.info("[CampaignWorker] started (retry sweep every 60s)");
}

export function stopCampaignWorker(): void {
  if (retrySweepTimer) {
    clearInterval(retrySweepTimer);
    retrySweepTimer = null;
  }
}

import { Worker, type JobsOptions } from "bullmq";
import { firstRow } from "../db/sql-helpers.js";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import {
  claimQueuedCampaignMessages,
  launchCampaign,
  markCampaignCompleted,
  type Campaign
} from "./campaign-service.js";
import { queueCampaignOutboundMessage } from "./outbound-message-service.js";
import {
  createQueueWorkerConnection,
  getCampaignDispatchQueue
} from "./queue-service.js";

interface CampaignDispatchJob {
  campaignId: string;
  userId: string;
}

let retrySweepTimer: ReturnType<typeof setInterval> | null = null;
let dispatchWorker: Worker<CampaignDispatchJob> | null = null;

function campaignDispatchJobId(campaignId: string): string {
  return `campaign-${campaignId}`;
}

function sharedJobCleanup(): Pick<JobsOptions, "removeOnComplete" | "removeOnFail"> {
  return {
    removeOnComplete: 1000,
    removeOnFail: 5000
  };
}

function sharedRetryOptions(): Pick<JobsOptions, "attempts" | "backoff"> {
  return {
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 3000
    }
  };
}

async function loadRunningCampaign(campaignId: string): Promise<Campaign | null> {
  const campaignResult = await pool.query<Campaign>(
    `SELECT * FROM campaigns WHERE id = $1 AND status = 'running' LIMIT 1`,
    [campaignId]
  );
  return firstRow(campaignResult);
}


export async function enqueueCampaign(campaignId: string, userId: string): Promise<void> {
  const queue = getCampaignDispatchQueue();
  if (!queue) {
    throw new Error("Campaign dispatch queue is unavailable because REDIS_URL is not configured.");
  }

  await queue.add(
    "dispatch-campaign",
    {
      campaignId,
      userId
    },
    {
      jobId: campaignDispatchJobId(campaignId),
      ...sharedRetryOptions(),
      ...sharedJobCleanup()
    }
  );
}

async function processCampaignDispatch(job: CampaignDispatchJob): Promise<void> {
  const campaign = await loadRunningCampaign(job.campaignId);
  if (!campaign || !campaign.template_id) {
    return;
  }

  let batchIndex = 0;
  while (true) {
    const statusCheck = await pool.query<{ status: string }>(
      `SELECT status FROM campaigns WHERE id = $1 LIMIT 1`,
      [job.campaignId]
    );
    if (firstRow(statusCheck)?.status !== "running") {
      break;
    }

    const messages = await claimQueuedCampaignMessages(job.campaignId, 25);
    if (messages.length === 0) {
      break;
    }

    // Stagger each message by 1–5 s within the batch to avoid thundering herd
    await Promise.all(
      messages.map((message, idx) => {
        const staggerMs = (batchIndex * 25 + idx) * 1000 + Math.floor(Math.random() * 1000);
        const scheduledAt = staggerMs > 0
          ? new Date(Date.now() + staggerMs).toISOString()
          : null;
        return queueCampaignOutboundMessage({
          userId: job.userId,
          campaignMessageId: message.id,
          scheduledAt,
          groupingKey: `campaign:${message.phone_number.replace(/\D/g, "")}`
        });
      })
    );

    batchIndex++;
  }

  await markCampaignCompleted(job.campaignId);
}

async function retrySweep(): Promise<void> {
  try {
    await recoverStuckCampaignMessages();

    const scheduledCampaigns = await pool.query<{ id: string; user_id: string }>(
      `SELECT id, user_id
       FROM campaigns
       WHERE status = 'scheduled'
         AND scheduled_at IS NOT NULL
         AND scheduled_at <= NOW()
       ORDER BY scheduled_at ASC
       LIMIT 50`
    );
    for (const row of scheduledCampaigns.rows) {
      try {
        const launched = await launchCampaign(row.user_id, row.id);
        if (launched) {
          await enqueueCampaign(row.id, row.user_id);
        }
      } catch (error) {
        console.error(`[CampaignWorker] scheduled launch failed for campaign=${row.id}`, error);
      }
    }

    // Re-dispatch campaigns with messages deferred via webhook (e.g. 131049 smart retry).
    // These messages have next_retry_at set but no active outbound_messages row, so
    // the reconciliation timer cannot handle them — they need a new dispatch job.
    const retryable = await pool.query<{ campaign_id: string; user_id: string }>(
      `SELECT DISTINCT cm.campaign_id, c.user_id
       FROM campaign_messages cm
       JOIN campaigns c ON c.id = cm.campaign_id
       WHERE cm.status = 'queued'
         AND cm.retry_count > 0
         AND cm.next_retry_at IS NOT NULL
         AND cm.next_retry_at <= NOW()
         AND c.status = 'running'`
    );
    for (const row of retryable.rows) {
      try {
        await enqueueCampaign(row.campaign_id, row.user_id);
      } catch (error) {
        console.error(`[CampaignWorker] retry enqueue failed for campaign=${row.campaign_id}`, error);
      }
    }
  } catch (error) {
    console.error("[CampaignWorker] retry sweep failed", error);
  }
}

async function recoverStuckCampaignMessages(): Promise<void> {
  const timeoutSeconds = Math.max(30, Math.floor(env.QUEUE_STALLED_JOB_TIMEOUT_MS / 1000));
  const recovered = await pool.query<{ campaign_id: string; user_id: string }>(
    `WITH stuck AS (
       UPDATE campaign_messages cm
       SET status = 'queued',
           next_retry_at = NOW(),
           error_message = COALESCE(cm.error_message, 'Recovered stalled queue send for retry')
       FROM campaigns c
       WHERE cm.campaign_id = c.id
         AND c.status = 'running'
         AND cm.status = 'sending'
         AND cm.updated_at <= NOW() - ($1::text || ' seconds')::interval
       RETURNING cm.campaign_id, c.user_id
     )
     SELECT DISTINCT campaign_id, user_id
     FROM stuck`,
    [String(timeoutSeconds)]
  );

  for (const row of recovered.rows) {
    await enqueueCampaign(row.campaign_id, row.user_id);
  }
}

export function startCampaignWorker(): void {
  if (!env.REDIS_URL) {
    console.warn("[CampaignWorker] REDIS_URL is not configured; BullMQ campaign workers are disabled");
    return;
  }

  if (!dispatchWorker) {
    const connection = createQueueWorkerConnection();
    if (!connection) {
      throw new Error("Failed to create BullMQ connection for campaign dispatch worker.");
    }

    dispatchWorker = new Worker<CampaignDispatchJob>(
      "campaign-dispatch",
      async (job) => processCampaignDispatch(job.data),
      {
        connection,
        prefix: env.QUEUE_PREFIX?.trim() || undefined,
        concurrency: Math.max(1, env.CAMPAIGN_DISPATCH_CONCURRENCY)
      }
    );

    dispatchWorker.on("failed", (job, error) => {
      console.error(`[CampaignWorker] dispatch job failed id=${job?.id ?? "unknown"}`, error);
    });
  }

  if (!retrySweepTimer) {
    retrySweepTimer = setInterval(
      () => void retrySweep(),
      Math.max(5, env.DELIVERY_RETRY_SWEEP_INTERVAL_SECONDS) * 1000
    );
  }

  void retrySweep();
  console.info("[CampaignWorker] BullMQ workers started");
}

export async function stopCampaignWorker(): Promise<void> {
  if (retrySweepTimer) {
    clearInterval(retrySweepTimer);
    retrySweepTimer = null;
  }

  if (dispatchWorker) {
    const worker = dispatchWorker;
    dispatchWorker = null;
    await worker.close();
  }
}

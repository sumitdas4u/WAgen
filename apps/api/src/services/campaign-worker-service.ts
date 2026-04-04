import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import {
  claimQueuedCampaignMessages,
  launchCampaign,
  markCampaignCompleted,
  type Campaign
} from "./campaign-service.js";
import { deliverCampaignMessage } from "./message-delivery-service.js";

interface RunningCampaignJob {
  campaignId: string;
  userId: string;
}

const pendingJobs = new Map<string, RunningCampaignJob>();
const pendingQueue: string[] = [];
const runningJobs = new Set<string>();
let queueLoopRunning = false;
let retrySweepTimer: ReturnType<typeof setInterval> | null = null;

async function processCampaignJob(job: RunningCampaignJob): Promise<void> {
  runningJobs.add(job.campaignId);

  try {
    const campaignResult = await pool.query<Campaign>(
      `SELECT * FROM campaigns WHERE id = $1 AND status = 'running' LIMIT 1`,
      [job.campaignId]
    );
    const campaign = campaignResult.rows[0];
    if (!campaign || !campaign.template_id) {
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

      const messages = await claimQueuedCampaignMessages(job.campaignId, 100);
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

        await deliverCampaignMessage({
          userId: job.userId,
          campaign,
          message,
          senderName
        });
      }
    }

    await markCampaignCompleted(job.campaignId);
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
          enqueueCampaign(row.id, row.user_id);
        }
      } catch (error) {
        console.error(`[CampaignWorker] scheduled launch failed for campaign=${row.id}`, error);
      }
    }

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

export function startCampaignWorker(): void {
  if (retrySweepTimer) {
    return;
  }
  retrySweepTimer = setInterval(
    () => void retrySweep(),
    Math.max(5, env.DELIVERY_RETRY_SWEEP_INTERVAL_SECONDS) * 1000
  );
  console.info("[CampaignWorker] started");
}

export function stopCampaignWorker(): void {
  if (retrySweepTimer) {
    clearInterval(retrySweepTimer);
    retrySweepTimer = null;
  }
}

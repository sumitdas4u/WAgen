import "./observability/otel.js";
import { env } from "./config/env.js";
import { runMigrations } from "./scripts/migrate.js";
import { startCampaignWorker, stopCampaignWorker } from "./services/campaign-worker-service.js";
import { startDeliveryWebhookWorker, stopDeliveryWebhookWorker } from "./services/delivery-webhook-queue-service.js";
import { startOutboundWorker, stopOutboundWorker } from "./services/outbound-message-service.js";
import { closeQueueInfrastructure } from "./services/queue-service.js";
import { startSequenceWorker, stopSequenceWorker } from "./services/sequence-worker-service.js";
import { startDailyReportWorker, stopDailyReportWorker } from "./services/daily-report-worker-service.js";
import { pool } from "./db/pool.js";

await runMigrations({
  silent: env.NODE_ENV === "production"
});

startCampaignWorker();
startDeliveryWebhookWorker();
startOutboundWorker();
startSequenceWorker();
startDailyReportWorker();

const WORKERS = ["campaign", "delivery-webhook", "outbound", "sequence", "daily-report"];

async function pingWorkerHeartbeats() {
  await Promise.allSettled(
    WORKERS.map((name) =>
      pool.query(
        `INSERT INTO worker_heartbeats (worker_name, last_ping_at, queue_name)
         VALUES ($1, NOW(), $1)
         ON CONFLICT (worker_name) DO UPDATE SET last_ping_at = NOW()`,
        [name]
      )
    )
  );
}

// Ping immediately on startup, then every 30s
void pingWorkerHeartbeats();
const heartbeatInterval = setInterval(() => { void pingWorkerHeartbeats(); }, 30_000);

const shutdown = async () => {
  clearInterval(heartbeatInterval);
  await stopCampaignWorker();
  await stopDeliveryWebhookWorker();
  await stopOutboundWorker();
  await stopSequenceWorker();
  await stopDailyReportWorker();
  await closeQueueInfrastructure();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

await new Promise<void>(() => {
  // Keep the worker process alive while BullMQ and timer-based workers run.
});

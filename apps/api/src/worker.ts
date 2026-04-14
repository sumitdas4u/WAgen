import "./observability/otel.js";
import { env } from "./config/env.js";
import { runMigrations } from "./scripts/migrate.js";
import { startCampaignWorker, stopCampaignWorker } from "./services/campaign-worker-service.js";
import { startDeliveryWebhookWorker, stopDeliveryWebhookWorker } from "./services/delivery-webhook-queue-service.js";
import { startOutboundWorker, stopOutboundWorker } from "./services/outbound-message-service.js";
import { closeQueueInfrastructure } from "./services/queue-service.js";
import { startSequenceWorker, stopSequenceWorker } from "./services/sequence-worker-service.js";
import { startDailyReportWorker, stopDailyReportWorker } from "./services/daily-report-worker-service.js";

await runMigrations({
  silent: env.NODE_ENV === "production"
});

startCampaignWorker();
startDeliveryWebhookWorker();
startOutboundWorker();
startSequenceWorker();
startDailyReportWorker();

const shutdown = async () => {
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

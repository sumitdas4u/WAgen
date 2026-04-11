import "./observability/otel.js";
import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { runMigrations } from "./scripts/migrate.js";
import { renewDueWorkspaceCredits } from "./services/workspace-billing-service.js";
import { runAutoRechargeSweep } from "./services/workspace-billing-center-service.js";
import { startCampaignWorker } from "./services/campaign-worker-service.js";
import { closeQueueInfrastructure } from "./services/queue-service.js";
import { startGenericWebhookWorker } from "./services/generic-webhook-worker-service.js";
import { startSequenceWorker } from "./services/sequence-worker-service.js";

await runMigrations({
  silent: env.NODE_ENV === "production"
});

const app = await buildApp();

if (env.CREDIT_RENEWAL_CRON_ENABLED) {
  const intervalMs = Math.max(60, env.CREDIT_RENEWAL_CRON_INTERVAL_SECONDS) * 1000;
  const runRenewal = async () => {
    try {
      const result = await renewDueWorkspaceCredits({ limit: 1000 });
      if (result.processed > 0) {
        app.log.info({ renewal: result }, "Workspace credit renewal completed");
      }
    } catch (error) {
      app.log.error(error, "Workspace credit renewal failed");
    }
  };

  void runRenewal();
  setInterval(() => {
    void runRenewal();
  }, intervalMs);
}

if (env.AUTO_RECHARGE_CRON_ENABLED) {
  const intervalMs = Math.max(60, env.AUTO_RECHARGE_CRON_INTERVAL_SECONDS) * 1000;
  const runAutoRecharge = async () => {
    try {
      const result = await runAutoRechargeSweep({ limit: env.AUTO_RECHARGE_SWEEP_LIMIT });
      if (result.processed > 0) {
        app.log.info({ autoRecharge: result }, "Auto recharge sweep completed");
      }
    } catch (error) {
      app.log.error(error, "Auto recharge sweep failed");
    }
  };

  void runAutoRecharge();
  setInterval(() => {
    void runAutoRecharge();
  }, intervalMs);
}

startCampaignWorker();
startGenericWebhookWorker();
startSequenceWorker();

const close = async () => {
  await closeQueueInfrastructure();
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void close();
});

process.on("SIGTERM", () => {
  void close();
});

await app.listen({
  port: env.PORT,
  host: "0.0.0.0"
});

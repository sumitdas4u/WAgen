import { processDueGenericWebhookJobs } from "./generic-webhook-service.js";

let timer: ReturnType<typeof setInterval> | null = null;

export function startGenericWebhookWorker(): void {
  if (timer) return;

  const run = async () => {
    try {
      await processDueGenericWebhookJobs(25);
    } catch (error) {
      console.error("[GenericWebhookWorker] processing failed", error);
    }
  };

  void run();
  timer = setInterval(() => {
    void run();
  }, 60_000);
}

export function stopGenericWebhookWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

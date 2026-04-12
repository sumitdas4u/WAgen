import { Worker } from "bullmq";
import { env } from "../config/env.js";
import {
  extractMetaDeliveryStatusEvents,
  processMetaDeliveryStatusEvent,
  type MetaDeliveryStatusEvent
} from "./message-delivery-service.js";
import { createQueueWorkerConnection, getDeliveryWebhookQueue } from "./queue-service.js";

interface DeliveryWebhookJob {
  event: MetaDeliveryStatusEvent;
}

let worker: Worker<DeliveryWebhookJob> | null = null;

function deliveryWebhookJobId(event: MetaDeliveryStatusEvent): string {
  const timestamp = (event.eventTimestamp ?? "none").replace(/[:.]/g, "-");
  const errorCode = (event.errorCode ?? "none").replace(/:/g, "-");
  return `delivery-webhook-${event.wamid}-${event.status}-${timestamp}-${errorCode}`;
}

export async function enqueueMetaDeliveryStatusEvents(payload: unknown): Promise<void> {
  const queue = getDeliveryWebhookQueue();
  if (!queue) {
    await Promise.all(extractMetaDeliveryStatusEvents(payload).map((event) => processMetaDeliveryStatusEvent(event)));
    return;
  }

  const events = extractMetaDeliveryStatusEvents(payload);
  await Promise.all(
    events.map((event) =>
      queue.add(
        "process-status",
        { event },
        {
          jobId: deliveryWebhookJobId(event),
          attempts: 5,
          backoff: {
            type: "exponential",
            delay: 3000
          },
          removeOnComplete: 5000,
          removeOnFail: 10000
        }
      )
    )
  );
}

export function startDeliveryWebhookWorker(): void {
  if (!env.REDIS_URL) {
    console.warn("[DeliveryWebhookWorker] REDIS_URL is not configured; BullMQ webhook worker is disabled");
    return;
  }

  if (worker) {
    return;
  }

  const connection = createQueueWorkerConnection();
  if (!connection) {
    throw new Error("Failed to create BullMQ connection for delivery webhook worker.");
  }

  worker = new Worker<DeliveryWebhookJob>(
    "delivery-webhook-process",
    async (job) => processMetaDeliveryStatusEvent(job.data.event),
    {
      connection,
      prefix: env.QUEUE_PREFIX?.trim() || undefined,
      concurrency: Math.max(1, env.DELIVERY_WEBHOOK_CONCURRENCY)
    }
  );

  worker.on("failed", (job, error) => {
    console.error(`[DeliveryWebhookWorker] job failed id=${job?.id ?? "unknown"}`, error);
  });
}

export async function stopDeliveryWebhookWorker(): Promise<void> {
  if (!worker) {
    return;
  }

  const activeWorker = worker;
  worker = null;
  await activeWorker.close();
}

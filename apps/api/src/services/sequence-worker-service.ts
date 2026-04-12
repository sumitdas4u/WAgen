import { Worker } from "bullmq";
import { env } from "../config/env.js";
import { createQueueWorkerConnection } from "./queue-service.js";
import { processSequenceEnrollmentAndScheduleNext } from "./sequence-execution-service.js";
import { enqueueSequenceEnrollmentRun } from "./sequence-queue-service.js";
import { getSequenceEnrollment, listDueSequenceEnrollmentIds } from "./sequence-service.js";

interface SequenceEnrollmentRunJob {
  enrollmentId: string;
}

let timer: ReturnType<typeof setInterval> | null = null;
let worker: Worker<SequenceEnrollmentRunJob> | null = null;

async function reconcileDueSequenceEnrollments(limit = 50): Promise<void> {
  const ids = await listDueSequenceEnrollmentIds(limit);
  for (const enrollmentId of ids) {
    const enrollment = await getSequenceEnrollment(enrollmentId);
    if (!enrollment || enrollment.status !== "active") {
      continue;
    }

    await enqueueSequenceEnrollmentRun({
      enrollmentId,
      nextRunAt: enrollment.next_run_at
    });
  }
}

export function startSequenceWorker(): void {
  if (!env.REDIS_URL) {
    console.warn("[SequenceWorker] REDIS_URL is not configured; BullMQ sequence workers are disabled");
    return;
  }

  if (!worker) {
    const connection = createQueueWorkerConnection();
    if (!connection) {
      throw new Error("Failed to create BullMQ connection for sequence worker.");
    }

    worker = new Worker<SequenceEnrollmentRunJob>(
      "sequence-enrollment-run",
      async (job) => processSequenceEnrollmentAndScheduleNext(job.data.enrollmentId),
      {
        connection,
        prefix: env.QUEUE_PREFIX?.trim() || undefined,
        concurrency: Math.max(1, env.SEQUENCE_RUN_CONCURRENCY)
      }
    );

    worker.on("failed", (job, error) => {
      console.error(`[SequenceWorker] job failed id=${job?.id ?? "unknown"}`, error);
    });
  }

  if (!timer) {
    timer = setInterval(() => {
      void reconcileDueSequenceEnrollments();
    }, 60_000);
  }

  void reconcileDueSequenceEnrollments();
}

export async function stopSequenceWorker(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  if (worker) {
    const activeWorker = worker;
    worker = null;
    await activeWorker.close();
  }
}

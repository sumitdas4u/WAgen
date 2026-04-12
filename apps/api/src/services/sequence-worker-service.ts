import { Worker } from "bullmq";
import { env } from "../config/env.js";
import {
  createQueueWorkerConnection,
  getSequenceEnrollmentRetryQueue,
  getSequenceEnrollmentRunQueue
} from "./queue-service.js";
import { processSequenceEnrollmentAndScheduleNext } from "./sequence-execution-service.js";
import {
  enqueueSequenceEnrollment,
  getSequenceEnrollmentJobId,
  resolveSequenceEnrollmentQueueKind
} from "./sequence-queue-service.js";
import { listDueSequenceEnrollmentsForQueueAudit } from "./sequence-service.js";

interface SequenceEnrollmentRunJob {
  enrollmentId: string;
}

let timer: ReturnType<typeof setInterval> | null = null;
let runWorker: Worker<SequenceEnrollmentRunJob> | null = null;
let retryWorker: Worker<SequenceEnrollmentRunJob> | null = null;

async function isEnrollmentAlreadyScheduled(input: {
  enrollmentId: string;
  nextRunAt: string;
  retryCount: number;
  retryStartedAt: string | null;
  lastDeliveryStatus: string | null;
  lastEnqueuedQueue: string | null;
  lastEnqueuedJobId: string | null;
  lastEnqueuedForRunAt: string | null;
}): Promise<boolean> {
  const queueKind = resolveSequenceEnrollmentQueueKind({
    retry_count: input.retryCount,
    retry_started_at: input.retryStartedAt,
    last_delivery_status: input.lastDeliveryStatus
  });
  const queue = queueKind === "retry" ? getSequenceEnrollmentRetryQueue() : getSequenceEnrollmentRunQueue();
  if (!queue) {
    return false;
  }

  const expectedQueueName = queue.name;
  const expectedJobId = getSequenceEnrollmentJobId(input.enrollmentId, input.nextRunAt, queueKind);
  const bookkeepingMatches =
    input.lastEnqueuedQueue === expectedQueueName &&
    input.lastEnqueuedJobId === expectedJobId &&
    Date.parse(input.lastEnqueuedForRunAt ?? "") === Date.parse(input.nextRunAt);

  if (!bookkeepingMatches) {
    return false;
  }

  const job = await queue.getJob(expectedJobId);
  if (!job) {
    return false;
  }

  const state = await job.getState();
  return ["waiting", "delayed", "active", "prioritized", "waiting-children"].includes(state);
}

async function reconcileDueSequenceEnrollments(limit = 50): Promise<void> {
  const enrollments = await listDueSequenceEnrollmentsForQueueAudit(limit);
  for (const enrollment of enrollments) {
    if (enrollment.status !== "active") {
      continue;
    }

    const alreadyScheduled = await isEnrollmentAlreadyScheduled({
      enrollmentId: enrollment.id,
      nextRunAt: enrollment.next_run_at,
      retryCount: enrollment.retry_count,
      retryStartedAt: enrollment.retry_started_at,
      lastDeliveryStatus: enrollment.last_delivery_status,
      lastEnqueuedQueue: enrollment.last_enqueued_queue,
      lastEnqueuedJobId: enrollment.last_enqueued_job_id,
      lastEnqueuedForRunAt: enrollment.last_enqueued_for_run_at
    });
    if (alreadyScheduled) {
      continue;
    }

    await enqueueSequenceEnrollment({
      enrollmentId: enrollment.id,
      nextRunAt: enrollment.next_run_at,
      kind: resolveSequenceEnrollmentQueueKind(enrollment)
    });
  }
}

export function startSequenceWorker(): void {
  if (!env.REDIS_URL) {
    console.warn("[SequenceWorker] REDIS_URL is not configured; BullMQ sequence workers are disabled");
    return;
  }

  if (!runWorker) {
    const connection = createQueueWorkerConnection();
    if (!connection) {
      throw new Error("Failed to create BullMQ connection for sequence run worker.");
    }

    runWorker = new Worker<SequenceEnrollmentRunJob>(
      "sequence-enrollment-run",
      async (job) => processSequenceEnrollmentAndScheduleNext(job.data.enrollmentId),
      {
        connection,
        prefix: env.QUEUE_PREFIX?.trim() || undefined,
        concurrency: Math.max(1, env.SEQUENCE_RUN_CONCURRENCY)
      }
    );

    runWorker.on("failed", (job, error) => {
      console.error(`[SequenceWorker] run job failed id=${job?.id ?? "unknown"}`, error);
    });
  }

  if (!retryWorker) {
    const connection = createQueueWorkerConnection();
    if (!connection) {
      throw new Error("Failed to create BullMQ connection for sequence retry worker.");
    }

    retryWorker = new Worker<SequenceEnrollmentRunJob>(
      "sequence-enrollment-retry",
      async (job) => processSequenceEnrollmentAndScheduleNext(job.data.enrollmentId),
      {
        connection,
        prefix: env.QUEUE_PREFIX?.trim() || undefined,
        concurrency: Math.max(1, env.SEQUENCE_RUN_CONCURRENCY)
      }
    );

    retryWorker.on("failed", (job, error) => {
      console.error(`[SequenceWorker] retry job failed id=${job?.id ?? "unknown"}`, error);
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

  if (runWorker) {
    const activeWorker = runWorker;
    runWorker = null;
    await activeWorker.close();
  }

  if (retryWorker) {
    const activeWorker = retryWorker;
    retryWorker = null;
    await activeWorker.close();
  }
}

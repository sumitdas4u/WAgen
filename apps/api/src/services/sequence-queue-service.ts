import type { JobsOptions } from "bullmq";
import {
  getSequenceEnrollmentRetryQueue,
  getSequenceEnrollmentRunQueue,
  type ManagedQueueName
} from "./queue-service.js";
import {
  recordSequenceEnrollmentQueueState,
  type SequenceEnrollment
} from "./sequence-service.js";

export type SequenceEnrollmentQueueKind = "run" | "retry";

function sequenceEnrollmentJobId(
  enrollmentId: string,
  nextRunAt: string,
  kind: SequenceEnrollmentQueueKind
): string {
  const runAtMs = Number.isFinite(Date.parse(nextRunAt)) ? Date.parse(nextRunAt) : nextRunAt;
  return kind === "retry"
    ? `sequence-enrollment-retry-${enrollmentId}-${runAtMs}`
    : `sequence-enrollment-${enrollmentId}-${runAtMs}`;
}

export function getSequenceEnrollmentQueueName(
  kind: SequenceEnrollmentQueueKind
): Extract<ManagedQueueName, "sequence-enrollment-run" | "sequence-enrollment-retry"> {
  return kind === "retry" ? "sequence-enrollment-retry" : "sequence-enrollment-run";
}

export function resolveSequenceEnrollmentQueueKind(
  enrollment: Pick<SequenceEnrollment, "retry_count" | "retry_started_at" | "last_delivery_status">
): SequenceEnrollmentQueueKind {
  return enrollment.retry_count > 0 &&
    enrollment.retry_started_at &&
    enrollment.last_delivery_status === "failed"
    ? "retry"
    : "run";
}

export function getSequenceEnrollmentJobId(
  enrollmentId: string,
  nextRunAt: string,
  kind: SequenceEnrollmentQueueKind
): string {
  return sequenceEnrollmentJobId(enrollmentId, nextRunAt, kind);
}

export async function enqueueSequenceEnrollment(input: {
  enrollmentId: string;
  nextRunAt: string;
  kind?: SequenceEnrollmentQueueKind;
}): Promise<void> {
  const kind = input.kind ?? "run";
  const queueName = getSequenceEnrollmentQueueName(kind);
  const queue =
    kind === "retry" ? getSequenceEnrollmentRetryQueue() : getSequenceEnrollmentRunQueue();
  if (!queue) {
    throw new Error("Sequence enrollment queue is unavailable because REDIS_URL is not configured.");
  }

  const delayMs = Math.max(0, Date.parse(input.nextRunAt) - Date.now());
  const jobId = sequenceEnrollmentJobId(input.enrollmentId, input.nextRunAt, kind);
  const options: JobsOptions = {
    jobId,
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 3000
    },
    delay: Number.isFinite(delayMs) ? delayMs : 0,
    removeOnComplete: 1000,
    removeOnFail: 5000
  };

  await queue.add(
    "run-enrollment",
    {
      enrollmentId: input.enrollmentId
    },
    options
  );

  await recordSequenceEnrollmentQueueState({
    enrollmentId: input.enrollmentId,
    nextRunAt: input.nextRunAt,
    queueName,
    jobId
  });
}

export async function enqueueSequenceEnrollmentRun(input: {
  enrollmentId: string;
  nextRunAt: string;
}): Promise<void> {
  await enqueueSequenceEnrollment({ ...input, kind: "run" });
}

export async function enqueueSequenceEnrollmentRetry(input: {
  enrollmentId: string;
  nextRunAt: string;
}): Promise<void> {
  await enqueueSequenceEnrollment({ ...input, kind: "retry" });
}

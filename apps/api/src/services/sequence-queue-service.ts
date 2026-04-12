import type { JobsOptions } from "bullmq";
import { getSequenceEnrollmentRunQueue } from "./queue-service.js";

function sequenceEnrollmentJobId(enrollmentId: string, nextRunAt: string): string {
  const runAtMs = Number.isFinite(Date.parse(nextRunAt)) ? Date.parse(nextRunAt) : nextRunAt;
  return `sequence-enrollment:${enrollmentId}:${runAtMs}`;
}

export async function enqueueSequenceEnrollmentRun(input: {
  enrollmentId: string;
  nextRunAt: string;
}): Promise<void> {
  const queue = getSequenceEnrollmentRunQueue();
  if (!queue) {
    throw new Error("Sequence enrollment queue is unavailable because REDIS_URL is not configured.");
  }

  const delayMs = Math.max(0, Date.parse(input.nextRunAt) - Date.now());
  const options: JobsOptions = {
    jobId: sequenceEnrollmentJobId(input.enrollmentId, input.nextRunAt),
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
}

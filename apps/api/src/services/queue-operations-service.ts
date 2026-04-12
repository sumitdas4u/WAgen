import type { FastifyInstance } from "fastify";
import client from "prom-client";
import { z } from "zod";
import { env } from "../config/env.js";
import {
  getManagedQueue,
  getManagedQueues,
  getSequenceEnrollmentRetryQueue,
  getSequenceEnrollmentRunQueue,
  managedQueueNames,
  type ManagedQueueName
} from "./queue-service.js";
import {
  getSequenceEnrollmentJobId,
  resolveSequenceEnrollmentQueueKind
} from "./sequence-queue-service.js";
import { listDueSequenceEnrollmentsForQueueAudit } from "./sequence-service.js";

const QueueActionParamsSchema = z.object({
  queueName: z.enum(managedQueueNames)
});

const QueueJobParamsSchema = z.object({
  queueName: z.enum(managedQueueNames),
  jobId: z.string().min(1)
});

const QueueActionBodySchema = z.object({
  count: z.coerce.number().int().min(1).max(1000).optional()
});

type QueueJobStateCount = Record<string, number>;

interface QueueFailureSample {
  id: string;
  name: string;
  failedReason: string | null;
  attemptsMade: number;
  finishedOn: number | null;
  timestamp: number;
}

interface QueueSnapshot {
  name: ManagedQueueName;
  counts: QueueJobStateCount;
  workers: number;
  lagSeconds: number;
  delayedOverdueSeconds: number;
  throughputPerMinute: number;
  failedPerMinute: number;
  recentFailedJobs: QueueFailureSample[];
}

interface DueButUnscheduledSnapshot {
  count: number;
  sample: Array<{
    enrollmentId: string;
    sequenceId: string;
    nextRunAt: string;
    expectedQueue: "sequence-enrollment-run" | "sequence-enrollment-retry";
    expectedJobId: string;
    lastEnqueuedQueue: string | null;
    lastEnqueuedJobId: string | null;
    reason: "bookkeeping_mismatch" | "missing_job";
  }>;
}

export interface QueueMetricsSnapshot {
  generatedAt: string;
  queues: QueueSnapshot[];
  dueButUnscheduled: DueButUnscheduledSnapshot;
}

let queueMetricsRegistered = false;
let queueMetricsCache:
  | {
      expiresAt: number;
      snapshot: QueueMetricsSnapshot;
    }
  | null = null;

function normalizeDateMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getOldestJobAgeSeconds(nowMs: number, jobs: Array<{ timestamp?: number }>): number {
  const oldestTimestamp = jobs
    .map((job) => job.timestamp)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => left - right)[0];

  if (!oldestTimestamp) {
    return 0;
  }

  return Math.max(0, (nowMs - oldestTimestamp) / 1000);
}

function getDelayedOverdueSeconds(
  nowMs: number,
  jobs: Array<{ timestamp?: number; delay?: number }>
): number {
  const oldestDueAt = jobs
    .map((job) => {
      if (typeof job.timestamp !== "number" || !Number.isFinite(job.timestamp)) {
        return null;
      }
      const delay = typeof job.delay === "number" && Number.isFinite(job.delay) ? job.delay : 0;
      return job.timestamp + delay;
    })
    .filter((value): value is number => typeof value === "number")
    .sort((left, right) => left - right)[0];

  if (!oldestDueAt || oldestDueAt > nowMs) {
    return 0;
  }

  return Math.max(0, (nowMs - oldestDueAt) / 1000);
}

async function getQueueSnapshot(queueName: ManagedQueueName): Promise<QueueSnapshot> {
  const queue = getManagedQueue(queueName);
  if (!queue) {
    return {
      name: queueName,
      counts: {},
      workers: 0,
      lagSeconds: 0,
      delayedOverdueSeconds: 0,
      throughputPerMinute: 0,
      failedPerMinute: 0,
      recentFailedJobs: []
    };
  }

  const nowMs = Date.now();
  const [counts, workers, waitingJobs, delayedJobs, failedJobs, completedMetrics, failedMetrics] =
    await Promise.all([
      queue.getJobCounts(
        "active",
        "completed",
        "delayed",
        "failed",
        "paused",
        "prioritized",
        "waiting",
        "waiting-children"
      ),
      queue.getWorkersCount().catch(() => 0),
      queue.getWaiting(0, 9),
      queue.getDelayed(0, 9),
      queue.getFailed(0, 9),
      queue.getMetrics("completed", 0, 0).catch(() => ({ meta: { count: 0, prevTS: 0, prevCount: 0 }, data: [], count: 0 })),
      queue.getMetrics("failed", 0, 0).catch(() => ({ meta: { count: 0, prevTS: 0, prevCount: 0 }, data: [], count: 0 }))
    ]);

  const waitingLagSeconds = getOldestJobAgeSeconds(nowMs, waitingJobs);
  const delayedOverdueSeconds = getDelayedOverdueSeconds(nowMs, delayedJobs);

  return {
    name: queueName,
    counts,
    workers,
    lagSeconds: Math.max(waitingLagSeconds, delayedOverdueSeconds),
    delayedOverdueSeconds,
    throughputPerMinute: completedMetrics.data[0] ?? 0,
    failedPerMinute: failedMetrics.data[0] ?? 0,
    recentFailedJobs: failedJobs.map((job) => ({
      id: job.id ?? String(job.name),
      name: job.name,
      failedReason: job.failedReason ?? null,
      attemptsMade: job.attemptsMade,
      finishedOn: job.finishedOn ?? null,
      timestamp: job.timestamp
    }))
  };
}

async function getDueButUnscheduledSnapshot(limit = 200): Promise<DueButUnscheduledSnapshot> {
  const [runQueue, retryQueue, enrollments] = await Promise.all([
    Promise.resolve(getSequenceEnrollmentRunQueue()),
    Promise.resolve(getSequenceEnrollmentRetryQueue()),
    listDueSequenceEnrollmentsForQueueAudit(limit)
  ]);

  const sample: DueButUnscheduledSnapshot["sample"] = [];
  let count = 0;

  for (const enrollment of enrollments) {
    const queueKind = resolveSequenceEnrollmentQueueKind(enrollment);
    const queue = queueKind === "retry" ? retryQueue : runQueue;
    const expectedQueue: "sequence-enrollment-run" | "sequence-enrollment-retry" =
      queueKind === "retry" ? "sequence-enrollment-retry" : "sequence-enrollment-run";
    const expectedJobId = getSequenceEnrollmentJobId(enrollment.id, enrollment.next_run_at, queueKind);
    const bookkeepingMatches =
      enrollment.last_enqueued_queue === expectedQueue &&
      enrollment.last_enqueued_job_id === expectedJobId &&
      normalizeDateMs(enrollment.last_enqueued_for_run_at) === normalizeDateMs(enrollment.next_run_at);

    if (!bookkeepingMatches) {
      count += 1;
      if (sample.length < 25) {
        sample.push({
          enrollmentId: enrollment.id,
          sequenceId: enrollment.sequence_id,
          nextRunAt: enrollment.next_run_at,
          expectedQueue,
          expectedJobId,
          lastEnqueuedQueue: enrollment.last_enqueued_queue,
          lastEnqueuedJobId: enrollment.last_enqueued_job_id,
          reason: "bookkeeping_mismatch"
        });
      }
      continue;
    }

    const job = queue ? await queue.getJob(expectedJobId) : null;
    if (!job) {
      count += 1;
      if (sample.length < 25) {
        sample.push({
          enrollmentId: enrollment.id,
          sequenceId: enrollment.sequence_id,
          nextRunAt: enrollment.next_run_at,
          expectedQueue,
          expectedJobId,
          lastEnqueuedQueue: enrollment.last_enqueued_queue,
          lastEnqueuedJobId: enrollment.last_enqueued_job_id,
          reason: "missing_job"
        });
      }
      continue;
    }

    const state = await job.getState();
    if (!["waiting", "delayed", "active", "prioritized", "waiting-children"].includes(state)) {
      count += 1;
      if (sample.length < 25) {
        sample.push({
          enrollmentId: enrollment.id,
          sequenceId: enrollment.sequence_id,
          nextRunAt: enrollment.next_run_at,
          expectedQueue,
          expectedJobId,
          lastEnqueuedQueue: enrollment.last_enqueued_queue,
          lastEnqueuedJobId: enrollment.last_enqueued_job_id,
          reason: "missing_job"
        });
      }
    }
  }

  return { count, sample };
}

async function buildQueueMetricsSnapshot(): Promise<QueueMetricsSnapshot> {
  const queues = await Promise.all(managedQueueNames.map((queueName) => getQueueSnapshot(queueName)));
  const dueButUnscheduled = await getDueButUnscheduledSnapshot();

  return {
    generatedAt: new Date().toISOString(),
    queues,
    dueButUnscheduled
  };
}

export async function getQueueMetricsSnapshot(forceRefresh = false): Promise<QueueMetricsSnapshot> {
  const now = Date.now();
  if (!forceRefresh && queueMetricsCache && queueMetricsCache.expiresAt > now) {
    return queueMetricsCache.snapshot;
  }

  const snapshot = await buildQueueMetricsSnapshot();
  queueMetricsCache = {
    snapshot,
    expiresAt: now + 15_000
  };
  return snapshot;
}

function registerQueuePrometheusMetrics(app: FastifyInstance): void {
  if (!app.metrics.enabled) {
    return;
  }

  const registers = [app.metrics.register];

  const queueJobsGauge = new client.Gauge({
    name: "wagen_queue_jobs_total",
    help: "BullMQ jobs by queue and state",
    labelNames: ["queue", "state"] as const,
    registers,
    async collect() {
      const snapshot = await getQueueMetricsSnapshot();
      this.reset();
      for (const queue of snapshot.queues) {
        for (const [state, value] of Object.entries(queue.counts)) {
          this.labels(queue.name, state).set(value);
        }
      }
    }
  });

  const queueLagGauge = new client.Gauge({
    name: "wagen_queue_lag_seconds",
    help: "Estimated queue lag in seconds",
    labelNames: ["queue", "kind"] as const,
    registers,
    async collect() {
      const snapshot = await getQueueMetricsSnapshot();
      this.reset();
      for (const queue of snapshot.queues) {
        this.labels(queue.name, "overall").set(queue.lagSeconds);
        this.labels(queue.name, "delayed_overdue").set(queue.delayedOverdueSeconds);
      }
    }
  });

  const queueWorkersGauge = new client.Gauge({
    name: "wagen_queue_workers",
    help: "Connected workers per BullMQ queue",
    labelNames: ["queue"] as const,
    registers,
    async collect() {
      const snapshot = await getQueueMetricsSnapshot();
      this.reset();
      for (const queue of snapshot.queues) {
        this.labels(queue.name).set(queue.workers);
      }
    }
  });

  const queueThroughputGauge = new client.Gauge({
    name: "wagen_queue_jobs_per_minute",
    help: "Recent queue throughput per minute",
    labelNames: ["queue", "state"] as const,
    registers,
    async collect() {
      const snapshot = await getQueueMetricsSnapshot();
      this.reset();
      for (const queue of snapshot.queues) {
        this.labels(queue.name, "completed").set(queue.throughputPerMinute);
        this.labels(queue.name, "failed").set(queue.failedPerMinute);
      }
    }
  });

  const dueButUnscheduledGauge = new client.Gauge({
    name: "wagen_sequence_due_unscheduled_total",
    help: "Active sequence enrollments that are due but missing a scheduled BullMQ job",
    registers,
    async collect() {
      const snapshot = await getQueueMetricsSnapshot();
      this.set(snapshot.dueButUnscheduled.count);
    }
  });

  void queueJobsGauge;
  void queueLagGauge;
  void queueWorkersGauge;
  void queueThroughputGauge;
  void dueButUnscheduledGauge;
}

export async function registerQueueOperations(app: FastifyInstance): Promise<void> {
  if (queueMetricsRegistered || !env.REDIS_URL) {
    return;
  }

  registerQueuePrometheusMetrics(app);

  app.get(
    "/api/admin/queue-metrics",
    { preHandler: [app.requireSuperAdmin] },
    async () => {
      const snapshot = await getQueueMetricsSnapshot(true);
      return {
        enabled: true,
        snapshot
      };
    }
  );

  app.get(
    "/api/admin/queue-dead-letters",
    { preHandler: [app.requireSuperAdmin] },
    async () => {
      const snapshot = await getQueueMetricsSnapshot(true);
      return {
        generatedAt: snapshot.generatedAt,
        queues: snapshot.queues.map((queue) => ({
          name: queue.name,
          failedCount: queue.counts.failed ?? 0,
          failedPerMinute: queue.failedPerMinute,
          recentFailedJobs: queue.recentFailedJobs
        }))
      };
    }
  );

  app.post(
    "/api/admin/queues/:queueName/retry-failed",
    { preHandler: [app.requireSuperAdmin] },
    async (request, reply) => {
      const paramsParsed = QueueActionParamsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({ error: "Invalid queue params" });
      }

      const bodyParsed = QueueActionBodySchema.safeParse(request.body ?? {});
      if (!bodyParsed.success) {
        return reply.status(400).send({ error: "Invalid queue action payload" });
      }

      const queue = getManagedQueue(paramsParsed.data.queueName);
      if (!queue) {
        return reply.status(503).send({ error: "Queue is unavailable" });
      }

      await queue.retryJobs({
        state: "failed",
        count: bodyParsed.data.count ?? 100
      });
      queueMetricsCache = null;

      return {
        ok: true,
        queue: queue.name,
        action: "retry-failed"
      };
    }
  );

  app.post(
    "/api/admin/queues/:queueName/promote-delayed",
    { preHandler: [app.requireSuperAdmin] },
    async (request, reply) => {
      const paramsParsed = QueueActionParamsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({ error: "Invalid queue params" });
      }

      const bodyParsed = QueueActionBodySchema.safeParse(request.body ?? {});
      if (!bodyParsed.success) {
        return reply.status(400).send({ error: "Invalid queue action payload" });
      }

      const queue = getManagedQueue(paramsParsed.data.queueName);
      if (!queue) {
        return reply.status(503).send({ error: "Queue is unavailable" });
      }

      await queue.promoteJobs({
        count: bodyParsed.data.count ?? 100
      });
      queueMetricsCache = null;

      return {
        ok: true,
        queue: queue.name,
        action: "promote-delayed"
      };
    }
  );

  app.post(
    "/api/admin/queues/:queueName/jobs/:jobId/retry",
    { preHandler: [app.requireSuperAdmin] },
    async (request, reply) => {
      const paramsParsed = QueueJobParamsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({ error: "Invalid queue job params" });
      }

      const queue = getManagedQueue(paramsParsed.data.queueName);
      if (!queue) {
        return reply.status(503).send({ error: "Queue is unavailable" });
      }

      const job = await queue.getJob(paramsParsed.data.jobId);
      if (!job) {
        return reply.status(404).send({ error: "Queue job not found" });
      }

      await job.retry();
      queueMetricsCache = null;

      return {
        ok: true,
        queue: queue.name,
        jobId: paramsParsed.data.jobId,
        action: "retry-job"
      };
    }
  );

  queueMetricsRegistered = true;
  app.log.info(
    {
      queues: getManagedQueues().map((queue) => queue.name)
    },
    "Queue operations registered"
  );
}

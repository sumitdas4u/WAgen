import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";

export const managedQueueNames = [
  "campaign-dispatch",
  "campaign-message-send",
  "sequence-enrollment-run",
  "sequence-enrollment-retry",
  "delivery-webhook-process",
  "outbound-execution"
] as const;

export type ManagedQueueName = (typeof managedQueueNames)[number];

let redisConnection: Redis | null = null;
let managedQueues: Queue[] | null = null;
const extraRedisConnections = new Set<Redis>();

function buildRedisConnection(): Redis | null {
  if (!env.REDIS_URL) {
    return null;
  }

  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true
  });
}

function queueOptions() {
  return env.QUEUE_PREFIX?.trim()
    ? {
        prefix: env.QUEUE_PREFIX.trim()
      }
    : {};
}

export function getQueueRedisConnection(): Redis | null {
  redisConnection ??= buildRedisConnection();
  return redisConnection;
}

export function createQueueWorkerConnection(): Redis | null {
  const connection = buildRedisConnection();
  if (connection) {
    extraRedisConnections.add(connection);
  }
  return connection;
}

export function getManagedQueues(): Queue[] {
  if (managedQueues) {
    return managedQueues;
  }

  const connection = getQueueRedisConnection();
  if (!connection) {
    managedQueues = [];
    return managedQueues;
  }

  managedQueues = managedQueueNames.map(
    (name) =>
      new Queue(name, {
        connection,
        ...queueOptions()
      })
  );

  return managedQueues;
}

export function getManagedQueue(name: ManagedQueueName): Queue | null {
  return getManagedQueues().find((queue) => queue.name === name) ?? null;
}

export function getCampaignDispatchQueue(): Queue | null {
  return getManagedQueue("campaign-dispatch");
}

export function getCampaignMessageQueue(): Queue | null {
  return getManagedQueue("campaign-message-send");
}

export function getSequenceEnrollmentRunQueue(): Queue | null {
  return getManagedQueue("sequence-enrollment-run");
}

export function getSequenceEnrollmentRetryQueue(): Queue | null {
  return getManagedQueue("sequence-enrollment-retry");
}

export function getDeliveryWebhookQueue(): Queue | null {
  return getManagedQueue("delivery-webhook-process");
}

export function getOutboundExecutionQueue(): Queue | null {
  return getManagedQueue("outbound-execution");
}

export async function closeQueueInfrastructure(): Promise<void> {
  if (managedQueues) {
    await Promise.all(managedQueues.map((queue) => queue.close()));
    managedQueues = null;
  }

  if (redisConnection) {
    const connection = redisConnection;
    redisConnection = null;
    await connection.quit();
  }

  if (extraRedisConnections.size > 0) {
    const connections = Array.from(extraRedisConnections);
    extraRedisConnections.clear();
    await Promise.all(connections.map((connection) => connection.quit()));
  }
}

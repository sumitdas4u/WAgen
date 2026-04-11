import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";

export const managedQueueNames = [
  "campaign-dispatch",
  "campaign-message-send",
  "sequence-enrollment-run",
  "sequence-enrollment-retry",
  "delivery-webhook-process"
] as const;

let redisConnection: Redis | null = null;
let managedQueues: Queue[] | null = null;

function buildRedisConnection(): Redis | null {
  if (!env.REDIS_URL) {
    return null;
  }

  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true
  });
}

export function getQueueRedisConnection(): Redis | null {
  redisConnection ??= buildRedisConnection();
  return redisConnection;
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
        connection
      })
  );

  return managedQueues;
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
}

import * as amqplib from "amqplib";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { decryptJsonPayload } from "../utils/encryption.js";
import type { WagenEvent } from "./event-fanout-service.js";

interface ChannelEntry {
  connection: amqplib.ChannelModel;
  channel: amqplib.Channel;
  exchange: string;
}

interface RabbitMqConfigRow {
  uri: string;
  exchange: string;
  enabled: boolean;
}

const channelPool = new Map<string, ChannelEntry>();

function getEncryptionKey(): string {
  return env.WA_SESSION_ENCRYPTION_KEY || env.JWT_SECRET;
}

async function getConfig(userId: string): Promise<RabbitMqConfigRow | null> {
  const result = await pool.query<RabbitMqConfigRow>(
    `SELECT uri, exchange, enabled
     FROM rabbitmq_configs
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] ?? null;
}

async function getOrCreateChannel(userId: string): Promise<ChannelEntry | null> {
  const existing = channelPool.get(userId);
  if (existing) {
    return existing;
  }

  const config = await getConfig(userId);
  if (!config?.enabled) {
    return null;
  }

  let uri: string;
  try {
    uri = decryptJsonPayload<string>(config.uri, getEncryptionKey());
  } catch {
    uri = config.uri;
  }

  const connection = await amqplib.connect(uri);
  const channel = await connection.createChannel();
  await channel.assertExchange(config.exchange, "topic", { durable: true });

  const entry: ChannelEntry = { connection, channel, exchange: config.exchange };
  channelPool.set(userId, entry);

  connection.on("close", () => {
    channelPool.delete(userId);
  });
  connection.on("error", () => {
    channelPool.delete(userId);
  });

  return entry;
}

export async function publishRabbitMQEvent(userId: string, event: WagenEvent, payload: unknown): Promise<void> {
  const entry = await getOrCreateChannel(userId);
  if (!entry) {
    return;
  }

  const content = Buffer.from(
    JSON.stringify({ userId, event, payload, timestamp: new Date().toISOString() })
  );

  entry.channel.publish(entry.exchange, event, content, {
    persistent: true,
    contentType: "application/json"
  });
}

export function disconnectRabbitMQ(userId: string): void {
  const entry = channelPool.get(userId);
  if (!entry) {
    return;
  }

  try {
    void entry.connection.close();
  } catch {
    // No-op.
  }
  channelPool.delete(userId);
}

import { realtimeHub } from "./realtime-hub.js";
import { deliverWebhookEvent } from "./webhook-delivery-service.js";
import { publishRabbitMQEvent } from "./rabbitmq-service.js";

export type WagenEvent =
  | "messages.upsert"
  | "messages.update"
  | "messages.delete"
  | "connection.update"
  | "qrcode.updated"
  | "pairing_code.updated"
  | "status.instance"
  | "chats.upsert"
  | "chats.update"
  | "contacts.upsert"
  | "presence.update"
  | "call";

const websocketAliases: Partial<Record<WagenEvent, string[]>> = {
  "qrcode.updated": ["whatsapp.qr"],
  "pairing_code.updated": ["whatsapp.pairing_code"],
  "status.instance": ["whatsapp.status"],
  "connection.update": ["whatsapp.status"]
};

export async function fanoutEvent(userId: string, event: WagenEvent, payload: unknown): Promise<void> {
  await Promise.allSettled([
    fanoutWebSocket(userId, event, payload),
    fanoutHttpWebhooks(userId, event, payload),
    fanoutRabbitMQ(userId, event, payload)
  ]);
}

function fanoutWebSocket(userId: string, event: WagenEvent, payload: unknown): Promise<void> {
  try {
    realtimeHub.broadcast(userId, event, payload);
    for (const alias of websocketAliases[event] ?? []) {
      realtimeHub.broadcast(userId, alias, payload);
    }
  } catch (err) {
    console.error(`[fanout] ws error user=${userId} event=${event}`, err);
  }
  return Promise.resolve();
}

async function fanoutHttpWebhooks(userId: string, event: WagenEvent, payload: unknown): Promise<void> {
  try {
    await deliverWebhookEvent(userId, event, payload);
  } catch (err) {
    console.error(`[fanout] http error user=${userId} event=${event}`, err);
  }
}

async function fanoutRabbitMQ(userId: string, event: WagenEvent, payload: unknown): Promise<void> {
  try {
    await publishRabbitMQEvent(userId, event, payload);
  } catch (err) {
    console.error(`[fanout] rmq error user=${userId} event=${event}`, err);
  }
}

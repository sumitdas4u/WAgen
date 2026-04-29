import { pool } from "../db/pool.js";
import type { AgentNotificationPayload } from "../types/ws-events.js";
import { realtimeHub } from "./realtime-hub.js";

export type AgentNotificationType = AgentNotificationPayload["type"];

interface CreateAgentNotificationInput {
  userId: string;
  type: AgentNotificationType;
  conversationId?: string | null;
  actorName?: string | null;
  body: string;
  broadcast?: boolean;
}

function trimNotificationBody(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

export async function createAgentNotification(
  input: CreateAgentNotificationInput
): Promise<AgentNotificationPayload | null> {
  const body = trimNotificationBody(input.body);
  if (!body) {
    return null;
  }

  try {
    const result = await pool.query<{ id: string; created_at: Date }>(
      `INSERT INTO agent_notifications (user_id, type, conversation_id, actor_name, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [input.userId, input.type, input.conversationId ?? null, input.actorName ?? null, body]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const notification: AgentNotificationPayload = {
      id: row.id,
      type: input.type,
      body,
      created_at: row.created_at.toISOString(),
      ...(input.conversationId ? { conversation_id: input.conversationId } : {}),
      ...(input.actorName ? { actor_name: input.actorName } : {})
    };

    if (input.broadcast !== false) {
      realtimeHub.broadcast(input.userId, "agent.notification", notification);
    }

    return notification;
  } catch (error) {
    console.warn(`[Notifications] failed to create ${input.type} notification for user=${input.userId}`, error);
    return null;
  }
}

export function createBotAlertNotification(userId: string, conversationId: string, body: string) {
  return createAgentNotification({
    userId,
    type: "bot_alert",
    conversationId,
    actorName: "Automation",
    body
  });
}

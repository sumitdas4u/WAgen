import { getQueueRedisConnection } from "./queue-service.js";

export const ADMIN_ACTIVITY_CHANNEL = "admin:activity";

export interface AdminActivityEvent {
  type: string;
  workspaceId?: string;
  workspaceName?: string;
  detail?: Record<string, unknown>;
  timestamp: string;
}

export function publishAdminActivity(
  event: Omit<AdminActivityEvent, "timestamp">
): void {
  const connection = getQueueRedisConnection();
  if (!connection) return;
  try {
    const payload = JSON.stringify({ ...event, timestamp: new Date().toISOString() });
    void connection.publish(ADMIN_ACTIVITY_CHANNEL, payload);
  } catch {
    // Fire-and-forget — never throw from an activity publish
  }
}

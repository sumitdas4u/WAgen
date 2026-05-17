import { pool } from "../db/pool.js";
import type { AgentNotificationPayload } from "../types/ws-events.js";

export type MobilePushPlatform = "android" | "ios" | "unknown";

export interface MobilePushTokenRecord {
  id: string;
  user_id: string;
  expo_push_token: string;
  platform: MobilePushPlatform;
  device_name: string | null;
  app_version: string | null;
  enabled: boolean;
  last_seen_at: Date;
  revoked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface ExpoPushTicket {
  status?: "ok" | "error";
  id?: string;
  message?: string;
  details?: {
    error?: string;
  };
}

const EXPO_PUSH_SEND_URL = "https://exp.host/--/api/v2/push/send";
const MAX_EXPO_BATCH_SIZE = 100;

export function isExpoPushToken(value: string): boolean {
  return /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]+\]$/.test(value.trim());
}

function normalizePlatform(value: string | null | undefined): MobilePushPlatform {
  if (value === "android" || value === "ios") {
    return value;
  }
  return "unknown";
}

function trimNullable(value: string | null | undefined, maxLength: number): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, maxLength);
}

export async function registerMobilePushToken(input: {
  userId: string;
  expoPushToken: string;
  platform?: string | null;
  deviceName?: string | null;
  appVersion?: string | null;
}): Promise<MobilePushTokenRecord> {
  const token = input.expoPushToken.trim();
  if (!isExpoPushToken(token)) {
    throw new Error("Invalid Expo push token.");
  }

  const result = await pool.query<MobilePushTokenRecord>(
    `INSERT INTO mobile_push_tokens (
       user_id,
       expo_push_token,
       platform,
       device_name,
       app_version,
       enabled,
       revoked_at,
       last_seen_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, TRUE, NULL, NOW(), NOW())
     ON CONFLICT (expo_push_token)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       platform = EXCLUDED.platform,
       device_name = EXCLUDED.device_name,
       app_version = EXCLUDED.app_version,
       enabled = TRUE,
       revoked_at = NULL,
       last_seen_at = NOW(),
       updated_at = NOW()
     RETURNING *`,
    [
      input.userId,
      token,
      normalizePlatform(input.platform),
      trimNullable(input.deviceName, 160),
      trimNullable(input.appVersion, 80)
    ]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to register mobile push token.");
  }
  return row;
}

export async function revokeMobilePushToken(input: {
  userId: string;
  expoPushToken: string;
}): Promise<boolean> {
  const token = input.expoPushToken.trim();
  if (!token) {
    return false;
  }

  const result = await pool.query(
    `UPDATE mobile_push_tokens
     SET enabled = FALSE,
         revoked_at = COALESCE(revoked_at, NOW()),
         updated_at = NOW()
     WHERE user_id = $1
       AND expo_push_token = $2`,
    [input.userId, token]
  );
  return (result.rowCount ?? 0) > 0;
}

async function disableDeviceToken(expoPushToken: string): Promise<void> {
  await pool.query(
    `UPDATE mobile_push_tokens
     SET enabled = FALSE,
         revoked_at = COALESCE(revoked_at, NOW()),
         updated_at = NOW()
     WHERE expo_push_token = $1`,
    [expoPushToken]
  );
}

export function buildExpoPushMessage(input: {
  expoPushToken: string;
  notification: AgentNotificationPayload;
}): Record<string, unknown> {
  const conversationId = input.notification.conversation_id ?? null;
  return {
    to: input.expoPushToken,
    sound: "default",
    priority: "high",
    title: input.notification.actor_name || titleForNotification(input.notification.type),
    body: input.notification.body,
    data: {
      type: input.notification.type,
      notificationId: input.notification.id,
      conversationId
    }
  };
}

function titleForNotification(type: AgentNotificationPayload["type"]): string {
  switch (type) {
    case "message":
      return "New message";
    case "mention":
      return "New mention";
    case "assigned":
      return "Assignment update";
    case "unassigned":
      return "Assignment removed";
    case "bot_alert":
      return "Automation alert";
    case "system":
      return "WAgen update";
  }
}

async function sendExpoPushBatch(messages: Array<Record<string, unknown>>): Promise<ExpoPushTicket[]> {
  const response = await fetch(EXPO_PUSH_SEND_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(messages)
  });

  const payload = (await response.json().catch(() => null)) as { data?: ExpoPushTicket[] | ExpoPushTicket } | null;
  if (!response.ok) {
    throw new Error(`Expo push request failed: ${response.status}`);
  }
  const data = payload?.data;
  if (!data) {
    return [];
  }
  return Array.isArray(data) ? data : [data];
}

export async function sendAgentNotificationPush(input: {
  userId: string;
  notification: AgentNotificationPayload;
}): Promise<void> {
  const result = await pool.query<{ expo_push_token: string }>(
    `SELECT expo_push_token
     FROM mobile_push_tokens
     WHERE user_id = $1
       AND enabled = TRUE
       AND revoked_at IS NULL
     ORDER BY last_seen_at DESC`,
    [input.userId]
  );
  if (result.rows.length === 0) {
    return;
  }

  const messages = result.rows.map((row) =>
    buildExpoPushMessage({
      expoPushToken: row.expo_push_token,
      notification: input.notification
    })
  );

  for (let index = 0; index < messages.length; index += MAX_EXPO_BATCH_SIZE) {
    const batch = messages.slice(index, index + MAX_EXPO_BATCH_SIZE);
    try {
      const tickets = await sendExpoPushBatch(batch);
      await Promise.all(
        tickets.map((ticket, ticketIndex) => {
          const token = String(batch[ticketIndex]?.to ?? "");
          if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered" && token) {
            return disableDeviceToken(token);
          }
          return Promise.resolve();
        })
      );
    } catch (error) {
      console.warn(`[MobilePush] failed to send notification user=${input.userId}`, error);
    }
  }
}

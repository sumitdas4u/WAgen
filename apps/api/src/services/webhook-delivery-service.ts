import { createHmac } from "node:crypto";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { decryptJsonPayload } from "../utils/encryption.js";
import type { WagenEvent } from "./event-fanout-service.js";

interface WebhookEndpointRow {
  id: string;
  url: string;
  secret: string | null;
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 4_000, 16_000];

function getEncryptionKey(): string {
  return env.WA_SESSION_ENCRYPTION_KEY || env.JWT_SECRET;
}

export function createHmacSignature(secret: string, body: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(body);
  return `sha256=${hmac.digest("hex")}`;
}

export async function deliverWebhookEvent(userId: string, event: WagenEvent, payload: unknown): Promise<void> {
  const endpoints = await pool.query<WebhookEndpointRow>(
    `SELECT id, url, secret
     FROM webhook_endpoints
     WHERE user_id = $1
       AND enabled = TRUE
       AND $2 = ANY(events)
     ORDER BY created_at DESC`,
    [userId, event]
  );

  await Promise.allSettled(
    endpoints.rows.map((endpoint) => deliverToEndpoint(endpoint, event, payload))
  );
}

async function deliverToEndpoint(endpoint: WebhookEndpointRow, event: WagenEvent, payload: unknown): Promise<void> {
  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });

  let secret: string | null = null;
  if (endpoint.secret) {
    try {
      secret = decryptJsonPayload<string>(endpoint.secret, getEncryptionKey());
    } catch {
      secret = endpoint.secret;
    }
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt - 1]));
    }

    let statusCode: number | null = null;
    let success = false;
    let errorMessage: string | null = null;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Wagen-Event": event
      };

      if (secret) {
        headers["X-Wagen-Signature"] = createHmacSignature(secret, body);
      }

      const response = await fetch(endpoint.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10_000)
      });

      statusCode = response.status;
      success = response.ok;
    } catch (err) {
      errorMessage = String(err);
    }

    await pool.query(
      `INSERT INTO webhook_delivery_logs (
         endpoint_id,
         event,
         payload,
         status_code,
         attempt,
         success,
         error_message
       )
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)`,
      [endpoint.id, event, JSON.stringify(payload ?? {}), statusCode, attempt + 1, success, errorMessage]
    );

    if (success) {
      return;
    }
  }
}

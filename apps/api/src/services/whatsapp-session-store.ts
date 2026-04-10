import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { decryptJsonPayload, encryptJsonPayload } from "../utils/encryption.js";

const SESSION_AUTH_ENCRYPTED_FIELD = "__enc_v1";

export interface WhatsAppSessionRecord {
  id: string;
  user_id: string;
  session_auth_json: Record<string, unknown>;
  enabled: boolean;
  status: string;
  phone_number: string | null;
}

function getSessionEncryptionSecret(): string {
  return env.WA_SESSION_ENCRYPTION_KEY || env.JWT_SECRET;
}

function decodeSessionAuthState(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const payload = value as Record<string, unknown>;
  const encrypted = payload[SESSION_AUTH_ENCRYPTED_FIELD];
  if (typeof encrypted !== "string" || !encrypted) {
    return payload;
  }

  try {
    return decryptJsonPayload<Record<string, unknown>>(encrypted, getSessionEncryptionSecret());
  } catch {
    return {};
  }
}

function encodeSessionAuthState(value: Record<string, unknown>): Record<string, string> {
  return {
    [SESSION_AUTH_ENCRYPTED_FIELD]: encryptJsonPayload(value, getSessionEncryptionSecret())
  };
}

function mapSessionRecord(row: WhatsAppSessionRecord): WhatsAppSessionRecord {
  return {
    ...row,
    session_auth_json: decodeSessionAuthState(row.session_auth_json)
  };
}

export async function getOrCreateWhatsAppSession(userId: string): Promise<WhatsAppSessionRecord> {
  const existing = await pool.query<WhatsAppSessionRecord>(
    `SELECT id, user_id, session_auth_json, enabled, status, phone_number
     FROM whatsapp_sessions
     WHERE user_id = $1`,
    [userId]
  );

  if ((existing.rowCount ?? 0) > 0) {
    return mapSessionRecord(existing.rows[0]);
  }

  const created = await pool.query<WhatsAppSessionRecord>(
    `INSERT INTO whatsapp_sessions (user_id)
     VALUES ($1)
     RETURNING id, user_id, session_auth_json, enabled, status, phone_number`,
    [userId]
  );

  return mapSessionRecord(created.rows[0]);
}

export async function saveWhatsAppAuthState(userId: string, authState: Record<string, unknown>): Promise<void> {
  const encrypted = encodeSessionAuthState(authState);
  await pool.query(
    `UPDATE whatsapp_sessions
     SET session_auth_json = $1::jsonb
     WHERE user_id = $2`,
    [JSON.stringify(encrypted), userId]
  );
}

export async function resetWhatsAppAuthState(userId: string): Promise<void> {
  await pool.query(
    `UPDATE whatsapp_sessions
     SET session_auth_json = '{}'::jsonb,
         status = 'disconnected',
         phone_number = NULL
     WHERE user_id = $1`,
    [userId]
  );
}

export async function updateWhatsAppStatus(
  userId: string,
  status: "connected" | "connecting" | "disconnected",
  phoneNumber?: string
): Promise<void> {
  await pool.query(
    `UPDATE whatsapp_sessions
     SET status = $1,
         phone_number = COALESCE($2, phone_number),
         last_connected_at = CASE WHEN $1 = 'connected' THEN NOW() ELSE last_connected_at END
     WHERE user_id = $3`,
    [status, phoneNumber ?? null, userId]
  );
}

export async function setWhatsAppChannelEnabled(userId: string, enabled: boolean): Promise<void> {
  await pool.query(
    `UPDATE whatsapp_sessions
     SET enabled = $1
     WHERE user_id = $2`,
    [enabled, userId]
  );
}

export async function disconnectSessionsByPhoneNumber(
  activeUserId: string,
  phoneNumber: string
): Promise<string[]> {
  const result = await pool.query<{ user_id: string }>(
    `UPDATE whatsapp_sessions
     SET status = 'disconnected',
         phone_number = NULL,
         session_auth_json = '{}'::jsonb
     WHERE user_id <> $1
       AND phone_number = $2
     RETURNING user_id`,
    [activeUserId, phoneNumber]
  );

  return result.rows.map((row) => row.user_id);
}

export async function getWhatsAppStatus(userId: string): Promise<{
  enabled: boolean;
  status: string;
  phoneNumber: string | null;
}> {
  const result = await pool.query<{
    enabled: boolean;
    status: string;
    phone_number: string | null;
  }>(
    `SELECT enabled, status, phone_number
     FROM whatsapp_sessions
     WHERE user_id = $1`,
    [userId]
  );

  return {
    enabled: result.rows[0]?.enabled ?? true,
    status: result.rows[0]?.status ?? "disconnected",
    phoneNumber: result.rows[0]?.phone_number ?? null
  };
}

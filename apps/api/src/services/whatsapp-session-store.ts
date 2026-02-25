import { pool } from "../db/pool.js";

export interface WhatsAppSessionRecord {
  id: string;
  user_id: string;
  session_auth_json: Record<string, unknown>;
  status: string;
  phone_number: string | null;
}

export async function getOrCreateWhatsAppSession(userId: string): Promise<WhatsAppSessionRecord> {
  const existing = await pool.query<WhatsAppSessionRecord>(
    `SELECT id, user_id, session_auth_json, status, phone_number
     FROM whatsapp_sessions
     WHERE user_id = $1`,
    [userId]
  );

  if ((existing.rowCount ?? 0) > 0) {
    return existing.rows[0];
  }

  const created = await pool.query<WhatsAppSessionRecord>(
    `INSERT INTO whatsapp_sessions (user_id)
     VALUES ($1)
     RETURNING id, user_id, session_auth_json, status, phone_number`,
    [userId]
  );

  return created.rows[0];
}

export async function saveWhatsAppAuthState(userId: string, authState: Record<string, unknown>): Promise<void> {
  await pool.query(
    `UPDATE whatsapp_sessions
     SET session_auth_json = $1::jsonb
     WHERE user_id = $2`,
    [JSON.stringify(authState), userId]
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
  status: string;
  phoneNumber: string | null;
}> {
  const result = await pool.query<{
    status: string;
    phone_number: string | null;
  }>(
    `SELECT status, phone_number
     FROM whatsapp_sessions
     WHERE user_id = $1`,
    [userId]
  );

  return {
    status: result.rows[0]?.status ?? "disconnected",
    phoneNumber: result.rows[0]?.phone_number ?? null
  };
}

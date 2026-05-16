import { pool } from "../db/pool.js";
import { sendConversationFlowMessage } from "./channel-outbound-service.js";

export interface CaptureSession {
  id: string;
  user_id: string;
  contact_id: string;
  conversation_id: string;
  config_key: string;
  state: "ASK_PERMISSION" | "ASK_DATE" | "COMPLETE" | "CANCELLED" | "EXPIRED" | "FAILED";
  status: "active" | "complete" | "cancelled" | "expired" | "failed";
  field_name: string | null;
  captured_date: string | null;
  retry_count: number;
  context: Record<string, unknown>;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export async function getActiveCaptureSession(conversationId: string): Promise<CaptureSession | null> {
  const result = await pool.query<CaptureSession>(
    `SELECT * FROM reminder_capture_sessions
     WHERE conversation_id = $1 AND status = 'active'
     LIMIT 1`,
    [conversationId]
  );
  return result.rows[0] ?? null;
}

function isYesPayload(message: string, configKey: string): boolean {
  const lower = message.trim().toLowerCase();
  return lower.includes(`start_flow_${configKey}`);
}

function isDeclineMessage(message: string): boolean {
  const lower = message.trim().toLowerCase();
  return lower.includes("not_now") || lower.includes("not now") || lower === "no" || lower === "cancel" || lower === "stop";
}

function parseDate(text: string): string | null {
  const trimmed = text.trim();
  // Accept YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return trimmed;
  }
  // Accept DD/MM/YYYY or DD-MM-YYYY
  const dmy = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const iso = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return iso;
  }
  return null;
}

async function saveDateToContactField(
  userId: string,
  contactId: string,
  fieldName: string,
  dateValue: string
): Promise<void> {
  const fieldResult = await pool.query<{ id: string }>(
    `SELECT id FROM contact_fields WHERE user_id = $1 AND name = $2 LIMIT 1`,
    [userId, fieldName]
  );
  const fieldId = fieldResult.rows[0]?.id;
  if (!fieldId) return;

  await pool.query(
    `INSERT INTO contact_field_values (contact_id, field_id, value)
     VALUES ($1, $2, $3)
     ON CONFLICT (contact_id, field_id) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [contactId, fieldId, dateValue]
  );
}

async function getConfigFieldInfo(
  userId: string,
  configKey: string
): Promise<{ fieldName: string; fieldLabel: string; templateName: string | null }> {
  const result = await pool.query<{ date_field_name: string | null; capture_template_name: string | null }>(
    `SELECT date_field_name, capture_template_name FROM reminder_configs
     WHERE user_id = $1 AND config_key = $2 LIMIT 1`,
    [userId, configKey]
  );
  const row = result.rows[0];
  const fieldName = row?.date_field_name ?? configKey;

  const labelResult = await pool.query<{ label: string }>(
    `SELECT label FROM contact_fields WHERE user_id = $1 AND name = $2 LIMIT 1`,
    [userId, fieldName]
  );
  const fieldLabel = labelResult.rows[0]?.label ?? fieldName;

  return { fieldName, fieldLabel, templateName: row?.capture_template_name ?? null };
}

export async function handleCaptureSessionReply(session: CaptureSession, message: string): Promise<void> {
  // --- ASK_PERMISSION state ---
  if (session.state === "ASK_PERMISSION") {
    if (isYesPayload(message, session.config_key)) {
      const { fieldName, fieldLabel, templateName } = await getConfigFieldInfo(session.user_id, session.config_key);

      await pool.query(
        `UPDATE reminder_capture_sessions
         SET state = 'ASK_DATE', field_name = $2, updated_at = now()
         WHERE id = $1`,
        [session.id, fieldName]
      );

      await sendConversationFlowMessage({
        userId: session.user_id,
        conversationId: session.conversation_id,
        payload: {
          type: "text",
          text: `Great! Please reply with your ${fieldLabel} date in YYYY-MM-DD format (e.g. 1990-06-15). Reply *cancel* to skip.`
        }
      });
      return;
    }

    if (isDeclineMessage(message)) {
      await pool.query(
        `UPDATE reminder_capture_sessions
         SET state = 'CANCELLED', status = 'cancelled', updated_at = now()
         WHERE id = $1`,
        [session.id]
      );
      await pool.query(
        `INSERT INTO reminder_dispatch_log
           (user_id, contact_id, config_key, log_type, template_name, status)
         VALUES ($1, $2, $3, 'capture_declined', null, 'failed')`,
        [session.user_id, session.contact_id, session.config_key]
      );
    }
    return;
  }

  // --- ASK_DATE state ---
  if (session.state === "ASK_DATE") {
    if (isDeclineMessage(message)) {
      await pool.query(
        `UPDATE reminder_capture_sessions
         SET state = 'CANCELLED', status = 'cancelled', updated_at = now()
         WHERE id = $1`,
        [session.id]
      );
      await pool.query(
        `INSERT INTO reminder_dispatch_log
           (user_id, contact_id, config_key, log_type, template_name, status)
         VALUES ($1, $2, $3, 'capture_declined', null, 'failed')`,
        [session.user_id, session.contact_id, session.config_key]
      );
      return;
    }

    const parsedDate = parseDate(message);
    if (!parsedDate) {
      await sendConversationFlowMessage({
        userId: session.user_id,
        conversationId: session.conversation_id,
        payload: {
          type: "text",
          text: `Please reply with a valid date in YYYY-MM-DD format (e.g. 1990-06-15). Reply *cancel* to skip.`
        }
      });
      return;
    }

    const fieldName = session.field_name ?? session.config_key;
    await saveDateToContactField(session.user_id, session.contact_id, fieldName, parsedDate);

    const { templateName } = await getConfigFieldInfo(session.user_id, session.config_key);

    await pool.query(
      `UPDATE reminder_capture_sessions
       SET state = 'COMPLETE', status = 'complete', captured_date = $2, updated_at = now()
       WHERE id = $1`,
      [session.id, parsedDate]
    );

    await sendConversationFlowMessage({
      userId: session.user_id,
      conversationId: session.conversation_id,
      payload: {
        type: "text",
        text: `Thank you! Your date has been saved as ${parsedDate}. We'll send you a reminder when the time comes.`
      }
    });

    await pool.query(
      `INSERT INTO reminder_dispatch_log
         (user_id, contact_id, config_key, log_type, template_name, status)
       VALUES ($1, $2, $3, 'capture_complete', $4, 'delivered')`,
      [session.user_id, session.contact_id, session.config_key, templateName]
    );
  }
}

export async function expireStaleCaptureSessions(): Promise<number> {
  const result = await pool.query<{ user_id: string; contact_id: string; config_key: string }>(
    `UPDATE reminder_capture_sessions
     SET state = 'EXPIRED', status = 'expired', updated_at = now()
     WHERE expires_at < now() AND status = 'active'
     RETURNING user_id, contact_id, config_key`
  );
  const expired = result.rows;
  for (const row of expired) {
    await pool.query(
      `INSERT INTO reminder_dispatch_log
         (user_id, contact_id, config_key, log_type, template_name, status)
       VALUES ($1, $2, $3, 'capture_expired', null, 'failed')`,
      [row.user_id, row.contact_id, row.config_key]
    );
  }
  return expired.length;
}

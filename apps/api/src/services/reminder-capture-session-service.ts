import { pool } from "../db/pool.js";
import { startFlowForConversation } from "./flow-engine-service.js";
import { sendConversationFlowMessage } from "./channel-outbound-service.js";
import type { FlowMessagePayload } from "./outbound-message-types.js";

export interface CaptureSession {
  id: string;
  user_id: string;
  contact_id: string;
  conversation_id: string;
  config_key: string;
  state: "ASK_PERMISSION" | "COMPLETE" | "CANCELLED" | "EXPIRED" | "FAILED";
  status: "active" | "complete" | "cancelled" | "expired" | "failed";
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
  // Button reply arrives as "title id" concatenated; check for the payload anywhere in the string
  return lower.includes(`start_flow_${configKey}`);
}

function isDeclineMessage(message: string): boolean {
  const lower = message.trim().toLowerCase();
  return lower.includes("not_now") || lower.includes("not now") || lower === "no";
}

export async function handleCaptureSessionReply(session: CaptureSession, message: string): Promise<void> {
  if (isYesPayload(message, session.config_key)) {
    const configResult = await pool.query<{ capture_flow_id: string | null; capture_template_name: string | null }>(
      `SELECT capture_flow_id, capture_template_name FROM reminder_configs
       WHERE user_id = $1 AND config_key = $2`,
      [session.user_id, session.config_key]
    );
    const { capture_flow_id: flowId, capture_template_name: templateName } = configResult.rows[0] ?? {};

    let flowStarted = false;
    if (flowId) {
      try {
        const sendReply = async (payload: FlowMessagePayload) => {
          await sendConversationFlowMessage({
            userId: session.user_id,
            conversationId: session.conversation_id,
            payload
          });
        };
        await startFlowForConversation({
          userId: session.user_id,
          flowId,
          conversationId: session.conversation_id,
          sendReply
        });
        flowStarted = true;
      } catch (err) {
        console.warn(`[ReminderSession] flow trigger failed for session ${session.id}`, err);
      }
    }

    await pool.query(
      `UPDATE reminder_capture_sessions
       SET state = 'COMPLETE', status = 'complete', updated_at = now()
       WHERE id = $1`,
      [session.id]
    );

    await pool.query(
      `INSERT INTO reminder_dispatch_log
         (user_id, contact_id, config_key, log_type, template_name, status)
       VALUES ($1, $2, $3, 'capture_complete', $4, $5)`,
      [
        session.user_id,
        session.contact_id,
        session.config_key,
        templateName ?? null,
        flowStarted ? 'delivered' : 'failed'
      ]
    );
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
    return;
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
  if (expired.length > 0) {
    for (const row of expired) {
      await pool.query(
        `INSERT INTO reminder_dispatch_log
           (user_id, contact_id, config_key, log_type, template_name, status)
         VALUES ($1, $2, $3, 'capture_expired', null, 'failed')`,
        [row.user_id, row.contact_id, row.config_key]
      );
    }
  }
  return expired.length;
}

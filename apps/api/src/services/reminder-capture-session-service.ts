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
  return message.trim().toLowerCase() === `start_flow_${configKey}`;
}

function isDeclineMessage(message: string): boolean {
  const lower = message.trim().toLowerCase();
  return lower === "not_now" || lower === "no" || lower === "not now";
}

export async function handleCaptureSessionReply(session: CaptureSession, message: string): Promise<void> {
  if (isYesPayload(message, session.config_key)) {
    const configResult = await pool.query<{ capture_flow_id: string | null }>(
      `SELECT capture_flow_id FROM reminder_configs
       WHERE user_id = $1 AND config_key = $2`,
      [session.user_id, session.config_key]
    );
    const flowId = configResult.rows[0]?.capture_flow_id;

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
    return;
  }

  if (isDeclineMessage(message)) {
    await pool.query(
      `UPDATE reminder_capture_sessions
       SET state = 'CANCELLED', status = 'cancelled', updated_at = now()
       WHERE id = $1`,
      [session.id]
    );
    return;
  }
}

export async function expireStaleCaptureSessions(): Promise<number> {
  const result = await pool.query(
    `UPDATE reminder_capture_sessions
     SET state = 'EXPIRED', status = 'expired', updated_at = now()
     WHERE expires_at < now() AND status = 'active'`
  );
  return result.rowCount ?? 0;
}

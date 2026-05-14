import { pool } from "../db/pool.js";
import { evaluateSequenceConditions, type SequenceContactSnapshot } from "./sequence-condition-service.js";
import { loadContactSnapshot } from "./contact-snapshot-service.js";
import type { SequenceEventType } from "./sequence-event-service.js";
import { getOrCreateConversation } from "./conversation-service.js";
import { sendConversationFlowMessage } from "./channel-outbound-service.js";

interface ReminderConfigRow {
  id: string;
  user_id: string;
  config_key: string;
  reminder_type: string;
  enabled: boolean;
  capture_enabled: boolean;
  capture_trigger_type: "create" | "update" | "both";
  capture_conditions_json: Array<{
    field: string;
    operator: string;
    value: string;
    id?: string;
    sequence_id?: string;
    condition_type?: string;
    created_at?: string;
    updated_at?: string;
  }>;
  capture_template_name: string | null;
  capture_template_lang: string;
  capture_template_vars: Record<string, unknown>;
  retry_interval_days: number;
  retry_max_count: number;
  cooldown_days: number;
}

type TemplateVarBinding =
  | { source: "static"; value?: string }
  | { source: "contact"; field?: string };

function eventMatchesTrigger(
  event: SequenceEventType,
  triggerType: ReminderConfigRow["capture_trigger_type"]
): boolean {
  if (triggerType === "both") return true;
  return (
    (event === "contact_created" && triggerType === "create") ||
    (event === "contact_updated" && triggerType === "update")
  );
}

async function isInCooldown(
  userId: string,
  contactId: string,
  configKey: string,
  cooldownDays: number
): Promise<boolean> {
  const result = await pool.query<{ updated_at: string }>(
    `SELECT updated_at FROM reminder_capture_sessions
     WHERE user_id = $1 AND contact_id = $2 AND config_key = $3
     AND status IN ('complete', 'cancelled')
     ORDER BY updated_at DESC LIMIT 1`,
    [userId, contactId, configKey]
  );
  if (!result.rows[0]) return false;
  const lastMs = Date.parse(result.rows[0].updated_at);
  const cutoffMs = Date.now() - cooldownDays * 24 * 60 * 60 * 1000;
  return lastMs > cutoffMs;
}

async function hasExceededRetryCount(
  userId: string,
  contactId: string,
  configKey: string,
  retryMaxCount: number
): Promise<boolean> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM reminder_capture_sessions
     WHERE user_id = $1 AND contact_id = $2 AND config_key = $3`,
    [userId, contactId, configKey]
  );
  return parseInt(result.rows[0]?.count ?? "0", 10) >= retryMaxCount;
}

function resolveTemplateVars(
  contact: SequenceContactSnapshot,
  varMapping: Record<string, unknown>
): Record<string, string> {
  const resolved: Record<string, string> = {};
  const builtins: Record<string, string> = {
    display_name: contact.display_name ?? "",
    name: contact.display_name ?? "",
    phone_number: contact.phone_number,
    phone: contact.phone_number,
    email: contact.email ?? "",
    contact_type: contact.contact_type ?? "",
    source_type: contact.source_type ?? ""
  };

  for (const [placeholder, rawBinding] of Object.entries(varMapping)) {
    const binding = rawBinding as TemplateVarBinding;
    if (binding.source === "static") {
      resolved[placeholder] = binding.value ?? "";
      continue;
    }
    if (binding.source === "contact" && binding.field) {
      resolved[placeholder] = builtins[binding.field] ?? contact.custom_fields[binding.field] ?? "";
    }
  }

  return resolved;
}

export async function processReminderCaptureEvent(input: {
  userId: string;
  event: SequenceEventType;
  contactId: string;
}): Promise<void> {
  const snapshot = await loadContactSnapshot(input.contactId);
  if (!snapshot) return;

  const configResult = await pool.query<ReminderConfigRow>(
    `SELECT * FROM reminder_configs
     WHERE user_id = $1 AND enabled = true AND capture_enabled = true`,
    [input.userId]
  );

  for (const config of configResult.rows) {
    try {
      if (!eventMatchesTrigger(input.event, config.capture_trigger_type)) continue;

      const normalizedConditions = config.capture_conditions_json.map((c) => ({
        id: c.id ?? "",
        sequence_id: c.sequence_id ?? "",
        condition_type: (c.condition_type ?? "start") as "start",
        field: c.field,
        operator: c.operator as "eq" | "neq" | "gt" | "lt" | "contains",
        value: c.value,
        created_at: c.created_at ?? new Date().toISOString(),
        updated_at: c.updated_at ?? new Date().toISOString()
      }));

      if (!evaluateSequenceConditions(normalizedConditions, snapshot)) continue;

      if (await isInCooldown(input.userId, input.contactId, config.config_key, config.cooldown_days)) continue;
      if (await hasExceededRetryCount(input.userId, input.contactId, config.config_key, config.retry_max_count)) continue;

      // Check no active session for this contact's conversation
      const sessionCheck = await pool.query(
        `SELECT id FROM reminder_capture_sessions
         WHERE conversation_id IN (
           SELECT id FROM conversations WHERE user_id = $1 AND phone_number = $2 LIMIT 1
         ) AND status = 'active' LIMIT 1`,
        [input.userId, snapshot.phone_number]
      );
      if (sessionCheck.rows.length > 0) continue;

      if (!config.capture_template_name) continue;

      const conversation = await getOrCreateConversation(input.userId, snapshot.phone_number, {
        channelType: "api"
      });

      await sendConversationFlowMessage({
        userId: input.userId,
        conversationId: conversation.id,
        payload: {
          type: "template",
          templateName: config.capture_template_name,
          language: config.capture_template_lang,
          variableValues: resolveTemplateVars(snapshot, config.capture_template_vars)
        }
      });

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const existingSession = await pool.query(
        `SELECT id FROM reminder_capture_sessions WHERE conversation_id = $1 AND status = 'active' LIMIT 1`,
        [conversation.id]
      );
      if (existingSession.rows.length === 0) {
        await pool.query(
          `INSERT INTO reminder_capture_sessions
             (user_id, contact_id, conversation_id, config_key, state, status, expires_at)
           VALUES ($1, $2, $3, $4, 'ASK_PERMISSION', 'active', $5)`,
          [input.userId, input.contactId, conversation.id, config.config_key, expiresAt]
        );
      }
    } catch (err) {
      console.warn(`[ReminderCapture] config ${config.config_key} failed for contact ${input.contactId}`, err);
    }
  }
}

import { pool } from "../db/pool.js";
import { ensureSystemContactFields } from "./contact-fields-service.js";

export interface ReminderConfig {
  id: string;
  user_id: string;
  config_key: string;
  reminder_type: "birthday" | "anniversary" | "custom";
  custom_label: string | null;
  enabled: boolean;
  capture_enabled: boolean;
  capture_template_name: string | null;
  capture_template_lang: string;
  capture_template_vars: Record<string, unknown>;
  capture_flow_id: string | null;
  capture_trigger_type: "create" | "update" | "both";
  capture_conditions_json: unknown[];
  retry_interval_days: number;
  retry_max_count: number;
  cooldown_days: number;
  campaign_enabled: boolean;
  campaign_conditions_json: unknown[];
  campaign_send_time: string;
  campaign_timezone: string;
  dispatch_mode: "annual" | "exact_date";
  date_field_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReminderCampaignStep {
  id: string;
  config_id: string;
  step_order: number;
  days_before: number;
  template_name: string;
  template_lang: string;
  template_vars: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ReminderConfigInput {
  configKey: string;
  reminderType: "birthday" | "anniversary" | "custom";
  customLabel?: string | null;
  enabled?: boolean;
  captureEnabled?: boolean;
  captureTemplateName?: string | null;
  captureTemplateLang?: string;
  captureTemplateVars?: Record<string, unknown>;
  captureFlowId?: string | null;
  captureTriggerType?: "create" | "update" | "both";
  captureConditionsJson?: unknown[];
  retryIntervalDays?: number;
  retryMaxCount?: number;
  cooldownDays?: number;
  campaignEnabled?: boolean;
  campaignConditionsJson?: unknown[];
  campaignSendTime?: string;
  campaignTimezone?: string;
  dispatchMode?: "annual" | "exact_date";
  dateFieldName?: string | null;
}

export interface ReminderCampaignStepInput {
  stepOrder: number;
  daysBefore: number;
  templateName: string;
  templateLang?: string;
  templateVars?: Record<string, unknown>;
}

const DEFAULT_CONFIGS: Array<{ config_key: string; reminder_type: ReminderConfig["reminder_type"] }> = [
  { config_key: "birthday", reminder_type: "birthday" },
  { config_key: "anniversary", reminder_type: "anniversary" }
];

function normalizeTime(value: string | Date | null | undefined, fallback = "09:00"): string {
  if (value instanceof Date) {
    return value.toISOString().slice(11, 16);
  }
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : fallback;
}

function normalizeReminderConfig(row: ReminderConfig): ReminderConfig {
  return {
    ...row,
    campaign_send_time: normalizeTime(row.campaign_send_time)
  };
}

async function ensureDefaultReminderConfigs(userId: string): Promise<void> {
  await ensureSystemContactFields(userId);
  for (const def of DEFAULT_CONFIGS) {
    await pool.query(
      `INSERT INTO reminder_configs (user_id, config_key, reminder_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, config_key) DO NOTHING`,
      [userId, def.config_key, def.reminder_type]
    );
  }
}

export async function listReminderConfigs(userId: string): Promise<ReminderConfig[]> {
  await ensureDefaultReminderConfigs(userId);

  const existing = await pool.query<ReminderConfig>(
    `SELECT * FROM reminder_configs WHERE user_id = $1 ORDER BY created_at`,
    [userId]
  );

  return existing.rows.map(normalizeReminderConfig);
}

export async function upsertReminderConfig(userId: string, input: ReminderConfigInput): Promise<ReminderConfig> {
  const existingResult = await pool.query<ReminderConfig>(
    `SELECT * FROM reminder_configs WHERE user_id = $1 AND config_key = $2 LIMIT 1`,
    [userId, input.configKey]
  );
  const existing = existingResult.rows[0] ? normalizeReminderConfig(existingResult.rows[0]) : null;

  const next = {
    configKey: input.configKey,
    reminderType: input.reminderType,
    customLabel: input.customLabel !== undefined ? input.customLabel : existing?.custom_label ?? null,
    enabled: input.enabled ?? existing?.enabled ?? false,
    captureEnabled: input.captureEnabled ?? existing?.capture_enabled ?? true,
    captureTemplateName: input.captureTemplateName !== undefined
      ? input.captureTemplateName
      : existing?.capture_template_name ?? null,
    captureTemplateLang: input.captureTemplateLang ?? existing?.capture_template_lang ?? "en",
    captureTemplateVars: input.captureTemplateVars ?? existing?.capture_template_vars ?? {},
    captureFlowId: input.captureFlowId !== undefined ? input.captureFlowId : existing?.capture_flow_id ?? null,
    captureTriggerType: input.captureTriggerType ?? existing?.capture_trigger_type ?? "create",
    captureConditionsJson: input.captureConditionsJson ?? existing?.capture_conditions_json ?? [],
    retryIntervalDays: input.retryIntervalDays ?? existing?.retry_interval_days ?? 7,
    retryMaxCount: input.retryMaxCount ?? existing?.retry_max_count ?? 1,
    cooldownDays: input.cooldownDays ?? existing?.cooldown_days ?? 30,
    campaignEnabled: input.campaignEnabled ?? existing?.campaign_enabled ?? true,
    campaignConditionsJson: input.campaignConditionsJson ?? existing?.campaign_conditions_json ?? [],
    campaignSendTime: normalizeTime(input.campaignSendTime ?? existing?.campaign_send_time ?? "09:00"),
    campaignTimezone: input.campaignTimezone ?? existing?.campaign_timezone ?? "Asia/Kolkata",
    dispatchMode: input.dispatchMode ?? existing?.dispatch_mode ?? "annual",
    dateFieldName: input.dateFieldName !== undefined
      ? input.dateFieldName
      : existing?.date_field_name ?? input.configKey
  };

  const result = await pool.query<ReminderConfig>(
    `INSERT INTO reminder_configs (
       user_id, config_key, reminder_type, custom_label, enabled,
       capture_enabled, capture_template_name, capture_template_lang, capture_template_vars,
       capture_flow_id, capture_trigger_type, capture_conditions_json,
       retry_interval_days, retry_max_count, cooldown_days,
       campaign_enabled, campaign_conditions_json, campaign_send_time, campaign_timezone,
       dispatch_mode, date_field_name, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9,
       $10, $11, $12,
       $13, $14, $15,
       $16, $17, $18, $19,
       $20, $21, now()
     )
     ON CONFLICT (user_id, config_key) DO UPDATE SET
       reminder_type           = EXCLUDED.reminder_type,
       custom_label            = EXCLUDED.custom_label,
       enabled                 = EXCLUDED.enabled,
       capture_enabled         = EXCLUDED.capture_enabled,
       capture_template_name   = EXCLUDED.capture_template_name,
       capture_template_lang   = EXCLUDED.capture_template_lang,
       capture_template_vars   = EXCLUDED.capture_template_vars,
       capture_flow_id         = EXCLUDED.capture_flow_id,
       capture_trigger_type    = EXCLUDED.capture_trigger_type,
       capture_conditions_json = EXCLUDED.capture_conditions_json,
       retry_interval_days     = EXCLUDED.retry_interval_days,
       retry_max_count         = EXCLUDED.retry_max_count,
       cooldown_days           = EXCLUDED.cooldown_days,
       campaign_enabled        = EXCLUDED.campaign_enabled,
       campaign_conditions_json = EXCLUDED.campaign_conditions_json,
       campaign_send_time      = EXCLUDED.campaign_send_time,
       campaign_timezone       = EXCLUDED.campaign_timezone,
       dispatch_mode           = EXCLUDED.dispatch_mode,
       date_field_name         = EXCLUDED.date_field_name,
       updated_at              = now()
     RETURNING *`,
    [
      userId,
      next.configKey,
      next.reminderType,
      next.customLabel,
      next.enabled,
      next.captureEnabled,
      next.captureTemplateName,
      next.captureTemplateLang,
      JSON.stringify(next.captureTemplateVars),
      next.captureFlowId,
      next.captureTriggerType,
      JSON.stringify(next.captureConditionsJson),
      next.retryIntervalDays,
      next.retryMaxCount,
      next.cooldownDays,
      next.campaignEnabled,
      JSON.stringify(next.campaignConditionsJson),
      next.campaignSendTime,
      next.campaignTimezone,
      next.dispatchMode,
      next.dateFieldName
    ]
  );
  return normalizeReminderConfig(result.rows[0]);
}

export async function deleteReminderConfig(userId: string, configKey: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM reminder_configs
     WHERE user_id = $1 AND config_key = $2 AND reminder_type = 'custom'`,
    [userId, configKey]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listReminderCampaignSteps(configId: string): Promise<ReminderCampaignStep[]> {
  const result = await pool.query<ReminderCampaignStep>(
    `SELECT * FROM reminder_campaign_steps WHERE config_id = $1 ORDER BY step_order`,
    [configId]
  );
  return result.rows;
}

export async function replaceReminderCampaignSteps(
  configId: string,
  steps: ReminderCampaignStepInput[]
): Promise<ReminderCampaignStep[]> {
  await pool.query(`DELETE FROM reminder_campaign_steps WHERE config_id = $1`, [configId]);

  const inserted: ReminderCampaignStep[] = [];
  for (const step of steps) {
    const row = await pool.query<ReminderCampaignStep>(
      `INSERT INTO reminder_campaign_steps
         (config_id, step_order, days_before, template_name, template_lang, template_vars)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        configId,
        step.stepOrder,
        step.daysBefore,
        step.templateName,
        step.templateLang ?? "en",
        JSON.stringify(step.templateVars ?? {})
      ]
    );
    inserted.push(row.rows[0]);
  }

  return inserted;
}

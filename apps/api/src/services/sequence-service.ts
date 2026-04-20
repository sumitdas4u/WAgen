import { pool, withTransaction } from "../db/pool.js";
import { requireMetaConnection } from "./meta-whatsapp-service.js";
import { getMessageTemplate } from "./template-service.js";
import type {
  SequenceCondition,
  SequenceConditionOperator,
  SequenceConditionType
} from "./sequence-condition-service.js";
import type { DateOffset } from "../utils/date-offset.js";

export type SequenceStatus = "draft" | "published" | "paused";
export type SequenceTriggerType = "create" | "update" | "both";
export type SequenceChannel = "whatsapp";
export type SequenceBaseType = "contact";
export type SequenceTimeMode = "any_time" | "window";
export type SequenceDelayUnit = "minutes" | "hours" | "days";
export type SequenceEnrollmentStatus = "active" | "sending" | "completed" | "failed" | "stopped";
export type CampaignTemplateVariableSource = "contact" | "static" | "now";

export interface CampaignTemplateVariableBinding {
  source: CampaignTemplateVariableSource;
  field?: string;
  value?: string;
  fallback?: string;
  dateOffset?: DateOffset;
}

export type CampaignTemplateVariables = Record<string, CampaignTemplateVariableBinding>;
export type CampaignMediaOverrides = Record<string, string>;

export interface SequenceStep {
  id: string;
  sequence_id: string;
  step_order: number;
  delay_value: number;
  delay_unit: SequenceDelayUnit;
  message_template_id: string;
  custom_delivery_json: Record<string, unknown>;
  template_variables_json?: CampaignTemplateVariables;
  media_overrides_json?: CampaignMediaOverrides;
  created_at: string;
  updated_at: string;
}

export interface Sequence {
  id: string;
  user_id: string;
  name: string;
  status: SequenceStatus;
  connection_id: string | null;
  base_type: SequenceBaseType;
  trigger_type: SequenceTriggerType;
  channel: SequenceChannel;
  allow_once: boolean;
  require_previous_delivery: boolean;
  retry_enabled: boolean;
  retry_window_hours: number;
  allowed_days_json: string[];
  time_mode: SequenceTimeMode;
  time_window_start: string | null;
  time_window_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface SequenceEnrollment {
  id: string;
  sequence_id: string;
  contact_id: string;
  status: SequenceEnrollmentStatus;
  current_step: number;
  entered_at: string;
  next_run_at: string;
  last_executed_at: string | null;
  last_message_id: string | null;
  last_delivery_status: string | null;
  retry_count: number;
  retry_started_at: string | null;
  last_enqueued_at: string | null;
  last_enqueued_for_run_at: string | null;
  last_enqueued_queue: string | null;
  last_enqueued_job_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SequenceListItem extends Sequence {
  steps_count: number;
  enrolled_count: number;
  completed_count: number;
  failed_count: number;
  active_count: number;
}

export interface SequenceDetail extends Sequence {
  steps: SequenceStep[];
  conditions: SequenceCondition[];
  metrics: {
    enrolled: number;
    active: number;
    completed: number;
    failed: number;
    stopped: number;
  };
}

export interface SequenceWriteStepInput {
  id?: string;
  stepOrder: number;
  delayValue: number;
  delayUnit: SequenceDelayUnit;
  messageTemplateId: string;
  templateVariables?: CampaignTemplateVariables;
  mediaOverrides?: CampaignMediaOverrides;
  customDelivery?: Record<string, unknown>;
}

export interface SequenceWriteConditionInput {
  id?: string;
  conditionType: SequenceConditionType;
  field: string;
  operator: SequenceConditionOperator;
  value: string;
}

export interface SequenceWriteInput {
  name: string;
  connectionId?: string | null;
  baseType?: SequenceBaseType;
  triggerType: SequenceTriggerType;
  channel?: SequenceChannel;
  allowOnce?: boolean;
  requirePreviousDelivery?: boolean;
  retryEnabled?: boolean;
  retryWindowHours?: number;
  allowedDays?: string[];
  timeMode?: SequenceTimeMode;
  timeWindowStart?: string | null;
  timeWindowEnd?: string | null;
  steps?: SequenceWriteStepInput[];
  conditions?: SequenceWriteConditionInput[];
}

const STEP_TEMPLATE_VARIABLES_KEY = "templateVariables";
const STEP_MEDIA_OVERRIDES_KEY = "mediaOverrides";

function addDelay(base: Date, value: number, unit: SequenceDelayUnit): Date {
  const next = new Date(base);
  if (unit === "minutes") next.setMinutes(next.getMinutes() + value);
  else if (unit === "hours") next.setHours(next.getHours() + value);
  else next.setDate(next.getDate() + value);
  return next;
}

function weekdayKey(date: Date): string {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][date.getDay()]!;
}

function isWithinWindow(date: Date, start: string | null, end: string | null): boolean {
  if (!start || !end) return true;
  const [startH, startM] = start.split(":").map(Number);
  const [endH, endM] = end.split(":").map(Number);
  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  return currentMinutes >= startH * 60 + startM && currentMinutes <= endH * 60 + endM;
}

function nextWindowTime(now: Date, allowedDays: string[], start: string | null): Date {
  const next = new Date(now);
  for (let i = 0; i < 8; i += 1) {
    const dayAllowed = allowedDays.length === 0 || allowedDays.includes(weekdayKey(next));
    if (dayAllowed) {
      if (start) {
        const [h, m] = start.split(":").map(Number);
        next.setHours(h, m, 0, 0);
      }
      if (next > now) return next;
    }
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
  }
  return new Date(now.getTime() + 60 * 60_000);
}

function resolveInitialSequenceRunAt(input: {
  firstStepDelay?: { value: number; unit: SequenceDelayUnit };
  allowedDays: string[];
  timeMode: SequenceTimeMode;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
}): string {
  const baseTime =
    input.firstStepDelay && input.firstStepDelay.value > 0
      ? addDelay(new Date(), input.firstStepDelay.value, input.firstStepDelay.unit)
      : new Date();

  const dayAllowed = input.allowedDays.length === 0 || input.allowedDays.includes(weekdayKey(baseTime));
  const inWindow =
    input.timeMode !== "window" || isWithinWindow(baseTime, input.timeWindowStart, input.timeWindowEnd);

  if (dayAllowed && inWindow) {
    return baseTime.toISOString();
  }

  const nextAllowedTime = nextWindowTime(
    baseTime,
    input.allowedDays,
    input.timeMode === "window" ? input.timeWindowStart : null
  );
  return nextAllowedTime.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStepCustomDelivery(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

function normalizeTemplateBinding(value: unknown): CampaignTemplateVariableBinding | null {
  if (!isRecord(value)) {
    return null;
  }

  const source = value.source;
  if (source !== "contact" && source !== "static") {
    return null;
  }

  const binding: CampaignTemplateVariableBinding = { source };
  if (typeof value.field === "string") {
    binding.field = value.field;
  }
  if (typeof value.value === "string") {
    binding.value = value.value;
  }
  if (typeof value.fallback === "string") {
    binding.fallback = value.fallback;
  }
  return binding;
}

function extractStepTemplateVariables(customDelivery: Record<string, unknown> | null | undefined): CampaignTemplateVariables {
  const source = isRecord(customDelivery?.[STEP_TEMPLATE_VARIABLES_KEY])
    ? (customDelivery?.[STEP_TEMPLATE_VARIABLES_KEY] as Record<string, unknown>)
    : null;
  if (!source) {
    return {};
  }

  const bindings: CampaignTemplateVariables = {};
  for (const [placeholder, candidate] of Object.entries(source)) {
    const normalized = normalizeTemplateBinding(candidate);
    if (normalized) {
      bindings[placeholder] = normalized;
    }
  }
  return bindings;
}

function extractStepMediaOverrides(customDelivery: Record<string, unknown> | null | undefined): CampaignMediaOverrides {
  const source = isRecord(customDelivery?.[STEP_MEDIA_OVERRIDES_KEY])
    ? (customDelivery?.[STEP_MEDIA_OVERRIDES_KEY] as Record<string, unknown>)
    : null;
  if (!source) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function stripStepRuntimeConfig(customDelivery: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const next = normalizeStepCustomDelivery(customDelivery);
  delete next[STEP_TEMPLATE_VARIABLES_KEY];
  delete next[STEP_MEDIA_OVERRIDES_KEY];
  return next;
}

function buildStepCustomDelivery(step: SequenceWriteStepInput): Record<string, unknown> {
  const customDelivery = stripStepRuntimeConfig(step.customDelivery);
  customDelivery[STEP_TEMPLATE_VARIABLES_KEY] = step.templateVariables ?? {};
  customDelivery[STEP_MEDIA_OVERRIDES_KEY] = step.mediaOverrides ?? {};
  return customDelivery;
}

function hydrateSequenceStep(step: SequenceStep): SequenceStep {
  const customDelivery = normalizeStepCustomDelivery(step.custom_delivery_json);
  return {
    ...step,
    custom_delivery_json: stripStepRuntimeConfig(customDelivery),
    template_variables_json: extractStepTemplateVariables(customDelivery),
    media_overrides_json: extractStepMediaOverrides(customDelivery)
  };
}

function normalizeAllowedDays(days?: string[]): string[] {
  const allowed = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
  return Array.from(
    new Set((days ?? []).map((day) => day.trim().toLowerCase()).filter((day) => allowed.has(day)))
  );
}

async function ensureValidSteps(userId: string, connectionId: string | null | undefined, steps: SequenceWriteStepInput[]): Promise<void> {
  if (!connectionId) {
    throw new Error("Select a WhatsApp API connection.");
  }
  for (const step of steps) {
    if (step.delayValue < 0) {
      throw new Error("Step delay cannot be negative.");
    }
    const template = await getMessageTemplate(userId, step.messageTemplateId);
    if (template.connectionId !== connectionId) {
      throw new Error("Sequence steps must use templates from the selected WhatsApp API connection.");
    }
    if (template.status !== "APPROVED") {
      throw new Error("Sequence steps require approved WhatsApp templates.");
    }
  }
}

async function replaceSequenceChildren(
  userId: string,
  connectionId: string | null | undefined,
  sequenceId: string,
  steps: SequenceWriteStepInput[] | undefined,
  conditions: SequenceWriteConditionInput[] | undefined
): Promise<void> {
  if (steps) {
    await ensureValidSteps(userId, connectionId, steps);
  }

  await withTransaction(async (client) => {
    if (steps) {
      await client.query(`DELETE FROM sequence_steps WHERE sequence_id = $1`, [sequenceId]);
      for (const step of steps.sort((a, b) => a.stepOrder - b.stepOrder)) {
        await client.query(
          `INSERT INTO sequence_steps (
             sequence_id,
             step_order,
             delay_value,
             delay_unit,
             message_template_id,
             custom_delivery_json
           )
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            sequenceId,
            step.stepOrder,
            step.delayValue,
            step.delayUnit,
            step.messageTemplateId,
            JSON.stringify(buildStepCustomDelivery(step))
          ]
        );
      }
    }

    if (conditions) {
      await client.query(`DELETE FROM sequence_conditions WHERE sequence_id = $1`, [sequenceId]);
      for (const condition of conditions) {
        await client.query(
          `INSERT INTO sequence_conditions (
             sequence_id,
             condition_type,
             field,
             operator,
             value
           )
           VALUES ($1, $2, $3, $4, $5)`,
          [sequenceId, condition.conditionType, condition.field, condition.operator, condition.value]
        );
      }
    }
  });
}

export async function listSequences(userId: string): Promise<SequenceListItem[]> {
  const result = await pool.query<SequenceListItem>(
    `SELECT
       s.*,
       COALESCE(ss.steps_count, 0)::int AS steps_count,
       COALESCE(se.enrolled_count, 0)::int AS enrolled_count,
       COALESCE(se.completed_count, 0)::int AS completed_count,
       COALESCE(se.failed_count, 0)::int AS failed_count,
       COALESCE(se.active_count, 0)::int AS active_count
     FROM sequences s
     LEFT JOIN (
       SELECT sequence_id, COUNT(*)::int AS steps_count
       FROM sequence_steps
       GROUP BY sequence_id
     ) ss ON ss.sequence_id = s.id
     LEFT JOIN (
       SELECT
         sequence_id,
         COUNT(*)::int AS enrolled_count,
         COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_count,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
         COUNT(*) FILTER (WHERE status IN ('active', 'sending'))::int AS active_count
       FROM sequence_enrollments
       GROUP BY sequence_id
     ) se ON se.sequence_id = s.id
     WHERE s.user_id = $1
     ORDER BY s.updated_at DESC, s.created_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function getSequence(userId: string, sequenceId: string): Promise<Sequence | null> {
  const result = await pool.query<Sequence>(
    `SELECT *
     FROM sequences
     WHERE user_id = $1
       AND id = $2
     LIMIT 1`,
    [userId, sequenceId]
  );
  return result.rows[0] ?? null;
}

export async function getSequenceDetail(userId: string, sequenceId: string): Promise<SequenceDetail | null> {
  const sequence = await getSequence(userId, sequenceId);
  if (!sequence) {
    return null;
  }

  const [stepsResult, conditionsResult, metricsResult] = await Promise.all([
    pool.query<SequenceStep>(
      `SELECT * FROM sequence_steps WHERE sequence_id = $1 ORDER BY step_order ASC`,
      [sequenceId]
    ),
    pool.query<SequenceCondition>(
      `SELECT * FROM sequence_conditions WHERE sequence_id = $1 ORDER BY created_at ASC`,
      [sequenceId]
    ),
    pool.query<{
      enrolled: string;
      active: string;
      completed: string;
      failed: string;
      stopped: string;
    }>(
      `SELECT
         COUNT(*)::text AS enrolled,
         COUNT(*) FILTER (WHERE status IN ('active', 'sending'))::text AS active,
         COUNT(*) FILTER (WHERE status = 'completed')::text AS completed,
         COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
         COUNT(*) FILTER (WHERE status = 'stopped')::text AS stopped
       FROM sequence_enrollments
       WHERE sequence_id = $1`,
      [sequenceId]
    )
  ]);

  return {
    ...sequence,
    steps: stepsResult.rows.map(hydrateSequenceStep),
    conditions: conditionsResult.rows,
    metrics: {
      enrolled: Number(metricsResult.rows[0]?.enrolled ?? 0),
      active: Number(metricsResult.rows[0]?.active ?? 0),
      completed: Number(metricsResult.rows[0]?.completed ?? 0),
      failed: Number(metricsResult.rows[0]?.failed ?? 0),
      stopped: Number(metricsResult.rows[0]?.stopped ?? 0)
    }
  };
}

export async function createSequence(userId: string, input: SequenceWriteInput): Promise<SequenceDetail> {
  if (!input.connectionId) {
    throw new Error("Select a WhatsApp API connection.");
  }
  await requireMetaConnection(userId, input.connectionId, { allowDisconnected: true });
  const result = await pool.query<{ id: string }>(
    `INSERT INTO sequences (
       user_id,
       name,
       connection_id,
       base_type,
       trigger_type,
       channel,
       allow_once,
       require_previous_delivery,
       retry_enabled,
       retry_window_hours,
       allowed_days_json,
       time_mode,
       time_window_start,
       time_window_end
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14)
     RETURNING id`,
    [
      userId,
      input.name.trim(),
      input.connectionId,
      input.baseType ?? "contact",
      input.triggerType,
      input.channel ?? "whatsapp",
      input.allowOnce ?? true,
      input.requirePreviousDelivery ?? false,
      input.retryEnabled ?? false,
      input.retryWindowHours ?? 48,
      JSON.stringify(normalizeAllowedDays(input.allowedDays)),
      input.timeMode ?? "any_time",
      input.timeWindowStart ?? null,
      input.timeWindowEnd ?? null
    ]
  );

  await replaceSequenceChildren(userId, input.connectionId, result.rows[0]!.id, input.steps, input.conditions);
  return (await getSequenceDetail(userId, result.rows[0]!.id))!;
}

export async function updateSequence(
  userId: string,
  sequenceId: string,
  patch: Partial<SequenceWriteInput>
): Promise<SequenceDetail | null> {
  const current = await getSequence(userId, sequenceId);
  if (!current) {
    return null;
  }

  const nextConnectionId = patch.connectionId ?? current.connection_id;
  if (!nextConnectionId) {
    throw new Error("Select a WhatsApp API connection.");
  }
  await requireMetaConnection(userId, nextConnectionId, { allowDisconnected: true });

  await pool.query(
    `UPDATE sequences
     SET name = COALESCE($3, name),
         connection_id = COALESCE($4, connection_id),
         base_type = COALESCE($5, base_type),
         trigger_type = COALESCE($6, trigger_type),
         channel = COALESCE($7, channel),
         allow_once = COALESCE($8, allow_once),
         require_previous_delivery = COALESCE($9, require_previous_delivery),
         retry_enabled = COALESCE($10, retry_enabled),
         retry_window_hours = COALESCE($11, retry_window_hours),
         allowed_days_json = COALESCE($12::jsonb, allowed_days_json),
         time_mode = COALESCE($13, time_mode),
         time_window_start = COALESCE($14, time_window_start),
         time_window_end = COALESCE($15, time_window_end),
         updated_at = NOW()
     WHERE user_id = $1
       AND id = $2`,
    [
      userId,
      sequenceId,
      patch.name?.trim() || null,
      patch.connectionId ?? null,
      patch.baseType ?? null,
      patch.triggerType ?? null,
      patch.channel ?? null,
      patch.allowOnce ?? null,
      patch.requirePreviousDelivery ?? null,
      patch.retryEnabled ?? null,
      patch.retryWindowHours ?? null,
      patch.allowedDays ? JSON.stringify(normalizeAllowedDays(patch.allowedDays)) : null,
      patch.timeMode ?? null,
      patch.timeWindowStart ?? null,
      patch.timeWindowEnd ?? null
    ]
  );

  await replaceSequenceChildren(userId, nextConnectionId, sequenceId, patch.steps, patch.conditions);
  return getSequenceDetail(userId, sequenceId);
}

export async function deleteSequence(userId: string, sequenceId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM sequences
     WHERE user_id = $1
       AND id = $2`,
    [userId, sequenceId]
  );
  return (result.rowCount ?? 0) > 0;
}

async function validatePublishableSequence(userId: string, sequenceId: string): Promise<void> {
  const detail = await getSequenceDetail(userId, sequenceId);
  if (!detail) {
    throw new Error("Sequence not found.");
  }
  if (!detail.name.trim()) {
    throw new Error("Sequence name is required.");
  }
  if (detail.steps.length === 0) {
    throw new Error("Add at least one step before publishing.");
  }
  if (!detail.connection_id) {
    throw new Error("Select a WhatsApp API connection.");
  }
  await requireMetaConnection(userId, detail.connection_id, { requireActive: true });
  await ensureValidSteps(
    userId,
    detail.connection_id,
    detail.steps.map((step) => ({
      stepOrder: step.step_order,
      delayValue: step.delay_value,
      delayUnit: step.delay_unit,
      messageTemplateId: step.message_template_id,
      templateVariables: step.template_variables_json,
      mediaOverrides: step.media_overrides_json,
      customDelivery: step.custom_delivery_json
    }))
  );
}

export async function publishSequence(userId: string, sequenceId: string): Promise<SequenceDetail | null> {
  await validatePublishableSequence(userId, sequenceId);
  await pool.query(
    `UPDATE sequences
     SET status = 'published',
         updated_at = NOW()
     WHERE user_id = $1
       AND id = $2`,
    [userId, sequenceId]
  );
  return getSequenceDetail(userId, sequenceId);
}

export async function pauseSequence(userId: string, sequenceId: string): Promise<SequenceDetail | null> {
  await pool.query(
    `UPDATE sequences
     SET status = 'paused',
         updated_at = NOW()
     WHERE user_id = $1
       AND id = $2`,
    [userId, sequenceId]
  );
  return getSequenceDetail(userId, sequenceId);
}

export async function resumeSequence(userId: string, sequenceId: string): Promise<SequenceDetail | null> {
  await validatePublishableSequence(userId, sequenceId);
  await pool.query(
    `UPDATE sequences
     SET status = 'published',
         updated_at = NOW()
     WHERE user_id = $1
       AND id = $2`,
    [userId, sequenceId]
  );
  return getSequenceDetail(userId, sequenceId);
}

export async function listSequenceEnrollments(
  userId: string,
  sequenceId: string,
  status?: SequenceEnrollmentStatus
): Promise<(SequenceEnrollment & { contact_phone: string; contact_name: string | null })[]> {
  const result = await pool.query<SequenceEnrollment & { contact_phone: string; contact_name: string | null }>(
    `SELECT se.*,
            c.phone_number AS contact_phone,
            c.display_name AS contact_name
     FROM sequence_enrollments se
     JOIN sequences s ON s.id = se.sequence_id
     JOIN contacts c ON c.id = se.contact_id
     WHERE se.sequence_id = $1
       AND s.user_id = $2
       ${status ? "AND se.status = $3" : ""}
     ORDER BY se.entered_at DESC`,
    status ? [sequenceId, userId, status] : [sequenceId, userId]
  );
  return result.rows;
}

export async function getSequenceEnrollment(enrollmentId: string): Promise<SequenceEnrollment | null> {
  const result = await pool.query<SequenceEnrollment>(
    `SELECT * FROM sequence_enrollments WHERE id = $1 LIMIT 1`,
    [enrollmentId]
  );
  return result.rows[0] ?? null;
}

export async function createSequenceEnrollment(
  sequenceId: string,
  contactId: string,
  options?: {
    firstStepDelay?: { value: number; unit: SequenceDelayUnit };
    allowedDays?: string[];
    timeMode?: SequenceTimeMode;
    timeWindowStart?: string | null;
    timeWindowEnd?: string | null;
  }
): Promise<SequenceEnrollment> {
  // Store the first real eligible send time at enrollment creation so queued jobs
  // already respect allowed days and time windows before the worker sees them.
  const nextRunAt = resolveInitialSequenceRunAt({
    firstStepDelay: options?.firstStepDelay,
    allowedDays: options?.allowedDays ?? [],
    timeMode: options?.timeMode ?? "any_time",
    timeWindowStart: options?.timeWindowStart ?? null,
    timeWindowEnd: options?.timeWindowEnd ?? null
  });

  const result = await pool.query<SequenceEnrollment>(
    `INSERT INTO sequence_enrollments (
       sequence_id,
       contact_id,
       status,
       current_step,
       next_run_at
     )
     VALUES ($1, $2, 'active', 0, $3)
     RETURNING *`,
    [sequenceId, contactId, nextRunAt]
  );
  return result.rows[0]!;
}

export async function updateSequenceEnrollment(
  enrollmentId: string,
  patch: Partial<{
    status: SequenceEnrollmentStatus;
    currentStep: number;
    nextRunAt: string | null;
    lastExecutedAt: string | null;
    lastMessageId: string | null;
    lastDeliveryStatus: string | null;
    retryCount: number;
    retryStartedAt: string | null;
  }>
): Promise<void> {
  // retryStartedAt uses an explicit-clear pattern: when the key is present and
  // the value is null we want the column set to NULL (not left unchanged by COALESCE).
  const clearRetryStartedAt =
    Object.prototype.hasOwnProperty.call(patch, "retryStartedAt") && patch.retryStartedAt === null;

  await pool.query(
    `UPDATE sequence_enrollments
     SET status = COALESCE($2, status),
         current_step = COALESCE($3, current_step),
         next_run_at = COALESCE($4, next_run_at),
         last_executed_at = COALESCE($5, last_executed_at),
         last_message_id = COALESCE($6, last_message_id),
         last_delivery_status = COALESCE($7, last_delivery_status),
         retry_count = COALESCE($8, retry_count),
         retry_started_at = CASE WHEN $9 THEN NULL ELSE COALESCE($10, retry_started_at) END,
         updated_at = NOW()
     WHERE id = $1`,
    [
      enrollmentId,
      patch.status ?? null,
      patch.currentStep ?? null,
      patch.nextRunAt ?? null,
      patch.lastExecutedAt ?? null,
      patch.lastMessageId ?? null,
      patch.lastDeliveryStatus ?? null,
      patch.retryCount ?? null,
      clearRetryStartedAt,
      clearRetryStartedAt ? null : (patch.retryStartedAt ?? null)
    ]
  );
}

export async function recordSequenceEnrollmentQueueState(input: {
  enrollmentId: string;
  nextRunAt: string;
  queueName: string;
  jobId: string;
}): Promise<void> {
  await pool.query(
    `UPDATE sequence_enrollments
     SET last_enqueued_at = NOW(),
         last_enqueued_for_run_at = $2,
         last_enqueued_queue = $3,
         last_enqueued_job_id = $4,
         updated_at = NOW()
     WHERE id = $1`,
    [input.enrollmentId, input.nextRunAt, input.queueName, input.jobId]
  );
}

export async function clearSequenceEnrollmentQueueState(enrollmentId: string): Promise<void> {
  await pool.query(
    `UPDATE sequence_enrollments
     SET last_enqueued_at = NULL,
         last_enqueued_for_run_at = NULL,
         last_enqueued_queue = NULL,
         last_enqueued_job_id = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [enrollmentId]
  );
}

export async function listDueSequenceEnrollmentIds(limit = 50): Promise<string[]> {
  return withTransaction(async (client) => {
    const result = await client.query<{ id: string }>(
      `SELECT id
       FROM sequence_enrollments
       WHERE status = 'active'
         AND next_run_at <= NOW()
       ORDER BY next_run_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    return result.rows.map((row) => row.id);
  });
}

export async function listDueSequenceEnrollmentsForQueueAudit(limit = 250): Promise<SequenceEnrollment[]> {
  const result = await pool.query<SequenceEnrollment>(
    `SELECT *
     FROM sequence_enrollments
     WHERE status = 'active'
       AND next_run_at <= NOW()
     ORDER BY next_run_at ASC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function getSequenceEnrollmentForExecution(enrollmentId: string): Promise<{
  enrollment: SequenceEnrollment;
  sequence: Sequence;
  steps: SequenceStep[];
  conditions: SequenceCondition[];
  contact: {
    id: string;
    user_id: string;
    display_name: string | null;
    phone_number: string;
    email: string | null;
    contact_type: string;
    tags: string[];
    source_type: string;
    source_id: string | null;
    source_url: string | null;
    created_at: string;
    updated_at: string;
    custom_fields: Record<string, string | null>;
  };
} | null> {
  const enrollment = await getSequenceEnrollment(enrollmentId);
  if (!enrollment) {
    return null;
  }

  const sequenceResult = await pool.query<Sequence>(
    `SELECT * FROM sequences WHERE id = $1 LIMIT 1`,
    [enrollment.sequence_id]
  );
  const sequence = sequenceResult.rows[0];
  if (!sequence) {
    return null;
  }

  const [stepsResult, conditionsResult, contactResult, fieldValuesResult] = await Promise.all([
    pool.query<SequenceStep>(`SELECT * FROM sequence_steps WHERE sequence_id = $1 ORDER BY step_order ASC`, [sequence.id]),
    pool.query<SequenceCondition>(`SELECT * FROM sequence_conditions WHERE sequence_id = $1 ORDER BY created_at ASC`, [sequence.id]),
    pool.query<{
      id: string;
      user_id: string;
      display_name: string | null;
      phone_number: string;
      email: string | null;
      contact_type: string;
      tags: string[];
      source_type: string;
      source_id: string | null;
      source_url: string | null;
      created_at: string;
      updated_at: string;
    }>(`SELECT * FROM contacts WHERE id = $1 LIMIT 1`, [enrollment.contact_id]),
    pool.query<{ field_name: string; value: string | null }>(
      `SELECT cf.name AS field_name, cfv.value
       FROM contact_field_values cfv
       JOIN contact_fields cf ON cf.id = cfv.field_id
       WHERE cfv.contact_id = $1`,
      [enrollment.contact_id]
    )
  ]);

  const contact = contactResult.rows[0];
  if (!contact) {
    return null;
  }

  return {
    enrollment,
    sequence,
    steps: stepsResult.rows.map(hydrateSequenceStep),
    conditions: conditionsResult.rows,
    contact: {
      ...contact,
      custom_fields: Object.fromEntries(fieldValuesResult.rows.map((row) => [row.field_name, row.value]))
    }
  };
}

export interface SequenceStepFunnelRow {
  step_id: string;
  step_order: number;
  delay_value: number;
  delay_unit: SequenceDelayUnit;
  message_template_id: string;
  reached: number;
}

export async function getSequenceStepFunnel(
  userId: string,
  sequenceId: string
): Promise<SequenceStepFunnelRow[]> {
  const result = await pool.query<SequenceStepFunnelRow>(
    `SELECT ss.id         AS step_id,
            ss.step_order,
            ss.delay_value,
            ss.delay_unit,
            ss.message_template_id,
            COUNT(DISTINCT sl.enrollment_id) AS reached
     FROM sequence_steps ss
     JOIN sequences s ON s.id = ss.sequence_id AND s.user_id = $2
     LEFT JOIN sequence_logs sl ON sl.step_id = ss.id
     WHERE ss.sequence_id = $1
     GROUP BY ss.id, ss.step_order, ss.delay_value, ss.delay_unit, ss.message_template_id
     ORDER BY ss.step_order ASC`,
    [sequenceId, userId]
  );
  return result.rows;
}

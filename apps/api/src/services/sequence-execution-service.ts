import { pool } from "../db/pool.js";
import { classifyDeliveryFailure } from "./message-delivery-data-service.js";
import { getContactByPhoneForUser, markContactTemplateOutboundActivity } from "./contacts-service.js";
import { evaluateOutboundTemplatePolicy, summarizeOutboundPolicyReasons } from "./outbound-policy-service.js";
import { queueSequenceOutboundMessage } from "./outbound-message-service.js";
import { evaluateSequenceConditions } from "./sequence-condition-service.js";
import { appendSequenceLog } from "./sequence-log-service.js";
import {
  clearSequenceEnrollmentQueueState,
  getSequenceEnrollment,
  getSequenceEnrollmentForExecution,
  listDueSequenceEnrollmentIds,
  updateSequenceEnrollment,
  type SequenceDelayUnit
} from "./sequence-service.js";
import {
  enqueueSequenceEnrollment,
  resolveSequenceEnrollmentQueueKind,
  type SequenceEnrollmentQueueKind
} from "./sequence-queue-service.js";
import { dispatchTemplateMessage, getMessageTemplate } from "./template-service.js";

const MAX_MESSAGES_PER_CONTACT_PER_DAY = 20;
const MIN_LOOP_GUARD_MS = 10_000;
const RETRY_DELAYS_MS = [5 * 60_000];

function normalizePlaceholderKey(raw: string): string {
  const inner = raw.replace(/^\{\{\s*|\s*\}\}$/g, "").trim();
  return `{{${inner}}}`;
}

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

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

async function passesSafetyChecks(userId: string, phoneNumber: string): Promise<string | null> {
  const [lastSentResult, dailyCountResult] = await Promise.all([
    pool.query<{ created_at: string }>(
      `SELECT cm.created_at
       FROM conversation_messages cm
       JOIN conversations c ON c.id = cm.conversation_id
       WHERE c.user_id = $1
         AND c.phone_number = $2
         AND cm.direction = 'outbound'
       ORDER BY cm.created_at DESC
       LIMIT 1`,
      [userId, phoneNumber]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM conversation_messages cm
       JOIN conversations c ON c.id = cm.conversation_id
       WHERE c.user_id = $1
         AND c.phone_number = $2
         AND cm.direction = 'outbound'
         AND cm.created_at >= NOW() - INTERVAL '1 day'`,
      [userId, phoneNumber]
    )
  ]);

  const lastSentAt = lastSentResult.rows[0]?.created_at;
  if (lastSentAt && Date.now() - Date.parse(lastSentAt) < MIN_LOOP_GUARD_MS) {
    return "Loop guard prevented a send within 10 seconds of the previous outbound message.";
  }
  if (Number(dailyCountResult.rows[0]?.count ?? 0) >= MAX_MESSAGES_PER_CONTACT_PER_DAY) {
    return "Daily outbound message cap reached for this contact.";
  }
  return null;
}

function resolveSequenceContactFieldValue(
  contact: {
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
  },
  field: string | undefined
): string | null {
  const normalized = field?.trim() ?? "";
  if (!normalized) {
    return null;
  }

  switch (normalized) {
    case "display_name":
      return trimToNull(contact.display_name);
    case "phone_number":
      return trimToNull(contact.phone_number);
    case "email":
      return trimToNull(contact.email);
    case "contact_type":
      return trimToNull(contact.contact_type);
    case "tags":
      return trimToNull(contact.tags.join(", "));
    case "source_type":
      return trimToNull(contact.source_type);
    case "source_id":
      return trimToNull(contact.source_id);
    case "source_url":
      return trimToNull(contact.source_url);
    case "created_at":
      return trimToNull(contact.created_at);
    case "updated_at":
      return trimToNull(contact.updated_at);
    default:
      break;
  }

  if (!normalized.startsWith("custom:")) {
    return null;
  }

  const customFieldName = normalized.slice("custom:".length).trim();
  if (!customFieldName) {
    return null;
  }

  const directMatch = contact.custom_fields[customFieldName] ?? contact.custom_fields[customFieldName.toLowerCase()] ?? null;
  if (directMatch != null) {
    return trimToNull(directMatch);
  }

  const fallbackMatch = Object.entries(contact.custom_fields).find(
    ([fieldName]) => fieldName.toLowerCase() === customFieldName.toLowerCase()
  );
  return trimToNull(fallbackMatch?.[1] ?? null);
}

function resolveSequenceStepVariables(
  contact: {
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
  },
  step: {
    template_variables_json?: Record<string, { source: "contact" | "static"; field?: string; value?: string; fallback?: string }>;
    media_overrides_json?: Record<string, string>;
  }
): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const [rawKey, binding] of Object.entries(step.template_variables_json ?? {})) {
    const key = normalizePlaceholderKey(rawKey);
    if (!binding) {
      continue;
    }

    let value: string | null = null;
    if (binding.source === "static") {
      value = trimToNull(binding.value);
    } else if (binding.source === "contact") {
      value = resolveSequenceContactFieldValue(contact, binding.field);
    }

    value = value ?? trimToNull(binding.fallback);
    if (value) {
      resolved[key] = value;
    }
  }

  return {
    ...resolved,
    ...(step.media_overrides_json ?? {})
  };
}

export async function processSequenceEnrollment(enrollmentId: string): Promise<void> {
  await processSequenceEnrollmentInternal(enrollmentId);
}

interface SequenceProcessingOutcome {
  shouldSchedule: boolean;
  queueKind: SequenceEnrollmentQueueKind | null;
}

async function processSequenceEnrollmentInternal(
  enrollmentId: string
): Promise<SequenceProcessingOutcome> {
  const context = await getSequenceEnrollmentForExecution(enrollmentId);
  if (!context) {
    return { shouldSchedule: false, queueKind: null };
  }

  const { enrollment, sequence, steps, conditions, contact } = context;
  if (sequence.status !== "published") {
    return { shouldSchedule: false, queueKind: null };
  }

  // Only evaluate stop conditions after at least one step has been executed.
  // On first run last_executed_at is null, so skipping avoids stopping contacts
  // before they have received any message.
  if (enrollment.last_executed_at) {
    const stopConditions =
      enrollment.last_delivery_status === "failed"
        ? conditions.filter((condition) => condition.condition_type === "stop_failure")
        : conditions.filter((condition) => condition.condition_type === "stop_success");

    if (stopConditions.length > 0 && evaluateSequenceConditions(stopConditions, contact)) {
      await updateSequenceEnrollment(enrollment.id, {
        status: "stopped",
        lastExecutedAt: new Date().toISOString()
      });
      await appendSequenceLog({
        enrollmentId: enrollment.id,
        sequenceId: sequence.id,
        status: "stopped",
        meta: { reason: "stop_condition_matched" }
      });
      return { shouldSchedule: false, queueKind: null };
    }
  }

  const now = new Date();
  const dayAllowed = sequence.allowed_days_json.length === 0 || sequence.allowed_days_json.includes(weekdayKey(now));
  const inWindow = sequence.time_mode !== "window" || isWithinWindow(now, sequence.time_window_start, sequence.time_window_end);
  if (!dayAllowed || !inWindow) {
    await updateSequenceEnrollment(enrollment.id, {
      nextRunAt: nextWindowTime(now, sequence.allowed_days_json, sequence.time_window_start).toISOString()
    });
    return { shouldSchedule: true, queueKind: "run" };
  }

  const step = steps[enrollment.current_step];
  if (!step) {
    await updateSequenceEnrollment(enrollment.id, {
      status: "completed",
      lastExecutedAt: now.toISOString()
    });
    return { shouldSchedule: false, queueKind: null };
  }

  if (
    sequence.require_previous_delivery &&
    enrollment.current_step > 0 &&
    enrollment.last_delivery_status !== "delivered" &&
    enrollment.last_delivery_status !== "read"
  ) {
    await updateSequenceEnrollment(enrollment.id, {
      nextRunAt: new Date(Date.now() + 60_000).toISOString()
    });
    return { shouldSchedule: true, queueKind: "run" };
  }

  const safetyError = await passesSafetyChecks(contact.user_id, contact.phone_number);
  if (safetyError) {
    await updateSequenceEnrollment(enrollment.id, {
      nextRunAt: new Date(Date.now() + 60_000).toISOString()
    });
    await appendSequenceLog({
      enrollmentId: enrollment.id,
      sequenceId: sequence.id,
      stepId: step.id,
      status: "skipped",
      errorMessage: safetyError
    });
    return { shouldSchedule: true, queueKind: "run" };
  }

  await updateSequenceEnrollment(enrollment.id, {
    status: "sending",
    lastExecutedAt: now.toISOString()
  });
  await queueSequenceOutboundMessage({
    userId: contact.user_id,
    enrollmentId: enrollment.id,
    stepIndex: enrollment.current_step,
    groupingKey: `sequence:${contact.phone_number.replace(/\D/g, "")}`
  });
  return { shouldSchedule: false, queueKind: null };
}

export async function processDueSequenceEnrollments(batchSize = 20): Promise<number> {
  const ids = await listDueSequenceEnrollmentIds(batchSize);
  for (const id of ids) {
    await processSequenceEnrollment(id);
  }
  return ids.length;
}

export async function processSequenceEnrollmentAndScheduleNext(
  enrollmentId: string
): Promise<SequenceProcessingOutcome> {
  const outcome = await processSequenceEnrollmentInternal(enrollmentId);
  if (!outcome.shouldSchedule || !outcome.queueKind) {
    await clearSequenceEnrollmentQueueState(enrollmentId);
    return outcome;
  }

  const refreshed = await getSequenceEnrollment(enrollmentId);
  if (!refreshed || refreshed.status !== "active" || !refreshed.next_run_at) {
    await clearSequenceEnrollmentQueueState(enrollmentId);
    return { shouldSchedule: false, queueKind: null };
  }

  const queueKind = outcome.queueKind ?? resolveSequenceEnrollmentQueueKind(refreshed);
  await enqueueSequenceEnrollment({
    enrollmentId: refreshed.id,
    nextRunAt: refreshed.next_run_at,
    kind: queueKind
  });
  return { shouldSchedule: true, queueKind };
}

export async function executeSequenceOutboundMessage(input: {
  enrollmentId: string;
  stepIndex: number;
}): Promise<{
  status: "sent" | "retrying" | "failed" | "noop";
  errorMessage?: string | null;
}> {
  const context = await getSequenceEnrollmentForExecution(input.enrollmentId);
  if (!context) {
    return { status: "noop" };
  }

  const { enrollment, sequence, steps, contact } = context;
  if (enrollment.current_step !== input.stepIndex) {
    return { status: "noop" };
  }

  const now = new Date();
  const step = steps[enrollment.current_step];
  if (!step) {
    await updateSequenceEnrollment(enrollment.id, {
      status: "completed",
      lastExecutedAt: now.toISOString()
    });
    return { status: "noop" };
  }

  try {
    const template = await getMessageTemplate(contact.user_id, step.message_template_id);
    const policy = await evaluateOutboundTemplatePolicy({
      userId: contact.user_id,
      phoneNumber: contact.phone_number,
      category: template.category,
      contact: await getContactByPhoneForUser(contact.user_id, contact.phone_number),
      marketingEnabled: true
    });
    if (!policy.allowed) {
      const policyMessage = summarizeOutboundPolicyReasons(policy.reasonCodes).join(" ");
      await updateSequenceEnrollment(enrollment.id, {
        status: "failed",
        lastExecutedAt: now.toISOString(),
        lastDeliveryStatus: "failed"
      });
      await appendSequenceLog({
        enrollmentId: enrollment.id,
        sequenceId: sequence.id,
        stepId: step.id,
        status: "failed",
        errorMessage: policyMessage
      });
      await clearSequenceEnrollmentQueueState(enrollment.id);
      return { status: "failed", errorMessage: policyMessage };
    }

    const variableValues = resolveSequenceStepVariables(contact, step);
    const sent = await dispatchTemplateMessage(contact.user_id, {
      templateId: step.message_template_id,
      to: contact.phone_number,
      variableValues
    });
    await markContactTemplateOutboundActivity(contact.user_id, contact.phone_number, template.category);

    const nextStepIndex = enrollment.current_step + 1;
    const nextStep = steps[nextStepIndex];
    const nextRunAt = nextStep ? addDelay(now, nextStep.delay_value, nextStep.delay_unit).toISOString() : now.toISOString();
    await updateSequenceEnrollment(enrollment.id, {
      currentStep: nextStepIndex,
      lastExecutedAt: now.toISOString(),
      lastMessageId: sent.messageId,
      lastDeliveryStatus: "sent",
      retryCount: 0,
      retryStartedAt: null,
      status: nextStep ? "active" : "completed",
      nextRunAt
    });
    await appendSequenceLog({
      enrollmentId: enrollment.id,
      sequenceId: sequence.id,
      stepId: step.id,
      status: "sent",
      responseId: sent.messageId,
      meta: { templateName: sent.template.name, nextStep: nextStepIndex }
    });

    if (nextStep) {
      await enqueueSequenceEnrollment({
        enrollmentId: enrollment.id,
        nextRunAt,
        kind: "run"
      });
    } else {
      await clearSequenceEnrollmentQueueState(enrollment.id);
    }
    return { status: "sent" };
  } catch (error) {
    const classification = classifyDeliveryFailure(error);
    const firstRetryStartedAt = enrollment.retry_started_at ? new Date(enrollment.retry_started_at) : now;
    const elapsedMs = now.getTime() - firstRetryStartedAt.getTime();
    const retryWindowMs = sequence.retry_window_hours * 60 * 60_000;
    const canRetry =
      sequence.retry_enabled &&
      classification.category === "transient" &&
      classification.retryable &&
      enrollment.retry_count < RETRY_DELAYS_MS.length &&
      elapsedMs <= retryWindowMs;

    if (canRetry) {
      const nextRetryAt = new Date(Date.now() + RETRY_DELAYS_MS[enrollment.retry_count]).toISOString();
      await updateSequenceEnrollment(enrollment.id, {
        status: "active",
        nextRunAt: nextRetryAt,
        lastExecutedAt: now.toISOString(),
        retryCount: enrollment.retry_count + 1,
        retryStartedAt: enrollment.retry_started_at ?? now.toISOString(),
        lastDeliveryStatus: "failed"
      });
      await appendSequenceLog({
        enrollmentId: enrollment.id,
        sequenceId: sequence.id,
        stepId: step.id,
        status: "retrying",
        errorMessage: classification.errorMessage,
        meta: { retryCount: enrollment.retry_count + 1 }
      });
      await enqueueSequenceEnrollment({
        enrollmentId: enrollment.id,
        nextRunAt: nextRetryAt,
        kind: "retry"
      });
      return {
        status: "retrying",
        errorMessage: classification.errorMessage
      };
    }

    await updateSequenceEnrollment(enrollment.id, {
      status: "failed",
      lastExecutedAt: now.toISOString(),
      lastDeliveryStatus: "failed"
    });
    await appendSequenceLog({
      enrollmentId: enrollment.id,
      sequenceId: sequence.id,
      stepId: step.id,
      status: "failed",
      errorMessage: classification.errorMessage
    });
    await clearSequenceEnrollmentQueueState(enrollment.id);
    return {
      status: "failed",
      errorMessage: classification.errorMessage
    };
  }
}

import { pool } from "../db/pool.js";
import { getOrCreateConversation, trackOutboundMessage } from "./conversation-service.js";
import { classifyDeliveryFailure } from "./message-delivery-data-service.js";
import { realtimeHub } from "./realtime-hub.js";
import { evaluateSequenceConditions } from "./sequence-condition-service.js";
import { appendSequenceLog } from "./sequence-log-service.js";
import {
  getSequenceEnrollmentForExecution,
  listDueSequenceEnrollmentIds,
  updateSequenceEnrollment,
  type SequenceDelayUnit
} from "./sequence-service.js";
import { dispatchTemplateMessage } from "./template-service.js";

const MAX_MESSAGES_PER_CONTACT_PER_DAY = 20;
const MIN_LOOP_GUARD_MS = 10_000;
const RETRY_DELAYS_MS = [0, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

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

async function processEnrollment(enrollmentId: string): Promise<void> {
  const context = await getSequenceEnrollmentForExecution(enrollmentId);
  if (!context) return;

  const { enrollment, sequence, steps, conditions, contact } = context;
  if (sequence.status !== "published") return;

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
    return;
  }

  const now = new Date();
  const dayAllowed = sequence.allowed_days_json.length === 0 || sequence.allowed_days_json.includes(weekdayKey(now));
  const inWindow = sequence.time_mode !== "window" || isWithinWindow(now, sequence.time_window_start, sequence.time_window_end);
  if (!dayAllowed || !inWindow) {
    await updateSequenceEnrollment(enrollment.id, {
      nextRunAt: nextWindowTime(now, sequence.allowed_days_json, sequence.time_window_start).toISOString()
    });
    return;
  }

  const step = steps[enrollment.current_step];
  if (!step) {
    await updateSequenceEnrollment(enrollment.id, {
      status: "completed",
      lastExecutedAt: now.toISOString()
    });
    return;
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
    return;
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
    return;
  }

  try {
    const sent = await dispatchTemplateMessage(contact.user_id, {
      templateId: step.message_template_id,
      to: contact.phone_number,
      variableValues: {
        "{{1}}": contact.display_name ?? contact.phone_number
      }
    });

    const conversation = await getOrCreateConversation(contact.user_id, contact.phone_number, {
      channelType: "api",
      channelLinkedNumber: sent.connection.linkedNumber
    });
    await trackOutboundMessage(
      conversation.id,
      sent.summaryText,
      { senderName: "Sequence Engine" },
      sent.messagePayload.headerMediaUrl ?? null,
      sent.messagePayload,
      sent.messageId ?? null
    );
    realtimeHub.broadcast(contact.user_id, "conversation.updated", {
      conversationId: conversation.id,
      phoneNumber: contact.phone_number,
      direction: "outbound",
      message: sent.summaryText,
      score: conversation.score,
      stage: conversation.stage
    });

    const nextStepIndex = enrollment.current_step + 1;
    const nextStep = steps[nextStepIndex];
    await updateSequenceEnrollment(enrollment.id, {
      currentStep: nextStepIndex,
      lastExecutedAt: now.toISOString(),
      lastMessageId: sent.messageId,
      lastDeliveryStatus: "sent",
      retryCount: 0,
      retryStartedAt: null,
      status: nextStep ? "active" : "completed",
      nextRunAt: nextStep ? addDelay(now, nextStep.delay_value, nextStep.delay_unit).toISOString() : now.toISOString()
    });
    await appendSequenceLog({
      enrollmentId: enrollment.id,
      sequenceId: sequence.id,
      stepId: step.id,
      status: "sent",
      responseId: sent.messageId,
      meta: { templateName: sent.template.name, nextStep: nextStepIndex }
    });
  } catch (error) {
    const classification = classifyDeliveryFailure(error);
    const firstRetryStartedAt = enrollment.retry_started_at ? new Date(enrollment.retry_started_at) : now;
    const elapsedMs = now.getTime() - firstRetryStartedAt.getTime();
    const retryWindowMs = sequence.retry_window_hours * 60 * 60_000;
    const canRetry =
      sequence.retry_enabled &&
      classification.retryable &&
      enrollment.retry_count < RETRY_DELAYS_MS.length &&
      elapsedMs <= retryWindowMs;

    if (canRetry) {
      const nextRetryAt = new Date(Date.now() + RETRY_DELAYS_MS[enrollment.retry_count]);
      await updateSequenceEnrollment(enrollment.id, {
        nextRunAt: nextRetryAt.toISOString(),
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
      return;
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
  }
}

export async function processDueSequenceEnrollments(batchSize = 20): Promise<number> {
  const ids = await listDueSequenceEnrollmentIds(batchSize);
  for (const id of ids) {
    await processEnrollment(id);
  }
  return ids.length;
}

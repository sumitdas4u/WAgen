import { Worker } from "bullmq";
import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { createQueueWorkerConnection, getReminderDispatchQueue } from "./queue-service.js";
import { expireStaleCaptureSessions } from "./reminder-capture-session-service.js";
import { getOrCreateConversation } from "./conversation-service.js";
import { sendConversationFlowMessage } from "./channel-outbound-service.js";
import { evaluateSequenceConditions, type SequenceCondition, type SequenceContactSnapshot } from "./sequence-condition-service.js";

interface ReminderDispatchJob {
  userId: string;
  force?: boolean;
  runAt?: string;
}

interface ReminderConfigRow {
  id: string;
  user_id: string;
  config_key: string;
  campaign_enabled: boolean;
  campaign_conditions_json: unknown[];
  campaign_send_time: string;
  campaign_timezone: string;
  dispatch_mode: "annual" | "exact_date";
}

interface ReminderStepRow {
  id: string;
  config_id: string;
  step_order: number;
  days_before: number;
  template_name: string;
  template_lang: string;
  template_vars: Record<string, { source: "contact" | "static"; field?: string; value?: string }>;
}

interface ContactDateMatch {
  contact_id: string;
  phone_number: string;
  display_name: string | null;
  email: string | null;
  contact_type: string;
  tags: string[];
  source_type: string;
  source_id: string | null;
  source_url: string | null;
  created_at: string;
  updated_at: string;
  custom_fields: Record<string, string | null>;
}

type ReminderConditionRow = {
  field?: string;
  operator?: string;
  value?: string;
  id?: string;
  sequence_id?: string;
  condition_type?: string;
  created_at?: string;
  updated_at?: string;
};

function normalizeTime(value: string | null | undefined): string {
  const match = String(value ?? "").trim().match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "09:00";
}

function normalizeTimeZone(timeZone: string | null | undefined): string {
  const candidate = String(timeZone ?? "").trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "UTC";
  }
}

function getZonedParts(date: Date, timeZone: string): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeTimeZone(timeZone),
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute")
  };
}

function getZonedIsoDate(date: Date, timeZone: string): string {
  const parts = getZonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getZonedTime(date: Date, timeZone: string): string {
  const parts = getZonedParts(date, timeZone);
  return `${parts.hour}:${parts.minute}`;
}

function addDaysToIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function shouldProcessReminderConfig(
  config: Pick<ReminderConfigRow, "campaign_send_time" | "campaign_timezone">,
  now: Date,
  force = false
): boolean {
  if (force) {
    return true;
  }
  return getZonedTime(now, config.campaign_timezone) === normalizeTime(config.campaign_send_time);
}

function normalizeConditions(rawConditions: unknown[]): SequenceCondition[] {
  return (Array.isArray(rawConditions) ? rawConditions : [])
    .filter((condition): condition is ReminderConditionRow => Boolean(condition) && typeof condition === "object")
    .map((condition) => ({
      id: condition.id ?? "",
      sequence_id: condition.sequence_id ?? "",
      condition_type: (condition.condition_type ?? "start") as "start",
      field: condition.field ?? "",
      operator: (condition.operator ?? "eq") as SequenceCondition["operator"],
      value: condition.value ?? "",
      created_at: condition.created_at ?? new Date().toISOString(),
      updated_at: condition.updated_at ?? new Date().toISOString()
    }))
    .filter((condition) => Boolean(condition.field));
}

function contactToSnapshot(contact: ContactDateMatch): SequenceContactSnapshot {
  return {
    id: contact.contact_id,
    display_name: contact.display_name,
    phone_number: contact.phone_number,
    email: contact.email,
    contact_type: contact.contact_type,
    tags: contact.tags ?? [],
    source_type: contact.source_type,
    source_id: contact.source_id,
    source_url: contact.source_url,
    created_at: contact.created_at,
    updated_at: contact.updated_at,
    custom_fields: contact.custom_fields ?? {}
  };
}

function matchesCampaignConditions(config: ReminderConfigRow, contact: ContactDateMatch): boolean {
  return evaluateSequenceConditions(
    normalizeConditions(config.campaign_conditions_json),
    contactToSnapshot(contact)
  );
}

function resolveTemplateVars(
  contact: ContactDateMatch,
  varMapping: ReminderStepRow["template_vars"]
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [placeholder, binding] of Object.entries(varMapping)) {
    if (binding.source === "static") {
      resolved[placeholder] = binding.value ?? "";
    } else if (binding.source === "contact" && binding.field) {
      const builtins: Record<string, string> = {
        display_name: contact.display_name ?? "",
        name: contact.display_name ?? "",
        phone_number: contact.phone_number,
        phone: contact.phone_number,
        email: contact.email ?? "",
        contact_type: contact.contact_type ?? "",
        source_type: contact.source_type ?? ""
      };
      resolved[placeholder] = builtins[binding.field] ?? contact.custom_fields[binding.field] ?? "";
    }
  }
  return resolved;
}

export async function processUserReminders(
  userId: string,
  options: { now?: Date; force?: boolean } = {}
): Promise<void> {
  const configResult = await pool.query<ReminderConfigRow>(
    `SELECT * FROM reminder_configs
     WHERE user_id = $1 AND enabled = true AND campaign_enabled = true`,
    [userId]
  );

  const now = options.now ?? new Date();

  for (const config of configResult.rows) {
    if (!shouldProcessReminderConfig(config, now, options.force ?? false)) {
      continue;
    }

    const stepsResult = await pool.query<ReminderStepRow>(
      `SELECT * FROM reminder_campaign_steps WHERE config_id = $1 ORDER BY step_order ASC`,
      [config.id]
    );
    if (stepsResult.rows.length === 0) continue;

    const fieldResult = await pool.query<{ id: string }>(
      `SELECT id FROM contact_fields WHERE user_id = $1 AND name = $2 LIMIT 1`,
      [userId, config.config_key]
    );
    const fieldId = fieldResult.rows[0]?.id;
    if (!fieldId) continue;

    const isAnnual = config.dispatch_mode === "annual";

    for (const step of stepsResult.rows) {
      try {
        const localToday = getZonedIsoDate(now, config.campaign_timezone);
        const targetDateStr = addDaysToIsoDate(localToday, step.days_before);
        const [targetYear, targetMonth, targetDay] = targetDateStr.split("-").map((part) => Number(part));

        const contactsResult = isAnnual
          ? await pool.query<ContactDateMatch>(
              `SELECT
                 c.id AS contact_id,
                 c.phone_number,
                 c.display_name,
                 c.email,
                 c.contact_type,
                 COALESCE(c.tags, ARRAY[]::text[]) AS tags,
                 c.source_type,
                 c.source_id,
                 c.source_url,
                 c.created_at,
                 c.updated_at,
                 (
                   SELECT jsonb_object_agg(cf2.name, cfv2.value)
                   FROM contact_field_values cfv2
                   JOIN contact_fields cf2 ON cf2.id = cfv2.field_id
                   WHERE cfv2.contact_id = c.id
                 ) AS custom_fields
               FROM contacts c
               JOIN contact_field_values cfv ON cfv.contact_id = c.id
               WHERE c.user_id = $1
                 AND cfv.field_id = $2
                 AND cfv.value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                 AND EXTRACT(MONTH FROM cfv.value::date) = $3
                 AND EXTRACT(DAY   FROM cfv.value::date) = $4
                 AND c.id NOT IN (
                   SELECT contact_id FROM reminder_dispatch_log
                   WHERE user_id = $1 AND step_id = $5 AND campaign_year = $6
                 )`,
              [userId, fieldId, targetMonth, targetDay, step.id, targetYear]
            )
          : await pool.query<ContactDateMatch>(
              `SELECT
                 c.id AS contact_id,
                 c.phone_number,
                 c.display_name,
                 c.email,
                 c.contact_type,
                 COALESCE(c.tags, ARRAY[]::text[]) AS tags,
                 c.source_type,
                 c.source_id,
                 c.source_url,
                 c.created_at,
                 c.updated_at,
                 (
                   SELECT jsonb_object_agg(cf2.name, cfv2.value)
                   FROM contact_field_values cfv2
                   JOIN contact_fields cf2 ON cf2.id = cfv2.field_id
                   WHERE cfv2.contact_id = c.id
                 ) AS custom_fields
               FROM contacts c
               JOIN contact_field_values cfv ON cfv.contact_id = c.id
               WHERE c.user_id = $1
                 AND cfv.field_id = $2
                 AND cfv.value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                 AND cfv.value::date = $3
                 AND c.id NOT IN (
                   SELECT contact_id FROM reminder_dispatch_log
                   WHERE user_id = $1 AND step_id = $4 AND dispatched_date = $3
                 )`,
              [userId, fieldId, targetDateStr, step.id]
            );

        for (const contact of contactsResult.rows) {
          try {
            if (!matchesCampaignConditions(config, {
              ...contact,
              custom_fields: (contact.custom_fields as Record<string, string | null>) ?? {}
            })) {
              continue;
            }

            const resolvedVars = resolveTemplateVars(
              { ...contact, custom_fields: (contact.custom_fields as Record<string, string | null>) ?? {} },
              step.template_vars
            );

            const conversation = await getOrCreateConversation(userId, contact.phone_number, {
              channelType: "api"
            });

            await sendConversationFlowMessage({
              userId,
              conversationId: conversation.id,
              payload: {
                type: "template",
                templateName: step.template_name,
                language: step.template_lang,
                variableValues: resolvedVars
              }
            });

            if (isAnnual) {
              await pool.query(
                `INSERT INTO reminder_dispatch_log
                 (user_id, contact_id, config_key, step_id, campaign_year, template_name, status)
                 VALUES ($1, $2, $3, $4, $5, $6, 'sent')
                 ON CONFLICT DO NOTHING`,
                [userId, contact.contact_id, config.config_key, step.id, targetYear, step.template_name]
              );
            } else {
              await pool.query(
                `INSERT INTO reminder_dispatch_log
                   (user_id, contact_id, config_key, step_id, dispatched_date, template_name, status)
                 VALUES ($1, $2, $3, $4, $5, $6, 'sent')
                 ON CONFLICT DO NOTHING`,
                [userId, contact.contact_id, config.config_key, step.id, targetDateStr, step.template_name]
              );
            }

            console.log(`[ReminderDispatch] Sent step ${step.step_order} of ${config.config_key} to ${contact.phone_number}`);
          } catch (err) {
            console.error(`[ReminderDispatch] Step ${step.id} failed for contact ${contact.contact_id}`, err);
          }
        }
      } catch (err) {
        console.error(`[ReminderDispatch] Step ${step.step_order} of config ${config.config_key} failed`, err);
      }
    }
  }

  await expireStaleCaptureSessions();
}

async function enqueueAllUserReminders(): Promise<void> {
  const queue = getReminderDispatchQueue();
  if (!queue) {
    console.warn("[ReminderDispatch] Queue unavailable — Redis not configured");
    return;
  }

  const runAt = new Date();
  const bucket = runAt.toISOString().slice(0, 16).replace(/:/g, "-");

  const { rows } = await pool.query<{ id: string }>(
    `SELECT DISTINCT user_id AS id
     FROM reminder_configs
     WHERE enabled = true AND campaign_enabled = true`
  );

  for (const user of rows) {
    const jobId = `reminder-dispatch-${user.id}-${bucket}`;
    await queue.add(
      "dispatch-reminders",
      { userId: user.id, runAt: runAt.toISOString() },
      {
        jobId,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 500,
        removeOnFail: 1000
      }
    );
  }

  console.log(`[ReminderDispatch] Enqueued ${rows.length} reminder job(s) for ${bucket}`);
}

function scheduleDispatchPoll(): void {
  const now = new Date();
  const next = new Date(now);
  next.setUTCSeconds(5, 0);
  if (next <= now) {
    next.setUTCMinutes(next.getUTCMinutes() + 1);
  }
  const msUntilNext = next.getTime() - now.getTime();

  cronTimer = setTimeout(async () => {
    try {
      await enqueueAllUserReminders();
    } catch (err) {
      console.error("[ReminderDispatch] Cron enqueue error", err);
    }
    scheduleDispatchPoll();
  }, msUntilNext);

  console.log(`[ReminderDispatch] Next poll in ${Math.round(msUntilNext / 1000)} seconds`);
}

let dispatchWorker: Worker<ReminderDispatchJob> | null = null;
let cronTimer: ReturnType<typeof setTimeout> | null = null;

export function startReminderDispatchWorker(): void {
  const connection = createQueueWorkerConnection();
  if (!connection) {
    console.warn("[ReminderDispatch] Worker not started — Redis not configured");
    return;
  }

  dispatchWorker = new Worker<ReminderDispatchJob>(
    "reminder-dispatch",
    async (job) => {
      const { userId, force, runAt } = job.data;
      await processUserReminders(userId, {
        force: force ?? false,
        now: runAt ? new Date(runAt) : undefined
      });
    },
    {
      connection,
      prefix: env.QUEUE_PREFIX?.trim() || undefined,
      concurrency: 3
    }
  );

  dispatchWorker.on("completed", (job) =>
    console.log(`[ReminderDispatch] Job completed: ${job.id}`)
  );
  dispatchWorker.on("failed", (job, err) =>
    console.error(`[ReminderDispatch] Job failed: ${job?.id}`, err)
  );

  scheduleDispatchPoll();
}

export async function stopReminderDispatchWorker(): Promise<void> {
  if (cronTimer) {
    clearTimeout(cronTimer);
    cronTimer = null;
  }
  if (dispatchWorker) {
    await dispatchWorker.close();
    dispatchWorker = null;
  }
}

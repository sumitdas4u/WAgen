import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  listReminderConfigs,
  upsertReminderConfig,
  deleteReminderConfig,
  listReminderCampaignSteps,
  replaceReminderCampaignSteps
} from "../services/reminder-config-service.js";
import { getUserPlanEntitlements } from "../services/billing-service.js";

const TemplateVarBindingSchema = z.object({
  source: z.enum(["contact", "static"]),
  field: z.string().optional(),
  value: z.string().optional()
});

const ReminderStepSchema = z.object({
  stepOrder: z.number().int().min(0),
  daysBefore: z.number().int().min(0).max(365),
  templateName: z.string().trim().min(1).max(100),
  templateLang: z.string().trim().max(10).default("en"),
  templateVars: z.record(z.string(), TemplateVarBindingSchema).optional().default({})
});

const ReminderConfigWriteSchema = z.object({
  reminderType: z.enum(["birthday", "anniversary", "custom"]),
  customLabel: z.string().trim().max(100).optional().nullable(),
  enabled: z.boolean().optional(),
  captureEnabled: z.boolean().optional(),
  captureTemplateName: z.string().trim().max(100).optional().nullable(),
  captureTemplateLang: z.string().trim().max(10).optional(),
  captureTemplateVars: z.record(z.string(), TemplateVarBindingSchema).optional(),
  captureFlowId: z.string().uuid().optional().nullable(),
  captureTriggerType: z.enum(["create", "update", "both"]).optional(),
  captureConditionsJson: z.array(z.object({
    field: z.string(),
    operator: z.enum(["eq", "neq", "gt", "lt", "contains"]),
    value: z.string()
  })).optional(),
  retryIntervalDays: z.number().int().min(1).max(365).optional(),
  retryMaxCount: z.number().int().min(0).max(5).optional(),
  cooldownDays: z.number().int().min(1).max(365).optional(),
  campaignEnabled: z.boolean().optional(),
  campaignConditionsJson: z.array(z.object({
    field: z.string(),
    operator: z.enum(["eq", "neq", "gt", "lt", "contains"]),
    value: z.string()
  })).optional(),
  campaignSendTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/).optional(),
  campaignTimezone: z.string().trim().max(60).optional(),
  dispatchMode: z.enum(["annual", "exact_date"]).optional(),
  steps: z.array(ReminderStepSchema).optional()
});

async function requireRemindersEntitlement(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const entitlements = await getUserPlanEntitlements(request.authUser.userId);
  if (!entitlements.modules.reminders) {
    await reply.status(403).send({ error: "Reminders module requires Pro plan or higher" });
  }
}

export async function reminderRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/reminder/configs",
    { preHandler: [fastify.requireAuth, requireRemindersEntitlement] },
    async (request) => {
      const configs = await listReminderConfigs(request.authUser.userId);
      return { configs };
    }
  );

  fastify.put(
    "/api/reminder/configs/:configKey",
    { preHandler: [fastify.requireAuth, requireRemindersEntitlement] },
    async (request, reply) => {
      const { configKey } = request.params as { configKey: string };
      const parsed = ReminderConfigWriteSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid reminder config payload" });
      }

      try {
        const { steps, ...configInput } = parsed.data;
        const config = await upsertReminderConfig(request.authUser.userId, {
          configKey,
          ...configInput
        });

        let savedSteps = await listReminderCampaignSteps(config.id);
        if (steps !== undefined) {
          savedSteps = await replaceReminderCampaignSteps(config.id, steps);
        }

        return { config, steps: savedSteps };
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }
    }
  );

  fastify.get(
    "/api/reminder/configs/:configKey/steps",
    { preHandler: [fastify.requireAuth, requireRemindersEntitlement] },
    async (request, reply) => {
      const { configKey } = request.params as { configKey: string };
      const { rows } = await (await import("../db/pool.js")).pool.query<{ id: string }>(
        `SELECT id FROM reminder_configs WHERE user_id = $1 AND config_key = $2 LIMIT 1`,
        [request.authUser.userId, configKey]
      );
      if (!rows[0]) return reply.status(404).send({ error: "Config not found" });
      const steps = await listReminderCampaignSteps(rows[0].id);
      return { steps };
    }
  );

  fastify.delete(
    "/api/reminder/configs/:configKey",
    { preHandler: [fastify.requireAuth, requireRemindersEntitlement] },
    async (request, reply) => {
      const { configKey } = request.params as { configKey: string };
      const deleted = await deleteReminderConfig(request.authUser.userId, configKey);
      if (!deleted) {
        return reply.status(404).send({ error: "Config not found or not a custom type" });
      }
      return { ok: true };
    }
  );

  fastify.get(
    "/api/reminder/dispatch-log",
    { preHandler: [fastify.requireAuth, requireRemindersEntitlement] },
    async (request) => {
      const query = request.query as { days?: string; configKey?: string };
      const days = Math.min(parseInt(query.days ?? "7", 10) || 7, 90);
      const { pool } = await import("../db/pool.js");

      const conditions: string[] = [
        `dl.user_id = $1`,
        `dl.sent_at >= now() - ($2 || ' days')::interval`
      ];
      const params: unknown[] = [request.authUser.userId, days];

      if (query.configKey) {
        conditions.push(`dl.config_key = $${params.length + 1}`);
        params.push(query.configKey);
      }

      const { rows } = await pool.query(
        `SELECT
           dl.id,
           dl.config_key,
           dl.template_name,
           dl.status,
           dl.sent_at,
           dl.campaign_year,
           c.display_name  AS contact_name,
           c.phone_number  AS contact_phone
         FROM reminder_dispatch_log dl
         LEFT JOIN contacts c ON c.id = dl.contact_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY dl.sent_at DESC
         LIMIT 200`,
        params
      );

      return { logs: rows };
    }
  );

  fastify.post(
    "/api/reminder/dispatch/run",
    { preHandler: [fastify.requireAuth, requireRemindersEntitlement] },
    async (request, reply) => {
      const { getReminderDispatchQueue } = await import("../services/queue-service.js");
      const queue = getReminderDispatchQueue();
      if (!queue) {
        return reply.status(503).send({ error: "Queue unavailable" });
      }
      const today = new Date().toISOString().slice(0, 10);
      const jobId = `reminder-dispatch-manual-${request.authUser.userId}-${today}-${Date.now()}`;
      await queue.add(
        "dispatch-reminders",
        { userId: request.authUser.userId, force: true },
        { jobId, attempts: 1 }
      );
      return { ok: true, jobId };
    }
  );
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createGenericWebhookWorkflow,
  deleteGenericWebhookWorkflow,
  getOrCreateGenericWebhookIntegration,
  handleIncomingGenericWebhook,
  listGenericWebhookLogs,
  listGenericWebhookWorkflows,
  rotateGenericWebhookSecret,
  updateGenericWebhookIntegration,
  updateGenericWebhookWorkflow
} from "../services/generic-webhook-service.js";

const MatchModeSchema = z.enum(["all", "any"]);
const ConditionOperatorSchema = z.enum(["is_not_empty", "is_empty", "equals", "not_equals"]);
const TagOperationSchema = z.enum(["append", "replace", "add_if_empty"]);

const ConditionSchema = z.object({
  comparator: z.string().trim().min(1).max(200),
  operator: ConditionOperatorSchema,
  value: z.string().optional()
});

const ContactFieldMappingSchema = z.object({
  contactFieldName: z.string().trim().min(1).max(100),
  payloadPath: z.string().trim().min(1).max(200)
});

const ContactActionSchema = z.object({
  tagOperation: TagOperationSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(24).optional(),
  fieldMappings: z.array(ContactFieldMappingSchema).max(32).optional()
}).optional();

const TemplateActionSchema = z.object({
  templateId: z.string().uuid(),
  recipientNamePath: z.string().trim().min(1).max(200),
  recipientPhonePath: z.string().trim().min(1).max(200),
  variableMappings: z.record(z.object({
    source: z.literal("payload"),
    path: z.string().trim().min(1).max(200)
  })),
  fallbackValues: z.record(z.string()).optional()
});

const WorkflowBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().optional(),
  matchMode: MatchModeSchema,
  conditions: z.array(ConditionSchema).max(3),
  contactAction: ContactActionSchema,
  templateAction: TemplateActionSchema
});

const WorkflowPatchSchema = WorkflowBodySchema.partial();
const IntegrationPatchSchema = z.object({
  enabled: z.boolean().optional()
});

export async function genericWebhookRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/integrations/webhooks",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const integration = await getOrCreateGenericWebhookIntegration(request.authUser.userId);
      return { integration };
    }
  );

  fastify.patch(
    "/api/integrations/webhooks",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = IntegrationPatchSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid webhook integration payload" });
      }
      const integration = await updateGenericWebhookIntegration(request.authUser.userId, parsed.data);
      return { integration };
    }
  );

  fastify.post(
    "/api/integrations/webhooks/rotate-secret",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const integration = await rotateGenericWebhookSecret(request.authUser.userId);
      return { integration };
    }
  );

  fastify.get(
    "/api/integrations/webhooks/workflows",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const workflows = await listGenericWebhookWorkflows(request.authUser.userId);
      return { workflows };
    }
  );

  fastify.post(
    "/api/integrations/webhooks/workflows",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = WorkflowBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid workflow payload" });
      }
      try {
        const workflow = await createGenericWebhookWorkflow(request.authUser.userId, parsed.data);
        return reply.status(201).send({ workflow });
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }
    }
  );

  fastify.patch(
    "/api/integrations/webhooks/workflows/:workflowId",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { workflowId } = request.params as { workflowId: string };
      const parsed = WorkflowPatchSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid workflow payload" });
      }
      try {
        const workflow = await updateGenericWebhookWorkflow(request.authUser.userId, workflowId, parsed.data);
        if (!workflow) {
          return reply.status(404).send({ error: "Workflow not found" });
        }
        return { workflow };
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }
    }
  );

  fastify.delete(
    "/api/integrations/webhooks/workflows/:workflowId",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { workflowId } = request.params as { workflowId: string };
      const deleted = await deleteGenericWebhookWorkflow(request.authUser.userId, workflowId);
      if (!deleted) {
        return reply.status(404).send({ error: "Workflow not found" });
      }
      return reply.status(204).send();
    }
  );

  fastify.get(
    "/api/integrations/webhooks/logs",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const logs = await listGenericWebhookLogs(request.authUser.userId);
      return { logs };
    }
  );

  fastify.post(
    "/api/integrations/webhooks/:webhookKey",
    async (request, reply) => {
      const { webhookKey } = request.params as { webhookKey: string };
      const query = (request.query ?? {}) as Record<string, unknown>;
      const secret =
        (typeof request.headers["x-webhook-secret"] === "string" ? request.headers["x-webhook-secret"] : null) ??
        (typeof query.secret === "string" ? query.secret : null);

      if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
        return reply.status(400).send({ error: "Webhook payload must be a JSON object." });
      }

      try {
        const result = await handleIncomingGenericWebhook({
          webhookKey,
          secretToken: secret,
          requestId: request.id,
          payload: request.body as Record<string, unknown>
        });
        return {
          ok: true,
          matchedWorkflows: result.matchedWorkflows,
          completedWorkflows: result.completedWorkflows,
          failedWorkflows: result.failedWorkflows
        };
      } catch (error) {
        const message = (error as Error).message;
        if (message.toLowerCase().includes("unauthorized") || message.toLowerCase().includes("secret")) {
          return reply.status(401).send({ error: message });
        }
        if (message.toLowerCase().includes("not found")) {
          return reply.status(404).send({ error: message });
        }
        return reply.status(400).send({ error: message });
      }
    }
  );
}

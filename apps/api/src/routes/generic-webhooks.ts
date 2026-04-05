import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createGenericWebhookIntegration,
  createGenericWebhookWorkflow,
  deleteGenericWebhookIntegration,
  deleteGenericWebhookWorkflow,
  getGenericWebhookIntegration,
  handleIncomingGenericWebhook,
  listGenericWebhookIntegrations,
  listGenericWebhookLogs,
  listGenericWebhookWorkflows,
  rotateGenericWebhookSecret,
  updateGenericWebhookIntegration,
  updateGenericWebhookWorkflow
} from "../services/generic-webhook-service.js";

const MatchModeSchema = z.enum(["all", "any"]);
const ConditionOperatorSchema = z.enum(["is_not_empty", "is_empty", "equals", "not_equals"]);
const TagOperationSchema = z.enum(["append", "replace", "add_if_empty"]);

const CreateIntegrationBodySchema = z.object({
  name: z.string().trim().min(1).max(120)
});

const IntegrationPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional()
});

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

export async function genericWebhookRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/integrations/webhooks",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const integrations = await listGenericWebhookIntegrations(request.authUser.userId);
      return { integrations };
    }
  );

  fastify.post(
    "/api/integrations/webhooks",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = CreateIntegrationBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid webhook integration payload" });
      }
      try {
        const integration = await createGenericWebhookIntegration(request.authUser.userId, parsed.data);
        return reply.status(201).send({ integration });
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }
    }
  );

  fastify.get(
    "/api/integrations/webhooks/:integrationId",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { integrationId } = request.params as { integrationId: string };
      const integration = await getGenericWebhookIntegration(request.authUser.userId, integrationId);
      if (!integration) {
        return reply.status(404).send({ error: "Webhook integration not found" });
      }
      return { integration };
    }
  );

  fastify.patch(
    "/api/integrations/webhooks/:integrationId",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { integrationId } = request.params as { integrationId: string };
      const parsed = IntegrationPatchSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid webhook integration payload" });
      }
      const integration = await updateGenericWebhookIntegration(request.authUser.userId, integrationId, parsed.data);
      if (!integration) {
        return reply.status(404).send({ error: "Webhook integration not found" });
      }
      return { integration };
    }
  );

  fastify.delete(
    "/api/integrations/webhooks/:integrationId",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { integrationId } = request.params as { integrationId: string };
      const deleted = await deleteGenericWebhookIntegration(request.authUser.userId, integrationId);
      if (!deleted) {
        return reply.status(404).send({ error: "Webhook integration not found" });
      }
      return reply.status(204).send();
    }
  );

  fastify.post(
    "/api/integrations/webhooks/:integrationId/rotate-secret",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { integrationId } = request.params as { integrationId: string };
      const integration = await rotateGenericWebhookSecret(request.authUser.userId, integrationId);
      if (!integration) {
        return reply.status(404).send({ error: "Webhook integration not found" });
      }
      return { integration };
    }
  );

  fastify.get(
    "/api/integrations/webhooks/:integrationId/workflows",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const { integrationId } = request.params as { integrationId: string };
      const workflows = await listGenericWebhookWorkflows(request.authUser.userId, integrationId);
      return { workflows };
    }
  );

  fastify.post(
    "/api/integrations/webhooks/:integrationId/workflows",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { integrationId } = request.params as { integrationId: string };
      const parsed = WorkflowBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid workflow payload" });
      }
      try {
        const workflow = await createGenericWebhookWorkflow(request.authUser.userId, integrationId, parsed.data);
        return reply.status(201).send({ workflow });
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }
    }
  );

  fastify.patch(
    "/api/integrations/webhooks/:integrationId/workflows/:workflowId",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { integrationId, workflowId } = request.params as { integrationId: string; workflowId: string };
      const parsed = WorkflowPatchSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid workflow payload" });
      }
      try {
        const workflow = await updateGenericWebhookWorkflow(request.authUser.userId, integrationId, workflowId, parsed.data);
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
    "/api/integrations/webhooks/:integrationId/workflows/:workflowId",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { integrationId, workflowId } = request.params as { integrationId: string; workflowId: string };
      const deleted = await deleteGenericWebhookWorkflow(request.authUser.userId, integrationId, workflowId);
      if (!deleted) {
        return reply.status(404).send({ error: "Workflow not found" });
      }
      return reply.status(204).send();
    }
  );

  fastify.get(
    "/api/integrations/webhooks/:integrationId/logs",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const { integrationId } = request.params as { integrationId: string };
      const logs = await listGenericWebhookLogs(request.authUser.userId, integrationId);
      return { logs };
    }
  );

  fastify.post(
    "/api/integrations/webhooks/:webhookKey/incoming",
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

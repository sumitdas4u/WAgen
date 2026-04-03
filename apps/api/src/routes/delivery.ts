import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listConversations } from "../services/conversation-service.js";
import {
  getDeliveryOverview,
  listDeliveryAlerts,
  resolveDeliveryAlert
} from "../services/message-delivery-data-service.js";
import { getDeliveryReportSummary, listDeliveryLogs } from "../services/message-delivery-report-service.js";

const DeliveryAlertsQuerySchema = z.object({
  status: z.enum(["open", "resolved"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

const DeliverySummaryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).optional(),
  channelKey: z.string().trim().optional()
});

const DeliveryLogsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).optional(),
  channelKey: z.string().trim().optional(),
  status: z.enum(["sending", "sent", "delivered", "read", "failed", "retrying"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional()
});

export async function deliveryRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/delivery/overview",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const overview = await getDeliveryOverview(request.authUser.userId);
      return { overview };
    }
  );

  fastify.get(
    "/api/delivery/summary",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = DeliverySummaryQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid delivery summary query" });
      }
      const summary = await getDeliveryReportSummary(request.authUser.userId, parsed.data);
      return { summary };
    }
  );

  fastify.get(
    "/api/delivery/notifications",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = DeliveryLogsQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid delivery notifications query" });
      }
      const result = await listDeliveryLogs(request.authUser.userId, {
        days: parsed.data.days,
        channelKey: parsed.data.channelKey,
        status: parsed.data.status,
        limit: parsed.data.limit,
        offset: parsed.data.offset
      });
      return result;
    }
  );

  fastify.get(
    "/api/delivery/failures",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = DeliveryLogsQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid delivery failures query" });
      }
      const result = await listDeliveryLogs(request.authUser.userId, {
        days: parsed.data.days,
        channelKey: parsed.data.channelKey,
        failuresOnly: true,
        limit: parsed.data.limit,
        offset: parsed.data.offset
      });
      return result;
    }
  );

  fastify.get(
    "/api/delivery/conversations",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = DeliverySummaryQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid delivery conversations query" });
      }

      const conversations = await listConversations(request.authUser.userId);
      const days = parsed.data.days ?? 7;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const filtered = conversations.filter((conversation) => {
        if (conversation.channel_type !== "api") {
          return false;
        }
        if (parsed.data.channelKey?.trim()) {
          const currentKey =
            conversation.channel_linked_number?.replace(/\D/g, "").trim() ||
            conversation.phone_number.replace(/\D/g, "").trim();
          if (currentKey !== parsed.data.channelKey.trim().replace(/\D/g, "")) {
            return false;
          }
        }
        const lastMessageMs = conversation.last_message_at ? Date.parse(conversation.last_message_at) : 0;
        return !Number.isFinite(lastMessageMs) || lastMessageMs >= cutoff;
      });

      return { conversations: filtered };
    }
  );

  fastify.get(
    "/api/delivery/alerts",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = DeliveryAlertsQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid delivery alerts query" });
      }
      const alerts = await listDeliveryAlerts(request.authUser.userId, parsed.data);
      return { alerts };
    }
  );

  fastify.post(
    "/api/delivery/alerts/:alertId/resolve",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { alertId } = request.params as { alertId: string };
      const alert = await resolveDeliveryAlert(request.authUser.userId, alertId);
      if (!alert) {
        return reply.status(404).send({ error: "Alert not found" });
      }
      return { alert };
    }
  );
}

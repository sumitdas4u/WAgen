import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";
import {
  listLeadsWithSummary,
  listConversationMessages,
  listConversations,
  summarizeLeadConversations,
  setConversationAIPaused,
  setManualTakeover
} from "../services/conversation-service.js";

const ToggleSchema = z.object({
  enabled: z.boolean().optional(),
  paused: z.boolean().optional()
});

const LeadsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const LeadsSummarizeBodySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  forceAll: z.boolean().optional()
});

export async function conversationRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/conversations",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const conversations = await listConversations(request.authUser.userId);
      return { conversations };
    }
  );

  fastify.get(
    "/api/conversations/leads",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = LeadsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid leads query" });
      }
      const leads = await listLeadsWithSummary(request.authUser.userId, parsed.data.limit);
      return { leads };
    }
  );

  fastify.post(
    "/api/conversations/leads/summarize",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = LeadsSummarizeBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid summarize payload" });
      }

      const result = await summarizeLeadConversations(request.authUser.userId, {
        limit: parsed.data.limit,
        forceAll: parsed.data.forceAll
      });
      return { ok: true, ...result };
    }
  );

  fastify.get(
    "/api/conversations/:conversationId/messages",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const params = request.params as { conversationId: string };
      const exists = await pool.query(
        `SELECT id FROM conversations WHERE id = $1 AND user_id = $2`,
        [params.conversationId, request.authUser.userId]
      );

      if ((exists.rowCount ?? 0) === 0) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const messages = await listConversationMessages(params.conversationId);
      return { messages };
    }
  );

  fastify.patch(
    "/api/conversations/:conversationId/manual-takeover",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const params = request.params as { conversationId: string };
      const parsed = ToggleSchema.safeParse(request.body);
      if (!parsed.success || typeof parsed.data.enabled !== "boolean") {
        return reply.status(400).send({ error: "enabled boolean is required" });
      }

      await setManualTakeover(request.authUser.userId, params.conversationId, parsed.data.enabled);
      return { ok: true };
    }
  );

  fastify.patch(
    "/api/conversations/:conversationId/pause",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const params = request.params as { conversationId: string };
      const parsed = ToggleSchema.safeParse(request.body);
      if (!parsed.success || typeof parsed.data.paused !== "boolean") {
        return reply.status(400).send({ error: "paused boolean is required" });
      }

      await setConversationAIPaused(request.authUser.userId, params.conversationId, parsed.data.paused);
      return { ok: true };
    }
  );
}

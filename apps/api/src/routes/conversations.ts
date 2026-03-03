import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { sendManualConversationMessage } from "../services/channel-outbound-service.js";
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

const AssignAgentSchema = z.object({
  agentProfileId: z.string().uuid().nullable().optional()
});

const ManualMessageSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  lockToManual: z.boolean().optional()
});

const LeadsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  stage: z.enum(["hot", "warm", "cold"]).optional(),
  kind: z.enum(["lead", "feedback", "complaint", "other"]).optional(),
  channelType: z.enum(["web", "qr", "api"]).optional(),
  todayOnly: z.coerce.boolean().optional(),
  requiresReply: z.coerce.boolean().optional()
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
      const leads = await listLeadsWithSummary(request.authUser.userId, parsed.data.limit, {
        stage: parsed.data.stage,
        kind: parsed.data.kind,
        channelType: parsed.data.channelType,
        todayOnly: parsed.data.todayOnly,
        requiresReply: parsed.data.requiresReply
      });
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

  fastify.patch(
    "/api/conversations/:conversationId/assign-agent",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const params = request.params as { conversationId: string };
      const parsed = AssignAgentSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid assign agent payload" });
      }

      const conversationExists = await pool.query(
        `SELECT id FROM conversations WHERE id = $1 AND user_id = $2 LIMIT 1`,
        [params.conversationId, request.authUser.userId]
      );
      if ((conversationExists.rowCount ?? 0) === 0) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const agentProfileId = parsed.data.agentProfileId ?? null;
      if (agentProfileId) {
        const agentExists = await pool.query(
          `SELECT id
           FROM agent_profiles
           WHERE id = $1
             AND user_id = $2
           LIMIT 1`,
          [agentProfileId, request.authUser.userId]
        );
        if ((agentExists.rowCount ?? 0) === 0) {
          return reply.status(404).send({ error: "Agent profile not found" });
        }
      }

      await pool.query(
        `UPDATE conversations
         SET assigned_agent_profile_id = $1,
             manual_takeover = CASE WHEN $1::uuid IS NOT NULL THEN TRUE ELSE manual_takeover END,
             ai_paused = CASE WHEN $1::uuid IS NOT NULL THEN TRUE ELSE ai_paused END
         WHERE id = $2
           AND user_id = $3`,
        [agentProfileId, params.conversationId, request.authUser.userId]
      );

      return { ok: true };
    }
  );

  fastify.post(
    "/api/conversations/:conversationId/messages",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const params = request.params as { conversationId: string };
      const parsed = ManualMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid message payload" });
      }

      try {
        const delivered = await sendManualConversationMessage({
          userId: request.authUser.userId,
          conversationId: params.conversationId,
          text: parsed.data.text,
          lockToManual: parsed.data.lockToManual
        });
        return { ok: true, delivered };
      } catch (error) {
        const message = (error as Error).message;
        if (message.toLowerCase().includes("not found")) {
          return reply.status(404).send({ error: message });
        }
        return reply.status(400).send({ error: message });
      }
    }
  );
}

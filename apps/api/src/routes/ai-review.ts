import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listAiReviewAuditLog, listAiReviewQueue, resolveAiReviewQueueItem } from "../services/ai-review-service.js";

const QueueQuerySchema = z.object({
  status: z.enum(["all", "pending", "resolved"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const AuditLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const ResolveBodySchema = z.object({
  resolutionAnswer: z.string().trim().max(8000).optional(),
  addToKnowledgeBase: z.boolean().optional().default(false)
});

export async function aiReviewRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/ai-review/queue",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = QueueQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid queue query." });
      }

      const queue = await listAiReviewQueue(request.authUser.userId, {
        status: parsed.data.status,
        limit: parsed.data.limit
      });
      return { queue };
    }
  );

  fastify.get(
    "/api/ai-review/audit-log",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = AuditLogQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid audit log query." });
      }

      const items = await listAiReviewAuditLog(request.authUser.userId, {
        limit: parsed.data.limit
      });
      return { items };
    }
  );

  fastify.post(
    "/api/ai-review/:reviewId/resolve",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const params = request.params as { reviewId: string };
      const parsed = ResolveBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid resolve payload." });
      }

      try {
        const resolved = await resolveAiReviewQueueItem({
          userId: request.authUser.userId,
          reviewId: params.reviewId,
          resolvedBy: request.authUser.userId,
          resolutionAnswer: parsed.data.resolutionAnswer,
          addToKnowledgeBase: parsed.data.addToKnowledgeBase
        });
        return {
          ok: true,
          item: resolved.item,
          knowledgeChunks: resolved.knowledgeChunks
        };
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

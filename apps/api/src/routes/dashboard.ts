import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDashboardOverview, getUsageAnalytics } from "../services/conversation-service.js";
import { getKnowledgeStats } from "../services/rag-service.js";
import { getUserById } from "../services/user-service.js";
import { whatsappSessionManager } from "../services/whatsapp-session-manager.js";

const UsageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(20).max(500).optional()
});

export async function dashboardRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/dashboard/overview",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const user = await getUserById(request.authUser.userId);
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }

      const [overview, knowledge, whatsapp] = await Promise.all([
        getDashboardOverview(request.authUser.userId),
        getKnowledgeStats(request.authUser.userId),
        whatsappSessionManager.getStatus(request.authUser.userId)
      ]);

      return {
        overview,
        knowledge,
        whatsapp,
        agent: {
          active: user.ai_active,
          personality: user.personality
        }
      };
    }
  );

  fastify.get(
    "/api/dashboard/usage",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = UsageQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid usage query" });
      }

      const usage = await getUsageAnalytics(request.authUser.userId, {
        days: parsed.data.days,
        limit: parsed.data.limit
      });

      return { usage };
    }
  );
}

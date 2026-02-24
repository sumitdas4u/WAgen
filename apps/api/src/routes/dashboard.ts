import type { FastifyInstance } from "fastify";
import { getDashboardOverview } from "../services/conversation-service.js";
import { getKnowledgeStats } from "../services/rag-service.js";
import { getUserById } from "../services/user-service.js";
import { whatsappSessionManager } from "../services/whatsapp-session-manager.js";

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
}
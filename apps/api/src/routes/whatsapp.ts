import type { FastifyInstance } from "fastify";
import { whatsappSessionManager } from "../services/whatsapp-session-manager.js";

export async function whatsappRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    "/api/whatsapp/connect",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      await whatsappSessionManager.connectUser(request.authUser.userId);
      return { ok: true };
    }
  );

  fastify.get(
    "/api/whatsapp/status",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      return whatsappSessionManager.getStatus(request.authUser.userId);
    }
  );
}
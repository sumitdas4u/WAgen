import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { whatsappSessionManager } from "../services/whatsapp-session-manager.js";

const ConnectSchema = z
  .object({
    resetAuth: z.boolean().optional()
  })
  .partial()
  .optional();

export async function whatsappRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    "/api/whatsapp/connect",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = ConnectSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid connect payload" });
      }

      await whatsappSessionManager.connectUser(request.authUser.userId, {
        resetAuth: Boolean(parsed.data?.resetAuth),
        force: Boolean(parsed.data?.resetAuth)
      });
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

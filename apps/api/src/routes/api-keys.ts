import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createApiKey, listApiKeys, revokeApiKey } from "../services/api-key-service.js";

const CreateKeySchema = z.object({
  name: z.string().trim().min(1).max(100)
});

export async function apiKeyRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/api-keys",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const keys = await listApiKeys(request.authUser.userId);
      return { keys };
    }
  );

  fastify.post(
    "/api/api-keys",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = CreateKeySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Name is required." });
      }
      const { key, rawKey } = await createApiKey(request.authUser.userId, parsed.data.name);
      return { key, rawKey };
    }
  );

  fastify.delete(
    "/api/api-keys/:id",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const revoked = await revokeApiKey(request.authUser.userId, id);
      if (!revoked) {
        return reply.status(404).send({ error: "Key not found or already revoked." });
      }
      return { ok: true };
    }
  );
}

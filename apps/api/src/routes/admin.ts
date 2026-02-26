import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { getAdminOverview, listAdminUserUsage } from "../services/admin-service.js";
import { getUsageAnalytics } from "../services/conversation-service.js";
import {
  getDefaultChatModel,
  getEffectiveChatModel,
  getChatModelOverride,
  isAllowedChatModel,
  listAvailableChatModels,
  setChatModelOverride
} from "../services/model-settings-service.js";

const AdminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

const SetModelSchema = z.object({
  model: z.string().min(2)
});

const UsersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const UserUsageParamsSchema = z.object({
  userId: z.string().uuid()
});

const UserUsageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(20).max(500).optional()
});

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/api/admin/login", async (request, reply) => {
    const parsed = AdminLoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid admin login payload" });
    }

    if (!env.SUPER_ADMIN_EMAIL || !env.SUPER_ADMIN_PASSWORD) {
      return reply.status(503).send({ error: "Super admin is not configured on server" });
    }

    const email = parsed.data.email.trim().toLowerCase();
    const password = parsed.data.password;
    const valid =
      email === env.SUPER_ADMIN_EMAIL.trim().toLowerCase() &&
      password === env.SUPER_ADMIN_PASSWORD;

    if (!valid) {
      return reply.status(401).send({ error: "Invalid super admin credentials" });
    }

    const token = fastify.jwt.sign(
      { role: "super_admin", email },
      { expiresIn: "12h" }
    );
    return { token, role: "super_admin" };
  });

  fastify.get("/api/admin/overview", { preHandler: [fastify.requireSuperAdmin] }, async () => {
    const overview = await getAdminOverview();
    return { overview };
  });

  fastify.get("/api/admin/users", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = UsersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid users query" });
    }
    const users = await listAdminUserUsage(parsed.data.limit);
    return { users };
  });

  fastify.get(
    "/api/admin/users/:userId/usage",
    { preHandler: [fastify.requireSuperAdmin] },
    async (request, reply) => {
      const paramsParsed = UserUsageParamsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({ error: "Invalid user usage params" });
      }

      const queryParsed = UserUsageQuerySchema.safeParse(request.query);
      if (!queryParsed.success) {
        return reply.status(400).send({ error: "Invalid user usage query" });
      }

      const usage = await getUsageAnalytics(paramsParsed.data.userId, {
        days: queryParsed.data.days,
        limit: queryParsed.data.limit
      });

      return { usage };
    }
  );

  fastify.get("/api/admin/model", { preHandler: [fastify.requireSuperAdmin] }, async () => {
    return {
      currentModel: await getEffectiveChatModel(),
      overrideModel: await getChatModelOverride(),
      defaultModel: getDefaultChatModel(),
      availableModels: listAvailableChatModels()
    };
  });

  fastify.post("/api/admin/model", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = SetModelSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid model payload" });
    }

    const model = parsed.data.model.trim();
    if (!isAllowedChatModel(model)) {
      return reply.status(400).send({ error: "Model is not in allowed list" });
    }

    await setChatModelOverride(model);
    return { ok: true, model };
  });
}

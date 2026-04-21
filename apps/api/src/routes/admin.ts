import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listAdminSubscriptionSummaries } from "../services/billing-service.js";
import { env } from "../config/env.js";
import { getAdminOverview, listAdminUserUsage } from "../services/admin-service.js";
import { getUsageAnalytics } from "../services/conversation-service.js";
import {
  adjustWorkspaceCreditsByAdmin,
  createPlan,
  listAdminWorkspaces,
  listPlans,
  resetWorkspaceWalletByAdmin,
  setWorkspaceStatusByAdmin,
  updatePlan
} from "../services/workspace-billing-service.js";
import {
  getDefaultChatModel,
  getEffectiveChatModel,
  getChatModelOverride,
  isAllowedChatModel,
  listAvailableChatModels,
  setChatModelOverride
} from "../services/model-settings-service.js";
import {
  getActiveProviderConfig,
  setActiveProviderConfig,
  clearActiveProviderConfig,
  SUPPORTED_PROVIDERS,
  type SupportedProvider,
  aiService
} from "../services/ai-service.js";

const AdminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

const SetModelSchema = z.object({
  model: z.string().min(2)
});

const SetProviderSchema = z.object({
  provider: z.enum(["openai", "anthropic", "gemini"]),
  apiKey: z.string().min(1),
  model: z.string().optional()
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

const SubscriptionQuerySchema = z.object({
  status: z.string().min(2).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const AdminPlansQuerySchema = z.object({
  includeInactive: z.coerce.boolean().optional()
});

const CreatePlanSchema = z.object({
  code: z.enum(["starter", "pro", "business"]),
  name: z.string().trim().min(2).max(80),
  priceMonthly: z.coerce.number().int().min(0),
  monthlyCredits: z.coerce.number().int().min(0),
  agentLimit: z.coerce.number().int().min(0),
  whatsappNumberLimit: z.coerce.number().int().min(0),
  status: z.enum(["active", "inactive"]).optional()
});

const UpdatePlanSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  priceMonthly: z.coerce.number().int().min(0).optional(),
  monthlyCredits: z.coerce.number().int().min(0).optional(),
  agentLimit: z.coerce.number().int().min(0).optional(),
  whatsappNumberLimit: z.coerce.number().int().min(0).optional(),
  status: z.enum(["active", "inactive"]).optional()
});

const PlanParamsSchema = z.object({
  planId: z.string().uuid()
});

const WorkspaceQuerySchema = z.object({
  status: z.enum(["active", "suspended", "deleted"]).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional()
});

const WorkspaceStatusSchema = z.object({
  status: z.enum(["active", "suspended", "deleted"]),
  reason: z.string().trim().max(240).optional()
});

const WorkspaceParamsSchema = z.object({
  workspaceId: z.string().uuid()
});

const AdminAdjustCreditsSchema = z.object({
  workspaceId: z.string().uuid(),
  deltaCredits: z.coerce.number().int().refine((value) => value !== 0, {
    message: "deltaCredits cannot be zero"
  }),
  reason: z.string().trim().max(240).optional()
});

const AdminResetWalletSchema = z.object({
  workspaceId: z.string().uuid(),
  reason: z.string().trim().max(240).optional()
});

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/api/admin/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
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

  fastify.get("/api/admin/overview", { preHandler: [fastify.requireSuperAdmin], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async () => {
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

  fastify.get("/api/admin/subscriptions", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = SubscriptionQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid subscriptions query" });
    }

    const subscriptions = await listAdminSubscriptionSummaries({
      status: parsed.data.status,
      limit: parsed.data.limit
    });
    return { subscriptions };
  });

  fastify.get("/api/admin/plans", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = AdminPlansQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid plans query" });
    }

    const plans = await listPlans({ includeInactive: parsed.data.includeInactive });
    return { plans };
  });

  fastify.post("/api/admin/plans", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = CreatePlanSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid create plan payload" });
    }

    const plan = await createPlan(parsed.data);
    return { plan };
  });

  fastify.patch(
    "/api/admin/plans/:planId",
    { preHandler: [fastify.requireSuperAdmin] },
    async (request, reply) => {
      const paramsParsed = PlanParamsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({ error: "Invalid plan params" });
      }
      const bodyParsed = UpdatePlanSchema.safeParse(request.body ?? {});
      if (!bodyParsed.success) {
        return reply.status(400).send({ error: "Invalid update plan payload" });
      }

      const plan = await updatePlan(paramsParsed.data.planId, bodyParsed.data);
      return { plan };
    }
  );

  fastify.get("/api/admin/workspaces", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = WorkspaceQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid workspaces query" });
    }

    const workspaces = await listAdminWorkspaces({
      status: parsed.data.status,
      limit: parsed.data.limit
    });
    return { workspaces };
  });

  fastify.post(
    "/api/admin/workspaces/:workspaceId/status",
    { preHandler: [fastify.requireSuperAdmin] },
    async (request, reply) => {
      const paramsParsed = WorkspaceParamsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({ error: "Invalid workspace params" });
      }
      const bodyParsed = WorkspaceStatusSchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({ error: "Invalid workspace status payload" });
      }

      const workspace = await setWorkspaceStatusByAdmin({
        workspaceId: paramsParsed.data.workspaceId,
        status: bodyParsed.data.status,
        reason: bodyParsed.data.reason,
        adminUserId: null
      });
      return { workspace };
    }
  );

  fastify.post(
    "/api/admin/credits/adjust",
    { preHandler: [fastify.requireSuperAdmin] },
    async (request, reply) => {
      const parsed = AdminAdjustCreditsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid credit adjustment payload" });
      }

      const wallet = await adjustWorkspaceCreditsByAdmin({
        workspaceId: parsed.data.workspaceId,
        deltaCredits: parsed.data.deltaCredits,
        reason: parsed.data.reason,
        adminUserId: null
      });
      return { wallet };
    }
  );

  fastify.post(
    "/api/admin/credits/reset",
    { preHandler: [fastify.requireSuperAdmin] },
    async (request, reply) => {
      const parsed = AdminResetWalletSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid credit reset payload" });
      }

      const wallet = await resetWorkspaceWalletByAdmin({
        workspaceId: parsed.data.workspaceId,
        reason: parsed.data.reason,
        adminUserId: null
      });
      return { wallet };
    }
  );

  fastify.get("/api/admin/model", { preHandler: [fastify.requireSuperAdmin], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async () => {
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

  // ── AI Provider config ─────────────────────────────────────────────────────
  fastify.get("/api/admin/provider", { preHandler: [fastify.requireSuperAdmin], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async () => {
    const config = await getActiveProviderConfig();
    return {
      providers: SUPPORTED_PROVIDERS,
      active: config
        ? { provider: config.provider, model: config.model ?? null, hasApiKey: true }
        : null
    };
  });

  fastify.post("/api/admin/provider", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = SetProviderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid provider payload", details: parsed.error.flatten().fieldErrors });
    }
    await setActiveProviderConfig({
      provider: parsed.data.provider as SupportedProvider,
      apiKey: parsed.data.apiKey,
      model: parsed.data.model?.trim() || undefined
    });
    return { ok: true, provider: parsed.data.provider };
  });

  fastify.delete("/api/admin/provider", { preHandler: [fastify.requireSuperAdmin], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async () => {
    await clearActiveProviderConfig();
    return { ok: true };
  });

  fastify.post("/api/admin/provider/test", { preHandler: [fastify.requireSuperAdmin] }, async (_request, reply) => {
    const config = await getActiveProviderConfig();
    const providerName = config?.provider ?? "openai (env fallback)";
    const t0 = Date.now();
    try {
      const result = await aiService.generateReply(
        "You are a test assistant. Reply in one short sentence.",
        "Say hello and confirm which AI model you are."
      );
      return reply.send({
        ok: true,
        provider: providerName,
        model: result.model,
        reply: result.content,
        latencyMs: Date.now() - t0
      });
    } catch (err) {
      return reply.status(502).send({
        ok: false,
        provider: providerName,
        error: (err as Error).message
      });
    }
  });
}

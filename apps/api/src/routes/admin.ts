import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listAdminSubscriptionSummaries } from "../services/billing-service.js";
import { env } from "../config/env.js";
import {
  getAdminOverview,
  listAdminUserUsage,
  listAdminQrSessions,
  listAdminWabaConnections,
  listAdminBroadcasts,
  cancelAdminBroadcast,
  listAdminTemplates,
  listAdminAiLogs,
  listAdminAuditLogs,
  writeAdminAuditLog,
  getAdminQueueStats,
  pauseAdminQueue,
  listAdminKillSwitches,
  setAdminKillSwitch,
  listAdminFeatureFlags,
  upsertAdminFeatureFlag,
  listAdminWebhookLogs,
  getSystemHealth,
  listWorkspaceHealthScores,
  listAdminAbuseFlags,
  resolveAdminAbuseFlag,
  listAdminFraudSignals,
  resolveAdminFraudSignal,
  listAdminPrompts,
  updateAdminPrompt,
  listBroadcastReputation,
  listMetaComplianceEvents,
  getWorkspaceSpendLimits,
  setWorkspaceSpendLimits,
  getBusinessAnalytics,
  writeAdminSession,
  getAdminWorkspaceDetail,
  getWorkspaceCreditLedger,
  overrideWorkspacePlan,
  listWorkspaceNotes,
  createWorkspaceNote,
  updateWorkspaceNote,
  deleteWorkspaceNote,
  getAdminUserDetail,
  toggleUserAiActive,
  sendAdminPasswordReset,
  globalAdminSearch,
  getAdminAlerts,
  listAdminSessions,
  writeAdminImpersonationLog,
  retryAdminQueueFailed,
  listBillingPayments,
  getAiCostSummary,
  listWorkspaceFeatureFlagOverrides,
  setWorkspaceFeatureFlagOverride,
  removeWorkspaceFeatureFlagOverride,
} from "../services/admin-service.js";
import { whatsappSessionManager } from "../services/whatsapp-session-manager.js";
import { createQueueWorkerConnection } from "../services/queue-service.js";
import { ADMIN_ACTIVITY_CHANNEL } from "../services/admin-activity-publisher.js";
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
  COUPON_DISCOUNT_TYPES,
  COUPON_REDEMPTION_STATUSES,
  COUPON_SCOPES,
  COUPON_STATUSES,
  createAdminCoupon,
  isCouponValidationError,
  listAdminCoupons,
  listCouponRedemptions,
  updateAdminCoupon
} from "../services/coupon-service.js";
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

const AdminCouponsQuerySchema = z.object({
  status: z.enum(COUPON_STATUSES).optional(),
  scope: z.enum(COUPON_SCOPES).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const CouponParamsSchema = z.object({
  couponId: z.string().uuid()
});

const CouponBodySchema = z.object({
  code: z.string().trim().min(1).max(80),
  title: z.string().trim().min(2).max(160),
  scope: z.enum(COUPON_SCOPES),
  discountType: z.enum(COUPON_DISCOUNT_TYPES),
  discountValue: z.coerce.number().positive().max(1_000_000),
  allowedPlans: z.array(z.enum(["starter", "pro", "business"])).optional(),
  maxRedemptions: z.coerce.number().int().min(1).max(1_000_000).optional().nullable(),
  maxPerUser: z.coerce.number().int().min(1).max(10_000).optional().nullable(),
  firstPurchaseOnly: z.boolean().optional(),
  startsAt: z.string().datetime().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  status: z.enum(COUPON_STATUSES).optional(),
  razorpayOfferId: z.string().trim().max(160).optional().nullable(),
  metadata: z.record(z.unknown()).optional()
});

const CouponPatchSchema = CouponBodySchema.partial();

const CouponRedemptionsQuerySchema = z.object({
  status: z.enum(COUPON_REDEMPTION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
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
    const ip = (request.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
      ?? request.socket.remoteAddress;
    const ua = request.headers["user-agent"];
    void writeAdminSession(email, ip, ua);
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

  fastify.get("/api/admin/coupons", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = AdminCouponsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid coupons query" });
    }

    const coupons = await listAdminCoupons({
      status: parsed.data.status,
      scope: parsed.data.scope,
      limit: parsed.data.limit
    });
    return { coupons };
  });

  fastify.post("/api/admin/coupons", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = CouponBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid coupon payload" });
    }

    try {
      const coupon = await createAdminCoupon(parsed.data);
      return reply.status(201).send({ coupon });
    } catch (error) {
      if (isCouponValidationError(error)) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });

  fastify.patch(
    "/api/admin/coupons/:couponId",
    { preHandler: [fastify.requireSuperAdmin] },
    async (request, reply) => {
      const paramsParsed = CouponParamsSchema.safeParse(request.params ?? {});
      if (!paramsParsed.success) {
        return reply.status(400).send({ error: "Invalid coupon params" });
      }
      const bodyParsed = CouponPatchSchema.safeParse(request.body ?? {});
      if (!bodyParsed.success) {
        return reply.status(400).send({ error: "Invalid coupon update payload" });
      }

      try {
        const coupon = await updateAdminCoupon(paramsParsed.data.couponId, bodyParsed.data);
        return { coupon };
      } catch (error) {
        if (isCouponValidationError(error)) {
          return reply.status(error.statusCode).send({ error: error.message });
        }
        throw error;
      }
    }
  );

  fastify.get(
    "/api/admin/coupons/:couponId/redemptions",
    { preHandler: [fastify.requireSuperAdmin] },
    async (request, reply) => {
      const paramsParsed = CouponParamsSchema.safeParse(request.params ?? {});
      if (!paramsParsed.success) {
        return reply.status(400).send({ error: "Invalid coupon params" });
      }
      const queryParsed = CouponRedemptionsQuerySchema.safeParse(request.query ?? {});
      if (!queryParsed.success) {
        return reply.status(400).send({ error: "Invalid redemptions query" });
      }

      const redemptions = await listCouponRedemptions({
        couponId: paramsParsed.data.couponId,
        status: queryParsed.data.status,
        limit: queryParsed.data.limit
      });
      return { redemptions };
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

  // ── QR Sessions ────────────────────────────────────────────────────────────
  fastify.get("/api/admin/qr-sessions", { preHandler: [fastify.requireSuperAdmin] }, async () => {
    const sessions = await listAdminQrSessions();
    return { sessions };
  });

  // ── WABA Connections ───────────────────────────────────────────────────────
  fastify.get("/api/admin/waba-connections", { preHandler: [fastify.requireSuperAdmin] }, async () => {
    const connections = await listAdminWabaConnections();
    return { connections };
  });

  // ── Broadcasts ─────────────────────────────────────────────────────────────
  const BroadcastsQuerySchema = z.object({
    status: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  });
  const BroadcastParamsSchema = z.object({ broadcastId: z.string().uuid() });

  fastify.get("/api/admin/broadcasts", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = BroadcastsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid query" });
    const broadcasts = await listAdminBroadcasts(parsed.data);
    return { broadcasts };
  });

  fastify.post("/api/admin/broadcasts/:broadcastId/cancel", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = BroadcastParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid params" });
    await cancelAdminBroadcast(parsed.data.broadcastId);
    const email = (request.user as { email?: string })?.email;
    await writeAdminAuditLog({ adminEmail: email, action: "broadcast.cancel", details: { broadcastId: parsed.data.broadcastId } });
    return { ok: true };
  });

  // ── Templates ──────────────────────────────────────────────────────────────
  const TemplatesQuerySchema = z.object({
    status: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  });

  fastify.get("/api/admin/templates", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = TemplatesQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid query" });
    const templates = await listAdminTemplates(parsed.data);
    return { templates };
  });

  // ── AI Logs ────────────────────────────────────────────────────────────────
  const AiLogsQuerySchema = z.object({
    workspaceId: z.string().uuid().optional(),
    model: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  });

  fastify.get("/api/admin/ai/logs", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = AiLogsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid query" });
    const logs = await listAdminAiLogs(parsed.data);
    return { logs };
  });

  // ── Audit Logs ─────────────────────────────────────────────────────────────
  const AuditLogsQuerySchema = z.object({
    action: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  });

  fastify.get("/api/admin/audit-logs", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = AuditLogsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid query" });
    const logs = await listAdminAuditLogs(parsed.data);
    return { logs };
  });

  // ── Queue Monitor ──────────────────────────────────────────────────────────
  const QueueNameSchema = z.object({ queueName: z.string().min(1).max(80) });

  fastify.get("/api/admin/queue-stats", { preHandler: [fastify.requireSuperAdmin] }, async () => {
    const queues = await getAdminQueueStats();
    return { queues };
  });

  const QueuePauseSchema = z.object({ pause: z.boolean() });

  fastify.post("/api/admin/queue-stats/:queueName/pause", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const paramsParsed = QueueNameSchema.safeParse(request.params);
    if (!paramsParsed.success) return reply.status(400).send({ error: "Invalid queue name" });
    const bodyParsed = QueuePauseSchema.safeParse(request.body);
    if (!bodyParsed.success) return reply.status(400).send({ error: "Invalid body" });
    await pauseAdminQueue(paramsParsed.data.queueName, bodyParsed.data.pause);
    return { ok: true };
  });

  // ── Kill Switches ──────────────────────────────────────────────────────────
  const KillSwitchParamsSchema = z.object({ key: z.string().min(1).max(80) });
  const KillSwitchBodySchema = z.object({ reason: z.string().max(500).optional() });

  fastify.get("/api/admin/kill-switches", { preHandler: [fastify.requireSuperAdmin] }, async () => {
    const switches = await listAdminKillSwitches();
    return { switches };
  });

  fastify.post("/api/admin/kill-switches/:key/enable", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const paramsParsed = KillSwitchParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) return reply.status(400).send({ error: "Invalid key" });
    const bodyParsed = KillSwitchBodySchema.safeParse(request.body ?? {});
    if (!bodyParsed.success) return reply.status(400).send({ error: "Invalid body" });
    const email = (request.user as { email?: string })?.email ?? "unknown";
    await setAdminKillSwitch(paramsParsed.data.key, true, email, bodyParsed.data.reason);
    await writeAdminAuditLog({ adminEmail: email, action: "kill_switch.enable", details: { key: paramsParsed.data.key, reason: bodyParsed.data.reason } });
    return { ok: true };
  });

  fastify.post("/api/admin/kill-switches/:key/disable", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const paramsParsed = KillSwitchParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) return reply.status(400).send({ error: "Invalid key" });
    const email = (request.user as { email?: string })?.email ?? "unknown";
    await setAdminKillSwitch(paramsParsed.data.key, false, email);
    await writeAdminAuditLog({ adminEmail: email, action: "kill_switch.disable", details: { key: paramsParsed.data.key } });
    return { ok: true };
  });

  // ── Feature Flags ──────────────────────────────────────────────────────────
  const FeatureFlagBodySchema = z.object({
    key: z.string().min(1).max(80),
    name: z.string().min(1).max(200),
    description: z.string().max(500).optional(),
    enabledGlobally: z.boolean().optional(),
    rolloutPercent: z.number().int().min(0).max(100).optional(),
  });
  const UpdateFeatureFlagBodySchema = z.object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(500).optional(),
    enabledGlobally: z.boolean().optional(),
    rolloutPercent: z.number().int().min(0).max(100).optional(),
  });
  const FeatureFlagKeySchema = z.object({ flagKey: z.string().min(1).max(80) });

  fastify.get("/api/admin/feature-flags", { preHandler: [fastify.requireSuperAdmin] }, async () => {
    const flags = await listAdminFeatureFlags();
    return { flags };
  });

  fastify.post("/api/admin/feature-flags", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = FeatureFlagBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid payload" });
    const flag = await upsertAdminFeatureFlag(parsed.data);
    return { flag };
  });

  fastify.put("/api/admin/feature-flags/:flagKey", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const paramsParsed = FeatureFlagKeySchema.safeParse(request.params);
    if (!paramsParsed.success) return reply.status(400).send({ error: "Invalid key" });
    const bodyParsed = UpdateFeatureFlagBodySchema.safeParse(request.body ?? {});
    if (!bodyParsed.success) return reply.status(400).send({ error: "Invalid payload" });
    const flag = await upsertAdminFeatureFlag({ key: paramsParsed.data.flagKey, name: bodyParsed.data.name ?? paramsParsed.data.flagKey, ...bodyParsed.data });
    return { flag };
  });

  // ── Prompt Management ─────────────────────────────────────────────────────
  const PromptKeyParamsSchema = z.object({ key: z.string().min(1).max(80) });
  const PromptUpdateBodySchema = z.object({ content: z.string().min(1).max(50000) });

  fastify.get("/api/admin/prompts", { preHandler: [fastify.requireSuperAdmin] }, async () => {
    const prompts = await listAdminPrompts();
    return { prompts };
  });

  fastify.put("/api/admin/prompts/:key", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const paramsParsed = PromptKeyParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) return reply.status(400).send({ error: "Invalid key" });
    const bodyParsed = PromptUpdateBodySchema.safeParse(request.body);
    if (!bodyParsed.success) return reply.status(400).send({ error: "Invalid payload" });
    const email = (request.user as { email?: string })?.email;
    const prompt = await updateAdminPrompt(paramsParsed.data.key, bodyParsed.data.content, email);
    await writeAdminAuditLog({ adminEmail: email, action: "prompt.update", details: { key: paramsParsed.data.key, version: prompt.version } });
    return { prompt };
  });

  // ── System Health ──────────────────────────────────────────────────────────
  fastify.get("/api/admin/system-health", { preHandler: [fastify.requireSuperAdmin] }, async () => {
    const health = await getSystemHealth();
    return health;
  });

  // ── Workspace Health Scores ────────────────────────────────────────────────
  fastify.get("/api/admin/workspace-health", { preHandler: [fastify.requireSuperAdmin] }, async () => {
    const workspaces = await listWorkspaceHealthScores(200);
    return { workspaces };
  });

  // ── Abuse Flags ────────────────────────────────────────────────────────────
  const AbuseFlagParamsSchema = z.object({ flagId: z.string().uuid() });
  const AbuseFlagQuerySchema = z.object({ unresolved: z.coerce.boolean().optional() });

  fastify.get("/api/admin/abuse-flags", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = AbuseFlagQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.status(400).send({ error: "Invalid query" });
    const flags = await listAdminAbuseFlags({ unresolved: parsed.data.unresolved });
    return { flags };
  });

  fastify.post("/api/admin/abuse-flags/:flagId/resolve", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = AbuseFlagParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid params" });
    await resolveAdminAbuseFlag(parsed.data.flagId);
    return { ok: true };
  });

  // ── Fraud Signals ──────────────────────────────────────────────────────────
  const FraudSignalParamsSchema = z.object({ signalId: z.string().uuid() });
  const FraudSignalQuerySchema = z.object({ unresolved: z.coerce.boolean().optional() });

  fastify.get("/api/admin/fraud-signals", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = FraudSignalQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.status(400).send({ error: "Invalid query" });
    const signals = await listAdminFraudSignals({ unresolved: parsed.data.unresolved });
    return { signals };
  });

  fastify.post("/api/admin/fraud-signals/:signalId/resolve", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = FraudSignalParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid params" });
    await resolveAdminFraudSignal(parsed.data.signalId);
    return { ok: true };
  });

  // ── Webhook Delivery Logs ──────────────────────────────────────────────────
  const WebhookLogsQuerySchema = z.object({
    success: z.coerce.boolean().optional(),
    failure: z.coerce.boolean().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  });

  fastify.get("/api/admin/webhook-logs", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = WebhookLogsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.status(400).send({ error: "Invalid query" });
    const logs = await listAdminWebhookLogs({
      limit: parsed.data.limit,
      successOnly: parsed.data.success === true,
      failureOnly: parsed.data.failure === true,
    });
    return { logs };
  });

  // ── Broadcast Reputation ───────────────────────────────────────────────────
  fastify.get("/api/admin/broadcast-reputation", { preHandler: [fastify.requireSuperAdmin] }, async () => {
    const entries = await listBroadcastReputation();
    return { entries };
  });

  // ── Meta Compliance Events ─────────────────────────────────────────────────
  const MetaComplianceQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(500).optional() });

  fastify.get("/api/admin/meta-compliance", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = MetaComplianceQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.status(400).send({ error: "Invalid query" });
    const events = await listMetaComplianceEvents({ limit: parsed.data.limit });
    return { events };
  });

  // ── AI Spend Limits per Workspace ──────────────────────────────────────────
  const SpendLimitsParamsSchema = z.object({ workspaceId: z.string().uuid() });
  const SpendLimitsBodySchema = z.object({
    dailyCapInr: z.number().positive().nullable().optional(),
    monthlyCapInr: z.number().positive().nullable().optional(),
    actionOnBreach: z.enum(["pause_ai", "alert_only", "pause_ai_and_alert"]).optional(),
    notifyEmail: z.string().email().nullable().optional(),
  });

  fastify.get("/api/admin/workspaces/:workspaceId/spend-limits", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = SpendLimitsParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid params" });
    const limits = await getWorkspaceSpendLimits(parsed.data.workspaceId);
    return { limits };
  });

  fastify.put("/api/admin/workspaces/:workspaceId/spend-limits", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const paramsParsed = SpendLimitsParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) return reply.status(400).send({ error: "Invalid params" });
    const bodyParsed = SpendLimitsBodySchema.safeParse(request.body ?? {});
    if (!bodyParsed.success) return reply.status(400).send({ error: "Invalid body" });
    const limits = await setWorkspaceSpendLimits(paramsParsed.data.workspaceId, bodyParsed.data);
    const email = (request.user as { email?: string })?.email;
    await writeAdminAuditLog({ adminEmail: email, action: "spend_limits.set", details: { workspaceId: paramsParsed.data.workspaceId, ...bodyParsed.data } });
    return { limits };
  });

  // ── Business Analytics ─────────────────────────────────────────────────────
  fastify.get("/api/admin/analytics/business", { preHandler: [fastify.requireSuperAdmin] }, async () => {
    const analytics = await getBusinessAnalytics();
    return analytics;
  });

  // ── Admin Logout ───────────────────────────────────────────────────────────
  fastify.post("/api/admin/logout", { preHandler: [fastify.requireSuperAdmin] }, async (request) => {
    const email = (request.user as { email?: string })?.email ?? "unknown";
    await writeAdminAuditLog({ adminEmail: email, action: "admin.logout", details: {} });
    return { ok: true };
  });

  // ── Workspace Detail ───────────────────────────────────────────────────────
  const WorkspaceDetailParamsSchema = z.object({ workspaceId: z.string().uuid() });
  const OverridePlanBodySchema = z.object({ planCode: z.string().min(1).max(50) });
  const CreditLedgerQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(500).optional() });
  const NoteBodySchema = z.object({ content: z.string().min(1).max(5000) });
  const NoteUpdateBodySchema = z.object({ content: z.string().min(1).max(5000).optional(), isPinned: z.boolean().optional() });
  const NoteParamsSchema = z.object({ workspaceId: z.string().uuid(), noteId: z.string().uuid() });

  fastify.get("/api/admin/workspaces/:workspaceId/detail", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = WorkspaceDetailParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid params" });
    const workspace = await getAdminWorkspaceDetail(parsed.data.workspaceId);
    if (!workspace) return reply.status(404).send({ error: "Workspace not found" });
    return { workspace };
  });

  fastify.patch("/api/admin/workspaces/:workspaceId/plan", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const paramsParsed = WorkspaceDetailParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) return reply.status(400).send({ error: "Invalid params" });
    const bodyParsed = OverridePlanBodySchema.safeParse(request.body);
    if (!bodyParsed.success) return reply.status(400).send({ error: "Invalid body" });
    const email = (request.user as { email?: string })?.email;
    await overrideWorkspacePlan(paramsParsed.data.workspaceId, bodyParsed.data.planCode, email);
    return { ok: true };
  });

  fastify.get("/api/admin/workspaces/:workspaceId/credit-ledger", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const paramsParsed = WorkspaceDetailParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) return reply.status(400).send({ error: "Invalid params" });
    const queryParsed = CreditLedgerQuerySchema.safeParse(request.query ?? {});
    if (!queryParsed.success) return reply.status(400).send({ error: "Invalid query" });
    const entries = await getWorkspaceCreditLedger(paramsParsed.data.workspaceId, queryParsed.data.limit);
    return { entries };
  });

  fastify.get("/api/admin/workspaces/:workspaceId/notes", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = WorkspaceDetailParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid params" });
    const notes = await listWorkspaceNotes(parsed.data.workspaceId);
    return { notes };
  });

  fastify.post("/api/admin/workspaces/:workspaceId/notes", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const paramsParsed = WorkspaceDetailParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) return reply.status(400).send({ error: "Invalid params" });
    const bodyParsed = NoteBodySchema.safeParse(request.body);
    if (!bodyParsed.success) return reply.status(400).send({ error: "Invalid body" });
    const email = (request.user as { email?: string })?.email ?? "admin";
    const note = await createWorkspaceNote(paramsParsed.data.workspaceId, email, bodyParsed.data.content);
    return { note };
  });

  fastify.patch("/api/admin/workspaces/:workspaceId/notes/:noteId", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const paramsParsed = NoteParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) return reply.status(400).send({ error: "Invalid params" });
    const bodyParsed = NoteUpdateBodySchema.safeParse(request.body ?? {});
    if (!bodyParsed.success) return reply.status(400).send({ error: "Invalid body" });
    const note = await updateWorkspaceNote(paramsParsed.data.noteId, bodyParsed.data);
    return { note };
  });

  fastify.delete("/api/admin/workspaces/:workspaceId/notes/:noteId", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const paramsParsed = NoteParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) return reply.status(400).send({ error: "Invalid params" });
    await deleteWorkspaceNote(paramsParsed.data.noteId);
    return { ok: true };
  });

  // ── User Detail & Actions ──────────────────────────────────────────────────
  const UserDetailParamsSchema = z.object({ userId: z.string().uuid() });
  const AiActiveBodySchema = z.object({ aiActive: z.boolean() });

  fastify.get("/api/admin/users/:userId/detail", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = UserDetailParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid params" });
    const user = await getAdminUserDetail(parsed.data.userId);
    if (!user) return reply.status(404).send({ error: "User not found" });
    return { user };
  });

  fastify.patch("/api/admin/users/:userId/ai-active", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const paramsParsed = UserDetailParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) return reply.status(400).send({ error: "Invalid params" });
    const bodyParsed = AiActiveBodySchema.safeParse(request.body);
    if (!bodyParsed.success) return reply.status(400).send({ error: "Invalid body" });
    const email = (request.user as { email?: string })?.email;
    await toggleUserAiActive(paramsParsed.data.userId, bodyParsed.data.aiActive, email);
    return { ok: true };
  });

  fastify.post("/api/admin/users/:userId/force-password-reset", { preHandler: [fastify.requireSuperAdmin] }, async (request, reply) => {
    const parsed = UserDetailParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid params" });
    const email = (request.user as { email?: string })?.email;
    const protocol = request.headers["x-forwarded-proto"] ?? "https";
    const host = request.headers.host ?? "app.wagenwai.com";
    const appBaseUrl = `${protocol}://${host}`;
    await sendAdminPasswordReset(parsed.data.userId, appBaseUrl);
    await writeAdminAuditLog({ adminEmail: email, action: "user.force_password_reset", targetUserId: parsed.data.userId });
    return { ok: true };
  });

  // ── Global Search ──────────────────────────────────────────────────────────
  const SearchQuerySchema = z.object({
    q: z.string().min(1).max(100),
  });

  fastify.get(
    "/api/admin/search",
    { preHandler: [fastify.requireSuperAdmin], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = SearchQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.status(400).send({ error: "Query param 'q' is required (1-100 chars)" });
      const results = await globalAdminSearch(parsed.data.q);
      return { results };
    }
  );

  // ── Computed Alerts ────────────────────────────────────────────────────────
  fastify.get(
    "/api/admin/alerts",
    { preHandler: [fastify.requireSuperAdmin], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async () => {
      const alerts = await getAdminAlerts();
      return { alerts };
    }
  );

  // ── Admin Sessions ─────────────────────────────────────────────────────────
  const AdminSessionsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
  });

  fastify.get(
    "/api/admin/sessions",
    { preHandler: [fastify.requireSuperAdmin] },
    async (request, reply) => {
      const parsed = AdminSessionsQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) return reply.status(400).send({ error: "Invalid query" });
      const sessions = await listAdminSessions(parsed.data.limit);
      return { sessions };
    }
  );

  // ── Impersonation ──────────────────────────────────────────────────────────
  const ImpersonateParamsSchema = z.object({ workspaceId: z.string().uuid() });

  fastify.post(
    "/api/admin/workspaces/:workspaceId/impersonate",
    { preHandler: [fastify.requireSuperAdmin], config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = ImpersonateParamsSchema.safeParse(request.params);
      if (!parsed.success) return reply.status(400).send({ error: "Invalid params" });

      const adminEmail = (request.user as { email?: string })?.email ?? "unknown";
      const wsResult = await import("../db/pool.js").then((m) =>
        m.pool.query<{ owner_id: string; name: string; email: string }>(
          `SELECT w.owner_id, w.name, u.email
           FROM workspaces w JOIN users u ON u.id = w.owner_id
           WHERE w.id = $1 LIMIT 1`,
          [parsed.data.workspaceId]
        )
      );
      const ws = wsResult.rows[0];
      if (!ws) return reply.status(404).send({ error: "Workspace not found" });

      const ip = (request.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
        ?? request.socket.remoteAddress;

      await writeAdminImpersonationLog({
        adminEmail,
        workspaceId: parsed.data.workspaceId,
        targetUserId: ws.owner_id,
        ipAddress: ip,
      });
      await writeAdminAuditLog({
        adminEmail,
        action: "workspace.impersonate",
        targetUserId: ws.owner_id,
        details: { workspaceId: parsed.data.workspaceId, workspaceName: ws.name },
      });

      const token = fastify.jwt.sign(
        { userId: ws.owner_id, email: ws.email, impersonatedBy: adminEmail },
        { expiresIn: "30m" }
      );
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

      return { token, expiresAt, userId: ws.owner_id, workspaceName: ws.name, userEmail: ws.email };
    }
  );

  // ── Live Activity SSE ──────────────────────────────────────────────────────
  fastify.get(
    "/api/admin/activity/stream",
    { preHandler: [fastify.requireSuperAdmin] },
    async (request, reply) => {
      const subscriber = createQueueWorkerConnection();
      if (!subscriber) {
        reply.raw.writeHead(503, { "Content-Type": "text/plain" });
        reply.raw.end("Redis unavailable");
        reply.hijack();
        return reply;
      }

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      reply.hijack();

      await subscriber.subscribe(ADMIN_ACTIVITY_CHANNEL);
      subscriber.on("message", (_ch: string, msg: string) => {
        reply.raw.write(`data: ${msg}\n\n`);
      });

      const ping = setInterval(() => { reply.raw.write(": ping\n\n"); }, 20_000);

      request.raw.on("close", () => {
        clearInterval(ping);
        void subscriber.unsubscribe().then(() => subscriber.disconnect());
      });
    }
  );

  // ── Queue: retry failed ────────────────────────────────────────────────────
  const QueueRetrySchema = z.object({ queueName: z.string().min(1).max(80) });

  fastify.post(
    "/api/admin/queues/:queueName/retry-failed",
    { preHandler: [fastify.requireSuperAdmin], config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = QueueRetrySchema.safeParse(request.params);
      if (!parsed.success) return reply.status(400).send({ error: "Invalid queue name" });
      const count = await retryAdminQueueFailed(parsed.data.queueName);
      const adminEmail = (request as { adminEmail?: string }).adminEmail ?? "unknown";
      await writeAdminAuditLog({ adminEmail, action: "system.queue_retry_failed", details: { queueName: parsed.data.queueName, retried: count } });
      return reply.send({ retried: count });
    }
  );

  // ── QR Sessions: force-disconnect ─────────────────────────────────────────
  const QrDisconnectSchema = z.object({ userId: z.string().uuid() });

  fastify.post(
    "/api/admin/qr-sessions/:userId/disconnect",
    { preHandler: [fastify.requireSuperAdmin], config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = QrDisconnectSchema.safeParse(request.params);
      if (!parsed.success) return reply.status(400).send({ error: "Invalid user ID" });
      const { userId } = parsed.data;
      try {
        await whatsappSessionManager.disconnectUser(userId);
      } catch {
        // If no active session, treat as success — it's already disconnected.
      }
      const adminEmail = (request as { adminEmail?: string }).adminEmail ?? "unknown";
      await writeAdminAuditLog({ adminEmail, action: "qr_session.force_disconnect", details: { userId } });
      return reply.send({ ok: true });
    }
  );

  // ── Billing Payments ───────────────────────────────────────────────────────
  fastify.get(
    "/api/admin/billing/payments",
    { preHandler: [fastify.requireSuperAdmin] },
    async (request, reply) => {
      const query = (request.query as Record<string, string>);
      const limit = Math.min(500, Math.max(1, parseInt(query.limit ?? "200", 10)));
      const payments = await listBillingPayments(limit);
      return reply.send({ payments });
    }
  );

  // ── AI Cost Summary ────────────────────────────────────────────────────────
  const AiCostSummaryGroupSchema = z.enum(["model", "workspace", "module", "day"]);

  fastify.get(
    "/api/admin/ai/cost-summary",
    { preHandler: [fastify.requireSuperAdmin] },
    async (request, reply) => {
      const query = (request.query as Record<string, string>);
      const groupByParsed = AiCostSummaryGroupSchema.safeParse(query.group_by ?? "model");
      const groupBy = groupByParsed.success ? groupByParsed.data : "model";
      const days = Math.min(90, Math.max(1, parseInt(query.days ?? "30", 10)));
      const series = await getAiCostSummary(groupBy, days);
      return reply.send({ series, groupBy, days });
    }
  );

  // ── Workspace Feature Flag Overrides ───────────────────────────────────────
  const WorkspaceFeatureFlagSchema = z.object({
    workspaceId: z.string().uuid(),
    flagKey: z.string().min(1).max(100),
  });
  const WorkspaceFeatureFlagBodySchema = z.object({
    enabled: z.boolean(),
    reason: z.string().max(500).optional(),
  });

  fastify.get(
    "/api/admin/workspaces/:workspaceId/feature-flags",
    { preHandler: [fastify.requireSuperAdmin] },
    async (request, reply) => {
      const parsed = z.object({ workspaceId: z.string().uuid() }).safeParse(request.params);
      if (!parsed.success) return reply.status(400).send({ error: "Invalid workspace ID" });
      const overrides = await listWorkspaceFeatureFlagOverrides(parsed.data.workspaceId);
      return reply.send({ overrides });
    }
  );

  fastify.put(
    "/api/admin/workspaces/:workspaceId/feature-flags/:flagKey",
    { preHandler: [fastify.requireSuperAdmin] },
    async (request, reply) => {
      const paramsParsed = WorkspaceFeatureFlagSchema.safeParse(request.params);
      const bodyParsed = WorkspaceFeatureFlagBodySchema.safeParse(request.body);
      if (!paramsParsed.success || !bodyParsed.success) return reply.status(400).send({ error: "Invalid request" });
      const adminEmail = (request as { adminEmail?: string }).adminEmail ?? "unknown";
      await setWorkspaceFeatureFlagOverride(
        paramsParsed.data.workspaceId,
        paramsParsed.data.flagKey,
        bodyParsed.data.enabled,
        adminEmail,
        bodyParsed.data.reason
      );
      return reply.send({ ok: true });
    }
  );

  fastify.delete(
    "/api/admin/workspaces/:workspaceId/feature-flags/:flagKey",
    { preHandler: [fastify.requireSuperAdmin] },
    async (request, reply) => {
      const paramsParsed = WorkspaceFeatureFlagSchema.safeParse(request.params);
      if (!paramsParsed.success) return reply.status(400).send({ error: "Invalid request" });
      const adminEmail = (request as { adminEmail?: string }).adminEmail ?? "unknown";
      await removeWorkspaceFeatureFlagOverride(
        paramsParsed.data.workspaceId,
        paramsParsed.data.flagKey,
        adminEmail
      );
      return reply.send({ ok: true });
    }
  );
}

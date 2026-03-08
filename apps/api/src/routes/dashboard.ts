import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { getUserPlanEntitlements } from "../services/billing-service.js";
import { getDashboardOverview, getUsageAnalytics } from "../services/conversation-service.js";
import { getKnowledgeStats } from "../services/rag-service.js";
import { getUserById } from "../services/user-service.js";
import { whatsappSessionManager } from "../services/whatsapp-session-manager.js";
import { getMetaBusinessStatus } from "../services/meta-whatsapp-service.js";
import { getWorkspaceCreditsByUserId } from "../services/workspace-billing-service.js";
import { getAgentProfileSummary } from "../services/agent-profile-service.js";

const UsageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(20).max(500).optional()
});

function buildDashboardFeatureFlags(): Record<string, boolean> {
  const defaults: Record<string, boolean> = {
    "dashboard.inbox": true,
    "dashboard.leads": true,
    "dashboard.billing": env.DASHBOARD_BILLING_CENTER,
    "dashboard.agents": true,
    "dashboard.settings.web": true,
    "dashboard.settings.qr": true,
    "dashboard.settings.api": true,
    "dashboard.studio.knowledge": true,
    "dashboard.studio.personality": true,
    "dashboard.studio.review": true,
    "dashboard.studio.test": true
  };

  return {
    ...defaults,
    ...env.DASHBOARD_FEATURE_FLAGS
  };
}

export async function dashboardRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/dashboard/bootstrap",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const user = await getUserById(request.authUser.userId);
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }

      const [planEntitlements, credits, whatsapp, metaApi, agentSummary] = await Promise.all([
        getUserPlanEntitlements(request.authUser.userId),
        getWorkspaceCreditsByUserId(request.authUser.userId),
        whatsappSessionManager.getStatus(request.authUser.userId),
        getMetaBusinessStatus(request.authUser.userId),
        getAgentProfileSummary(request.authUser.userId)
      ]);

      return {
        userSummary: {
          id: user.id,
          name: user.name,
          email: user.email,
          subscriptionPlan: user.subscription_plan,
          aiActive: user.ai_active,
          personality: user.personality
        },
        planEntitlements,
        featureFlags: buildDashboardFeatureFlags(),
        creditsSummary: {
          total_credits: credits.totalCredits,
          used_credits: credits.usedCredits,
          remaining_credits: credits.remainingCredits,
          low_credit: credits.lowCredit,
          low_credit_threshold_percent: credits.lowCreditThresholdPercent,
          low_credit_message: credits.lowCreditMessage
        },
        agentSummary: {
          configuredProfiles: agentSummary.configuredProfiles,
          activeProfiles: agentSummary.activeProfiles,
          hasConfiguredProfile: agentSummary.configuredProfiles > 0,
          hasActiveProfile: agentSummary.activeProfiles > 0
        },
        channelSummary: {
          website: {
            enabled: user.ai_active
          },
          whatsapp,
          metaApi,
          anyConnected: user.ai_active || whatsapp.status === "connected" || metaApi.connected
        }
      };
    }
  );

  fastify.get(
    "/api/dashboard/overview",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const user = await getUserById(request.authUser.userId);
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }

      const [overview, knowledge, whatsapp, metaApi] = await Promise.all([
        getDashboardOverview(request.authUser.userId),
        getKnowledgeStats(request.authUser.userId),
        whatsappSessionManager.getStatus(request.authUser.userId),
        getMetaBusinessStatus(request.authUser.userId)
      ]);

      return {
        overview,
        knowledge,
        whatsapp,
        metaApi,
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

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { getUserPlanEntitlements } from "../services/billing-service.js";
import { getDashboardOverview, getUsageAnalytics } from "../services/conversation-service.js";
import { getKnowledgeStats } from "../services/rag-service.js";
import { getUserById } from "../services/user-service.js";
import { whatsappSessionManager } from "../services/whatsapp-session-manager.js";
import { getMetaBusinessStatus } from "../services/meta-whatsapp-service.js";
import { getAgentProfileSummary } from "../services/agent-profile-service.js";
import { getTokenStatus } from "../services/ai-token-service.js";
import { InMemoryCache } from "../utils/cache.js";

const bootstrapCache = new InMemoryCache<object>(20_000);

export function invalidateBootstrapCache(userId: string): void {
  bootstrapCache.delete(userId);
}

const UsageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(20).max(500).optional()
});

async function getDashboardHomeMetrics(userId: string): Promise<{
  openConversations: number;
  totalContacts: number;
  activeBroadcasts: number;
  activeSequences: number;
  activeFlows: number;
}> {
  const result = await pool.query<{
    open_conversations: string;
    total_contacts: string;
    active_broadcasts: string;
    active_sequences: string;
    active_flows: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM conversations WHERE user_id = $1 AND COALESCE(status, 'open') NOT IN ('resolved', 'closed'))::text AS open_conversations,
       (SELECT COUNT(*) FROM contacts WHERE user_id = $1)::text AS total_contacts,
       (SELECT COUNT(*) FROM campaigns WHERE user_id = $1 AND status IN ('draft', 'scheduled', 'running', 'paused'))::text AS active_broadcasts,
       (SELECT COUNT(*) FROM sequences WHERE user_id = $1 AND status IN ('draft', 'published', 'paused'))::text AS active_sequences,
       (SELECT COUNT(*) FROM flows WHERE user_id = $1 AND published = TRUE)::text AS active_flows`,
    [userId]
  );
  const row = result.rows[0];
  return {
    openConversations: Number(row?.open_conversations ?? 0),
    totalContacts: Number(row?.total_contacts ?? 0),
    activeBroadcasts: Number(row?.active_broadcasts ?? 0),
    activeSequences: Number(row?.active_sequences ?? 0),
    activeFlows: Number(row?.active_flows ?? 0)
  };
}

function buildDashboardFeatureFlags(): Record<string, boolean> {
  const envFeatureFlags = (env as { DASHBOARD_FEATURE_FLAGS?: Record<string, boolean> }).DASHBOARD_FEATURE_FLAGS ?? {};
  const contactsEnabled = envFeatureFlags["dashboard.contacts"] ?? envFeatureFlags["dashboard.leads"] ?? true;
  const defaults: Record<string, boolean> = {
    "dashboard.inbox": true,
    "dashboard.contacts": contactsEnabled,
    "dashboard.leads": contactsEnabled,
    "dashboard.billing": env.DASHBOARD_BILLING_CENTER,
    "dashboard.sequence": true,
    "dashboard.agents": true,
    "dashboard.settings.web": true,
    "dashboard.settings.qr": true,
    "dashboard.settings.api": true,
    "dashboard.studio.flows": true,
    "dashboard.studio.knowledge": true,
    "dashboard.studio.personality": true,
    "dashboard.studio.review": true,
    "dashboard.studio.test": true
  };

  return {
    ...defaults,
    ...envFeatureFlags
  };
}

export async function dashboardRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/dashboard/bootstrap",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const userId = request.authUser.userId;
      const cached = bootstrapCache.get(userId);
      if (cached) return cached;

      const user = await getUserById(userId);
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }

      const [planEntitlements, whatsapp, metaApi, agentSummary] = await Promise.all([
        getUserPlanEntitlements(userId),
        whatsappSessionManager.getStatus(userId),
        getMetaBusinessStatus(userId),
        getAgentProfileSummary(userId)
      ]);
      const credits = await getTokenStatus(userId, planEntitlements.planCode);

      const response = {
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
          total_credits: credits.monthlyQuota,
          used_credits: credits.monthlyQuota - credits.balance,
          remaining_credits: credits.balance,
          low_credit: credits.isLow,
          low_credit_threshold_percent: 10,
          low_credit_message: credits.isLow ? "AI credits running low" : null
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

      bootstrapCache.set(userId, response);
      return response;
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

      const [overview, knowledge, whatsapp, metaApi, agentSummary, homeMetrics] = await Promise.all([
        getDashboardOverview(request.authUser.userId),
        getKnowledgeStats(request.authUser.userId),
        whatsappSessionManager.getStatus(request.authUser.userId),
        getMetaBusinessStatus(request.authUser.userId),
        getAgentProfileSummary(request.authUser.userId),
        getDashboardHomeMetrics(request.authUser.userId)
      ]);

      const websiteConnected = Boolean(user.ai_active);
      const qrConnected = whatsapp.status === "connected";
      const apiConnected = Boolean(metaApi.connected);
      const connected = websiteConnected || qrConnected || apiConnected;
      const agentConfigured = agentSummary.configuredProfiles > 0;
      const knowledgeConfigured = knowledge.chunks > 0;
      const flowConfigured = homeMetrics.activeFlows > 0;
      const operating = homeMetrics.openConversations > 0 || homeMetrics.totalContacts > 0;
      const checklist = [
        {
          id: "connect-channel",
          label: "Connect a channel",
          complete: connected,
          primaryCta: { label: "Connect API", to: "/dashboard/settings/api" },
          secondaryCtas: [
            { label: "QR", to: "/dashboard/settings/qr" },
            { label: "Web", to: "/dashboard/settings/web" }
          ]
        },
        {
          id: "configure-ai",
          label: "Configure AI agent and knowledge",
          complete: agentConfigured && (knowledgeConfigured || flowConfigured),
          primaryCta: { label: "AI Agents", to: "/dashboard/agents" },
          secondaryCtas: [
            { label: "Knowledge", to: "/dashboard/studio/knowledge" },
            { label: "Flows", to: "/dashboard/studio/flows" }
          ]
        },
        {
          id: "start-operating",
          label: "Start operating",
          complete: operating,
          primaryCta: { label: "Open Chats", to: "/dashboard/inbox-v2" },
          secondaryCtas: [
            { label: "Broadcast", to: "/dashboard/broadcast" },
            { label: "Analytics", to: "/dashboard/analytics" }
          ]
        }
      ];

      return {
        overview: {
          ...overview,
          openConversations: homeMetrics.openConversations,
          totalContacts: homeMetrics.totalContacts,
          activeBroadcasts: homeMetrics.activeBroadcasts,
          activeSequences: homeMetrics.activeSequences
        },
        knowledge,
        whatsapp,
        metaApi,
        agent: {
          active: user.ai_active,
          personality: user.personality
        },
        automation: {
          configuredAgents: agentSummary.configuredProfiles,
          activeAgents: agentSummary.activeProfiles,
          knowledgeChunks: knowledge.chunks,
          activeFlows: homeMetrics.activeFlows
        },
        channels: {
          website: {
            label: "Website Widget",
            connected: websiteConnected,
            status: websiteConnected ? "active" : "not_connected"
          },
          qr: {
            label: "WhatsApp QR",
            connected: qrConnected,
            status: whatsapp.status,
            phoneNumber: whatsapp.phoneNumber
          },
          api: {
            label: "Official WhatsApp API",
            connected: apiConnected,
            status: apiConnected ? "connected" : "not_connected",
            phoneNumber: metaApi.connection?.displayPhoneNumber ?? null
          }
        },
        setup: {
          connected,
          stepsLeft: checklist.filter((item) => !item.complete).length,
          checklist
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

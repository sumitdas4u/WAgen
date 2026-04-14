import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  cancelCampaign,
  createCampaign,
  getCampaign,
  previewCampaignLaunch,
  launchCampaign,
  listCampaignMessages,
  listCampaigns,
  updateCampaign,
  type BroadcastType,
  type CampaignMessageStatus,
  type RetargetStatus
} from "../services/campaign-service.js";
import { enqueueCampaign } from "../services/campaign-worker-service.js";
import { getCampaignDeliveryAnalytics } from "../services/message-delivery-data-service.js";

const TemplateVariableBindingSchema = z.object({
  source: z.enum(["contact", "static"]),
  field: z.string().trim().min(1).optional(),
  value: z.string().optional(),
  fallback: z.string().optional()
});

const TemplateVariablesSchema = z.record(z.string(), TemplateVariableBindingSchema).superRefine((value, ctx) => {
  for (const [key, binding] of Object.entries(value)) {
    if (!/^\{\{[^}]+\}\}$/.test(key.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Template variable keys must use placeholder format like {{1}}.",
        path: [key]
      });
    }
    if (binding.source === "contact" && !binding.field?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Contact bindings require a field.",
        path: [key, "field"]
      });
    }
    if (binding.source === "static" && !binding.value?.trim() && !binding.fallback?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Static bindings require a value or fallback.",
        path: [key, "value"]
      });
    }
  }
});

const CreateCampaignBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  broadcastType: z.enum(["standard", "retarget"] as [BroadcastType, ...BroadcastType[]]).optional(),
  connectionId: z.string().uuid().optional().nullable(),
  templateId: z.string().uuid().optional().nullable(),
  templateVariables: TemplateVariablesSchema.optional(),
  targetSegmentId: z.string().uuid().optional().nullable(),
  sourceCampaignId: z.string().uuid().optional().nullable(),
  retargetStatus: z.enum(["sent", "delivered", "read", "failed", "skipped"] as [RetargetStatus, ...RetargetStatus[]]).optional().nullable(),
  audienceSource: z.record(z.string(), z.unknown()).optional(),
  mediaOverrides: z.record(z.string(), z.string()).optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional().nullable()
});

const UpdateCampaignBodySchema = CreateCampaignBodySchema.partial();

const CampaignMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  status: z.enum(["queued", "sending", "sent", "delivered", "read", "failed", "skipped"]).optional()
});

export async function campaignRoutes(fastify: FastifyInstance): Promise<void> {
  // List all campaigns
  fastify.get(
    "/api/campaigns",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const campaigns = await listCampaigns(request.authUser.userId);
      return { campaigns };
    }
  );

  // Create campaign
  fastify.post(
    "/api/campaigns",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = CreateCampaignBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid campaign payload" });
      }
      const campaign = await createCampaign(request.authUser.userId, {
        name: parsed.data.name,
        broadcastType: parsed.data.broadcastType ?? "standard",
        connectionId: parsed.data.connectionId ?? null,
        templateId: parsed.data.templateId ?? null,
        templateVariables: parsed.data.templateVariables ?? {},
        targetSegmentId: parsed.data.targetSegmentId ?? null,
        sourceCampaignId: parsed.data.sourceCampaignId ?? null,
        retargetStatus: parsed.data.retargetStatus ?? null,
        audienceSource: parsed.data.audienceSource ?? {},
        mediaOverrides: parsed.data.mediaOverrides ?? {},
        scheduledAt: parsed.data.scheduledAt ?? null
      });
      return reply.status(201).send({ campaign });
    }
  );

  // Get single campaign
  fastify.get(
    "/api/campaigns/:campaignId",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { campaignId } = request.params as { campaignId: string };
      const campaign = await getCampaign(request.authUser.userId, campaignId);
      if (!campaign) {
        return reply.status(404).send({ error: "Campaign not found" });
      }
      return { campaign };
    }
  );

  fastify.get(
    "/api/campaigns/:campaignId/launch-preview",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { campaignId } = request.params as { campaignId: string };
      const preview = await previewCampaignLaunch(request.authUser.userId, campaignId);
      if (!preview) {
        return reply.status(404).send({ error: "Campaign not found" });
      }
      return { preview };
    }
  );

  fastify.get(
    "/api/campaigns/:campaignId/analytics",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { campaignId } = request.params as { campaignId: string };
      const analytics = await getCampaignDeliveryAnalytics(request.authUser.userId, campaignId);
      if (!analytics) {
        return reply.status(404).send({ error: "Campaign not found" });
      }
      return { analytics };
    }
  );

  // Update campaign (draft only)
  fastify.patch(
    "/api/campaigns/:campaignId",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { campaignId } = request.params as { campaignId: string };
      const parsed = UpdateCampaignBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid campaign patch" });
      }
      const campaign = await updateCampaign(request.authUser.userId, campaignId, {
        name: parsed.data.name,
        broadcastType: parsed.data.broadcastType,
        connectionId: parsed.data.connectionId ?? undefined,
        templateId: parsed.data.templateId ?? undefined,
        templateVariables: parsed.data.templateVariables ?? undefined,
        targetSegmentId: parsed.data.targetSegmentId ?? undefined,
        sourceCampaignId: parsed.data.sourceCampaignId ?? undefined,
        retargetStatus: parsed.data.retargetStatus ?? undefined,
        audienceSource: parsed.data.audienceSource ?? undefined,
        mediaOverrides: parsed.data.mediaOverrides ?? undefined,
        scheduledAt: parsed.data.scheduledAt ?? undefined
      });
      if (!campaign) {
        return reply.status(404).send({ error: "Campaign not found or not in draft state" });
      }
      return { campaign };
    }
  );

  // Launch campaign
  fastify.post(
    "/api/campaigns/:campaignId/launch",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { campaignId } = request.params as { campaignId: string };
      try {
        const campaign = await launchCampaign(request.authUser.userId, campaignId);
        if (!campaign) {
          return reply.status(404).send({ error: "Campaign not found or cannot be launched" });
        }
        await enqueueCampaign(campaign.id, request.authUser.userId);
        return { campaign };
      } catch (error) {
        return reply.status(400).send({ error: error instanceof Error ? error.message : "Launch failed" });
      }
    }
  );

  // Cancel campaign
  fastify.post(
    "/api/campaigns/:campaignId/cancel",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { campaignId } = request.params as { campaignId: string };
      const campaign = await cancelCampaign(request.authUser.userId, campaignId);
      if (!campaign) {
        return reply.status(404).send({ error: "Campaign not found or already completed" });
      }
      return { campaign };
    }
  );

  // List campaign messages (paginated)
  fastify.get(
    "/api/campaigns/:campaignId/messages",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { campaignId } = request.params as { campaignId: string };
      const parsed = CampaignMessagesQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid query parameters" });
      }
      const result = await listCampaignMessages(request.authUser.userId, campaignId, {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        status: parsed.data.status as CampaignMessageStatus | undefined
      });
      return result;
    }
  );
}

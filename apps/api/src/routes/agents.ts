import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createAgentProfile,
  deleteAgentProfile,
  listAgentProfiles,
  updateAgentProfile
} from "../services/agent-profile-service.js";

const BusinessSchema = z.object({
  companyName: z.string().trim().max(120).optional().default(""),
  whatDoYouSell: z.string().trim().min(2),
  targetAudience: z.string().trim().min(2),
  usp: z.string().trim().min(2),
  objections: z.string().trim().min(2),
  defaultCountry: z.string().trim().min(2).max(56).optional().default("IN"),
  defaultCurrency: z.string().trim().min(3).max(4).optional().default("INR"),
  greetingScript: z.string().trim().max(2000).optional().default(""),
  availabilityScript: z.string().trim().max(2000).optional().default(""),
  objectionHandlingScript: z.string().trim().max(2000).optional().default(""),
  bookingScript: z.string().trim().max(2000).optional().default(""),
  feedbackCollectionScript: z.string().trim().max(2000).optional().default(""),
  complaintHandlingScript: z.string().trim().max(2000).optional().default(""),
  supportEmail: z.union([z.string().trim().email(), z.literal("")]).optional().default(""),
  aiDoRules: z.string().trim().max(3000).optional().default(""),
  aiDontRules: z.string().trim().max(3000).optional().default(""),
  websiteUrl: z.string().trim().max(500).optional().default(""),
  manualFaq: z.string().trim().max(20000).optional().default("")
});

const AgentPayloadSchema = z.object({
  name: z.string().trim().min(2).max(80),
  channelType: z.enum(["web", "qr", "api"]).optional().default("web"),
  linkedNumber: z.string().trim().max(30).optional().default("web"),
  businessBasics: BusinessSchema,
  personality: z.enum(["friendly_warm", "professional", "hard_closer", "premium_consultant", "custom"]),
  customPrompt: z.string().optional(),
  objectiveType: z.enum(["lead", "feedback", "complaint", "hybrid"]).optional().default("lead"),
  taskDescription: z.string().trim().max(2000).optional().default(""),
  isActive: z.boolean().optional()
}).superRefine((value, ctx) => {
  if (value.channelType !== "web" && value.linkedNumber.replace(/\D/g, "").length < 8) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["linkedNumber"],
      message: "Linked number must contain at least 8 digits for WhatsApp channels."
    });
  }
});

const AgentParamsSchema = z.object({
  profileId: z.string().uuid()
});

export async function agentRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/agents/profiles",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const profiles = await listAgentProfiles(request.authUser.userId);
      return { profiles: profiles[0] ? [profiles[0]] : [] };
    }
  );

  fastify.post(
    "/api/agents/profiles",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = AgentPayloadSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid agent profile payload" });
      }

      const payload = {
        ...parsed.data,
        channelType: "web" as const,
        linkedNumber: "web",
        isActive: true
      };
      const existingProfiles = await listAgentProfiles(request.authUser.userId);
      const profile = existingProfiles[0]
        ? await updateAgentProfile(request.authUser.userId, existingProfiles[0].id, payload)
        : await createAgentProfile(request.authUser.userId, payload);
      if (!profile) {
        return reply.status(500).send({ error: "Failed to upsert agent profile" });
      }
      return { ok: true, profile };
    }
  );

  fastify.put(
    "/api/agents/profiles/:profileId",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const params = AgentParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: "Invalid profile id" });
      }

      const parsed = AgentPayloadSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid agent profile payload" });
      }

      const payload = {
        ...parsed.data,
        channelType: "web" as const,
        linkedNumber: "web",
        isActive: true
      };
      const profile = await updateAgentProfile(request.authUser.userId, params.data.profileId, payload);
      if (!profile) {
        return reply.status(404).send({ error: "Agent profile not found" });
      }

      return { ok: true, profile };
    }
  );

  fastify.delete(
    "/api/agents/profiles/:profileId",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const params = AgentParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: "Invalid profile id" });
      }

      const deleted = await deleteAgentProfile(request.authUser.userId, params.data.profileId);
      if (!deleted) {
        return reply.status(404).send({ error: "Agent profile not found" });
      }

      return { ok: true };
    }
  );
}

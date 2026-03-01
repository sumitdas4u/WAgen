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
  supportAddress: z.string().trim().max(300).optional().default(""),
  supportPhoneNumber: z.string().trim().max(40).optional().default(""),
  supportContactName: z.string().trim().max(100).optional().default(""),
  supportEmail: z.union([z.string().trim().email(), z.literal("")]).optional().default(""),
  aiDoRules: z.string().trim().max(3000).optional().default(""),
  aiDontRules: z.string().trim().max(3000).optional().default(""),
  websiteUrl: z.string().trim().max(500).optional().default(""),
  manualFaq: z.string().trim().max(20000).optional().default("")
});

const AgentPayloadSchema = z.object({
  name: z.string().trim().min(2).max(80),
  channelType: z.enum(["qr", "api"]),
  linkedNumber: z.string().trim().min(8).max(30),
  businessBasics: BusinessSchema,
  personality: z.enum(["friendly_warm", "professional", "hard_closer", "premium_consultant", "custom"]),
  customPrompt: z.string().optional(),
  isActive: z.boolean().optional()
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
      return { profiles };
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

      const profile = await createAgentProfile(request.authUser.userId, parsed.data);
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

      const profile = await updateAgentProfile(request.authUser.userId, params.data.profileId, parsed.data);
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

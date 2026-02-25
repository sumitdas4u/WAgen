import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { setAgentActive, updateBusinessBasics, updatePersonality } from "../services/user-service.js";

const BusinessSchema = z.object({
  whatDoYouSell: z.string().min(2),
  targetAudience: z.string().min(2),
  usp: z.string().min(2),
  objections: z.string().min(2),
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
  aiDontRules: z.string().trim().max(3000).optional().default("")
});

const PersonalitySchema = z.object({
  personality: z.enum(["friendly_warm", "professional", "hard_closer", "premium_consultant", "custom"]),
  customPrompt: z.string().optional()
});

const ActivateSchema = z.object({
  active: z.boolean()
});

export async function onboardingRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    "/api/onboarding/business",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = BusinessSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid business basics payload" });
      }

      await updateBusinessBasics(request.authUser.userId, parsed.data);
      return reply.send({ ok: true });
    }
  );

  fastify.post(
    "/api/onboarding/personality",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = PersonalitySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid personality payload" });
      }

      await updatePersonality(request.authUser.userId, parsed.data.personality, parsed.data.customPrompt);
      return reply.send({ ok: true });
    }
  );

  fastify.post(
    "/api/onboarding/activate",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = ActivateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid activate payload" });
      }

      await setAgentActive(request.authUser.userId, parsed.data.active);
      return reply.send({ ok: true, active: parsed.data.active });
    }
  );
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getUserById, setAgentActive, updateBusinessBasics, updatePersonality } from "../services/user-service.js";
import { generateOnboardingDraft } from "../services/onboarding-autofill-service.js";
import { buildSalesReply } from "../services/ai-reply-service.js";
import { requireAiCredit, AiTokensDepletedError } from "../services/ai-token-service.js";

const BusinessSchema = z.object({
  companyName: z.string().trim().max(120).optional().default(""),
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
  supportEmail: z.union([z.string().trim().email(), z.literal("")]).optional().default(""),
  aiDoRules: z.string().trim().max(3000).optional().default(""),
  aiDontRules: z.string().trim().max(3000).optional().default(""),
  escalationWhenToEscalate: z.string().trim().max(2000).optional().default(""),
  escalationContactPerson: z.string().trim().max(120).optional().default(""),
  escalationPhoneNumber: z.string().trim().max(40).optional().default(""),
  escalationEmail: z.union([z.string().trim().email(), z.literal("")]).optional().default(""),
  websiteUrl: z.string().trim().max(500).optional().default(""),
  manualFaq: z.string().trim().max(20000).optional().default("")
});

const PersonalitySchema = z.object({
  personality: z.enum(["friendly_warm", "professional", "hard_closer", "premium_consultant", "custom"]),
  customPrompt: z.string().optional()
});

const ActivateSchema = z.object({
  active: z.boolean()
});

const AutofillSchema = z.object({
  description: z.string().trim().min(20).max(6000)
});

const TestChatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(
      z.object({
        sender: z.enum(["user", "bot"]),
        text: z.string().trim().min(1).max(2000)
      })
    )
    .max(20)
    .optional(),
  phone: z.string().trim().max(30).optional()
});

function resolveTestPhone(value?: string): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 15) {
    return digits;
  }
  return "919999999999";
}

export async function onboardingRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    "/api/onboarding/autofill",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = AutofillSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Description must be at least 20 characters" });
      }

      try {
        await requireAiCredit(request.authUser.userId, "onboarding_autofill");
      } catch (e) {
        if (e instanceof AiTokensDepletedError) {
          return reply.status(402).send({ error: "ai_tokens_depleted", message: e.message, balance: e.balance });
        }
        throw e;
      }

      const draft = await generateOnboardingDraft(request.authUser.userId, parsed.data.description);
      return reply.send({ ok: true, draft });
    }
  );

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

  fastify.post(
    "/api/onboarding/test-chat",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = TestChatSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid test chat payload" });
      }

      const user = await getUserById(request.authUser.userId);
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }

      const history = (parsed.data.history ?? []).map((item) => ({
        direction: item.sender === "user" ? ("inbound" as const) : ("outbound" as const),
        message_text: item.text
      }));

      const response = await buildSalesReply({
        user,
        incomingMessage: parsed.data.message,
        conversationPhone: resolveTestPhone(parsed.data.phone),
        history
      });

      return reply.send({
        ok: true,
        reply: response.text,
        model: response.model,
        usage: response.usage,
        retrievalChunks: response.retrievalChunks
      });
    }
  );
}

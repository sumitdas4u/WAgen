import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  BILLING_PLAN_CODES,
  createAddonCreditsOrder,
  createUserSubscription,
  type BillingPlanCode
} from "../services/billing-service.js";
import { getUserById } from "../services/user-service.js";
import { getWorkspaceCreditsByUserId, listPlans } from "../services/workspace-billing-service.js";

const UpgradeWorkspaceSchema = z.object({
  planCode: z.enum(BILLING_PLAN_CODES),
  totalCount: z.coerce.number().int().min(1).max(60).optional(),
  trialDays: z.coerce.number().int().min(0).max(30).optional()
});

const AddonOrderSchema = z.object({
  credits: z.coerce.number().int().min(1).max(1_000_000)
});

const PlansQuerySchema = z.object({
  includeInactive: z.coerce.boolean().optional()
});

export async function workspaceRoutes(fastify: FastifyInstance): Promise<void> {
  const plansHandler = async (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
    const parsed = PlansQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid plans query" });
    }

    const plans = await listPlans({ includeInactive: parsed.data.includeInactive });
    return {
      plans: plans.map((plan) => ({
        id: plan.id,
        code: plan.code,
        name: plan.name,
        priceMonthly: plan.priceMonthly,
        monthlyCredits: plan.monthlyCredits,
        agentLimit: plan.agentLimit,
        whatsappNumberLimit: plan.whatsappNumberLimit,
        status: plan.status
      }))
    };
  };

  fastify.get("/api/plans", plansHandler);
  fastify.get("/plans", plansHandler);

  const creditsHandler = async (request: import("fastify").FastifyRequest) => {
    const credits = await getWorkspaceCreditsByUserId(request.authUser.userId);
    return {
      total_credits: credits.totalCredits,
      used_credits: credits.usedCredits,
      remaining_credits: credits.remainingCredits,
      low_credit: credits.lowCredit,
      low_credit_threshold_percent: credits.lowCreditThresholdPercent,
      low_credit_message: credits.lowCreditMessage
    };
  };

  fastify.get("/api/workspace/credits", { preHandler: [fastify.requireAuth] }, creditsHandler);
  fastify.get("/workspace/credits", { preHandler: [fastify.requireAuth] }, creditsHandler);

  const upgradeHandler = async (
    request: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply
  ) => {
    const parsed = UpgradeWorkspaceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid upgrade payload" });
    }

    const user = await getUserById(request.authUser.userId);
    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    const subscription = await createUserSubscription({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      planCode: parsed.data.planCode as BillingPlanCode,
      totalCount: parsed.data.totalCount,
      trialDays: parsed.data.trialDays
    });
    return reply.send(subscription);
  };

  fastify.post("/api/workspace/upgrade", { preHandler: [fastify.requireAuth] }, upgradeHandler);
  fastify.post("/workspace/upgrade", { preHandler: [fastify.requireAuth] }, upgradeHandler);

  const addonOrderHandler = async (
    request: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply
  ) => {
    const parsed = AddonOrderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid addon payload" });
    }

    const order = await createAddonCreditsOrder({
      userId: request.authUser.userId,
      credits: parsed.data.credits
    });

    return reply.send({
      keyId: order.keyId,
      orderId: order.orderId,
      amountInr: order.amountInr,
      amountPaise: order.amountPaise,
      currency: order.currency,
      credits: order.credits
    });
  };

  fastify.post("/api/workspace/addon", { preHandler: [fastify.requireAuth] }, addonOrderHandler);
  fastify.post("/workspace/addon", { preHandler: [fastify.requireAuth] }, addonOrderHandler);
}

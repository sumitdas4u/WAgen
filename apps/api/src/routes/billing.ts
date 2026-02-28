import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  BILLING_PLAN_CODES,
  cancelUserSubscription,
  createUserSubscription,
  getRazorpayCheckoutKey,
  getUserBillingSummary,
  handleRazorpayWebhookEvent,
  listBillingPlans,
  verifyRazorpayWebhookSignature,
  type BillingPlanCode
} from "../services/billing-service.js";
import { getUserById } from "../services/user-service.js";

const CreateSubscriptionSchema = z.object({
  planCode: z.enum(BILLING_PLAN_CODES),
  totalCount: z.coerce.number().int().min(1).max(60).optional(),
  trialDays: z.coerce.number().int().min(0).max(30).optional()
});

const CancelSubscriptionSchema = z.object({
  atCycleEnd: z.boolean().optional()
});

const BillingPlansQuerySchema = z.object({
  includeUnconfigured: z.coerce.boolean().optional()
});

export async function billingRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/billing/plans", async (request, reply) => {
    const parsed = BillingPlansQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid plans query" });
    }

    const includeUnconfigured = Boolean(parsed.data.includeUnconfigured);
    const plans = listBillingPlans()
      .filter((plan) => includeUnconfigured || Boolean(plan.razorpayPlanId))
      .map((plan) => ({
        code: plan.code,
        label: plan.label,
        amountInr: plan.amountInr,
        trialDaysDefault: plan.trialDaysDefault,
        totalCountDefault: plan.totalCountDefault,
        available: Boolean(plan.razorpayPlanId)
      }));

    let keyIdAvailable = false;
    try {
      keyIdAvailable = Boolean(getRazorpayCheckoutKey());
    } catch {
      keyIdAvailable = false;
    }

    return { keyIdAvailable, plans };
  });

  fastify.get("/api/billing/subscription", { preHandler: [fastify.requireAuth] }, async (request) => {
    const subscription = await getUserBillingSummary(request.authUser.userId);
    return { subscription };
  });

  fastify.post("/api/billing/subscription", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const parsed = CreateSubscriptionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid subscription payload" });
    }

    const user = await getUserById(request.authUser.userId);
    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    try {
      const subscription = await createUserSubscription({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        planCode: parsed.data.planCode as BillingPlanCode,
        totalCount: parsed.data.totalCount,
        trialDays: parsed.data.trialDays
      });
      return reply.send(subscription);
    } catch (error) {
      const message = (error as Error).message;
      if (message.toLowerCase().includes("active subscription")) {
        return reply.status(409).send({ error: message });
      }
      throw error;
    }
  });

  fastify.post(
    "/api/billing/subscription/cancel",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = CancelSubscriptionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid cancel payload" });
      }

      const subscription = await cancelUserSubscription(request.authUser.userId, {
        atCycleEnd: parsed.data.atCycleEnd ?? true
      });
      return reply.send({ subscription });
    }
  );

  fastify.post(
    "/api/billing/razorpay-webhook",
    {
      config: {
        rawBody: true
      }
    },
    async (request, reply) => {
      const signatureHeader = request.headers["x-razorpay-signature"];
      const signature =
        typeof signatureHeader === "string"
          ? signatureHeader
          : Array.isArray(signatureHeader)
            ? signatureHeader[0] ?? ""
            : "";
      const rawBody =
        typeof request.rawBody === "string"
          ? request.rawBody
          : Buffer.isBuffer(request.rawBody)
            ? request.rawBody.toString("utf8")
            : "";

      if (!rawBody || !signature || !verifyRazorpayWebhookSignature(rawBody, signature)) {
        return reply.status(401).send({ error: "Invalid webhook signature" });
      }

      let payload: unknown = request.body;
      if (!payload || typeof payload !== "object") {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          return reply.status(400).send({ error: "Invalid webhook payload" });
        }
      }

      await handleRazorpayWebhookEvent(payload);
      return reply.send({ status: "ok" });
    }
  );
}

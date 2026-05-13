import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listBillingPlans } from "../services/billing-service.js";
import { isCouponValidationError, previewCouponForUser } from "../services/coupon-service.js";

const CouponPreviewSchema = z.object({
  code: z.string().trim().min(1).max(80),
  purchaseType: z.literal("subscription"),
  planCode: z.enum(["starter", "pro", "business"])
});

export async function couponRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/api/coupons/preview", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const parsed = CouponPreviewSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid coupon preview payload" });
    }

    try {
      const payload = parsed.data;
      const plan = listBillingPlans().find((item) => item.code === payload.planCode);
      if (!plan) {
        return reply.status(400).send({ error: "Selected plan is invalid" });
      }
      const preview = await previewCouponForUser({
        userId: request.authUser.userId,
        code: payload.code,
        purchaseType: "subscription",
        planCode: payload.planCode,
        originalAmountPaise: Math.round(plan.amountInr * 100)
      });
      return { preview };
    } catch (error) {
      if (isCouponValidationError(error)) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });
}

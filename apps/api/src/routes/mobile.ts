import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { registerMobilePushToken, revokeMobilePushToken } from "../services/mobile-push-service.js";

const PushTokenSchema = z.object({
  expoPushToken: z.string().trim().min(10).max(256),
  platform: z.enum(["android", "ios", "unknown"]).optional().default("unknown"),
  deviceName: z.string().trim().max(160).nullable().optional(),
  appVersion: z.string().trim().max(80).nullable().optional()
});

const RevokePushTokenSchema = z.object({
  expoPushToken: z.string().trim().min(1).max(256)
});

export async function mobileRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    "/api/mobile/push-tokens",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = PushTokenSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid push token payload" });
      }

      try {
        const token = await registerMobilePushToken({
          userId: request.authUser.userId,
          expoPushToken: parsed.data.expoPushToken,
          platform: parsed.data.platform,
          deviceName: parsed.data.deviceName,
          appVersion: parsed.data.appVersion
        });
        return { ok: true, token: { id: token.id, platform: token.platform, enabled: token.enabled } };
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }
    }
  );

  fastify.post(
    "/api/mobile/push-tokens/revoke",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = RevokePushTokenSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid push token payload" });
      }

      const revoked = await revokeMobilePushToken({
        userId: request.authUser.userId,
        expoPushToken: parsed.data.expoPushToken
      });
      return { ok: true, revoked };
    }
  );
}

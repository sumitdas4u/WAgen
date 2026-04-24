import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { enqueueMetaDeliveryStatusEvents } from "../services/delivery-webhook-queue-service.js";
import {
  completeMetaEmbeddedSignup,
  disconnectMetaBusinessConnection,
  getMetaBusinessProfile,
  getMetaBusinessConfig,
  listMetaBusinessConnections,
  getMetaBusinessStatus,
  handleMetaWebhookPayload,
  sendMetaMessage,
  setMetaBusinessChannelEnabled,
  sendMetaTextMessage,
  updateMetaBusinessProfile,
  uploadMetaBusinessProfileLogo,
  verifyMetaWebhookSignature
} from "../services/meta-whatsapp-service.js";
import { validateFlowMessagePayload } from "../services/outbound-message-types.js";
import { applyTemplateWebhookUpdate } from "../services/template-service.js";
import { readFile } from "node:fs/promises";

const CompleteEmbeddedSignupSchema = z.object({
  code: z.string().trim().min(4),
  redirectUri: z.string().trim().url().optional(),
  metaBusinessId: z.string().trim().optional(),
  wabaId: z.string().trim().optional(),
  phoneNumberId: z.string().trim().optional(),
  displayPhoneNumber: z.string().trim().optional()
});

const SendTextSchema = z.object({
  to: z.string().trim().min(8).max(25),
  text: z.string().trim().min(1).max(4096),
  phoneNumberId: z.string().trim().optional(),
  webhookUrl: z.string().trim().url().optional()
});

const SendMessageSchema = z.object({
  to: z.string().trim().min(8).max(25),
  phoneNumberId: z.string().trim().optional(),
  payload: z.unknown(),
  webhookUrl: z.string().trim().url().optional()
});

const DisconnectSchema = z.object({
  connectionId: z.string().uuid().optional()
});

const ChannelStatusSchema = z.object({
  connectionId: z.string().uuid().optional(),
  enabled: z.boolean()
});

const BusinessProfileQuerySchema = z.object({
  connectionId: z.string().uuid().optional()
});

const BusinessProfileUpdateSchema = z.object({
  connectionId: z.string().uuid().optional(),
  address: z.string().trim().max(256).optional().nullable(),
  businessDescription: z.string().trim().max(256).optional().nullable(),
  email: z.string().trim().email().max(128).optional().nullable().or(z.literal("")),
  vertical: z.string().trim().max(64).optional().nullable(),
  websiteUrl: z.string().trim().url().max(256).optional().nullable().or(z.literal("")),
  about: z.string().trim().max(139).optional().nullable(),
  profilePictureHandle: z.string().trim().max(512).optional().nullable()
});

const perMinuteCounter = new Map<string, { count: number; resetAt: number }>();

function consumeRateLimit(key: string, limit: number): boolean {
  const now = Date.now();
  const current = perMinuteCounter.get(key);
  if (!current || current.resetAt <= now) {
    perMinuteCounter.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (current.count >= limit) {
    return false;
  }

  current.count += 1;
  perMinuteCounter.set(key, current);
  return true;
}

function readHeaderValue(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return "";
}

async function handleWebhookVerificationRequest(request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) {
  const query = request.query as Record<string, string | undefined>;
  const mode = query["hub.mode"];
  const verifyToken = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (mode === "subscribe" && verifyToken && challenge && env.META_VERIFY_TOKEN && verifyToken === env.META_VERIFY_TOKEN) {
    return reply.status(200).send(challenge);
  }

  return reply.status(403).send({ error: "Invalid webhook verification token" });
}

export async function metaRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/meta/business/config",
    { preHandler: [fastify.requireAuth] },
    async () => {
      return getMetaBusinessConfig();
    }
  );

  fastify.get(
    "/api/meta/business/status",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const query = request.query as Record<string, string | undefined>;
      const forceRefreshRaw = (query.forceRefresh ?? "").toLowerCase();
      const forceRefresh = forceRefreshRaw === "true" || forceRefreshRaw === "1";
      return getMetaBusinessStatus(request.authUser.userId, { forceRefresh });
    }
  );

  fastify.get(
    "/api/meta/business/connections",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const query = request.query as Record<string, string | undefined>;
      const forceRefreshRaw = (query.forceRefresh ?? "").toLowerCase();
      const forceRefresh = forceRefreshRaw === "true" || forceRefreshRaw === "1";
      const connections = await listMetaBusinessConnections(request.authUser.userId, {
        forceRefresh,
        includeDisconnected: true
      });
      return { connections };
    }
  );

  fastify.post(
    "/api/meta/business/complete",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      if (!consumeRateLimit(`meta-complete:${request.authUser.userId}`, 20)) {
        return reply.status(429).send({ error: "Rate limit exceeded. Try again in a minute." });
      }

      const parsed = CompleteEmbeddedSignupSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid Meta signup payload" });
      }

      const connection = await completeMetaEmbeddedSignup(request.authUser.userId, parsed.data);
      return { ok: true, connection };
    }
  );

  fastify.post(
    "/api/meta/business/disconnect",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = DisconnectSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid disconnect payload" });
      }

      const disconnected = await disconnectMetaBusinessConnection(
        request.authUser.userId,
        parsed.data.connectionId
      );
      return { ok: disconnected };
    }
  );

  fastify.post(
    "/api/meta/business/channel",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = ChannelStatusSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid channel status payload" });
      }

      const connection = await setMetaBusinessChannelEnabled(
        request.authUser.userId,
        parsed.data.enabled,
        parsed.data.connectionId
      );

      if (!connection) {
        return reply.status(404).send({ error: "No connected WhatsApp Business API number found." });
      }

      return { ok: true, connection };
    }
  );

  fastify.get(
    "/api/meta/business/profile",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = BusinessProfileQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid profile query" });
      }

      const profile = await getMetaBusinessProfile(request.authUser.userId, parsed.data.connectionId);
      return { profile };
    }
  );

  fastify.post(
    "/api/meta/business/profile",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = BusinessProfileUpdateSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid business profile payload" });
      }

      const profile = await updateMetaBusinessProfile({
        userId: request.authUser.userId,
        connectionId: parsed.data.connectionId,
        address: parsed.data.address ?? null,
        businessDescription: parsed.data.businessDescription ?? null,
        email: parsed.data.email || null,
        vertical: parsed.data.vertical ?? null,
        websiteUrl: parsed.data.websiteUrl || null,
        about: parsed.data.about ?? null,
        profilePictureHandle: parsed.data.profilePictureHandle ?? null
      });
      return { ok: true, profile };
    }
  );

  fastify.post(
    "/api/meta/business/profile/logo",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request: import("fastify").FastifyRequest, reply) => {
      const parsed = BusinessProfileQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid logo upload query" });
      }

      const files = await request.saveRequestFiles();
      try {
        if (files.length === 0) {
          return reply.status(400).send({ error: "A logo file is required" });
        }

        const file = files[0]!;
        const mimeType = (file.mimetype ?? "").toLowerCase();
        if (!["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(mimeType)) {
          return reply.status(400).send({ error: "Logo must be a PNG, JPG, or WEBP image." });
        }

        const buffer = await readFile(file.filepath);
        if (buffer.byteLength > 5 * 1024 * 1024) {
          return reply.status(400).send({ error: "Logo file exceeds 5MB limit." });
        }

        const result = await uploadMetaBusinessProfileLogo({
          userId: request.authUser.userId,
          connectionId: parsed.data.connectionId,
          fileBuffer: buffer,
          mimeType,
          fileName: file.filename ?? null
        });

        return { ok: true, ...result };
      } finally {
        await request.cleanRequestFiles();
      }
    }
  );

  fastify.post(
    "/api/meta/business/send-text",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      if (!consumeRateLimit(`meta-send:${request.authUser.userId}`, 60)) {
        return reply.status(429).send({ error: "Rate limit exceeded. Try again in a minute." });
      }

      const parsed = SendTextSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid text message payload" });
      }

      const result = await sendMetaTextMessage({
        userId: request.authUser.userId,
        to: parsed.data.to,
        text: parsed.data.text,
        phoneNumberId: parsed.data.phoneNumberId,
        webhookUrl: parsed.data.webhookUrl ?? null
      });

      return { ok: true, messageId: result.messageId, connection: result.connection };
    }
  );

  fastify.post(
    "/api/meta/business/send-message",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      if (!consumeRateLimit(`meta-send:${request.authUser.userId}`, 60)) {
        return reply.status(429).send({ error: "Rate limit exceeded. Try again in a minute." });
      }

      const parsed = SendMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid message payload" });
      }

      let payload;
      try {
        payload = validateFlowMessagePayload(parsed.data.payload as never);
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }

      const result = await sendMetaMessage({
        userId: request.authUser.userId,
        to: parsed.data.to,
        payload,
        phoneNumberId: parsed.data.phoneNumberId,
        webhookUrl: parsed.data.webhookUrl ?? null
      });

      return {
        ok: true,
        messageId: result.messageId,
        connection: result.connection,
        summaryText: result.summaryText
      };
    }
  );

  fastify.get("/meta-webhook", async (request, reply) => handleWebhookVerificationRequest(request, reply));
  fastify.get("/api/meta/webhook", async (request, reply) => handleWebhookVerificationRequest(request, reply));

  const webhookHandler = async (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
    const signature = readHeaderValue(request.headers["x-hub-signature-256"] as string | string[] | undefined);
    const rawBody =
      typeof request.rawBody === "string"
        ? request.rawBody
        : Buffer.isBuffer(request.rawBody)
          ? request.rawBody.toString("utf8")
          : "";

    if (!rawBody) {
      return reply.status(400).send({ error: "Missing webhook payload" });
    }

    if (!env.META_APP_SECRET) {
      return reply.status(503).send({ error: "Meta webhook secret is not configured" });
    }

    if (!signature || !verifyMetaWebhookSignature(rawBody, signature)) {
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

    await handleMetaWebhookPayload(payload);
    await enqueueMetaDeliveryStatusEvents(payload);

    // Handle template status update events
    const parsed = payload as { entry?: Array<{ changes?: Array<{ field?: string; value?: unknown }> }> };
    for (const entry of parsed.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field === "message_template_status_update" && change.value) {
          try {
            await applyTemplateWebhookUpdate(
              change.value as Parameters<typeof applyTemplateWebhookUpdate>[0]
            );
          } catch (err) {
            console.error("[MetaWebhook] template status update failed", err);
          }
        }
      }
    }

    return reply.send({ ok: true });
  };

  const webhookRouteOptions = {
    config: {
      rawBody: true,
      rateLimit: { max: 500, timeWindow: "1 minute" }
    }
  } as const;

  fastify.post("/meta-webhook", webhookRouteOptions, webhookHandler);
  fastify.post("/api/meta/webhook", webhookRouteOptions, webhookHandler);
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listContacts } from "../services/contacts-service.js";
import {
  getOrCreateConversation,
  listConversations,
  listRecentConversationMessages
} from "../services/conversation-service.js";
import {
  sendMetaMessage,
  sendMetaTextMessage
} from "../services/meta-whatsapp-service.js";
import { validateFlowMessagePayload } from "../services/outbound-message-types.js";
import { buildPlanModulePreHandler } from "../services/plan-entitlement-service.js";

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

const ConversationMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

const ContactsQuerySchema = z.object({
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export async function publicApiRoutes(fastify: FastifyInstance): Promise<void> {
  const requireApiAccess = buildPlanModulePreHandler("apiAccess");

  // List conversations
  fastify.get(
    "/v1/conversations",
    { preHandler: [fastify.requireApiKeyAuth, requireApiAccess] },
    async (request) => {
      const conversations = await listConversations(request.authUser.userId);
      return { conversations };
    }
  );

  // Get messages for a conversation by phone number
  fastify.get(
    "/v1/conversations/:phone/messages",
    { preHandler: [fastify.requireApiKeyAuth, requireApiAccess] },
    async (request, reply) => {
      const { phone } = request.params as { phone: string };
      const queryParsed = ConversationMessagesQuerySchema.safeParse(request.query);
      if (!queryParsed.success) {
        return reply.status(400).send({ error: "Invalid query params." });
      }

      const normalizedPhone = phone.replace(/\D/g, "");
      if (!normalizedPhone || normalizedPhone.length < 8) {
        return reply.status(400).send({ error: "Invalid phone number." });
      }

      const conversation = await getOrCreateConversation(request.authUser.userId, normalizedPhone);
      const messages = await listRecentConversationMessages(
        conversation.id,
        queryParsed.data.limit
      );
      return { conversation, messages };
    }
  );

  // List contacts
  fastify.get(
    "/v1/contacts",
    { preHandler: [fastify.requireApiKeyAuth, requireApiAccess] },
    async (request, reply) => {
      const queryParsed = ContactsQuerySchema.safeParse(request.query);
      if (!queryParsed.success) {
        return reply.status(400).send({ error: "Invalid query params." });
      }

      const contacts = await listContacts(request.authUser.userId, {
        q: queryParsed.data.q,
        limit: queryParsed.data.limit
      });
      return { contacts };
    }
  );

  // Send a plain text message
  fastify.post(
    "/v1/messages/send-text",
    { preHandler: [fastify.requireApiKeyAuth, requireApiAccess] },
    async (request, reply) => {
      const parsed = SendTextSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid payload." });
      }

      let result;
      try {
        result = await sendMetaTextMessage({
          userId: request.authUser.userId,
          to: parsed.data.to,
          text: parsed.data.text,
          phoneNumberId: parsed.data.phoneNumberId,
          webhookUrl: parsed.data.webhookUrl ?? null
        });
      } catch (error) {
        const msg = (error as Error).message;
        if (msg.startsWith("Message blocked:")) return reply.status(403).send({ error: msg });
        throw error;
      }

      return { ok: true, messageId: result.messageId };
    }
  );

  // Send any message type via FlowMessagePayload
  fastify.post(
    "/v1/messages/send",
    { preHandler: [fastify.requireApiKeyAuth, requireApiAccess] },
    async (request, reply) => {
      const parsed = SendMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid payload." });
      }

      let payload;
      try {
        payload = validateFlowMessagePayload(parsed.data.payload as never);
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }

      let result;
      try {
        result = await sendMetaMessage({
          userId: request.authUser.userId,
          to: parsed.data.to,
          payload,
          phoneNumberId: parsed.data.phoneNumberId,
          webhookUrl: parsed.data.webhookUrl ?? null
        });
      } catch (error) {
        const msg = (error as Error).message;
        if (msg.startsWith("Message blocked:")) return reply.status(403).send({ error: msg });
        throw error;
      }

      return { ok: true, messageId: result.messageId, summaryText: result.summaryText };
    }
  );
}

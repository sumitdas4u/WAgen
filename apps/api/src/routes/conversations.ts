import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { aiService } from "../services/ai-service.js";
import { chargeUser } from "../services/ai-token-service.js";
import { queueApiConversationSend } from "../services/api-outbound-router-service.js";
import { requireMetaConnection } from "../services/meta-whatsapp-service.js";
import { sendManualConversationMessage } from "../services/channel-outbound-service.js";
import {
  listLeadsWithSummary,
  listConversationMessages,
  listConversations,
  markConversationRead,
  summarizeLeadConversations,
  setConversationAIPaused,
  setManualTakeover,
  getOrCreateConversation,
} from "../services/conversation-service.js";
import {
  createConversationNote,
  listConversationNotes
} from "../services/conversation-notes-service.js";

const ToggleSchema = z.object({
  enabled: z.boolean().optional(),
  paused: z.boolean().optional()
});

const AssignAgentSchema = z.object({
  agentProfileId: z.string().uuid().nullable().optional()
});

const ManualMessageSchema = z.object({
  text: z.string().trim().max(4000).optional().default(""),
  mediaUrl: z.string().optional(),
  mediaMimeType: z.string().optional(),
  lockToManual: z.boolean().optional()
});

const ConversationNoteSchema = z.object({
  content: z.string().trim().min(1).max(4000)
});

const LeadsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  stage: z.enum(["hot", "warm", "cold"]).optional(),
  kind: z.enum(["lead", "feedback", "complaint", "other"]).optional(),
  channelType: z.enum(["web", "qr", "api"]).optional(),
  todayOnly: z.coerce.boolean().optional(),
  requiresReply: z.coerce.boolean().optional()
});

const LeadsSummarizeBodySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  forceAll: z.boolean().optional()
});

export async function conversationRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/conversations",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const conversations = await listConversations(request.authUser.userId);
      return { conversations };
    }
  );

  fastify.get(
    "/api/conversations/leads",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = LeadsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid leads query" });
      }
      const leads = await listLeadsWithSummary(request.authUser.userId, parsed.data.limit, {
        stage: parsed.data.stage,
        kind: parsed.data.kind,
        channelType: parsed.data.channelType,
        todayOnly: parsed.data.todayOnly,
        requiresReply: parsed.data.requiresReply
      });
      return { leads };
    }
  );

  fastify.post(
    "/api/conversations/leads/summarize",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = LeadsSummarizeBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid summarize payload" });
      }

      const result = await summarizeLeadConversations(request.authUser.userId, {
        limit: parsed.data.limit,
        forceAll: parsed.data.forceAll
      });
      return { ok: true, ...result };
    }
  );

  fastify.get(
    "/api/conversations/:conversationId/messages",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const params = request.params as { conversationId: string };
      const exists = await pool.query(
        `SELECT id FROM conversations WHERE id = $1 AND user_id = $2`,
        [params.conversationId, request.authUser.userId]
      );

      if ((exists.rowCount ?? 0) === 0) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const messages = await listConversationMessages(params.conversationId);
      return { messages };
    }
  );

  fastify.post(
    "/api/conversations/:conversationId/read",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const params = request.params as { conversationId: string };
      const exists = await pool.query(
        `SELECT id FROM conversations WHERE id = $1 AND user_id = $2`,
        [params.conversationId, request.authUser.userId]
      );

      if ((exists.rowCount ?? 0) === 0) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const unreadCount = await markConversationRead(request.authUser.userId, params.conversationId);
      return { ok: true, unreadCount };
    }
  );

  fastify.patch(
    "/api/conversations/:conversationId/manual-takeover",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const params = request.params as { conversationId: string };
      const parsed = ToggleSchema.safeParse(request.body);
      if (!parsed.success || typeof parsed.data.enabled !== "boolean") {
        return reply.status(400).send({ error: "enabled boolean is required" });
      }

      await setManualTakeover(request.authUser.userId, params.conversationId, parsed.data.enabled);
      return { ok: true };
    }
  );

  fastify.patch(
    "/api/conversations/:conversationId/pause",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const params = request.params as { conversationId: string };
      const parsed = ToggleSchema.safeParse(request.body);
      if (!parsed.success || typeof parsed.data.paused !== "boolean") {
        return reply.status(400).send({ error: "paused boolean is required" });
      }

      await setConversationAIPaused(request.authUser.userId, params.conversationId, parsed.data.paused);
      return { ok: true };
    }
  );

  fastify.patch(
    "/api/conversations/:conversationId/assign-agent",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const params = request.params as { conversationId: string };
      const parsed = AssignAgentSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid assign agent payload" });
      }

      const conversationExists = await pool.query(
        `SELECT id FROM conversations WHERE id = $1 AND user_id = $2 LIMIT 1`,
        [params.conversationId, request.authUser.userId]
      );
      if ((conversationExists.rowCount ?? 0) === 0) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const agentProfileId = parsed.data.agentProfileId ?? null;
      if (agentProfileId) {
        const agentExists = await pool.query(
          `SELECT id
           FROM agent_profiles
           WHERE id = $1
             AND user_id = $2
           LIMIT 1`,
          [agentProfileId, request.authUser.userId]
        );
        if ((agentExists.rowCount ?? 0) === 0) {
          return reply.status(404).send({ error: "Agent profile not found" });
        }
      }

      await pool.query(
        `UPDATE conversations
         SET assigned_agent_profile_id = $1,
             manual_takeover = CASE WHEN $1::uuid IS NOT NULL THEN TRUE ELSE manual_takeover END,
             ai_paused = CASE WHEN $1::uuid IS NOT NULL THEN TRUE ELSE ai_paused END
         WHERE id = $2
           AND user_id = $3`,
        [agentProfileId, params.conversationId, request.authUser.userId]
      );

      return { ok: true };
    }
  );

  fastify.get(
    "/api/conversations/:conversationId/notes",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const params = request.params as { conversationId: string };
      const exists = await pool.query(
        `SELECT id FROM conversations WHERE id = $1 AND user_id = $2`,
        [params.conversationId, request.authUser.userId]
      );

      if ((exists.rowCount ?? 0) === 0) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const notes = await listConversationNotes(request.authUser.userId, params.conversationId);
      return { notes };
    }
  );

  fastify.post(
    "/api/conversations/:conversationId/notes",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const params = request.params as { conversationId: string };
      const parsed = ConversationNoteSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid note payload" });
      }

      try {
        const userRow = await pool.query<{ name: string }>(
          `SELECT name FROM users WHERE id = $1 LIMIT 1`,
          [request.authUser.userId]
        );
        const authorName = userRow.rows[0]?.name?.trim() || request.authUser.email.split("@")[0] || "Agent";

        const note = await createConversationNote({
          userId: request.authUser.userId,
          conversationId: params.conversationId,
          authorName,
          content: parsed.data.content
        });

        return reply.status(201).send({ note });
      } catch (error) {
        const message = (error as Error).message;
        if (message.toLowerCase().includes("not found")) {
          return reply.status(404).send({ error: message });
        }
        return reply.status(400).send({ error: message });
      }
    }
  );

  fastify.post(
    "/api/conversations/:conversationId/messages",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const params = request.params as { conversationId: string };
      const parsed = ManualMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid message payload" });
      }

      const text = parsed.data.text ?? "";
      const mediaUrl = parsed.data.mediaUrl ?? null;
      const mediaMimeType = parsed.data.mediaMimeType ?? null;
      if (!text && !mediaUrl) {
        return reply.status(400).send({ error: "text or mediaUrl is required" });
      }

      try {
        // Look up the agent's display name so it appears in the chat bubble.
        const userRow = await pool.query<{ name: string }>(
          `SELECT name FROM users WHERE id = $1 LIMIT 1`,
          [request.authUser.userId]
        );
        const senderName = userRow.rows[0]?.name?.trim() || request.authUser.email.split("@")[0] || "Agent";

        const delivered = await sendManualConversationMessage({
          userId: request.authUser.userId,
          conversationId: params.conversationId,
          text,
          lockToManual: parsed.data.lockToManual,
          mediaUrl,
          mediaMimeType,
          senderName
        });
        return { ok: true, delivered };
      } catch (error) {
        const message = (error as Error).message;
        if (message.toLowerCase().includes("not found")) {
          return reply.status(404).send({ error: message });
        }
        return reply.status(400).send({ error: message });
      }
    }
  );

  // ── Send an approved template directly into a conversation ──────────────
  const SendTemplateSchema = z.object({
    templateId: z.string().uuid(),
    variableValues: z.record(z.string()).optional().default({})
  });

  fastify.post(
    "/api/conversations/:conversationId/send-template",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const params = request.params as { conversationId: string };
      const parsed = SendTemplateSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "Invalid payload" });

      // Resolve phone number from the conversation
      const convRow = await pool.query<{
        channel_type: string;
      }>(
        `SELECT channel_type
         FROM conversations
         WHERE id = $1
           AND user_id = $2
         LIMIT 1`,
        [params.conversationId, request.authUser.userId]
      );
      if ((convRow.rowCount ?? 0) === 0) {
        return reply.status(404).send({ error: "Conversation not found" });
      }
      const { channel_type } = convRow.rows[0];
      if (channel_type !== "api") {
        return reply.status(400).send({ error: "Templates can only be sent on the API (Meta) channel." });
      }

      try {
        const userRow = await pool.query<{ name: string }>(
          `SELECT name FROM users WHERE id = $1 LIMIT 1`,
          [request.authUser.userId]
        );
        const senderName = userRow.rows[0]?.name?.trim() || request.authUser.email.split("@")[0] || "Agent";

        const result = await queueApiConversationSend({
          userId: request.authUser.userId,
          conversationId: params.conversationId,
          source: "manual",
          templateId: parsed.data.templateId,
          variableValues: parsed.data.variableValues,
          senderName
        });

        return { ok: true, queued: true, messageId: result.queuedMessageId, policy: result.policy };
      } catch (error) {
        const message = (error as Error).message;
        if (message.toLowerCase().includes("not found")) {
          return reply.status(404).send({ error: message });
        }
        return reply.status(400).send({ error: message });
      }
    }
  );

  fastify.post(
    "/api/conversations/:conversationId/upload",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const params = request.params as { conversationId: string };
      const exists = await pool.query(
        `SELECT id FROM conversations WHERE id = $1 AND user_id = $2`,
        [params.conversationId, request.authUser.userId]
      );
      if ((exists.rowCount ?? 0) === 0) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ error: "No file provided" });
      }

      const chunks: Buffer[] = [];
      for await (const chunk of file.file) {
        chunks.push(chunk as Buffer);
      }
      const buffer = Buffer.concat(chunks);

      if (buffer.length > 10 * 1024 * 1024) {
        return reply.status(400).send({ error: "File too large. Maximum 10 MB." });
      }

      const base64Data = buffer.toString("base64");
      const result = await pool.query<{ id: string }>(
        `INSERT INTO media_uploads (user_id, mime_type, filename, data, size_bytes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [request.authUser.userId, file.mimetype, file.filename, base64Data, buffer.length]
      );

      const mediaId = result.rows[0].id;
      return { mediaId, url: `/api/media/${mediaId}`, mimeType: file.mimetype };
    }
  );

  // ── Create or find an outbound conversation for a contact ────────────────
  const OutboundConversationSchema = z.object({
    contactId: z.string().uuid(),
    channelType: z.enum(["qr", "api"]),
    connectionId: z.string().uuid().optional()
  });

  fastify.post(
    "/api/conversations/outbound",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = OutboundConversationSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "Invalid payload" });

      const { contactId, channelType } = parsed.data;

      const contactRow = await pool.query<{ phone_number: string }>(
        `SELECT phone_number FROM contacts WHERE id = $1 AND user_id = $2 LIMIT 1`,
        [contactId, request.authUser.userId]
      );
      if ((contactRow.rowCount ?? 0) === 0) {
        return reply.status(404).send({ error: "Contact not found" });
      }

      const phoneNumber = contactRow.rows[0].phone_number;

      let channelLinkedNumber: string | null = null;
      if (channelType === "api") {
        if (!parsed.data.connectionId) {
          return reply.status(400).send({ error: "connectionId is required for WhatsApp API conversations." });
        }
        const connection = await requireMetaConnection(request.authUser.userId, parsed.data.connectionId, {
          requireActive: true
        });
        channelLinkedNumber = connection.linkedNumber?.trim() || connection.displayPhoneNumber?.trim() || null;
      }

      const conversation = await getOrCreateConversation(request.authUser.userId, phoneNumber, { channelType, channelLinkedNumber });
      return { conversationId: conversation.id };
    }
  );

  // ── AI Assist: rewrite / translate message text ───────────────────────────
  const AiAssistSchema = z.object({
    text: z.string().trim().min(1).max(4000),
    action: z.enum(["rewrite", "translate"]),
    language: z.string().max(60).optional()
  });

  fastify.post(
    "/api/ai-assist/text",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = AiAssistSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "Invalid input" });
      const { text, action, language } = parsed.data;
      const systemPrompt =
        action === "rewrite"
          ? "You are a professional WhatsApp business messaging assistant. Rewrite the given message to be clearer, more professional, and friendly. Return only the rewritten message text with no explanation or prefix."
          : `You are a professional translator. Translate the given message to ${language ?? "English"}. Return only the translated text with no explanation or prefix.`;
      const result = await aiService.generateReply(systemPrompt, text, undefined, { temperature: 0.5 });
      void chargeUser(request.authUser.userId, "ai_text_assist");
      return { text: result.content.trim() };
    }
  );

  fastify.get(
    "/api/media/:mediaId",
    async (request, reply) => {
      const params = request.params as { mediaId: string };
      const result = await pool.query<{ mime_type: string; filename: string | null; data: string }>(
        `SELECT mime_type, filename, data FROM media_uploads WHERE id = $1`,
        [params.mediaId]
      );
      if ((result.rowCount ?? 0) === 0) {
        return reply.status(404).send({ error: "Media not found" });
      }
      const row = result.rows[0];
      const buffer = Buffer.from(row.data, "base64");
      reply.header("Content-Type", row.mime_type);
      reply.header("Content-Disposition", `inline; filename="${row.filename ?? "attachment"}"`);
      reply.header("Cache-Control", "public, max-age=86400");
      return reply.send(buffer);
    }
  );
}

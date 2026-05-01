import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { aiService } from "../services/ai-service.js";
import { AiTokensDepletedError, chargeUser, estimateTextTokens, requireAiCredit } from "../services/ai-token-service.js";
import { queueApiConversationSend } from "../services/api-outbound-router-service.js";
import { requireMetaConnection } from "../services/meta-whatsapp-service.js";
import { sendManualConversationMessage } from "../services/channel-outbound-service.js";
import {
  listLeadsWithSummary,
  listConversationMessagesPage,
  listConversations,
  listConversationsPage,
  markConversationRead,
  summarizeLeadConversations,
  setConversationAIPaused,
  setManualTakeover,
  getOrCreateConversation,
  getConversationForUser,
} from "../services/conversation-service.js";
import {
  createConversationNote,
  listConversationNotes
} from "../services/conversation-notes-service.js";
import { realtimeHub } from "../services/realtime-hub.js";
import { createAgentNotification } from "../services/agent-notification-service.js";
import { retryConversationOutboundMessage } from "../services/outbound-message-service.js";

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
  echoId: z.string().uuid().optional(),
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

const ConversationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().trim().min(1).optional(),
  q: z.string().trim().max(200).optional(),
  status: z.enum(["all", "open", "pending", "resolved", "snoozed"]).optional(),
  channel: z.enum(["all", "web", "qr", "api"]).optional(),
  aiMode: z.enum(["all", "ai", "human"]).optional(),
  assignment: z.enum(["all", "assigned", "unassigned"]).optional(),
  labelId: z.string().trim().optional(),
  leadKind: z.enum(["all", "lead", "feedback", "complaint", "other"]).optional(),
  priority: z.enum(["all", "none", "low", "medium", "high", "urgent"]).optional(),
  stage: z.enum(["all", "hot", "warm", "cold"]).optional()
});

const ConversationMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  before: z.string().trim().min(1).optional()
});

type ConversationTimelineEvent = {
  id: string;
  type:
    | "conversation_started"
    | "inbound_message"
    | "human_reply"
    | "ai_reply"
    | "template_sent"
    | "broadcast_sent"
    | "sequence_started"
    | "sequence_event"
    | "flow_started"
    | "flow_event";
  label: string;
  detail: string | null;
  occurred_at: string | Date;
};

function cleanTimelineDetail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed;
}

type FacetDimension = "status" | "stage" | "channel" | "aiMode" | "assignment" | "labelId" | "leadKind" | "priority";

function conversationFacetWhere(
  options: z.infer<typeof ConversationsQuerySchema>,
  values: unknown[],
  omit?: FacetDimension
): string {
  const where = ["c.user_id = $1"];

  const search = options.q?.trim();
  if (search) {
    values.push(`%${search}%`);
    const param = `$${values.length}`;
    where.push(`(
      c.phone_number ILIKE ${param}
      OR c.last_message ILIKE ${param}
      OR COALESCE(ct.display_name, '') ILIKE ${param}
    )`);
  }

  if (omit !== "status" && options.status && options.status !== "all") {
    if (options.status === "pending") {
      where.push(`c.status = 'open' AND COALESCE(crs.unread_count, 0) > 0`);
    } else {
      values.push(options.status);
      where.push(`c.status = $${values.length}`);
    }
  }

  if (omit !== "stage" && options.stage && options.stage !== "all") {
    if (options.stage === "hot") where.push(`COALESCE(c.score, 0) >= 70`);
    if (options.stage === "warm") where.push(`COALESCE(c.score, 0) >= 40 AND COALESCE(c.score, 0) < 70`);
    if (options.stage === "cold") where.push(`COALESCE(c.score, 0) < 40`);
  }

  if (omit !== "channel" && options.channel && options.channel !== "all") {
    values.push(options.channel);
    where.push(`c.channel_type = $${values.length}`);
  }

  if (omit !== "aiMode" && options.aiMode && options.aiMode !== "all") {
    where.push(
      options.aiMode === "ai"
        ? `COALESCE(c.ai_paused, FALSE) = FALSE AND COALESCE(c.manual_takeover, FALSE) = FALSE`
        : `(COALESCE(c.ai_paused, FALSE) = TRUE OR COALESCE(c.manual_takeover, FALSE) = TRUE)`
    );
  }

  if (omit !== "assignment" && options.assignment && options.assignment !== "all") {
    where.push(
      options.assignment === "assigned"
        ? `c.assigned_agent_profile_id IS NOT NULL`
        : `c.assigned_agent_profile_id IS NULL`
    );
  }

  const labelId = options.labelId?.trim();
  if (omit !== "labelId" && labelId && labelId !== "all") {
    values.push(labelId);
    where.push(`EXISTS (
      SELECT 1 FROM conversation_labels cl
      WHERE cl.conversation_id = c.id AND cl.label_id = $${values.length}::uuid
    )`);
  }

  if (omit !== "leadKind" && options.leadKind && options.leadKind !== "all") {
    values.push(options.leadKind);
    where.push(`COALESCE(ct.contact_type, c.lead_kind) = $${values.length}`);
  }

  if (omit !== "priority" && options.priority && options.priority !== "all") {
    values.push(options.priority);
    where.push(`COALESCE(c.priority, 'none') = $${values.length}`);
  }

  return where.join(" AND ");
}

async function countConversationFacet(
  userId: string,
  options: z.infer<typeof ConversationsQuerySchema>,
  groupSql: string,
  omit?: FacetDimension
): Promise<Record<string, number>> {
  const values: unknown[] = [userId];
  const where = conversationFacetWhere(options, values, omit);
  const result = await pool.query<{ key: string; count: string }>(
    `SELECT ${groupSql} AS key, COUNT(DISTINCT c.id)::text AS count
     FROM conversations c
     LEFT JOIN conversation_read_state crs
       ON crs.conversation_id = c.id AND crs.user_id = c.user_id
     LEFT JOIN contacts ct
       ON ct.user_id = c.user_id
      AND (
        ct.linked_conversation_id = c.id
        OR regexp_replace(ct.phone_number, '\\D', '', 'g') = regexp_replace(c.phone_number, '\\D', '', 'g')
      )
     WHERE ${where}
     GROUP BY key`,
    values
  );

  return Object.fromEntries(result.rows.map((row) => [row.key, Number(row.count)]));
}

export async function conversationRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/conversations",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = ConversationsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid conversations query" });
      }

      const usePagination =
        typeof parsed.data.limit === "number" ||
        typeof parsed.data.cursor === "string" ||
        typeof parsed.data.q === "string";

      if (!usePagination) {
        const conversations = await listConversations(request.authUser.userId);
        return { conversations };
      }

      const result = await listConversationsPage(request.authUser.userId, {
        limit: parsed.data.limit,
        cursor: parsed.data.cursor,
        search: parsed.data.q,
        status: parsed.data.status,
        channel: parsed.data.channel,
        aiMode: parsed.data.aiMode,
        assignment: parsed.data.assignment,
        labelId: parsed.data.labelId,
        leadKind: parsed.data.leadKind,
        priority: parsed.data.priority,
        stage: parsed.data.stage
      });

      return {
        items: result.items,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore
      };
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
    "/api/conversations/facets",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = ConversationsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid conversation facets query" });
      }

      const userId = request.authUser.userId;
      const [folders, stages, channels] = await Promise.all([
        countConversationFacet(
          userId,
          parsed.data,
          `CASE
             WHEN c.status = 'open' AND COALESCE(crs.unread_count, 0) > 0 THEN 'pending'
             ELSE COALESCE(c.status, 'open')
           END`,
          "status"
        ),
        countConversationFacet(
          userId,
          parsed.data,
          `CASE
             WHEN COALESCE(c.score, 0) >= 70 THEN 'hot'
             WHEN COALESCE(c.score, 0) >= 40 THEN 'warm'
             ELSE 'cold'
           END`,
          "stage"
        ),
        countConversationFacet(userId, parsed.data, `COALESCE(c.channel_type, 'qr')`, "channel")
      ]);

      const total = Object.values(await countConversationFacet(userId, parsed.data, `'all'`, "status"))[0] ?? 0;
      const open = await countConversationFacet(userId, { ...parsed.data, status: undefined }, `COALESCE(c.status, 'open')`, "status");

      return {
        folders: {
          all: total,
          open: open.open ?? 0,
          pending: folders.pending ?? 0,
          resolved: open.resolved ?? 0,
          snoozed: open.snoozed ?? 0
        },
        stages: {
          hot: stages.hot ?? 0,
          warm: stages.warm ?? 0,
          cold: stages.cold ?? 0
        },
        channels: {
          api: channels.api ?? 0,
          qr: channels.qr ?? 0,
          web: channels.web ?? 0
        }
      };
    }
  );

  fastify.get(
    "/api/conversations/:conversationId",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const params = request.params as { conversationId: string };
      const conversation = await getConversationForUser(request.authUser.userId, params.conversationId);
      if (!conversation) {
        return reply.status(404).send({ error: "Conversation not found" });
      }
      return { conversation };
    }
  );

  fastify.get(
    "/api/conversations/:conversationId/messages",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const params = request.params as { conversationId: string };
      const parsed = ConversationMessagesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid messages query" });
      }
      const exists = await pool.query(
        `SELECT id FROM conversations WHERE id = $1 AND user_id = $2`,
        [params.conversationId, request.authUser.userId]
      );

      if ((exists.rowCount ?? 0) === 0) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const result = await listConversationMessagesPage(params.conversationId, {
        limit: parsed.data.limit,
        before: parsed.data.before
      });
      return {
        items: result.items,
        messages: result.items,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore
      };
    }
  );

  fastify.get(
    "/api/conversations/:conversationId/automation",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { conversationId } = request.params as { conversationId: string };
      const exists = await getConversationForUser(request.authUser.userId, conversationId);
      if (!exists) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const result = await pool.query<{
        id: string;
        flow_id: string;
        flow_name: string | null;
        status: string;
        current_node_id: string | null;
        waiting_for: string | null;
        waiting_node_id: string | null;
        variables: Record<string, unknown> | null;
        updated_at: string;
        created_at: string;
      }>(
        `SELECT fs.id,
                fs.flow_id,
                f.name AS flow_name,
                fs.status,
                fs.current_node_id,
                fs.waiting_for,
                fs.waiting_node_id,
                fs.variables,
                fs.updated_at::text,
                fs.created_at::text
         FROM flow_sessions fs
         JOIN flows f ON f.id = fs.flow_id
         WHERE fs.conversation_id = $1
           AND f.user_id = $2
         ORDER BY CASE WHEN fs.status IN ('active', 'waiting', 'ai_mode') THEN 0 ELSE 1 END,
                  fs.updated_at DESC
         LIMIT 1`,
        [conversationId, request.authUser.userId]
      );

      return { automation: result.rows[0] ?? null };
    }
  );

  fastify.get(
    "/api/conversations/:conversationId/timeline",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { conversationId } = request.params as { conversationId: string };
      const exists = await pool.query(
        `SELECT id FROM conversations WHERE id = $1 AND user_id = $2`,
        [conversationId, request.authUser.userId]
      );

      if ((exists.rowCount ?? 0) === 0) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const result = await pool.query<ConversationTimelineEvent>(
        `WITH owned AS (
           SELECT id, user_id, phone_number, created_at
           FROM conversations
           WHERE id = $1 AND user_id = $2
         ),
         contact_match AS (
           SELECT ct.id
           FROM contacts ct
           JOIN owned o ON ct.user_id = o.user_id
            AND (
              ct.linked_conversation_id = o.id
              OR regexp_replace(ct.phone_number, '\\D', '', 'g') = regexp_replace(o.phone_number, '\\D', '', 'g')
            )
           ORDER BY CASE WHEN ct.linked_conversation_id = o.id THEN 0 ELSE 1 END, ct.updated_at DESC
           LIMIT 1
         )
         SELECT
           'conversation-started' AS id,
           'conversation_started' AS type,
           'Conversation started' AS label,
           NULL::text AS detail,
           o.created_at AS occurred_at
         FROM owned o

         UNION ALL

         SELECT
           'message-' || cm.id::text AS id,
           CASE
             WHEN COALESCE(cm.source_type, 'manual') = 'broadcast' THEN 'broadcast_sent'
             WHEN COALESCE(cm.source_type, 'manual') = 'sequence' THEN 'sequence_event'
             WHEN COALESCE(cm.message_type, 'text') = 'template'
               OR cm.message_content->>'type' = 'template'
               OR cm.message_text ILIKE '[Template:%' THEN 'template_sent'
             WHEN cm.direction = 'outbound' AND (COALESCE(cm.source_type, 'manual') = 'bot' OR cm.ai_model IS NOT NULL) THEN 'ai_reply'
             WHEN cm.direction = 'outbound' THEN 'human_reply'
             ELSE 'inbound_message'
           END AS type,
           CASE
             WHEN COALESCE(cm.source_type, 'manual') = 'broadcast' THEN 'Broadcast sent'
             WHEN COALESCE(cm.source_type, 'manual') = 'sequence' THEN 'Sequence message sent'
             WHEN COALESCE(cm.message_type, 'text') = 'template'
               OR cm.message_content->>'type' = 'template'
               OR cm.message_text ILIKE '[Template:%' THEN 'Template sent'
             WHEN cm.direction = 'outbound' AND (COALESCE(cm.source_type, 'manual') = 'bot' OR cm.ai_model IS NOT NULL) THEN 'AI replied'
             WHEN cm.direction = 'outbound' THEN 'Human replied'
             ELSE 'Customer replied'
           END AS label,
           COALESCE(
             NULLIF(cm.message_content->>'templateName', ''),
             NULLIF(cm.message_content->>'template_name', ''),
             NULLIF(cm.payload_json->>'templateName', ''),
             NULLIF(cm.sender_name, ''),
             NULLIF(cm.message_text, '')
           ) AS detail,
           cm.created_at AS occurred_at
         FROM conversation_messages cm
         JOIN owned o ON o.id = cm.conversation_id

         UNION ALL

         SELECT
           'flow-started-' || fs.id::text AS id,
           'flow_started' AS type,
           'Flow started' AS label,
           COALESCE(NULLIF(f.name, ''), fs.flow_id::text) AS detail,
           fs.created_at AS occurred_at
         FROM flow_sessions fs
         JOIN owned o ON o.id = fs.conversation_id
         LEFT JOIN flows f ON f.id = fs.flow_id

         UNION ALL

         SELECT
           'flow-status-' || fs.id::text AS id,
           'flow_event' AS type,
           CASE fs.status
             WHEN 'waiting' THEN 'Flow waiting'
             WHEN 'ai_mode' THEN 'Flow handed to AI'
             WHEN 'completed' THEN 'Flow completed'
             WHEN 'failed' THEN 'Flow failed'
             ELSE 'Flow active'
           END AS label,
           COALESCE(NULLIF(f.name, ''), fs.waiting_for, fs.current_node_id, fs.flow_id::text) AS detail,
           fs.updated_at AS occurred_at
         FROM flow_sessions fs
         JOIN owned o ON o.id = fs.conversation_id
         LEFT JOIN flows f ON f.id = fs.flow_id
         WHERE fs.updated_at > fs.created_at + INTERVAL '1 second'

         UNION ALL

         SELECT
           'sequence-started-' || se.id::text AS id,
           'sequence_started' AS type,
           'Sequence started' AS label,
           COALESCE(NULLIF(s.name, ''), se.sequence_id::text) AS detail,
           se.entered_at AS occurred_at
         FROM sequence_enrollments se
         JOIN sequences s ON s.id = se.sequence_id
         JOIN contact_match cmatch ON cmatch.id = se.contact_id
         JOIN owned o ON o.user_id = s.user_id

         UNION ALL

         SELECT
           'sequence-log-' || sl.id::text AS id,
           'sequence_event' AS type,
           CASE sl.status
             WHEN 'sent' THEN 'Sequence step sent'
             WHEN 'failed' THEN 'Sequence step failed'
             WHEN 'stopped' THEN 'Sequence stopped'
             WHEN 'skipped' THEN 'Sequence step skipped'
             WHEN 'retrying' THEN 'Sequence retry scheduled'
             ELSE 'Sequence updated'
           END AS label,
           COALESCE(NULLIF(sl.meta_json->>'templateName', ''), NULLIF(s.name, ''), sl.error_message) AS detail,
           sl.created_at AS occurred_at
         FROM sequence_logs sl
         JOIN sequence_enrollments se ON se.id = sl.enrollment_id
         JOIN sequences s ON s.id = sl.sequence_id
         JOIN contact_match cmatch ON cmatch.id = se.contact_id
         JOIN owned o ON o.user_id = s.user_id

         UNION ALL

         SELECT
           'campaign-message-' || cmsg.id::text AS id,
           'broadcast_sent' AS type,
           CASE cmsg.status
             WHEN 'queued' THEN 'Broadcast queued'
             WHEN 'sending' THEN 'Broadcast sending'
             WHEN 'sent' THEN 'Broadcast sent'
             WHEN 'delivered' THEN 'Broadcast delivered'
             WHEN 'read' THEN 'Broadcast read'
             WHEN 'failed' THEN 'Broadcast failed'
             ELSE 'Broadcast skipped'
           END AS label,
           c.name AS detail,
           COALESCE(cmsg.sent_at, cmsg.delivered_at, cmsg.read_at, cmsg.updated_at, cmsg.created_at) AS occurred_at
         FROM campaign_messages cmsg
         JOIN campaigns c ON c.id = cmsg.campaign_id
         JOIN owned o ON o.user_id = c.user_id
         LEFT JOIN contact_match cmatch ON cmatch.id = cmsg.contact_id
         WHERE cmatch.id IS NOT NULL
            OR regexp_replace(cmsg.phone_number, '\\D', '', 'g') = regexp_replace(o.phone_number, '\\D', '', 'g')

         ORDER BY occurred_at ASC
         LIMIT 80`,
        [conversationId, request.authUser.userId]
      );

      return {
        events: result.rows.map((event) => ({
          ...event,
          detail: cleanTimelineDetail(event.detail),
          occurred_at: event.occurred_at instanceof Date ? event.occurred_at.toISOString() : event.occurred_at
        }))
      };
    }
  );

  fastify.post(
    "/api/conversations/:conversationId/read",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
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
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
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
      let assignedAgentName: string | null = null;
      if (agentProfileId) {
        const agentExists = await pool.query<{ id: string; name: string }>(
          `SELECT id, name
           FROM agent_profiles
           WHERE id = $1
             AND user_id = $2
           LIMIT 1`,
          [agentProfileId, request.authUser.userId]
        );
        if ((agentExists.rowCount ?? 0) === 0) {
          return reply.status(404).send({ error: "Agent profile not found" });
        }
        assignedAgentName = agentExists.rows[0]?.name ?? null;
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

      realtimeHub.broadcast(request.authUser.userId, "conversation.assigned", {
        id: params.conversationId,
        agent_id: agentProfileId ?? null
      });

      void createAgentNotification({
        userId: request.authUser.userId,
        type: agentProfileId ? "assigned" : "unassigned",
        conversationId: params.conversationId,
        actorName: request.authUser.email.split("@")[0] || "Agent",
        body: agentProfileId
          ? `Conversation assigned to ${assignedAgentName ?? "an agent"}.`
          : "Conversation was unassigned."
      });

      return { ok: true };
    }
  );

  fastify.get(
    "/api/conversations/:conversationId/notes",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
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
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
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

        // Detect @mentions and create in-app notifications
        const mentionMatches = [...parsed.data.content.matchAll(/@(\S+)/g)];
        if (mentionMatches.length > 0) {
          const shortBody = parsed.data.content.slice(0, 120);
          try {
            const notif = await createAgentNotification({
              userId: request.authUser.userId,
              type: "mention",
              conversationId: params.conversationId,
              actorName: authorName,
              body: shortBody
            });
            if (notif) {
              realtimeHub.broadcast(request.authUser.userId, "conversation.mentioned", {
                conversationId: params.conversationId,
                noteId: note.id,
                actorName: authorName,
                body: shortBody
              });
            }
          } catch { /* non-fatal */ }
        }

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
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
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
          senderName,
          echoId: parsed.data.echoId ?? null
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
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
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
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
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

      if (buffer.length > 20 * 1024 * 1024) {
        return reply.status(400).send({ error: "File too large. Maximum 20 MB." });
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
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
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
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = AiAssistSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "Invalid input" });
      const { text, action, language } = parsed.data;
      const systemPrompt =
        action === "rewrite"
          ? "You are a professional WhatsApp business messaging assistant. Rewrite the given message to be clearer, more professional, and friendly. Return only the rewritten message text with no explanation or prefix."
          : `You are a professional translator. Translate the given message to ${language ?? "English"}. Return only the translated text with no explanation or prefix.`;
      try {
        await requireAiCredit(request.authUser.userId, "ai_text_assist", {
          estimatedTokens: estimateTextTokens(text) + estimateTextTokens(systemPrompt)
        });
      } catch (error) {
        if (error instanceof AiTokensDepletedError) {
          return reply.status(402).send({ error: "ai_tokens_depleted", message: error.message, balance: error.balance });
        }
        throw error;
      }
      const result = await aiService.generateReply(systemPrompt, text, undefined, { temperature: 0.5 });
      void chargeUser(request.authUser.userId, "ai_text_assist", {
        module: "inbox",
        model: result.model,
        promptTokens: result.usage?.promptTokens ?? 0,
        completionTokens: result.usage?.completionTokens ?? 0,
        totalTokens: result.usage?.totalTokens ?? 0
      });
      return { text: result.content.trim() };
    }
  );

  // ── inbox-v2: status change ──────────────────────────────────────────────
  const StatusSchema = z.object({
    status: z.enum(["open", "pending", "resolved", "snoozed"]),
    snoozed_until: z.string().datetime().optional()
  });

  fastify.patch(
    "/api/conversations/:conversationId/status",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { conversationId } = request.params as { conversationId: string };
      const parsed = StatusSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "Invalid status payload" });

      const { status, snoozed_until } = parsed.data;
      const result = await pool.query<{ id: string }>(
        `UPDATE conversations
         SET status = $1,
             snoozed_until = $2,
             updated_at = NOW()
         WHERE id = $3 AND user_id = $4
         RETURNING id`,
        [status, snoozed_until ?? null, conversationId, request.authUser.userId]
      );
      if ((result.rowCount ?? 0) === 0) return reply.status(404).send({ error: "Conversation not found" });

      realtimeHub.broadcastConversationStatusChanged(request.authUser.userId, {
        id: conversationId,
        status,
        snoozed_until
      });
      return { ok: true };
    }
  );

  // ── inbox-v2: priority change ────────────────────────────────────────────
  const PrioritySchema = z.object({
    priority: z.enum(["none", "low", "medium", "high", "urgent"])
  });

  fastify.patch(
    "/api/conversations/:conversationId/priority",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { conversationId } = request.params as { conversationId: string };
      const parsed = PrioritySchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "Invalid priority payload" });

      const result = await pool.query<{ id: string }>(
        `UPDATE conversations SET priority = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = $3 RETURNING id`,
        [parsed.data.priority, conversationId, request.authUser.userId]
      );
      if ((result.rowCount ?? 0) === 0) return reply.status(404).send({ error: "Conversation not found" });

      realtimeHub.broadcast(request.authUser.userId, "conversation.priority_changed", {
        id: conversationId,
        priority: parsed.data.priority
      });
      return { ok: true };
    }
  );

  // ── inbox-v2: labels ─────────────────────────────────────────────────────
  const LabelsSchema = z.object({ label_ids: z.array(z.string().uuid()) });

  fastify.put(
    "/api/conversations/:conversationId/labels",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { conversationId } = request.params as { conversationId: string };
      const parsed = LabelsSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "Invalid labels payload" });

      const exists = await pool.query(
        `SELECT id FROM conversations WHERE id = $1 AND user_id = $2`,
        [conversationId, request.authUser.userId]
      );
      if ((exists.rowCount ?? 0) === 0) return reply.status(404).send({ error: "Conversation not found" });

      await pool.query(`DELETE FROM conversation_labels WHERE conversation_id = $1`, [conversationId]);
      if (parsed.data.label_ids.length > 0) {
        const values = parsed.data.label_ids.map((_, i) => `($1, $${i + 2})`).join(", ");
        await pool.query(
          `INSERT INTO conversation_labels (conversation_id, label_id) VALUES ${values}
           ON CONFLICT DO NOTHING`,
          [conversationId, ...parsed.data.label_ids]
        );
      }

      realtimeHub.broadcastConversationLabelChanged(request.authUser.userId, conversationId, parsed.data.label_ids);
      return { ok: true };
    }
  );

  // ── inbox-v2: typing indicator ────────────────────────────────────────────
  const TypingSchema = z.object({ typing: z.boolean() });

  fastify.post(
    "/api/conversations/:conversationId/typing",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { conversationId } = request.params as { conversationId: string };
      const parsed = TypingSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "Invalid typing payload" });

      realtimeHub.broadcastTyping(request.authUser.userId, conversationId, parsed.data.typing, request.authUser.userId, true);
      return { ok: true };
    }
  );

  // ── inbox-v2: retry failed message ───────────────────────────────────────
  fastify.post(
    "/api/conversations/:conversationId/messages/:messageId/retry",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { conversationId, messageId } = request.params as { conversationId: string; messageId: string };

      try {
        const result = await retryConversationOutboundMessage({
          userId: request.authUser.userId,
          conversationId,
          messageId
        });

        realtimeHub.broadcastMessageUpdated(request.authUser.userId, {
          messageId,
          conversationId,
          deliveryStatus: result.deliveryStatus,
          retryCount: result.retryCount
        });
        return { ok: true, queued: true, retryCount: result.retryCount };
      } catch (error) {
        const message = (error as Error).message;
        if (message.toLowerCase().includes("not found")) {
          return reply.status(404).send({ error: message });
        }
        return reply.status(400).send({ error: message });
      }
    }
  );

  // ── inbox-v2: messages with direction cursor (after) ─────────────────────
  fastify.get(
    "/api/conversations/:conversationId/messages/after",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { conversationId } = request.params as { conversationId: string };
      const query = request.query as { cursor?: string; limit?: string };

      const exists = await pool.query(
        `SELECT id FROM conversations WHERE id = $1 AND user_id = $2`,
        [conversationId, request.authUser.userId]
      );
      if ((exists.rowCount ?? 0) === 0) return reply.status(404).send({ error: "Conversation not found" });

      const limit = Math.min(Number(query.limit) || 30, 50);
      const cursor = query.cursor ?? null;

      type AfterMsgRow = { id: string; conversation_id: string; direction: string; sender_name: string | null; message_text: string; content_type: string; is_private: boolean; in_reply_to_id: string | null; echo_id: string | null; delivery_status: string; error_code: string | null; error_message: string | null; retry_count: number; created_at: Date };
      let messages: AfterMsgRow[] = [];
      if (cursor) {
        const result = await pool.query<AfterMsgRow>(
          `SELECT id, conversation_id, direction, sender_name, message_text, content_type,
                  is_private, in_reply_to_id, echo_id, delivery_status, error_code, error_message, retry_count, created_at
           FROM conversation_messages
           WHERE conversation_id = $1 AND id > $2
           ORDER BY created_at ASC, id ASC
           LIMIT $3`,
          [conversationId, cursor, limit]
        );
        messages = result.rows;
      } else {
        messages = [];
      }

      return { messages, items: messages, hasMore: messages.length === limit };
    }
  );

  // ── inbox-v2: bulk actions ────────────────────────────────────────────────
  const BulkActionSchema = z.object({
    ids: z.array(z.string().uuid()).min(1).max(100),
    action: z.enum(["resolve", "assign", "label", "snooze", "reopen"]),
    payload: z.record(z.unknown()).optional()
  });

  fastify.post(
    "/api/conversations/bulk",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = BulkActionSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "Invalid bulk action payload" });

      const { ids, action, payload } = parsed.data;
      const userId = request.authUser.userId;

      const placeholders = ids.map((_, i) => `$${i + 2}`).join(", ");

      if (action === "resolve" || action === "reopen") {
        const status = action === "resolve" ? "resolved" : "open";
        await pool.query(
          `UPDATE conversations SET status = $1, updated_at = NOW()
           WHERE id IN (${placeholders}) AND user_id = $${ids.length + 2}`,
          [status, ...ids, userId]
        );
      } else if (action === "assign") {
        const agentId = (payload as { agentId?: string })?.agentId ?? null;
        await pool.query(
          `UPDATE conversations SET assigned_agent_profile_id = $1, updated_at = NOW()
           WHERE id IN (${placeholders}) AND user_id = $${ids.length + 2}`,
          [agentId, ...ids, userId]
        );
      } else if (action === "label") {
        const labelIds = ((payload as { label_ids?: string[] })?.label_ids ?? []) as string[];
        for (const convId of ids) {
          await pool.query(`DELETE FROM conversation_labels WHERE conversation_id = $1`, [convId]);
          if (labelIds.length > 0) {
            const vals = labelIds.map((_, i) => `($1, $${i + 2})`).join(", ");
            await pool.query(
              `INSERT INTO conversation_labels (conversation_id, label_id) VALUES ${vals} ON CONFLICT DO NOTHING`,
              [convId, ...labelIds]
            );
          }
        }
      } else if (action === "snooze") {
        const snoozedUntil = (payload as { snoozed_until?: string })?.snoozed_until ?? null;
        await pool.query(
          `UPDATE conversations SET status = 'snoozed', snoozed_until = $1, updated_at = NOW()
           WHERE id IN (${placeholders}) AND user_id = $${ids.length + 2}`,
          [snoozedUntil, ...ids, userId]
        );
      }

      realtimeHub.broadcastBulkUpdated(userId, { ids, action, payload: payload as Record<string, unknown> | undefined });
      return { ok: true, count: ids.length };
    }
  );

  // ── inbox-v2: search conversations ───────────────────────────────────────
  const SearchQuerySchema = z.object({
    q: z.string().trim().min(1).max(200),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20)
  });

  fastify.get(
    "/api/conversations/search",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = SearchQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.status(400).send({ error: "Invalid search query" });

      const { q, limit } = parsed.data;
      const pattern = `%${q}%`;

      const result = await pool.query(
        `SELECT c.* FROM conversations c
         LEFT JOIN contacts ct ON ct.phone_number = c.phone_number AND ct.user_id = c.user_id
         WHERE c.user_id = $1
           AND (
             ct.display_name ILIKE $2 OR
             c.phone_number ILIKE $2 OR
             EXISTS (
               SELECT 1 FROM conversation_messages m
               WHERE m.conversation_id = c.id AND m.message_text ILIKE $2
               LIMIT 1
             )
           )
         ORDER BY c.updated_at DESC
         LIMIT $3`,
        [request.authUser.userId, pattern, limit]
      );
      return { items: result.rows, conversations: result.rows };
    }
  );

  // ── inbox-v2: get label IDs for a conversation ───────────────────────────
  fastify.get(
    "/api/conversations/:conversationId/labels",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { conversationId } = request.params as { conversationId: string };
      const exists = await pool.query(
        `SELECT id FROM conversations WHERE id = $1 AND user_id = $2`,
        [conversationId, request.authUser.userId]
      );
      if ((exists.rowCount ?? 0) === 0) return reply.status(404).send({ error: "Conversation not found" });

      const result = await pool.query<{ label_id: string }>(
        `SELECT label_id FROM conversation_labels WHERE conversation_id = $1`,
        [conversationId]
      );
      return { label_ids: result.rows.map((r) => r.label_id) };
    }
  );

  // ── CSAT ─────────────────────────────────────────────────────────────────
  fastify.patch(
    "/api/conversations/:conversationId/csat",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { conversationId } = request.params as { conversationId: string };
      const { rating } = request.body as { rating: unknown };
      if (!Number.isInteger(rating) || (rating as number) < 1 || (rating as number) > 5) {
        return reply.status(400).send({ error: "Rating must be integer 1–5" });
      }
      const exists = await pool.query(
        `SELECT id FROM conversations WHERE id = $1 AND user_id = $2`,
        [conversationId, request.authUser.userId]
      );
      if ((exists.rowCount ?? 0) === 0) return reply.status(404).send({ error: "Conversation not found" });

      await pool.query(
        `UPDATE conversations SET csat_rating = $1 WHERE id = $2`,
        [rating, conversationId]
      );
      return { ok: true };
    }
  );

  fastify.post(
    "/api/conversations/:conversationId/csat/send",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { conversationId } = request.params as { conversationId: string };
      const exists = await pool.query(
        `SELECT id FROM conversations WHERE id = $1 AND user_id = $2`,
        [conversationId, request.authUser.userId]
      );
      if ((exists.rowCount ?? 0) === 0) return reply.status(404).send({ error: "Conversation not found" });

      try {
        await sendManualConversationMessage({
          userId: request.authUser.userId,
          conversationId,
          text: "How would you rate your experience today? Please reply with a number from 1 (poor) to 5 (excellent). ⭐",
          senderName: null
        });
        await pool.query(
          `UPDATE conversations SET csat_sent_at = NOW() WHERE id = $1`,
          [conversationId]
        );
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to send CSAT survey";
        return reply.status(500).send({ error: msg });
      }
    }
  );

  fastify.get(
    "/api/media/:mediaId",
    { config: { rateLimit: { max: 200, timeWindow: "1 minute" } } },
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

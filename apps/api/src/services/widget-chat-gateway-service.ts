import type { FastifyInstance } from "fastify";
import type { RawData, WebSocket } from "ws";
import { pool } from "../db/pool.js";
import { getOrCreateConversation, incrementConversationUnreadCount } from "./conversation-service.js";
import { syncConversationContact } from "./contacts-service.js";
import { processIncomingMessage, type ProcessIncomingMessageResult } from "./message-router-service.js";
import { getUserById } from "./user-service.js";
import {
  addWidgetConnection,
  getWidgetConnections,
  removeWidgetConnection
} from "./widget-connection-registry.js";

type WidgetSocketEvent =
  | { event: "ready"; data: { visitorId: string } }
  | { event: "message"; data: { sender: "ai" | "system"; text: string; reason?: string } }
  | { event: "error"; data: { message: string } };

interface WidgetInboundPayload {
  type?: string;
  message?: string;
  visitorId?: string;
  wid?: string;
  name?: string;
  phone?: string;
  email?: string;
}

const widgetLeadProfiles = new Map<string, { name: string; phone: string; email: string }>();

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isLikelyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeVisitorId(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) {
    return "";
  }
  return raw.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 128);
}

function normalizeLeadName(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function normalizeLeadPhone(value: string | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    return "";
  }
  return digits;
}

function normalizeLeadEmail(value: string | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized.slice(0, 160) : "";
}

function sendEvent(socket: WebSocket, event: WidgetSocketEvent): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(event));
}

function getWidgetSystemMessage(reason: ProcessIncomingMessageResult["reason"]): string {
  switch (reason) {
    case "auto_reply_disabled":
      return "Automated replies are turned off right now. Enable the agent to keep testing live answers.";
    case "manual_takeover":
      return "This conversation is in manual takeover mode, so the chatbot will not answer until AI is resumed.";
    case "conversation_paused":
      return "AI replies are paused for this conversation. Resume automation and try again.";
    case "no_matching_flow":
      return "No chatbot flow matched this message. Add a matching flow or a default AI step, then test again.";
    case "flow_error":
      return "The chatbot flow hit an error while processing this test. Review the flow setup and AI Review Center logs.";
    case "external_bot_detected":
      return "Automation was paused because another bot may already be replying on this channel.";
    case "missing_channel_adapter":
      return "The website widget channel is missing a reply adapter. Please verify the channel setup.";
    case "missing_user":
      return "The workspace for this widget test could not be found.";
    case "sender_is_agent_number":
      return "This sender is protected from bot loops, so the chatbot did not auto-reply.";
    case "insufficient_credits":
      return "The workspace is out of credits, so automated replies are currently paused.";
    default:
      return "The live widget did not send an automated reply for this message.";
  }
}

async function persistWidgetLeadProfile(input: {
  userId: string;
  visitorId: string;
  profile: { name: string; phone: string; email: string };
}): Promise<void> {
  const conversation = await getOrCreateConversation(input.userId, `web:${input.visitorId}`, {
    channelType: "web",
    channelLinkedNumber: "web"
  });

  const leadMessage = `Lead details captured: Name=${input.profile.name}, Phone=${input.profile.phone}, Email=${input.profile.email}`;

  const latest = await pool.query<{ message_text: string; sender_name: string | null }>(
    `SELECT message_text, sender_name
     FROM conversation_messages
     WHERE conversation_id = $1
       AND direction = 'inbound'
     ORDER BY created_at DESC
     LIMIT 1`,
    [conversation.id]
  );

  const latestRow = latest.rows[0];
  if (latestRow?.message_text === leadMessage && latestRow?.sender_name === input.profile.name) {
    return;
  }

  await pool.query(
    `INSERT INTO conversation_messages (conversation_id, direction, sender_name, message_text)
     VALUES ($1, 'inbound', $2, $3)`,
    [conversation.id, input.profile.name, leadMessage]
  );

  await pool.query(
    `UPDATE conversations
     SET channel_type = 'web',
         channel_linked_number = 'web',
         last_message = $2,
         last_message_at = NOW()
     WHERE id = $1`,
    [conversation.id, leadMessage]
  );
  await incrementConversationUnreadCount(input.userId, conversation.id);

  await syncConversationContact({
    userId: input.userId,
    phoneNumber: input.profile.phone,
    displayName: input.profile.name,
    email: input.profile.email,
    contactType: "lead",
    sourceType: "web",
    linkedConversationId: conversation.id
  });
}

export async function sendWidgetConversationMessage(input: {
  userId: string;
  customerIdentifier: string;
  text: string;
}): Promise<boolean> {
  const identifier = input.customerIdentifier.trim();
  const visitorId = identifier.startsWith("web:") ? identifier.slice("web:".length).trim() : identifier;
  if (!visitorId) {
    return false;
  }

  const sockets = getWidgetConnections(input.userId, visitorId);
  if (!sockets || sockets.size === 0) {
    return false;
  }

  const event: WidgetSocketEvent = {
    event: "message",
    data: {
      sender: "ai",
      text: input.text
    }
  };

  let delivered = false;
  for (const socket of sockets) {
    if (socket.readyState !== socket.OPEN) {
      continue;
    }
    sendEvent(socket, event);
    delivered = true;
  }

  return delivered;
}

export async function registerWidgetChatGatewayRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/ws/widget",
    { websocket: true },
    async (socket, request) => {
      const query = request.query as Record<string, string | undefined>;
      const wid = (query.wid ?? "").trim();
      const visitorId = normalizeVisitorId(query.visitorId);

      if (!isLikelyUuid(wid)) {
        sendEvent(socket, { event: "error", data: { message: "Invalid workspace id." } });
        socket.close(1008, "Invalid workspace id");
        return;
      }
      if (!visitorId) {
        sendEvent(socket, { event: "error", data: { message: "Missing visitor id." } });
        socket.close(1008, "Missing visitor id");
        return;
      }

      const workspace = await getUserById(wid);
      if (!workspace) {
        sendEvent(socket, { event: "error", data: { message: "Workspace not found." } });
        socket.close(1008, "Workspace not found");
        return;
      }

      sendEvent(socket, { event: "ready", data: { visitorId } });
      addWidgetConnection(wid, visitorId, socket);

      socket.on("message", async (raw: RawData) => {
        const parsed = safeJsonParse(raw.toString()) as WidgetInboundPayload | null;
        if (!parsed) {
          return;
        }

        if (parsed.type === "lead_profile") {
          const name = normalizeLeadName(parsed.name);
          const phone = normalizeLeadPhone(parsed.phone);
          const email = normalizeLeadEmail(parsed.email);
          if (!name || !phone || !email) {
            sendEvent(socket, {
              event: "error",
              data: { message: "Name, phone, and email are required before chat." }
            });
            return;
          }

          const key = `${wid}::${visitorId}`;
          widgetLeadProfiles.set(key, { name, phone, email });

          try {
            await persistWidgetLeadProfile({
              userId: wid,
              visitorId,
              profile: { name, phone, email }
            });
          } catch (error) {
            sendEvent(socket, {
              event: "error",
              data: { message: (error as Error).message || "Could not save lead profile." }
            });
            return;
          }

          sendEvent(socket, {
            event: "message",
            data: {
              sender: "system",
              text: `Thanks ${name}. You can start chatting now.`
            }
          });
          return;
        }

        if (parsed.type !== "message") {
          return;
        }

        const inboundText = (parsed.message ?? "").trim();
        if (!inboundText) {
          return;
        }

        const rememberedProfile = widgetLeadProfiles.get(`${wid}::${visitorId}`);

        try {
          const result = await processIncomingMessage({
            userId: wid,
            channelType: "web",
            customerIdentifier: `web:${visitorId}`,
            messageText: inboundText,
            senderName: rememberedProfile?.name,
            shouldAutoReply: Boolean(workspace.ai_active),
            sendReply: async ({ text }) => {
              sendEvent(socket, {
                event: "message",
                data: {
                  sender: "ai",
                  text
                }
              });
            }
          });

          if (!result.autoReplySent) {
            sendEvent(socket, {
              event: "message",
              data: {
                sender: "system",
                text: getWidgetSystemMessage(result.reason),
                reason: result.reason
              }
            });
          }
        } catch (error) {
          sendEvent(socket, {
            event: "error",
            data: {
              message: (error as Error).message || "Message processing failed."
            }
          });
        }
      });

      socket.on("close", () => {
        removeWidgetConnection(wid, visitorId, socket);
      });
    }
  );
}

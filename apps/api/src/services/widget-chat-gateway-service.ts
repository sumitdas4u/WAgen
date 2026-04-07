import type { FastifyInstance } from "fastify";
import type { RawData, WebSocket } from "ws";
import { pool } from "../db/pool.js";
import { getOrCreateConversation } from "./conversation-service.js";
import { syncConversationContact } from "./contacts-service.js";
import { processIncomingMessage } from "./message-router-service.js";
import { getUserById } from "./user-service.js";

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

const widgetConnections = new Map<string, Set<WebSocket>>();
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

function connectionKey(userId: string, visitorId: string): string {
  return `${userId}::${visitorId}`;
}

function addWidgetConnection(userId: string, visitorId: string, socket: WebSocket): void {
  const key = connectionKey(userId, visitorId);
  const sockets = widgetConnections.get(key) ?? new Set<WebSocket>();
  sockets.add(socket);
  widgetConnections.set(key, sockets);
}

function removeWidgetConnection(userId: string, visitorId: string, socket: WebSocket): void {
  const key = connectionKey(userId, visitorId);
  const sockets = widgetConnections.get(key);
  if (!sockets) {
    return;
  }
  sockets.delete(socket);
  if (sockets.size === 0) {
    widgetConnections.delete(key);
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

  const key = connectionKey(input.userId, visitorId);
  const sockets = widgetConnections.get(key);
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

          const key = connectionKey(wid, visitorId);
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

        const rememberedProfile = widgetLeadProfiles.get(connectionKey(wid, visitorId));

        try {
          const result = await processIncomingMessage({
            userId: wid,
            channelType: "web",
            customerIdentifier: `web:${visitorId}`,
            messageText: inboundText,
            senderName: rememberedProfile?.name,
            shouldAutoReply: true,
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

          if (
            !result.autoReplySent &&
            result.reason !== "auto_reply_disabled" &&
            result.reason !== "flow_error" &&
            result.reason !== "no_matching_flow"
          ) {
            sendEvent(socket, {
              event: "message",
              data: {
                sender: "system",
                text: "Chat is currently in manual mode. A human agent will reply.",
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

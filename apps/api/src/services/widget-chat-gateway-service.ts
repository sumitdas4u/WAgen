import type { FastifyInstance } from "fastify";
import type { RawData, WebSocket } from "ws";
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
}

const widgetConnections = new Map<string, Set<WebSocket>>();

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
        if (!parsed || parsed.type !== "message") {
          return;
        }

        const inboundText = (parsed.message ?? "").trim();
        if (!inboundText) {
          return;
        }

        try {
          const result = await processIncomingMessage({
            userId: wid,
            channelType: "web",
            customerIdentifier: `web:${visitorId}`,
            messageText: inboundText,
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

          if (!result.autoReplySent && result.reason !== "auto_reply_disabled") {
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

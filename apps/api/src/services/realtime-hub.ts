import type { FastifyInstance } from "fastify";
import type { RawData, WebSocket } from "ws";
import type {
  MessageCreatedPayload,
  MessageUpdatedPayload,
  ConversationUpdatedPayload,
  ConversationStatusChangedPayload,
  TypingPayload,
  BulkUpdatedPayload
} from "../types/ws-events.js";

interface AuthPayload {
  userId: string;
}

class RealtimeHub {
  private readonly connections = new Map<string, Set<WebSocket>>();
  private readonly typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  addConnection(userId: string, socket: WebSocket) {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }
    this.connections.get(userId)?.add(socket);
  }

  removeConnection(userId: string, socket: WebSocket) {
    const sockets = this.connections.get(userId);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size === 0) {
      this.connections.delete(userId);
    }
  }

  broadcast(userId: string, event: string, data: unknown) {
    const sockets = this.connections.get(userId);
    if (!sockets) return;
    const serialized = JSON.stringify({ v: 1, event, data });
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) {
        socket.send(serialized);
      }
    }
  }

  broadcastMessageCreated(userId: string, payload: MessageCreatedPayload) {
    this.broadcast(userId, "message.created", payload);
  }

  broadcastMessageUpdated(userId: string, payload: MessageUpdatedPayload) {
    this.broadcast(userId, "message.updated", payload);
  }

  broadcastConversationUpdated(userId: string, payload: ConversationUpdatedPayload) {
    this.broadcast(userId, "conversation.updated", payload);
  }

  broadcastConversationCreated(userId: string, payload: ConversationUpdatedPayload) {
    this.broadcast(userId, "conversation.created", payload);
  }

  broadcastConversationStatusChanged(userId: string, payload: ConversationStatusChangedPayload) {
    this.broadcast(userId, "conversation.status_changed", payload);
  }

  broadcastConversationRead(userId: string, conversationId: string) {
    this.broadcast(userId, "conversation.read", { conversation_id: conversationId });
  }

  broadcastConversationLabelChanged(userId: string, conversationId: string, labelIds: string[]) {
    this.broadcast(userId, "conversation.label_changed", { id: conversationId, label_ids: labelIds });
  }

  broadcastBulkUpdated(userId: string, payload: BulkUpdatedPayload) {
    this.broadcast(userId, "conversations.bulk_updated", payload);
  }

  broadcastTyping(userId: string, convId: string, on: boolean, senderId: string, isAgent: boolean) {
    const key = `${userId}:${convId}:${senderId}`;
    const typingPayload: TypingPayload = { conversation_id: convId, user_id: senderId, is_agent: isAgent };

    if (on) {
      clearTimeout(this.typingTimers.get(key));
      this.typingTimers.set(key, setTimeout(() => {
        this.broadcast(userId, "conversation.typing_off", typingPayload);
        this.typingTimers.delete(key);
      }, 30_000));
      this.broadcast(userId, "conversation.typing_on", typingPayload);
    } else {
      clearTimeout(this.typingTimers.get(key));
      this.typingTimers.delete(key);
      this.broadcast(userId, "conversation.typing_off", typingPayload);
    }
  }
}

export const realtimeHub = new RealtimeHub();

export async function registerRealtimeRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/ws",
    { websocket: true, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (socket, req) => {
      const token = (req.query as Record<string, string | undefined>).token;
      if (!token) {
        socket.close(1008, "Missing token");
        return;
      }

      let userId: string;
      try {
        const payload = await fastify.jwt.verify<AuthPayload>(token);
        userId = payload.userId;
      } catch {
        socket.close(1008, "Invalid token");
        return;
      }

      realtimeHub.addConnection(userId, socket);

      socket.on("message", (raw: RawData) => {
        const text = raw.toString();
        if (text === "ping") {
          socket.send(JSON.stringify({ event: "pong", data: Date.now() }));
        }
      });

      socket.on("close", () => {
        realtimeHub.removeConnection(userId, socket);
      });
    }
  );
}

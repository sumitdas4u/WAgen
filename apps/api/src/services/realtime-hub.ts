import type { FastifyInstance } from "fastify";
import type { RawData, WebSocket } from "ws";

interface AuthPayload {
  userId: string;
}

type RealtimeEvent =
  | "whatsapp.qr"
  | "whatsapp.status"
  | "conversation.updated"
  | "agent.status";

interface OutgoingEvent {
  event: RealtimeEvent;
  data: unknown;
}

class RealtimeHub {
  private readonly connections = new Map<string, Set<WebSocket>>();

  addConnection(userId: string, socket: WebSocket) {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }

    this.connections.get(userId)?.add(socket);
  }

  removeConnection(userId: string, socket: WebSocket) {
    const sockets = this.connections.get(userId);
    if (!sockets) {
      return;
    }

    sockets.delete(socket);
    if (sockets.size === 0) {
      this.connections.delete(userId);
    }
  }

  broadcast(userId: string, event: RealtimeEvent, data: unknown) {
    const sockets = this.connections.get(userId);
    if (!sockets) {
      return;
    }

    const payload: OutgoingEvent = { event, data };
    const serialized = JSON.stringify(payload);

    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) {
        socket.send(serialized);
      }
    }
  }
}

export const realtimeHub = new RealtimeHub();

export async function registerRealtimeRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/ws",
    { websocket: true },
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
        // Keepalive / future commands channel.
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

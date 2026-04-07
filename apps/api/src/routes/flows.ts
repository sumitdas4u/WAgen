import type { FastifyInstance } from "fastify";
import {
  createFlow,
  deleteFlow,
  getFlow,
  getPublishedFlowsForUser,
  listFlowSummaries,
  publishFlow,
  updateFlow
} from "../services/flow-service.js";
import { generateFlowDraft } from "../services/flow-draft-generator-service.js";
import { pool } from "../db/pool.js";
import { startFlowForConversation } from "../services/flow-engine-service.js";
import { sendConversationFlowMessage } from "../services/channel-outbound-service.js";
import * as net from "net";

function isBlockedHostname(hostname: string): boolean {
  const lowerHost = hostname.toLowerCase();

  // Block obvious internal hostnames
  if (
    lowerHost === "localhost" ||
    lowerHost === "127.0.0.1" ||
    lowerHost === "::1"
  ) {
    return true;
  }

  // If it's an IP address, block private, loopback and link-local ranges
  const ipVersion = net.isIP(lowerHost);
  if (ipVersion === 4) {
    const parts = lowerHost.split(".").map((p) => Number(p));
    const [a, b] = parts;
    // 10.0.0.0/8
    if (a === 10) return true;
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    // 127.0.0.0/8
    if (a === 127) return true;
    // 169.254.0.0/16 (link-local)
    if (a === 169 && b === 254) return true;
  } else if (ipVersion === 6) {
    // Block IPv6 loopback and link-local ranges
    if (lowerHost === "::1") return true;
    if (lowerHost.startsWith("fe80:")) return true;
    if (lowerHost.startsWith("fc00:") || lowerHost.startsWith("fd00:")) return true;
  }

  return false;
}

export async function flowRoutes(app: FastifyInstance) {
  const serializeFlow = (flow: Awaited<ReturnType<typeof getFlow>>) => {
    if (!flow) {
      return null;
    }
    return {
      id: flow.id,
      name: flow.name,
      channel: flow.channel,
      published: flow.published,
      isDefaultReply: flow.is_default_reply,
      createdAt: flow.created_at,
      updatedAt: flow.updated_at,
      nodes: flow.nodes,
      edges: flow.edges,
      triggers: flow.triggers
    };
  };

  const serializeFlowSummary = (
    flow: Awaited<ReturnType<typeof listFlowSummaries>>[number]
  ) => ({
    id: flow.id,
    name: flow.name,
    channel: flow.channel,
    published: flow.published,
    isDefaultReply: flow.is_default_reply,
    createdAt: flow.created_at,
    updatedAt: flow.updated_at,
    nodeCount: Number(flow.node_count ?? 0),
    edgeCount: Number(flow.edge_count ?? 0),
    triggerCount: Number(flow.trigger_count ?? 0)
  });

  app.get("/api/flows", { preHandler: app.requireAuth }, async (req, reply) => {
    const userId = req.authUser!.userId;
    const flows = await listFlowSummaries(userId);
    return reply.send(flows.map(serializeFlowSummary));
  });

  app.post<{ Body: { prompt?: string; channel?: "web" | "qr" | "api" } }>(
    "/api/flows/generate-draft",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
      const channel = req.body?.channel;
      if (!prompt) {
        return reply.status(400).send({ error: "Prompt is required." });
      }
      if (channel !== "web" && channel !== "qr" && channel !== "api") {
        return reply.status(400).send({ error: "A valid channel is required." });
      }

      try {
        const draft = await generateFlowDraft({ prompt, channel });
        return reply.send(draft);
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message || "Could not generate flow draft." });
      }
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/flows/:id",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const userId = req.authUser!.userId;
      const flow = await getFlow(userId, req.params.id);
      if (!flow) return reply.status(404).send({ error: "Flow not found" });
      return reply.send(serializeFlow(flow));
    }
  );

  app.post<{ Body: { name?: string; nodes?: unknown[]; edges?: unknown[]; triggers?: unknown[] } }>(
    "/api/flows",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const userId = req.authUser!.userId;
      const flow = await createFlow(userId, req.body as Parameters<typeof createFlow>[1]);
      return reply.status(201).send(serializeFlow(flow));
    }
  );

  app.put<{ Params: { id: string }; Body: { name?: string; nodes?: unknown[]; edges?: unknown[]; triggers?: unknown[]; isDefaultReply?: boolean } }>(
    "/api/flows/:id",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const userId = req.authUser!.userId;
      const { isDefaultReply, ...rest } = req.body as { name?: string; nodes?: unknown[]; edges?: unknown[]; triggers?: unknown[]; isDefaultReply?: boolean };
      const flow = await updateFlow(userId, req.params.id, {
        ...(rest as Parameters<typeof updateFlow>[2]),
        ...(isDefaultReply !== undefined ? { is_default_reply: isDefaultReply } : {})
      });
      if (!flow) return reply.status(404).send({ error: "Flow not found" });
      return reply.send(serializeFlow(flow));
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/flows/:id",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const userId = req.authUser!.userId;
      const deleted = await deleteFlow(userId, req.params.id);
      if (!deleted) return reply.status(404).send({ error: "Flow not found" });
      return reply.status(204).send();
    }
  );

  app.post<{ Params: { id: string }; Body: { published: boolean } }>(
    "/api/flows/:id/publish",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const userId = req.authUser!.userId;
      const published = req.body?.published ?? true;
      const flow = await publishFlow(userId, req.params.id, published);
      if (!flow) return reply.status(404).send({ error: "Flow not found" });
      return reply.send(serializeFlow(flow));
    }
  );

  app.get(
    "/api/flows/published",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const userId = req.authUser!.userId;
      const flows = await getPublishedFlowsForUser(userId);
      return reply.send(flows.map(f => ({ id: f.id, name: f.name, channel: f.channel })));
    }
  );

  app.post<{ Params: { id: string }; Body: { conversationId: string } }>(
    "/api/flows/:id/assign",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const userId = req.authUser!.userId;
      const { conversationId } = req.body ?? {};
      if (!conversationId) return reply.status(400).send({ error: "conversationId required" });

      const flow = await getFlow(userId, req.params.id);
      if (!flow) return reply.status(404).send({ error: "Flow not found" });
      if (!flow.published) return reply.status(400).send({ error: "Flow is not published" });

      const convRes = await pool.query(
        "SELECT id FROM conversations WHERE id = $1 AND user_id = $2 LIMIT 1",
        [conversationId, userId]
      );
      if (!convRes.rows[0]) return reply.status(404).send({ error: "Conversation not found" });

      try {
        const session = await startFlowForConversation({
          userId,
          flowId: flow.id,
          conversationId,
          sendReply: async (payload) => {
            await sendConversationFlowMessage({
              userId,
              conversationId,
              payload
            });
          }
        });

        return reply.status(201).send({ sessionId: session.id, flowId: flow.id, flowName: flow.name });
      } catch (error) {
        const message = (error as Error).message || "Could not start flow.";
        const statusCode = message.includes("does not match conversation channel") ? 400 : 500;
        return reply.status(statusCode).send({ error: message });
      }
    }
  );

  // ── Test API Request (proxies a user-configured HTTP call from the editor) ──
  app.post<{
    Body: {
      method: string;
      url: string;
      headers?: Array<{ key: string; value: string }>;
      bodyMode?: string;
      body?: string;
      timeoutMs?: number;
    };
  }>(
    "/api/flows/test-api-request",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { method, url, headers = [], bodyMode = "none", body = "", timeoutMs = 15000 } = req.body ?? {};

      if (!url || typeof url !== "string" || !url.startsWith("http")) {
        return reply.status(400).send({ error: "A valid URL starting with http/https is required." });
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return reply.status(400).send({ error: "Invalid URL format." });
      }

      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return reply.status(400).send({ error: "Only http and https protocols are allowed." });
      }

      if (!parsedUrl.hostname || isBlockedHostname(parsedUrl.hostname)) {
        return reply
          .status(400)
          .send({ error: "Requests to internal or disallowed hosts are not permitted." });
      }

      const safeMethod = ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(
        String(method).toUpperCase()
      )
        ? String(method).toUpperCase()
        : "GET";

      const safeTimeout = Math.min(Math.max(Number(timeoutMs) || 15000, 1000), 30000);

      const reqHeaders = new Headers();
      reqHeaders.set("accept", "application/json, text/plain;q=0.9, */*;q=0.8");
      for (const h of headers) {
        if (h.key?.trim()) reqHeaders.set(h.key.trim(), String(h.value ?? ""));
      }

      const hasBody = !["GET", "DELETE"].includes(safeMethod) && bodyMode !== "none" && body?.trim();
      if (hasBody && bodyMode === "json" && !reqHeaders.has("content-type")) {
        reqHeaders.set("content-type", "application/json");
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), safeTimeout);

      const startedAt = Date.now();
      try {
        const response = await fetch(url, {
          method: safeMethod,
          headers: reqHeaders,
          body: hasBody ? body?.trim() : undefined,
          signal: controller.signal
        });
        clearTimeout(timer);

        const rawBody = await response.text();
        let parsedBody: unknown = rawBody;
        try { parsedBody = JSON.parse(rawBody); } catch { /* leave as string */ }

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((v, k) => { responseHeaders[k] = v; });

        return reply.send({
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          durationMs: Date.now() - startedAt,
          headers: responseHeaders,
          body: parsedBody,
          rawBody
        });
      } catch (error) {
        clearTimeout(timer);
        const isTimeout = (error as Error).name === "AbortError";
        return reply.status(502).send({
          error: isTimeout ? `Timed out after ${safeTimeout}ms` : (error as Error).message
        });
      }
    }
  );
}

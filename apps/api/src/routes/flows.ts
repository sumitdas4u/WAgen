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
import { requireAiCredit, AiTokensDepletedError, chargeUser } from "../services/ai-token-service.js";
import { pool } from "../db/pool.js";
import { startFlowForConversation } from "../services/flow-engine-service.js";
import { sendConversationFlowMessage } from "../services/channel-outbound-service.js";
import * as net from "net";
import * as dns from "dns";
import * as http from "http";
import * as https from "https";

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
      connectionId: flow.connection_id,
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
    connectionId: flow.connection_id,
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
        await requireAiCredit(req.authUser.userId, "flow_draft_generate");
      } catch (e) {
        if (e instanceof AiTokensDepletedError) {
          return reply.status(402).send({ error: "ai_tokens_depleted", message: e.message, balance: e.balance });
        }
        throw e;
      }

      try {
        const draft = await generateFlowDraft({ prompt, channel });
        // Charge after successful generation (route owns billing, not service)
        void chargeUser(req.authUser.userId, "flow_draft_generate");
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

  app.post<{ Body: { name?: string; channel?: "web" | "qr" | "api"; connectionId?: string | null; nodes?: unknown[]; edges?: unknown[]; triggers?: unknown[] } }>(
    "/api/flows",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const userId = req.authUser!.userId;
      try {
        const flow = await createFlow(userId, req.body as Parameters<typeof createFlow>[1]);
        return reply.status(201).send(serializeFlow(flow));
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message || "Could not create flow." });
      }
    }
  );

  app.put<{ Params: { id: string }; Body: { name?: string; connectionId?: string | null; nodes?: unknown[]; edges?: unknown[]; triggers?: unknown[]; isDefaultReply?: boolean } }>(
    "/api/flows/:id",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const userId = req.authUser!.userId;
      try {
        const { isDefaultReply, ...rest } = req.body as { name?: string; connectionId?: string | null; nodes?: unknown[]; edges?: unknown[]; triggers?: unknown[]; isDefaultReply?: boolean };
        const flow = await updateFlow(userId, req.params.id, {
          ...(rest as Parameters<typeof updateFlow>[2]),
          ...(isDefaultReply !== undefined ? { is_default_reply: isDefaultReply } : {})
        });
        if (!flow) return reply.status(404).send({ error: "Flow not found" });
        return reply.send(serializeFlow(flow));
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message || "Could not update flow." });
      }
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
      try {
        const flow = await publishFlow(userId, req.params.id, published);
        if (!flow) return reply.status(404).send({ error: "Flow not found" });
        return reply.send(serializeFlow(flow));
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message || "Could not publish flow." });
      }
    }
  );

  app.get(
    "/api/flows/published",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const userId = req.authUser!.userId;
      const flows = await getPublishedFlowsForUser(userId);
      return reply.send(flows.map(f => ({ id: f.id, name: f.name, channel: f.channel, connectionId: f.connection_id })));
    }
  );

  app.post<{ Params: { id: string }; Body: { conversationId: string } }>(
    "/api/flows/:id/assign",
    { preHandler: app.requireAuth, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
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

      // Additional SSRF hardening: validate resolved IPs are not private/loopback
      function isPrivateOrLoopbackIp(ip: string): boolean {
        const ipVersion = net.isIP(ip);
        if (ipVersion === 4) {
          if (ip === "127.0.0.1") return true;
          if (ip === "0.0.0.0") return true;
          // 10.0.0.0/8
          if (ip.startsWith("10.")) return true;
          // 172.16.0.0/12
          const octets = ip.split(".");
          const first = Number(octets[0]);
          const second = Number(octets[1]);
          if (first === 172 && second >= 16 && second <= 31) return true;
          // 192.168.0.0/16
          if (ip.startsWith("192.168.")) return true;
          // link-local 169.254.0.0/16
          if (ip.startsWith("169.254.")) return true;
          // common cloud metadata IP
          if (ip === "169.254.169.254") return true;
          return false;
        }
        if (ipVersion === 6) {
          const normalized = ip.toLowerCase();
          if (normalized === "::1") return true;
          if (normalized.startsWith("fe80:")) return true; // link-local
          if (normalized.startsWith("fc00:") || normalized.startsWith("fd00:")) return true; // unique local
          return false;
        }
        return false;
      }

      let addresses: { address: string; family: number }[];
      try {
        const lookupResult = await dns.promises.lookup(parsedUrl.hostname, { all: true });
        addresses = Array.isArray(lookupResult) ? lookupResult : [lookupResult];
        for (const entry of addresses) {
          if (isPrivateOrLoopbackIp(entry.address)) {
            return reply
              .status(400)
              .send({ error: "Requests to internal or disallowed hosts are not permitted." });
          }
        }
      } catch {
        // If hostname cannot be resolved, treat as invalid target
        return reply.status(400).send({ error: "Unable to resolve target host." });
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

      const resolvedIp = addresses[0].address;
      const resolvedFamily = addresses[0].family === 6 ? 6 : 4;
      const reqLib = parsedUrl.protocol === "https:" ? https : http;
      const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : (parsedUrl.protocol === "https:" ? 443 : 80);
      const MAX_RESPONSE_BYTES = 1024 * 1024;

      const startedAt = Date.now();
      try {
        const responseData = await new Promise<{ status: number; statusText: string; headers: Record<string, string>; rawBody: string }>((resolve, reject) => {
          const options: https.RequestOptions = {
            hostname: parsedUrl.hostname,
            port,
            path: (parsedUrl.pathname || "/") + parsedUrl.search,
            method: safeMethod,
            headers: Object.fromEntries(reqHeaders.entries()),
            lookup: (_h: string, _o: dns.LookupOptions, cb: (e: NodeJS.ErrnoException | null, a: string, f: number) => void) => {
              cb(null, resolvedIp, resolvedFamily);
            },
            timeout: safeTimeout
          };

          const req = reqLib.request(options, (res) => {
            const responseHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) {
              responseHeaders[k] = Array.isArray(v) ? v.join(", ") : (v ?? "");
            }
            const chunks: Buffer[] = [];
            let totalSize = 0;
            res.on("data", (chunk: Buffer) => {
              totalSize += chunk.length;
              if (totalSize > MAX_RESPONSE_BYTES) {
                req.destroy(new Error("Response body too large (> 1 MB)"));
                return;
              }
              chunks.push(chunk);
            });
            res.on("end", () => resolve({ status: res.statusCode ?? 0, statusText: res.statusMessage ?? "", headers: responseHeaders, rawBody: Buffer.concat(chunks).toString("utf8") }));
            res.on("error", reject);
          });
          req.on("error", reject);
          req.on("timeout", () => req.destroy(new Error(`Timed out after ${safeTimeout}ms`)));
          if (hasBody && body?.trim()) req.write(body.trim());
          req.end();
        });

        let parsedBody: unknown = responseData.rawBody;
        try { parsedBody = JSON.parse(responseData.rawBody); } catch { /* leave as string */ }

        return reply.send({
          ok: responseData.status >= 200 && responseData.status < 300,
          status: responseData.status,
          statusText: responseData.statusText,
          durationMs: Date.now() - startedAt,
          headers: responseData.headers,
          body: parsedBody,
          rawBody: responseData.rawBody
        });
      } catch (error) {
        return reply.status(502).send({
          error: (error as Error).message
        });
      }
    }
  );
}

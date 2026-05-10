import type { FastifyInstance } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { recordBroadcastEngagement } from "../services/broadcast-engagement-service.js";

function signPayload(payload: string): string {
  return createHmac("sha256", env.JWT_SECRET).update(payload).digest("hex").slice(0, 32);
}

export function buildTrackingToken(campaignMsgId: string, destinationUrl: string): string {
  const payload = Buffer.from(JSON.stringify({ id: campaignMsgId, url: destinationUrl })).toString("base64url");
  const sig = signPayload(payload);
  return `${payload}.${sig}`;
}

function parseTrackingToken(token: string): { id: string; url: string } | null {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = signPayload(payload);
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const { id, url } = parsed as Record<string, unknown>;
    if (typeof id !== "string" || typeof url !== "string") return null;
    return { id, url };
  } catch {
    return null;
  }
}

export async function trackingRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/t/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const parsed = parseTrackingToken(token);
    if (!parsed) {
      return reply.status(400).send({ error: "Invalid tracking token" });
    }
    recordBroadcastEngagement({
      eventType: "clicked_url",
      wamid: null,
      contactId: null,
      campaignMsgId: parsed.id,
    }).catch((err) => console.warn("[Tracking] engagement record failed", err));
    return reply.redirect(parsed.url, 302);
  });
}

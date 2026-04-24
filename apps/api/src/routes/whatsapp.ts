import type { FastifyInstance } from "fastify";
import https from "node:https";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { whatsappSessionManager } from "../services/whatsapp-session-manager.js";
import { getSessionEncryptionSecret } from "../services/whatsapp-session-store.js";
import { encryptJsonPayload } from "../utils/encryption.js";
import { wait } from "../utils/index.js";
import { makeProxyAgent, type ProxyConfig } from "../utils/makeProxyAgent.js";

const ConnectSchema = z
  .object({
    resetAuth: z.boolean().optional(),
    phoneNumber: z.string().min(8).optional()
  })
  .partial()
  .optional();

const TestSuiteSchema = z.object({
  phoneNumber: z.string().min(8),
  delayMs: z.number().int().min(250).max(10_000).optional()
});

const ChannelStatusSchema = z.object({
  enabled: z.boolean()
});

const ProxySchema = z.object({
  enabled: z.boolean(),
  protocol: z.enum(["http", "https", "socks5"]),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().optional(),
  password: z.string().optional()
});

async function testProxyReachability(config: ProxyConfig): Promise<string> {
  const agent = makeProxyAgent(config);
  return new Promise<string>((resolve, reject) => {
    const request = https.get(
      "https://checkip.amazonaws.com",
      {
        agent,
        timeout: 8_000
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve(body.trim());
        });
      }
    );
    request.on("timeout", () => {
      request.destroy(new Error("Proxy timeout"));
    });
    request.on("error", reject);
  });
}

export async function whatsappRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    "/api/whatsapp/connect",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = ConnectSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid connect payload" });
      }

      await whatsappSessionManager.connectUser(request.authUser.userId, {
        resetAuth: Boolean(parsed.data?.resetAuth),
        force: Boolean(parsed.data?.resetAuth),
        phoneNumber: parsed.data?.phoneNumber
      });
      return { ok: true };
    }
  );

  fastify.get(
    "/api/whatsapp/status",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      return whatsappSessionManager.getStatus(request.authUser.userId);
    }
  );

  fastify.get(
    "/api/whatsapp/pairing-code",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const result = await pool.query<{ pairing_code: string | null; pairing_code_expires_at: Date | null }>(
        `SELECT pairing_code, pairing_code_expires_at
         FROM whatsapp_sessions
         WHERE user_id = $1
         LIMIT 1`,
        [request.authUser.userId]
      );

      const session = result.rows[0];
      if (!session?.pairing_code) {
        return { code: null, expiresAt: null };
      }

      const expired = session.pairing_code_expires_at ? session.pairing_code_expires_at < new Date() : false;
      return {
        code: expired ? null : session.pairing_code,
        expiresAt: session.pairing_code_expires_at?.toISOString() ?? null
      };
    }
  );

  fastify.post(
    "/api/whatsapp/disconnect",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      await whatsappSessionManager.disconnectUser(request.authUser.userId);
      return { ok: true };
    }
  );

  fastify.get(
    "/api/whatsapp/chats",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const result = await pool.query(
        `SELECT id, remote_jid, unread_count, last_message_at, last_message_id, created_at, updated_at
         FROM whatsapp_chats
         WHERE user_id = $1
         ORDER BY last_message_at DESC
         LIMIT 50`,
        [request.authUser.userId]
      );
      return result.rows;
    }
  );

  fastify.get(
    "/api/whatsapp/messages/:jid",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const { jid } = request.params as { jid: string };
      const { before, limit } = request.query as { before?: string; limit?: string };
      const take = Math.min(Number(limit ?? 50), 100);
      const params: unknown[] = [request.authUser.userId, decodeURIComponent(jid), take];
      const beforeClause = before ? `AND timestamp < $4` : "";
      if (before) {
        params.push(new Date(before));
      }

      const result = await pool.query(
        `SELECT id, remote_jid, message_id, from_me, message_type, content, text, timestamp, status, created_at, updated_at
         FROM whatsapp_messages
         WHERE user_id = $1
           AND remote_jid = $2
           ${beforeClause}
         ORDER BY timestamp DESC
         LIMIT $3`,
        params
      );
      return result.rows;
    }
  );

  fastify.post(
    "/api/whatsapp/channel",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = ChannelStatusSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid channel status payload" });
      }

      await whatsappSessionManager.setChannelEnabled(
        request.authUser.userId,
        parsed.data.enabled
      );
      return { ok: true };
    }
  );

  fastify.get(
    "/api/whatsapp/proxy",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const result = await pool.query(
        `SELECT enabled, protocol, host, port, username, password
         FROM whatsapp_proxies
         WHERE user_id = $1
         LIMIT 1`,
        [request.authUser.userId]
      );
      const proxy = result.rows[0];
      if (!proxy) {
        return null;
      }
      return {
        enabled: proxy.enabled,
        protocol: proxy.protocol,
        host: proxy.host,
        port: proxy.port,
        username: proxy.username ?? null,
        password: proxy.password ? "********" : null
      };
    }
  );

  fastify.put(
    "/api/whatsapp/proxy",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = ProxySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid proxy config" });
      }

      const { password, ...rest } = parsed.data;
      const encryptedPassword = password ? encryptJsonPayload(password, getSessionEncryptionSecret()) : null;
      await pool.query(
        `INSERT INTO whatsapp_proxies (user_id, enabled, protocol, host, port, username, password)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id)
         DO UPDATE SET enabled = EXCLUDED.enabled,
                       protocol = EXCLUDED.protocol,
                       host = EXCLUDED.host,
                       port = EXCLUDED.port,
                       username = EXCLUDED.username,
                       password = EXCLUDED.password`,
        [
          request.authUser.userId,
          rest.enabled,
          rest.protocol,
          rest.host,
          rest.port,
          rest.username ?? null,
          encryptedPassword
        ]
      );
      return { ok: true };
    }
  );

  fastify.delete(
    "/api/whatsapp/proxy",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      await pool.query(`DELETE FROM whatsapp_proxies WHERE user_id = $1`, [request.authUser.userId]);
      return { ok: true };
    }
  );

  fastify.post(
    "/api/whatsapp/proxy/test",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = ProxySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid proxy config" });
      }

      const { password, ...rest } = parsed.data;
      const config: ProxyConfig = { ...rest, password: password ?? null };

      try {
        const ip = await testProxyReachability(config);
        return { ok: true, ip };
      } catch (err) {
        return reply.status(502).send({ error: "Proxy unreachable", detail: String(err) });
      }
    }
  );

  fastify.post(
    "/api/whatsapp/test-suite",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = TestSuiteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid test suite payload" });
      }

      const { phoneNumber } = parsed.data;
      const delayMs = parsed.data.delayMs ?? 1_500;
      const userId = request.authUser.userId;

      const results: Array<{
        name: string;
        status: "sent" | "failed" | "skipped";
        messageId?: string | null;
        error?: string;
      }> = [];

      let firstTextMessageKey:
        | {
            remoteJid?: string | null;
            fromMe?: boolean | null;
            id?: string | null;
            participant?: string | null;
          }
        | undefined;

      const tests: Array<{
        name: string;
        build: () => Record<string, unknown> | null;
        captureKey?: boolean;
      }> = [
        {
          name: "text",
          captureKey: true,
          build: () => ({ text: "✅ Test 1: Simple Text Message" })
        },
        {
          name: "image",
          build: () => ({
            image: { url: "https://picsum.photos/400" },
            caption: "✅ Test 2: Image Message"
          })
        },
        {
          name: "video",
          build: () => ({
            video: { url: "https://www.w3schools.com/html/mov_bbb.mp4" },
            caption: "✅ Test 3: Video Message"
          })
        },
        {
          name: "audio",
          build: () => ({
            audio: { url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" },
            mimetype: "audio/mpeg",
            ptt: false
          })
        },
        {
          name: "voice_note",
          build: () => ({
            audio: { url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" },
            mimetype: "audio/mpeg",
            ptt: true
          })
        },
        {
          name: "document",
          build: () => ({
            document: { url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf" },
            fileName: "Test.pdf",
            mimetype: "application/pdf"
          })
        },
        {
          name: "location",
          build: () => ({
            location: {
              degreesLatitude: 22.5726,
              degreesLongitude: 88.3639
            }
          })
        },
        {
          name: "contact",
          build: () => ({
            contacts: {
              displayName: "Food Studio",
              contacts: [
                {
                  vcard: "BEGIN:VCARD\nVERSION:3.0\nFN:Food Studio\nTEL;type=CELL:+919999999999\nEND:VCARD"
                }
              ]
            }
          })
        },
        {
          name: "reaction",
          build: () =>
            firstTextMessageKey
              ? {
                  react: {
                    text: "🔥",
                    key: firstTextMessageKey
                  }
                }
              : null
        },
        {
          name: "buttons",
          build: () => ({
            text: "✅ Test 10: Buttons",
            footer: "Food Studio",
            buttons: [
              { buttonId: "1", buttonText: { displayText: "Option 1" }, type: 1 },
              { buttonId: "2", buttonText: { displayText: "Option 2" }, type: 1 }
            ],
            headerType: 1
          })
        },
        {
          name: "image_buttons",
          build: () => ({
            image: { url: "https://picsum.photos/400" },
            caption: "✅ Test 11: Image + Buttons",
            footer: "Food Studio",
            buttons: [
              { buttonId: "order", buttonText: { displayText: "Order Now" }, type: 1 },
              { buttonId: "menu", buttonText: { displayText: "Menu" }, type: 1 }
            ],
            headerType: 4
          })
        },
        {
          name: "list",
          build: () => ({
            text: "✅ Test 12: Select Item",
            buttonText: "Open Menu",
            sections: [
              {
                title: "Rolls",
                rows: [
                  { title: "Chicken Roll", rowId: "chicken" },
                  { title: "Paneer Roll", rowId: "paneer" }
                ]
              }
            ]
          })
        },
        {
          name: "template_fallback",
          build: () => ({
            text: "🍽️ Menu\n\n1️⃣ Chicken Roll\n2️⃣ Egg Roll\n3️⃣ Paneer Roll\n\nReply with number"
          })
        },
        {
          name: "poll",
          build: () => ({
            poll: {
              name: "What do you want?",
              values: ["Chicken Roll", "Paneer Roll", "Egg Roll"],
              selectableCount: 1
            }
          })
        }
      ];

      for (const test of tests) {
        const content = test.build();
        if (!content) {
          results.push({
            name: test.name,
            status: "skipped",
            error: "Missing prerequisite message key."
          });
          continue;
        }

        try {
          const sent = await whatsappSessionManager.sendRawMessage({
            userId,
            phoneNumber,
            content
          });
          if (test.captureKey && sent?.key) {
            firstTextMessageKey = {
              remoteJid: sent.key.remoteJid ?? null,
              fromMe: sent.key.fromMe ?? null,
              id: sent.key.id ?? null,
              participant: sent.key.participant ?? null
            };
          }

          results.push({
            name: test.name,
            status: "sent",
            messageId: sent?.key?.id ?? null
          });
        } catch (error) {
          results.push({
            name: test.name,
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown error"
          });
        }

        await wait(delayMs);
      }

      return {
        ok: true,
        phoneNumber,
        delayMs,
        results
      };
    }
  );
}

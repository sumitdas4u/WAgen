import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { whatsappSessionManager } from "../services/whatsapp-session-manager.js";
import { wait } from "../utils/index.js";

const ConnectSchema = z
  .object({
    resetAuth: z.boolean().optional()
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
        force: Boolean(parsed.data?.resetAuth)
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

  fastify.post(
    "/api/whatsapp/disconnect",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      await whatsappSessionManager.disconnectUser(request.authUser.userId);
      return { ok: true };
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

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  resolveChannelDefaultReplyConfig,
  saveChannelDefaultReplyConfig
} from "../services/channel-default-reply-service.js";
import { getFlow } from "../services/flow-service.js";

const ChannelParamsSchema = z.object({
  channel: z.enum(["web", "qr", "api"])
});

const SaveSchema = z
  .object({
    mode: z.enum(["manual", "flow", "ai"]),
    flowId: z.string().uuid().nullable().optional(),
    agentProfileId: z.string().uuid().nullable().optional(),
    invalidReplyLimit: z.number().int().min(1).max(2).nullable().optional()
  })
  .superRefine((value, ctx) => {
    if (value.mode === "flow" && !value.flowId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["flowId"],
        message: "Select a flow for flow mode."
      });
    }
  });

export async function channelDefaultReplyRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/channels/default-reply/:channel",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const params = ChannelParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: "Invalid channel." });
      }

      const config = await resolveChannelDefaultReplyConfig(
        request.authUser.userId,
        params.data.channel
      );
      return { config };
    }
  );

  fastify.put(
    "/api/channels/default-reply/:channel",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const params = ChannelParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: "Invalid channel." });
      }

      const body = SaveSchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply.status(400).send({ error: "Invalid default reply settings." });
      }

      if (body.data.mode === "flow" && body.data.flowId) {
        const flow = await getFlow(request.authUser.userId, body.data.flowId);
        if (!flow || flow.channel !== params.data.channel) {
          return reply.status(400).send({ error: "Selected flow does not belong to this channel." });
        }
        if (!flow.published) {
          return reply.status(400).send({ error: "Publish the selected flow before using it as default reply." });
        }
      }

      const config = await saveChannelDefaultReplyConfig(request.authUser.userId, {
        channel: params.data.channel,
        mode: body.data.mode,
        flowId: body.data.flowId ?? null,
        agentProfileId: body.data.agentProfileId ?? null,
        invalidReplyLimit: body.data.invalidReplyLimit ?? null
      });

      return { ok: true, config };
    }
  );
}

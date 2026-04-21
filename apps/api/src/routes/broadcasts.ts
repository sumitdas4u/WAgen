import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getBroadcastReport,
  getBroadcastSummary,
  importBroadcastAudienceWorkbook,
  listBroadcasts,
  previewBroadcastAudienceWorkbookImport,
  previewRetargetAudience,
  uploadBroadcastMedia
} from "../services/broadcast-service.js";
import type { CampaignMessageStatus, RetargetStatus } from "../services/campaign-service.js";

const CampaignMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  status: z.enum(["queued", "sending", "sent", "delivered", "read", "failed", "skipped"] as [CampaignMessageStatus, ...CampaignMessageStatus[]]).optional()
});

const RetargetPreviewQuerySchema = z.object({
  status: z.enum(["sent", "delivered", "read", "failed", "skipped"] as [RetargetStatus, ...RetargetStatus[]])
});

export async function broadcastRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    "/api/broadcasts/audience/import/preview",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ error: "XLSX file is required." });
      }
      if (!file.filename.toLowerCase().endsWith(".xlsx")) {
        return reply.status(400).send({ error: "Only .xlsx files are supported." });
      }

      try {
        const buffer = await file.toBuffer();
        const preview = await previewBroadcastAudienceWorkbookImport(buffer);
        return { ok: true, preview };
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }
    }
  );

  fastify.get(
    "/api/broadcasts",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const [broadcasts, summary] = await Promise.all([
        listBroadcasts(request.authUser.userId),
        getBroadcastSummary(request.authUser.userId)
      ]);
      return { broadcasts, summary };
    }
  );

  fastify.get(
    "/api/broadcasts/summary",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const summary = await getBroadcastSummary(request.authUser.userId);
      return { summary };
    }
  );

  fastify.get(
    "/api/broadcasts/:campaignId/report",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { campaignId } = request.params as { campaignId: string };
      const parsed = CampaignMessagesQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid query parameters" });
      }
      const report = await getBroadcastReport(request.authUser.userId, campaignId, parsed.data);
      if (!report) {
        return reply.status(404).send({ error: "Broadcast not found" });
      }
      return { report };
    }
  );

  fastify.get(
    "/api/broadcasts/:campaignId/retarget-preview",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { campaignId } = request.params as { campaignId: string };
      const parsed = RetargetPreviewQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid retarget preview query" });
      }
      const preview = await previewRetargetAudience(request.authUser.userId, campaignId, parsed.data.status);
      if (!preview) {
        return reply.status(404).send({ error: "Broadcast not found" });
      }
      return { preview };
    }
  );

  fastify.post(
    "/api/broadcasts/audience/import",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ error: "XLSX file is required." });
      }
      if (!file.filename.toLowerCase().endsWith(".xlsx")) {
        return reply.status(400).send({ error: "Only .xlsx files are supported." });
      }

      const segmentNameRaw = file.fields.segmentName;
      const segmentName =
        segmentNameRaw && "value" in segmentNameRaw && typeof segmentNameRaw.value === "string"
          ? segmentNameRaw.value
          : null;
      const marketingOptInRaw = file.fields.marketingOptIn;
      const marketingOptIn =
        marketingOptInRaw && "value" in marketingOptInRaw && typeof marketingOptInRaw.value === "string"
          ? marketingOptInRaw.value === "yes"
          : false;
      const phoneNumberFormatRaw = file.fields.phoneNumberFormat;
      const phoneNumberFormat =
        phoneNumberFormatRaw &&
        "value" in phoneNumberFormatRaw &&
        typeof phoneNumberFormatRaw.value === "string" &&
        phoneNumberFormatRaw.value === "without_country_code"
          ? "without_country_code"
          : "with_country_code";
      const defaultCountryCodeRaw = file.fields.defaultCountryCode;
      const defaultCountryCode =
        defaultCountryCodeRaw &&
        "value" in defaultCountryCodeRaw &&
        typeof defaultCountryCodeRaw.value === "string"
          ? defaultCountryCodeRaw.value
          : null;

      try {
        const buffer = await file.toBuffer();
        const mappingRaw = file.fields.mapping;
        let mapping: Record<string, string> | undefined;
        if (mappingRaw && "value" in mappingRaw && typeof mappingRaw.value === "string" && mappingRaw.value.trim()) {
          mapping = JSON.parse(mappingRaw.value) as Record<string, string>;
        }
        const result = await importBroadcastAudienceWorkbook(request.authUser.userId, buffer, segmentName, {
          marketingOptIn,
          phoneNumberFormat,
          defaultCountryCode,
          columnMapping: mapping
        });
        return {
          ok: true,
          importResult: result.importResult,
          segment: result.segment,
          batchTag: result.batchTag
        };
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }
    }
  );

  fastify.post(
    "/api/broadcasts/media/upload",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ error: "File is required." });
      }

      const buffer = await file.toBuffer();
      if (buffer.length > 16 * 1024 * 1024) {
        return reply.status(400).send({ error: "File too large. Maximum 16 MB." });
      }

      const uploaded = await uploadBroadcastMedia(
        request.authUser.userId,
        buffer,
        file.mimetype,
        file.filename
      );
      return uploaded;
    }
  );
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import {
  createWorkspaceRechargeOrder,
  disableAutoRecharge,
  generateWorkspaceInvoicePdf,
  getAutoRechargeSettings,
  getWorkspaceBillingOverview,
  getWorkspaceBillingProfile,
  getWorkspaceRenewalHistory,
  getWorkspaceTransactions,
  getWorkspaceUsageSeries,
  listWorkspaceInvoices,
  upsertAutoRechargeSettings,
  upsertWorkspaceBillingProfile
} from "../services/workspace-billing-center-service.js";

const UsageQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).optional()
});

const TransactionsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  type: z.string().optional()
});

const RenewalsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional()
});

const BillingProfileSchema = z.object({
  legalName: z.string().max(255).optional().nullable(),
  gstin: z.string().max(32).optional().nullable(),
  addressLine1: z.string().max(255).optional().nullable(),
  addressLine2: z.string().max(255).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  state: z.string().max(120).optional().nullable(),
  pincode: z.string().max(32).optional().nullable(),
  country: z.string().max(16).optional().nullable(),
  billingEmail: z.string().email().max(255).optional().nullable(),
  billingPhone: z.string().max(64).optional().nullable(),
  metadata: z.record(z.unknown()).optional()
});

const RechargeOrderSchema = z.object({
  credits: z.coerce.number().int().min(1).max(1_000_000)
});

const AutoRechargeSchema = z.object({
  enabled: z.boolean(),
  thresholdCredits: z.coerce.number().int().min(0).max(1_000_000),
  rechargeCredits: z.coerce.number().int().min(1).max(1_000_000),
  maxRechargesPerDay: z.coerce.number().int().min(1).max(100),
  gatewayCustomerId: z.string().max(255).optional().nullable(),
  gatewayTokenId: z.string().max(255).optional().nullable()
});

const InvoicesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional()
});

const DownloadParamsSchema = z.object({
  invoiceId: z.string().min(1)
});

function ensureBillingCenterEnabled(reply: import("fastify").FastifyReply): boolean {
  if (!env.DASHBOARD_BILLING_CENTER) {
    reply.status(404).send({ error: "Dashboard billing center is disabled" });
    return false;
  }
  return true;
}

export async function workspaceBillingRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/workspace/billing/overview", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    if (!ensureBillingCenterEnabled(reply)) {
      return;
    }
    const overview = await getWorkspaceBillingOverview(request.authUser.userId);
    return { overview };
  });

  fastify.get("/api/workspace/billing/usage", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    if (!ensureBillingCenterEnabled(reply)) {
      return;
    }
    const parsed = UsageQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid usage query" });
    }
    const usage = await getWorkspaceUsageSeries(request.authUser.userId, parsed.data.months ?? 12);
    return { usage };
  });

  fastify.get(
    "/api/workspace/billing/transactions",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      if (!ensureBillingCenterEnabled(reply)) {
        return;
      }
      const parsed = TransactionsQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid transactions query" });
      }
      const transactions = await getWorkspaceTransactions({
        userId: request.authUser.userId,
        cursor: parsed.data.cursor,
        limit: parsed.data.limit,
        type: parsed.data.type
      });
      return transactions;
    }
  );

  fastify.get("/api/workspace/billing/renewals", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    if (!ensureBillingCenterEnabled(reply)) {
      return;
    }
    const parsed = RenewalsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid renewals query" });
    }
    const renewals = await getWorkspaceRenewalHistory(request.authUser.userId, parsed.data.limit ?? 20);
    return { renewals };
  });

  fastify.get("/api/workspace/billing/profile", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    if (!ensureBillingCenterEnabled(reply)) {
      return;
    }
    const profile = await getWorkspaceBillingProfile(request.authUser.userId);
    return { profile };
  });

  fastify.put("/api/workspace/billing/profile", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    if (!ensureBillingCenterEnabled(reply)) {
      return;
    }
    const parsed = BillingProfileSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid billing profile payload" });
    }
    const profile = await upsertWorkspaceBillingProfile(request.authUser.userId, parsed.data);
    return { profile };
  });

  fastify.post(
    "/api/workspace/billing/recharge/order",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      if (!ensureBillingCenterEnabled(reply)) {
        return;
      }
      const parsed = RechargeOrderSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid recharge order payload" });
      }
      const order = await createWorkspaceRechargeOrder({
        userId: request.authUser.userId,
        credits: parsed.data.credits,
        metadata: { source: "dashboard_billing_center" }
      });
      return { order };
    }
  );

  fastify.get("/api/workspace/billing/recharge/auto", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    if (!ensureBillingCenterEnabled(reply)) {
      return;
    }
    const settings = await getAutoRechargeSettings(request.authUser.userId);
    return { settings };
  });

  fastify.post(
    "/api/workspace/billing/recharge/auto",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      if (!ensureBillingCenterEnabled(reply)) {
        return;
      }
      const parsed = AutoRechargeSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid auto recharge payload" });
      }
      const settings = await upsertAutoRechargeSettings(request.authUser.userId, parsed.data);
      return { settings };
    }
  );

  fastify.post(
    "/api/workspace/billing/recharge/auto/disable",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      if (!ensureBillingCenterEnabled(reply)) {
        return;
      }
      const settings = await disableAutoRecharge(request.authUser.userId);
      return { settings };
    }
  );

  fastify.get("/api/workspace/billing/invoices", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    if (!ensureBillingCenterEnabled(reply)) {
      return;
    }
    const parsed = InvoicesQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid invoices query" });
    }
    const invoices = await listWorkspaceInvoices(request.authUser.userId, parsed.data.limit ?? 20);
    return { invoices };
  });

  fastify.get(
    "/api/workspace/billing/invoices/:invoiceId/download",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      if (!ensureBillingCenterEnabled(reply)) {
        return;
      }
      const params = DownloadParamsSchema.safeParse(request.params ?? {});
      if (!params.success) {
        return reply.status(400).send({ error: "Invalid invoice id" });
      }
      const { filename, pdf, invoice } = await generateWorkspaceInvoicePdf({
        userId: request.authUser.userId,
        invoiceId: params.data.invoiceId
      });
      reply.header("Content-Type", "application/pdf");
      reply.header("Content-Disposition", `attachment; filename="${filename}"`);
      reply.header("X-Invoice-Number", invoice.invoiceNumber);
      return reply.send(pdf);
    }
  );
}

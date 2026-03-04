import Razorpay from "razorpay";
import { env } from "../config/env.js";
import { pool, withTransaction } from "../db/pool.js";
import { getWorkspaceIdByUserId } from "./workspace-billing-service.js";

type InvoiceType = "subscription" | "recharge";
type InvoiceSourceType = "subscription_payment" | "recharge_order";
type RechargeOrderStatus = "created" | "paid" | "failed" | "expired" | "refunded";
type AutoRechargeAttemptStatus = "success" | "failed" | "skipped";

interface WorkspaceBillingProfileRow {
  id: string;
  workspace_id: string;
  legal_name: string | null;
  gstin: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string;
  billing_email: string | null;
  billing_phone: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface AutoRechargeSettingsRow {
  id: string;
  workspace_id: string;
  enabled: boolean;
  threshold_credits: number;
  recharge_credits: number;
  max_recharges_per_day: number;
  gateway_customer_id: string | null;
  gateway_token_id: string | null;
  last_triggered_at: string | null;
  last_status: string | null;
  failure_count: number;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface BillingInvoiceRow {
  id: string;
  workspace_id: string;
  invoice_number: string;
  invoice_type: InvoiceType;
  source_type: InvoiceSourceType;
  source_id: string;
  currency: string;
  total_paise: number;
  taxable_paise: number;
  gst_paise: number;
  status: "issued" | "void";
  billing_profile_snapshot_json: Record<string, unknown> | null;
  line_items_json: unknown;
  created_at: string;
}

interface CreditRechargeOrderRow {
  id: string;
  workspace_id: string;
  user_id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string | null;
  status: RechargeOrderStatus;
  credits: number;
  amount_total_paise: number;
  amount_taxable_paise: number;
  gst_amount_paise: number;
  gst_rate_percent: string | number;
  currency: string;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  paid_at: string | null;
  updated_at: string;
}

interface WorkspaceBillingOverviewRow {
  workspace_id: string;
  workspace_name: string;
  plan_code: string | null;
  plan_name: string | null;
  plan_price_monthly: number | null;
  plan_monthly_credits: number | null;
  subscription_status: string | null;
  next_billing_date: string | null;
  total_credits: number | null;
  used_credits: number | null;
  remaining_credits: number | null;
  auto_enabled: boolean | null;
  auto_threshold_credits: number | null;
  auto_recharge_credits: number | null;
  auto_max_recharges_per_day: number | null;
  auto_last_triggered_at: string | null;
  auto_last_status: string | null;
  auto_failure_count: number | null;
}

interface RazorpayOrderEntity {
  id: string;
  amount: number;
  currency: string;
}

interface RazorpayTokenChargeEntity {
  id: string;
  status?: string;
  amount?: number;
  currency?: string;
  order_id?: string;
  created_at?: number;
}

interface RazorpayTokenChargeClient {
  payments?: {
    create?: (payload: Record<string, unknown>) => Promise<unknown>;
  };
}

interface InvoiceLineItem {
  label: string;
  quantity: number;
  unitAmountPaise: number;
  totalAmountPaise: number;
  metadata?: Record<string, unknown>;
}

interface RechargeOrderPriceBreakdown {
  totalPaise: number;
  taxablePaise: number;
  gstPaise: number;
  gstRatePercent: number;
}

export interface WorkspaceBillingProfile {
  workspaceId: string;
  legalName: string | null;
  gstin: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string;
  billingEmail: string | null;
  billingPhone: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceBillingOverview {
  workspaceId: string;
  workspaceName: string;
  plan: {
    code: string | null;
    name: string | null;
    priceMonthly: number;
    monthlyCredits: number;
  };
  subscription: {
    status: string | null;
    nextBillingDate: string | null;
  };
  credits: {
    total: number;
    used: number;
    remaining: number;
  };
  autoRecharge: {
    enabled: boolean;
    thresholdCredits: number;
    rechargeCredits: number;
    maxRechargesPerDay: number;
    lastTriggeredAt: string | null;
    lastStatus: string | null;
    failureCount: number;
  };
}

export interface WorkspaceUsageSeriesPoint {
  month: string;
  spentCredits: number;
  channelBreakdown: {
    web: number;
    qr: number;
    api: number;
    unknown: number;
  };
}

export interface WorkspaceUsageSeries {
  months: number;
  points: WorkspaceUsageSeriesPoint[];
  totals: {
    spentCredits: number;
    web: number;
    qr: number;
    api: number;
    unknown: number;
  };
}

export interface WorkspaceBillingTransactionFeedItem {
  createdAt: string;
  source: "credit_transaction" | "recharge_order" | "invoice";
  itemId: string;
  type: string;
  credits: number;
  amountPaise: number | null;
  currency: string | null;
  status: string | null;
  referenceId: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
}

export interface WorkspaceBillingTransactionFeed {
  items: WorkspaceBillingTransactionFeedItem[];
  nextCursor: string | null;
}

export interface WorkspaceRenewalHistoryItem {
  renewalId: string;
  renewedAt: string;
  creditsReset: number;
  planCode: string | null;
  planName: string | null;
  payment: {
    razorpayPaymentId: string | null;
    amountPaise: number | null;
    currency: string | null;
    status: string | null;
    paidAt: string | null;
  };
}

export interface WorkspaceInvoiceSummary {
  id: string;
  invoiceNumber: string;
  invoiceType: InvoiceType;
  sourceType: InvoiceSourceType;
  sourceId: string;
  currency: string;
  totalPaise: number;
  taxablePaise: number;
  gstPaise: number;
  status: "issued" | "void";
  createdAt: string;
}

export interface WorkspaceRechargeOrderCreateResult {
  rechargeOrderId: string;
  keyId: string;
  razorpayOrderId: string;
  currency: string;
  credits: number;
  amountTotalPaise: number;
  amountTaxablePaise: number;
  gstAmountPaise: number;
  gstRatePercent: number;
}

export interface AutoRechargeSettings {
  workspaceId: string;
  enabled: boolean;
  thresholdCredits: number;
  rechargeCredits: number;
  maxRechargesPerDay: number;
  gatewayCustomerId: string | null;
  gatewayTokenId: string | null;
  lastTriggeredAt: string | null;
  lastStatus: string | null;
  failureCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AutoRechargeUpsertInput {
  enabled: boolean;
  thresholdCredits: number;
  rechargeCredits: number;
  maxRechargesPerDay: number;
  gatewayCustomerId?: string | null;
  gatewayTokenId?: string | null;
}

let razorpayClient: Razorpay | null = null;

function getRazorpayClient(): Razorpay {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new Error("Razorpay is not configured on server");
  }
  if (!razorpayClient) {
    razorpayClient = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID,
      key_secret: env.RAZORPAY_KEY_SECRET
    });
  }
  return razorpayClient;
}

function getRazorpayCheckoutKey(): string {
  if (!env.RAZORPAY_KEY_ID) {
    throw new Error("Razorpay key ID is not configured on server");
  }
  return env.RAZORPAY_KEY_ID;
}

async function createRazorpayTokenCharge(payload: Record<string, unknown>): Promise<RazorpayTokenChargeEntity> {
  const client = getRazorpayClient() as unknown as RazorpayTokenChargeClient;
  if (!client.payments?.create) {
    throw new Error("Razorpay token charge API is not available");
  }
  const response = await client.payments.create(payload);
  return response as RazorpayTokenChargeEntity;
}

function toNonNegativeInteger(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return Math.max(0, Math.floor(fallback));
  }
  return Math.max(0, Math.floor(parsed));
}

function toPositiveInteger(value: unknown, fallback = 1): number {
  return Math.max(1, toNonNegativeInteger(value, fallback));
}

function normalizeGstin(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toUpperCase() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function isValidGstin(value: string): boolean {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value);
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function getPricePerCreditPaise(): number {
  const value = (Number(env.RECHARGE_PRICE_PER_1000_CREDITS_INR) * 100) / 1000;
  if (!Number.isFinite(value) || value <= 0) {
    return 49.9;
  }
  return value;
}

function getGstRatePercent(): number {
  const value = Number(env.BILLING_GST_RATE_PERCENT);
  if (!Number.isFinite(value) || value < 0) {
    return 18;
  }
  return value;
}

function computeTaxBreakdown(totalPaise: number, gstRatePercent = getGstRatePercent()): RechargeOrderPriceBreakdown {
  const safeTotal = Math.max(0, Math.floor(totalPaise));
  const safeRate = Math.max(0, gstRatePercent);
  if (safeTotal <= 0 || safeRate <= 0) {
    return {
      totalPaise: safeTotal,
      taxablePaise: safeTotal,
      gstPaise: 0,
      gstRatePercent: safeRate
    };
  }
  const divisor = 1 + safeRate / 100;
  const taxablePaise = Math.round(safeTotal / divisor);
  const gstPaise = safeTotal - taxablePaise;
  return {
    totalPaise: safeTotal,
    taxablePaise: Math.max(0, taxablePaise),
    gstPaise: Math.max(0, gstPaise),
    gstRatePercent: safeRate
  };
}

function encodeCursor(value: { createdAt: string; rowId: string }): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null | undefined): { createdAt: string; rowId: string } | null {
  if (!cursor) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      rowId?: unknown;
    };
    if (typeof decoded.createdAt !== "string" || typeof decoded.rowId !== "string") {
      return null;
    }
    return { createdAt: decoded.createdAt, rowId: decoded.rowId };
  } catch {
    return null;
  }
}

function toProfile(row: WorkspaceBillingProfileRow): WorkspaceBillingProfile {
  return {
    workspaceId: row.workspace_id,
    legalName: row.legal_name,
    gstin: row.gstin,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    country: row.country,
    billingEmail: row.billing_email,
    billingPhone: row.billing_phone,
    metadata: row.metadata_json ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toAutoRechargeSettings(row: AutoRechargeSettingsRow): AutoRechargeSettings {
  return {
    workspaceId: row.workspace_id,
    enabled: row.enabled,
    thresholdCredits: toNonNegativeInteger(row.threshold_credits, 0),
    rechargeCredits: toPositiveInteger(row.recharge_credits, 1000),
    maxRechargesPerDay: toPositiveInteger(row.max_recharges_per_day, 1),
    gatewayCustomerId: row.gateway_customer_id,
    gatewayTokenId: row.gateway_token_id,
    lastTriggeredAt: row.last_triggered_at,
    lastStatus: row.last_status,
    failureCount: toNonNegativeInteger(row.failure_count, 0),
    metadata: row.metadata_json ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toInvoiceSummary(row: BillingInvoiceRow): WorkspaceInvoiceSummary {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    invoiceType: row.invoice_type,
    sourceType: row.source_type,
    sourceId: row.source_id,
    currency: row.currency,
    totalPaise: toNonNegativeInteger(row.total_paise),
    taxablePaise: toNonNegativeInteger(row.taxable_paise),
    gstPaise: toNonNegativeInteger(row.gst_paise),
    status: row.status,
    createdAt: row.created_at
  };
}

function parseInvoiceLineItems(value: unknown): InvoiceLineItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: InvoiceLineItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const label = typeof row.label === "string" ? row.label : "Item";
    const quantity = toPositiveInteger(row.quantity, 1);
    const unitAmountPaise = toNonNegativeInteger(row.unitAmountPaise, 0);
    const totalAmountPaise = toNonNegativeInteger(row.totalAmountPaise, 0);
    const metadata =
      row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : undefined;
    items.push({
      label,
      quantity,
      unitAmountPaise,
      totalAmountPaise,
      metadata
    });
  }
  return items;
}

function buildRechargeLineItems(credits: number, totalPaise: number): InvoiceLineItem[] {
  return [
    {
      label: `Recharge credits (${credits})`,
      quantity: credits,
      unitAmountPaise: Math.max(1, Math.round(totalPaise / Math.max(1, credits))),
      totalAmountPaise: totalPaise,
      metadata: {
        category: "credit_recharge"
      }
    }
  ];
}

function formatInrFromPaise(value: number): string {
  const inr = Math.max(0, Number(value) / 100);
  return inr.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  });
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function generateSimplePdf(lines: string[]): Buffer {
  const textLines = lines.length > 0 ? lines : ["Invoice"];
  const bodyLines = textLines.map((line, index) => `${index === 0 ? "" : "T* " }(${escapePdfText(line)}) Tj`).join("\n");
  const content = `BT
/F1 11 Tf
40 800 Td
14 TL
${bodyLines}
ET`;

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream\nendobj\n`
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const objectText of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += objectText;
  }

  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref
0 ${objects.length + 1}
0000000000 65535 f 
`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer
<< /Size ${objects.length + 1} /Root 1 0 R >>
startxref
${xrefStart}
%%EOF`;

  return Buffer.from(pdf, "utf8");
}

async function getWorkspaceBillingProfileByWorkspaceId(workspaceId: string): Promise<WorkspaceBillingProfileRow | null> {
  const result = await pool.query<WorkspaceBillingProfileRow>(
    `SELECT
       id,
       workspace_id,
       legal_name,
       gstin,
       address_line1,
       address_line2,
       city,
       state,
       pincode,
       country,
       billing_email,
       billing_phone,
       metadata_json,
       created_at,
       updated_at
     FROM workspace_billing_profiles
     WHERE workspace_id = $1
     LIMIT 1`,
    [workspaceId]
  );
  return result.rows[0] ?? null;
}

async function ensureWorkspaceBillingProfileSeed(workspaceId: string): Promise<WorkspaceBillingProfileRow> {
  const existing = await getWorkspaceBillingProfileByWorkspaceId(workspaceId);
  if (existing) {
    return existing;
  }

  const inserted = await pool.query<WorkspaceBillingProfileRow>(
    `INSERT INTO workspace_billing_profiles (
       workspace_id,
       legal_name,
       billing_email,
       country,
       metadata_json
     )
     SELECT
       w.id,
       COALESCE(NULLIF(TRIM(u.business_type), ''), NULLIF(TRIM(u.name), ''), SPLIT_PART(u.email, '@', 1)),
       u.email,
       'IN',
       jsonb_build_object('seededFrom', 'service')
     FROM workspaces w
     JOIN users u ON u.id = w.owner_id
     WHERE w.id = $1
     ON CONFLICT (workspace_id) DO UPDATE SET
       workspace_id = EXCLUDED.workspace_id
     RETURNING
       id,
       workspace_id,
       legal_name,
       gstin,
       address_line1,
       address_line2,
       city,
       state,
       pincode,
       country,
       billing_email,
       billing_phone,
       metadata_json,
       created_at,
       updated_at`,
    [workspaceId]
  );

  const row = inserted.rows[0];
  if (!row) {
    throw new Error("Failed to initialize workspace billing profile");
  }
  return row;
}

async function getWorkspaceBillingOverviewByWorkspaceId(workspaceId: string): Promise<WorkspaceBillingOverviewRow> {
  const result = await pool.query<WorkspaceBillingOverviewRow>(
    `SELECT
       w.id AS workspace_id,
       w.name AS workspace_name,
       p.code AS plan_code,
       p.name AS plan_name,
       p.price_monthly AS plan_price_monthly,
       p.monthly_credits AS plan_monthly_credits,
       s.status AS subscription_status,
       s.next_billing_date,
       cw.total_credits,
       cw.used_credits,
       cw.remaining_credits,
       ars.enabled AS auto_enabled,
       ars.threshold_credits AS auto_threshold_credits,
       ars.recharge_credits AS auto_recharge_credits,
       ars.max_recharges_per_day AS auto_max_recharges_per_day,
       ars.last_triggered_at AS auto_last_triggered_at,
       ars.last_status AS auto_last_status,
       ars.failure_count AS auto_failure_count
     FROM workspaces w
     LEFT JOIN plans p ON p.id = w.plan_id
     LEFT JOIN subscriptions s ON s.workspace_id = w.id
     LEFT JOIN credit_wallet cw ON cw.workspace_id = w.id
     LEFT JOIN auto_recharge_settings ars ON ars.workspace_id = w.id
     WHERE w.id = $1
     LIMIT 1`,
    [workspaceId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Workspace not found");
  }
  return row;
}

async function nextInvoiceNumber(client: import("pg").PoolClient, issuedAt: Date): Promise<string> {
  const monthKey = `${issuedAt.getUTCFullYear()}${String(issuedAt.getUTCMonth() + 1).padStart(2, "0")}`;
  const prefix = `INV-${monthKey}-`;
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [prefix]);
  const latestResult = await client.query<{ invoice_number: string }>(
    `SELECT invoice_number
     FROM billing_invoices
     WHERE invoice_number LIKE $1
     ORDER BY invoice_number DESC
     LIMIT 1`,
    [`${prefix}%`]
  );
  const latest = latestResult.rows[0]?.invoice_number ?? null;
  const latestSequence = latest ? Number(latest.slice(prefix.length)) : 0;
  const nextSequence = Number.isFinite(latestSequence) ? latestSequence + 1 : 1;
  return `${prefix}${String(nextSequence).padStart(6, "0")}`;
}

async function issueInvoiceInTransaction(input: {
  client: import("pg").PoolClient;
  workspaceId: string;
  invoiceType: InvoiceType;
  sourceType: InvoiceSourceType;
  sourceId: string;
  currency: string;
  totalPaise: number;
  taxablePaise: number;
  gstPaise: number;
  lineItems: InvoiceLineItem[];
  metadata?: Record<string, unknown>;
}): Promise<WorkspaceInvoiceSummary> {
  const existingResult = await input.client.query<BillingInvoiceRow>(
    `SELECT
       id,
       workspace_id,
       invoice_number,
       invoice_type,
       source_type,
       source_id,
       currency,
       total_paise,
       taxable_paise,
       gst_paise,
       status,
       billing_profile_snapshot_json,
       line_items_json,
       created_at
     FROM billing_invoices
     WHERE source_type = $1 AND source_id = $2
     LIMIT 1`,
    [input.sourceType, input.sourceId]
  );
  if (existingResult.rows[0]) {
    return toInvoiceSummary(existingResult.rows[0]);
  }

  const profile = await ensureWorkspaceBillingProfileSeed(input.workspaceId);
  const invoiceNumber = await nextInvoiceNumber(input.client, new Date());
  const insertedResult = await input.client.query<BillingInvoiceRow>(
    `INSERT INTO billing_invoices (
       workspace_id,
       invoice_number,
       invoice_type,
       source_type,
       source_id,
       currency,
       total_paise,
       taxable_paise,
       gst_paise,
       status,
       billing_profile_snapshot_json,
       line_items_json
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'issued', $10::jsonb, $11::jsonb)
     ON CONFLICT (source_type, source_id) DO UPDATE SET
       source_id = EXCLUDED.source_id
     RETURNING
       id,
       workspace_id,
       invoice_number,
       invoice_type,
       source_type,
       source_id,
       currency,
       total_paise,
       taxable_paise,
       gst_paise,
       status,
       billing_profile_snapshot_json,
       line_items_json,
       created_at`,
    [
      input.workspaceId,
      invoiceNumber,
      input.invoiceType,
      input.sourceType,
      input.sourceId,
      input.currency,
      Math.max(0, Math.floor(input.totalPaise)),
      Math.max(0, Math.floor(input.taxablePaise)),
      Math.max(0, Math.floor(input.gstPaise)),
      JSON.stringify({
        ...toProfile(profile),
        metadata: input.metadata ?? {}
      }),
      JSON.stringify(input.lineItems)
    ]
  );

  const row = insertedResult.rows[0];
  if (!row) {
    throw new Error("Failed to issue invoice");
  }
  return toInvoiceSummary(row);
}

async function applyRechargeCreditsInTransaction(input: {
  client: import("pg").PoolClient;
  workspaceId: string;
  credits: number;
  referenceId: string;
  reason: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const credits = toPositiveInteger(input.credits);
  const insertTransaction = await input.client.query<{ id: string }>(
    `INSERT INTO credit_transactions (
       workspace_id,
       type,
       credits,
       reference_id,
       reason,
       metadata_json
     )
     VALUES ($1, 'addon_purchase', $2, $3, $4, $5::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [input.workspaceId, credits, input.referenceId, input.reason, JSON.stringify(input.metadata ?? {})]
  );
  const inserted = Boolean(insertTransaction.rows[0]?.id);
  if (!inserted) {
    return;
  }

  await input.client.query(
    `INSERT INTO credit_wallet (
       workspace_id,
       total_credits,
       used_credits,
       remaining_credits,
       last_reset_date
     )
     VALUES ($1, $2, 0, $2, NOW())
     ON CONFLICT (workspace_id) DO UPDATE SET
       total_credits = credit_wallet.total_credits + $2,
       remaining_credits = credit_wallet.remaining_credits + $2,
       updated_at = NOW()`,
    [input.workspaceId, credits]
  );
}

export async function getWorkspaceBillingOverview(userId: string): Promise<WorkspaceBillingOverview> {
  const workspaceId = await getWorkspaceIdByUserId(userId);
  const row = await getWorkspaceBillingOverviewByWorkspaceId(workspaceId);
  return {
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    plan: {
      code: row.plan_code,
      name: row.plan_name,
      priceMonthly: toNonNegativeInteger(row.plan_price_monthly, 0),
      monthlyCredits: toNonNegativeInteger(row.plan_monthly_credits, 0)
    },
    subscription: {
      status: row.subscription_status,
      nextBillingDate: row.next_billing_date
    },
    credits: {
      total: toNonNegativeInteger(row.total_credits, 0),
      used: toNonNegativeInteger(row.used_credits, 0),
      remaining: toNonNegativeInteger(row.remaining_credits, 0)
    },
    autoRecharge: {
      enabled: Boolean(row.auto_enabled),
      thresholdCredits: toNonNegativeInteger(row.auto_threshold_credits, 0),
      rechargeCredits: toPositiveInteger(row.auto_recharge_credits, 1000),
      maxRechargesPerDay: toPositiveInteger(row.auto_max_recharges_per_day, 1),
      lastTriggeredAt: row.auto_last_triggered_at,
      lastStatus: row.auto_last_status,
      failureCount: toNonNegativeInteger(row.auto_failure_count, 0)
    }
  };
}

export async function getWorkspaceUsageSeries(userId: string, monthsInput = 12): Promise<WorkspaceUsageSeries> {
  const workspaceId = await getWorkspaceIdByUserId(userId);
  const months = Math.min(24, Math.max(1, Math.floor(monthsInput)));

  const result = await pool.query<{
    month_start: string;
    spent_credits: number;
    web_spent: number;
    qr_spent: number;
    api_spent: number;
    unknown_spent: number;
  }>(
    `WITH month_series AS (
       SELECT generate_series(
         date_trunc('month', NOW()) - (($2::int - 1) * INTERVAL '1 month'),
         date_trunc('month', NOW()),
         INTERVAL '1 month'
       ) AS month_start
     ),
     tx AS (
       SELECT
         date_trunc('month', ct.created_at) AS month_start,
         SUM(CASE WHEN ct.type = 'deduction' THEN ABS(ct.credits) ELSE 0 END)::int AS spent_credits,
         SUM(
           CASE
             WHEN ct.type = 'deduction' AND COALESCE(ct.metadata_json->>'channelType', '') = 'web'
               THEN ABS(ct.credits)
             ELSE 0
           END
         )::int AS web_spent,
         SUM(
           CASE
             WHEN ct.type = 'deduction' AND COALESCE(ct.metadata_json->>'channelType', '') = 'qr'
               THEN ABS(ct.credits)
             ELSE 0
           END
         )::int AS qr_spent,
         SUM(
           CASE
             WHEN ct.type = 'deduction' AND COALESCE(ct.metadata_json->>'channelType', '') = 'api'
               THEN ABS(ct.credits)
             ELSE 0
           END
         )::int AS api_spent,
         SUM(
           CASE
             WHEN ct.type = 'deduction' AND COALESCE(ct.metadata_json->>'channelType', '') NOT IN ('web', 'qr', 'api')
               THEN ABS(ct.credits)
             ELSE 0
           END
         )::int AS unknown_spent
       FROM credit_transactions ct
       WHERE ct.workspace_id = $1
       GROUP BY date_trunc('month', ct.created_at)
     )
     SELECT
       ms.month_start::text,
       COALESCE(tx.spent_credits, 0) AS spent_credits,
       COALESCE(tx.web_spent, 0) AS web_spent,
       COALESCE(tx.qr_spent, 0) AS qr_spent,
       COALESCE(tx.api_spent, 0) AS api_spent,
       COALESCE(tx.unknown_spent, 0) AS unknown_spent
     FROM month_series ms
     LEFT JOIN tx ON tx.month_start = ms.month_start
     ORDER BY ms.month_start ASC`,
    [workspaceId, months]
  );

  let totalSpent = 0;
  let totalWeb = 0;
  let totalQr = 0;
  let totalApi = 0;
  let totalUnknown = 0;
  const points = result.rows.map((row) => {
    const spentCredits = toNonNegativeInteger(row.spent_credits, 0);
    const webSpent = toNonNegativeInteger(row.web_spent, 0);
    const qrSpent = toNonNegativeInteger(row.qr_spent, 0);
    const apiSpent = toNonNegativeInteger(row.api_spent, 0);
    const unknownSpent = toNonNegativeInteger(row.unknown_spent, 0);
    totalSpent += spentCredits;
    totalWeb += webSpent;
    totalQr += qrSpent;
    totalApi += apiSpent;
    totalUnknown += unknownSpent;
    return {
      month: row.month_start.slice(0, 7),
      spentCredits,
      channelBreakdown: {
        web: webSpent,
        qr: qrSpent,
        api: apiSpent,
        unknown: unknownSpent
      }
    };
  });

  return {
    months,
    points,
    totals: {
      spentCredits: totalSpent,
      web: totalWeb,
      qr: totalQr,
      api: totalApi,
      unknown: totalUnknown
    }
  };
}

export async function getWorkspaceTransactions(input: {
  userId: string;
  cursor?: string | null;
  limit?: number;
  type?: string | null;
}): Promise<WorkspaceBillingTransactionFeed> {
  const workspaceId = await getWorkspaceIdByUserId(input.userId);
  const cursor = decodeCursor(input.cursor);
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 30)));
  const typeFilter = normalizeNullableText(input.type)?.toLowerCase() ?? null;

  const result = await pool.query<{
    created_at: string;
    source: "credit_transaction" | "recharge_order" | "invoice";
    row_id: string;
    event_type: string;
    credits: number;
    amount_paise: number | null;
    currency: string | null;
    status: string | null;
    reference_id: string | null;
    reason: string | null;
    metadata_json: Record<string, unknown> | null;
  }>(
    `WITH feed AS (
       SELECT
         ct.created_at,
         'credit_transaction'::text AS source,
         ct.id::text AS row_id,
         ct.type AS event_type,
         ct.credits AS credits,
         NULL::int AS amount_paise,
         NULL::text AS currency,
         NULL::text AS status,
         ct.reference_id AS reference_id,
         ct.reason AS reason,
         ct.metadata_json AS metadata_json
       FROM credit_transactions ct
       WHERE ct.workspace_id = $1

       UNION ALL

       SELECT
         cro.created_at,
         'recharge_order'::text AS source,
         cro.id::text AS row_id,
         'recharge_order'::text AS event_type,
         cro.credits AS credits,
         cro.amount_total_paise AS amount_paise,
         cro.currency AS currency,
         cro.status AS status,
         cro.razorpay_order_id AS reference_id,
         'Credit recharge order'::text AS reason,
         cro.metadata_json AS metadata_json
       FROM credit_recharge_orders cro
       WHERE cro.workspace_id = $1

       UNION ALL

       SELECT
         bi.created_at,
         'invoice'::text AS source,
         bi.id::text AS row_id,
         'invoice'::text AS event_type,
         0 AS credits,
         bi.total_paise AS amount_paise,
         bi.currency AS currency,
         bi.status AS status,
         bi.invoice_number AS reference_id,
         'Invoice issued'::text AS reason,
         COALESCE(bi.line_items_json::jsonb, '{}'::jsonb) AS metadata_json
       FROM billing_invoices bi
       WHERE bi.workspace_id = $1
     )
     SELECT
       created_at,
       source,
       row_id,
       event_type,
       credits,
       amount_paise,
       currency,
       status,
       reference_id,
       reason,
       metadata_json
     FROM feed
     WHERE
       ($2::timestamptz IS NULL OR (created_at, row_id) < ($2::timestamptz, $3::text))
       AND (
         $4::text IS NULL OR
         source = $4::text OR
         event_type = $4::text
       )
     ORDER BY created_at DESC, row_id DESC
     LIMIT $5`,
    [workspaceId, cursor?.createdAt ?? null, cursor?.rowId ?? "", typeFilter, limit + 1]
  );

  const hasMore = result.rows.length > limit;
  const pageRows = hasMore ? result.rows.slice(0, limit) : result.rows;
  const items = pageRows.map<WorkspaceBillingTransactionFeedItem>((row) => ({
    createdAt: row.created_at,
    source: row.source,
    itemId: row.row_id,
    type: row.event_type,
    credits: Math.trunc(row.credits),
    amountPaise: row.amount_paise === null ? null : toNonNegativeInteger(row.amount_paise, 0),
    currency: row.currency,
    status: row.status,
    referenceId: row.reference_id,
    reason: row.reason,
    metadata: row.metadata_json ?? {}
  }));

  const last = pageRows[pageRows.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, rowId: last.row_id }) : null
  };
}

export async function getWorkspaceRenewalHistory(userId: string, limitInput = 12): Promise<WorkspaceRenewalHistoryItem[]> {
  const workspaceId = await getWorkspaceIdByUserId(userId);
  const limit = Math.min(100, Math.max(1, Math.floor(limitInput)));

  const result = await pool.query<{
    renewal_id: string;
    renewed_at: string;
    credits_reset: number;
    plan_code: string | null;
    plan_name: string | null;
    razorpay_payment_id: string | null;
    payment_amount_paise: number | null;
    payment_currency: string | null;
    payment_status: string | null;
    payment_paid_at: string | null;
  }>(
    `SELECT
       ct.id AS renewal_id,
       ct.created_at AS renewed_at,
       ct.credits AS credits_reset,
       p.code AS plan_code,
       p.name AS plan_name,
       payment_match.razorpay_payment_id,
       payment_match.amount_paise AS payment_amount_paise,
       payment_match.currency AS payment_currency,
       payment_match.status AS payment_status,
       payment_match.paid_at AS payment_paid_at
     FROM credit_transactions ct
     JOIN workspaces w ON w.id = ct.workspace_id
     LEFT JOIN subscriptions s ON s.workspace_id = ct.workspace_id
     LEFT JOIN plans p ON p.id = s.plan_id
     LEFT JOIN LATERAL (
       SELECT
         sp.razorpay_payment_id,
         sp.amount_paise,
         sp.currency,
         sp.status,
         sp.paid_at
       FROM subscription_payments sp
       WHERE sp.user_id = w.owner_id
         AND sp.status = 'captured'
         AND sp.paid_at IS NOT NULL
         AND sp.paid_at <= ct.created_at + INTERVAL '2 days'
       ORDER BY ABS(EXTRACT(EPOCH FROM (ct.created_at - sp.paid_at))) ASC
       LIMIT 1
     ) payment_match ON TRUE
     WHERE ct.workspace_id = $1
       AND ct.type = 'renewal'
     ORDER BY ct.created_at DESC
     LIMIT $2`,
    [workspaceId, limit]
  );

  return result.rows.map((row) => ({
    renewalId: row.renewal_id,
    renewedAt: row.renewed_at,
    creditsReset: toNonNegativeInteger(row.credits_reset, 0),
    planCode: row.plan_code,
    planName: row.plan_name,
    payment: {
      razorpayPaymentId: row.razorpay_payment_id,
      amountPaise: row.payment_amount_paise === null ? null : toNonNegativeInteger(row.payment_amount_paise, 0),
      currency: row.payment_currency,
      status: row.payment_status,
      paidAt: row.payment_paid_at
    }
  }));
}

export async function getWorkspaceBillingProfile(userId: string): Promise<WorkspaceBillingProfile> {
  const workspaceId = await getWorkspaceIdByUserId(userId);
  const row = await ensureWorkspaceBillingProfileSeed(workspaceId);
  return toProfile(row);
}

export async function upsertWorkspaceBillingProfile(
  userId: string,
  input: {
    legalName?: string | null;
    gstin?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    country?: string | null;
    billingEmail?: string | null;
    billingPhone?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<WorkspaceBillingProfile> {
  const workspaceId = await getWorkspaceIdByUserId(userId);
  const normalizedGstin = normalizeGstin(input.gstin);
  if (normalizedGstin && !isValidGstin(normalizedGstin)) {
    throw new Error("Invalid GSTIN format");
  }

  const result = await pool.query<WorkspaceBillingProfileRow>(
    `INSERT INTO workspace_billing_profiles (
       workspace_id,
       legal_name,
       gstin,
       address_line1,
       address_line2,
       city,
       state,
       pincode,
       country,
       billing_email,
       billing_phone,
       metadata_json
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'IN'), $10, $11, $12::jsonb)
     ON CONFLICT (workspace_id) DO UPDATE SET
       legal_name = EXCLUDED.legal_name,
       gstin = EXCLUDED.gstin,
       address_line1 = EXCLUDED.address_line1,
       address_line2 = EXCLUDED.address_line2,
       city = EXCLUDED.city,
       state = EXCLUDED.state,
       pincode = EXCLUDED.pincode,
       country = EXCLUDED.country,
       billing_email = EXCLUDED.billing_email,
       billing_phone = EXCLUDED.billing_phone,
       metadata_json = COALESCE(workspace_billing_profiles.metadata_json, '{}'::jsonb) || EXCLUDED.metadata_json,
       updated_at = NOW()
     RETURNING
       id,
       workspace_id,
       legal_name,
       gstin,
       address_line1,
       address_line2,
       city,
       state,
       pincode,
       country,
       billing_email,
       billing_phone,
       metadata_json,
       created_at,
       updated_at`,
    [
      workspaceId,
      normalizeNullableText(input.legalName) ?? null,
      normalizedGstin,
      normalizeNullableText(input.addressLine1) ?? null,
      normalizeNullableText(input.addressLine2) ?? null,
      normalizeNullableText(input.city) ?? null,
      normalizeNullableText(input.state) ?? null,
      normalizeNullableText(input.pincode) ?? null,
      normalizeNullableText(input.country)?.toUpperCase() ?? "IN",
      normalizeNullableText(input.billingEmail) ?? null,
      normalizeNullableText(input.billingPhone) ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to save billing profile");
  }
  return toProfile(row);
}

export function computeRechargePriceForCredits(creditsInput: number): RechargeOrderPriceBreakdown & { credits: number } {
  const credits = toPositiveInteger(creditsInput);
  const totalPaise = Math.max(100, Math.round(credits * getPricePerCreditPaise()));
  const taxBreakdown = computeTaxBreakdown(totalPaise, getGstRatePercent());
  return {
    credits,
    ...taxBreakdown
  };
}

export async function createWorkspaceRechargeOrder(input: {
  userId: string;
  credits: number;
  metadata?: Record<string, unknown>;
  orderNotes?: Record<string, string>;
}): Promise<WorkspaceRechargeOrderCreateResult> {
  const workspaceId = await getWorkspaceIdByUserId(input.userId);
  const price = computeRechargePriceForCredits(input.credits);
  const client = getRazorpayClient();
  const keyId = getRazorpayCheckoutKey();
  const order = (await client.orders.create({
    amount: price.totalPaise,
    currency: "INR",
    receipt: `workspace_recharge_${workspaceId}_${Date.now()}`,
    notes: {
      purchaseType: "workspace_recharge",
      workspaceId,
      userId: input.userId,
      credits: String(price.credits),
      ...(input.orderNotes ?? {})
    }
  })) as RazorpayOrderEntity;

  const insertResult = await pool.query<CreditRechargeOrderRow>(
    `INSERT INTO credit_recharge_orders (
       workspace_id,
       user_id,
       razorpay_order_id,
       status,
       credits,
       amount_total_paise,
       amount_taxable_paise,
       gst_amount_paise,
       gst_rate_percent,
       currency,
       metadata_json
     )
     VALUES ($1, $2, $3, 'created', $4, $5, $6, $7, $8, $9, $10::jsonb)
     RETURNING
       id,
       workspace_id,
       user_id,
       razorpay_order_id,
       razorpay_payment_id,
       status,
       credits,
       amount_total_paise,
       amount_taxable_paise,
       gst_amount_paise,
       gst_rate_percent,
       currency,
       metadata_json,
       created_at,
       paid_at,
       updated_at`,
    [
      workspaceId,
      input.userId,
      order.id,
      price.credits,
      price.totalPaise,
      price.taxablePaise,
      price.gstPaise,
      price.gstRatePercent,
      order.currency ?? "INR",
      JSON.stringify(input.metadata ?? {})
    ]
  );
  const row = insertResult.rows[0];
  if (!row) {
    throw new Error("Failed to create recharge order");
  }

  return {
    rechargeOrderId: row.id,
    keyId,
    razorpayOrderId: order.id,
    currency: row.currency,
    credits: row.credits,
    amountTotalPaise: toNonNegativeInteger(row.amount_total_paise, price.totalPaise),
    amountTaxablePaise: toNonNegativeInteger(row.amount_taxable_paise, price.taxablePaise),
    gstAmountPaise: toNonNegativeInteger(row.gst_amount_paise, price.gstPaise),
    gstRatePercent: Number(row.gst_rate_percent ?? price.gstRatePercent)
  };
}

export async function markRechargeOrderPaidFromWebhook(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  paidAt?: string | null;
  event: string;
  amountPaise?: number;
  currency?: string;
  rawPayload?: Record<string, unknown>;
}): Promise<{ applied: boolean; workspaceId: string | null; invoiceId: string | null }> {
  const paidAt = input.paidAt ?? new Date().toISOString();
  const result = await withTransaction(async (client) => {
    const rowResult = await client.query<CreditRechargeOrderRow>(
      `SELECT
         id,
         workspace_id,
         user_id,
         razorpay_order_id,
         razorpay_payment_id,
         status,
         credits,
         amount_total_paise,
         amount_taxable_paise,
         gst_amount_paise,
         gst_rate_percent,
         currency,
         metadata_json,
         created_at,
         paid_at,
         updated_at
       FROM credit_recharge_orders
       WHERE razorpay_order_id = $1
       LIMIT 1
       FOR UPDATE`,
      [input.razorpayOrderId]
    );
    const order = rowResult.rows[0];
    if (!order) {
      return { applied: false, workspaceId: null, invoiceId: null };
    }

    const alreadyPaid = order.status === "paid" && Boolean(order.razorpay_payment_id);
    await client.query(
      `UPDATE credit_recharge_orders
       SET status = 'paid',
           razorpay_payment_id = COALESCE(razorpay_payment_id, $2),
           paid_at = COALESCE(paid_at, $3::timestamptz),
           updated_at = NOW(),
           metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $4::jsonb
       WHERE id = $1`,
      [
        order.id,
        input.razorpayPaymentId,
        paidAt,
        JSON.stringify({
          webhookEvent: input.event,
          paidAt,
          amountPaise: input.amountPaise ?? null,
          currency: input.currency ?? null,
          rawPayload: input.rawPayload ?? null
        })
      ]
    );

    await applyRechargeCreditsInTransaction({
      client,
      workspaceId: order.workspace_id,
      credits: order.credits,
      referenceId: input.razorpayPaymentId,
      reason: "Recharge payment captured",
      metadata: {
        event: input.event,
        razorpayOrderId: input.razorpayOrderId,
        rechargeOrderId: order.id
      }
    });

    const invoice = await issueInvoiceInTransaction({
      client,
      workspaceId: order.workspace_id,
      invoiceType: "recharge",
      sourceType: "recharge_order",
      sourceId: order.id,
      currency: order.currency ?? "INR",
      totalPaise: toNonNegativeInteger(order.amount_total_paise, 0),
      taxablePaise: toNonNegativeInteger(order.amount_taxable_paise, 0),
      gstPaise: toNonNegativeInteger(order.gst_amount_paise, 0),
      lineItems: buildRechargeLineItems(order.credits, toNonNegativeInteger(order.amount_total_paise, 0)),
      metadata: {
        razorpayOrderId: input.razorpayOrderId,
        razorpayPaymentId: input.razorpayPaymentId
      }
    });

    return {
      applied: !alreadyPaid,
      workspaceId: order.workspace_id,
      invoiceId: invoice.id
    };
  });

  return result;
}

export async function markRechargeOrderFailedFromWebhook(input: {
  razorpayOrderId: string;
  event: string;
  errorMessage?: string | null;
  rawPayload?: Record<string, unknown>;
}): Promise<boolean> {
  const result = await pool.query(
    `UPDATE credit_recharge_orders
     SET status = CASE WHEN status = 'paid' THEN status ELSE 'failed' END,
         updated_at = NOW(),
         metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $2::jsonb
     WHERE razorpay_order_id = $1`,
    [
      input.razorpayOrderId,
      JSON.stringify({
        webhookEvent: input.event,
        errorMessage: input.errorMessage ?? null,
        rawPayload: input.rawPayload ?? null
      })
    ]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function issueSubscriptionInvoiceFromPayment(input: {
  userId: string;
  razorpayPaymentId: string;
  amountPaise: number;
  currency?: string;
  paidAt?: string | null;
  planCode?: string | null;
}): Promise<WorkspaceInvoiceSummary | null> {
  const workspaceId = await getWorkspaceIdByUserId(input.userId);
  const totalPaise = Math.max(0, Math.floor(input.amountPaise));
  if (totalPaise <= 0) {
    return null;
  }
  const tax = computeTaxBreakdown(totalPaise, getGstRatePercent());
  const invoice = await withTransaction(async (client) => {
    const overview = await client.query<{
      plan_name: string | null;
      plan_code: string | null;
    }>(
      `SELECT p.name AS plan_name, p.code AS plan_code
       FROM workspaces w
       LEFT JOIN plans p ON p.id = w.plan_id
       WHERE w.id = $1
       LIMIT 1`,
      [workspaceId]
    );
    const planName = overview.rows[0]?.plan_name ?? "Subscription";
    const planCode = overview.rows[0]?.plan_code ?? input.planCode ?? "starter";
    const lineItems: InvoiceLineItem[] = [
      {
        label: `${planName} subscription`,
        quantity: 1,
        unitAmountPaise: totalPaise,
        totalAmountPaise: totalPaise,
        metadata: {
          planCode,
          paidAt: input.paidAt ?? null
        }
      }
    ];

    return issueInvoiceInTransaction({
      client,
      workspaceId,
      invoiceType: "subscription",
      sourceType: "subscription_payment",
      sourceId: input.razorpayPaymentId,
      currency: input.currency ?? "INR",
      totalPaise: tax.totalPaise,
      taxablePaise: tax.taxablePaise,
      gstPaise: tax.gstPaise,
      lineItems,
      metadata: {
        razorpayPaymentId: input.razorpayPaymentId,
        paidAt: input.paidAt ?? null
      }
    });
  });
  return invoice;
}

export async function listWorkspaceInvoices(userId: string, limitInput = 20): Promise<WorkspaceInvoiceSummary[]> {
  const workspaceId = await getWorkspaceIdByUserId(userId);
  const limit = Math.min(100, Math.max(1, Math.floor(limitInput)));
  const result = await pool.query<BillingInvoiceRow>(
    `SELECT
       id,
       workspace_id,
       invoice_number,
       invoice_type,
       source_type,
       source_id,
       currency,
       total_paise,
       taxable_paise,
       gst_paise,
       status,
       billing_profile_snapshot_json,
       line_items_json,
       created_at
     FROM billing_invoices
     WHERE workspace_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [workspaceId, limit]
  );
  return result.rows.map(toInvoiceSummary);
}

export async function generateWorkspaceInvoicePdf(input: {
  userId: string;
  invoiceId: string;
}): Promise<{ filename: string; pdf: Buffer; invoice: WorkspaceInvoiceSummary }> {
  const workspaceId = await getWorkspaceIdByUserId(input.userId);
  const result = await pool.query<BillingInvoiceRow>(
    `SELECT
       id,
       workspace_id,
       invoice_number,
       invoice_type,
       source_type,
       source_id,
       currency,
       total_paise,
       taxable_paise,
       gst_paise,
       status,
       billing_profile_snapshot_json,
       line_items_json,
       created_at
     FROM billing_invoices
     WHERE id = $1
       AND workspace_id = $2
     LIMIT 1`,
    [input.invoiceId, workspaceId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Invoice not found");
  }

  const summary = toInvoiceSummary(row);
  const profile =
    row.billing_profile_snapshot_json && typeof row.billing_profile_snapshot_json === "object"
      ? row.billing_profile_snapshot_json
      : {};
  const lineItems = parseInvoiceLineItems(row.line_items_json);
  const lines: string[] = [];
  lines.push("WagenAI GST Invoice");
  lines.push(`Invoice Number: ${summary.invoiceNumber}`);
  lines.push(`Invoice Date: ${new Date(summary.createdAt).toLocaleString("en-IN")}`);
  lines.push(`Invoice Type: ${summary.invoiceType}`);
  lines.push("");
  lines.push(`Legal Name: ${String(profile.legalName ?? profile.legal_name ?? "-")}`);
  lines.push(`GSTIN: ${String(profile.gstin ?? "-")}`);
  lines.push(
    `Address: ${String(profile.addressLine1 ?? profile.address_line1 ?? "-")} ${String(
      profile.addressLine2 ?? profile.address_line2 ?? ""
    )}`.trim()
  );
  lines.push(
    `City/State/Pincode: ${String(profile.city ?? "-")}, ${String(profile.state ?? "-")} ${String(profile.pincode ?? "-")}`
  );
  lines.push(`Billing Email: ${String(profile.billingEmail ?? profile.billing_email ?? "-")}`);
  lines.push("");
  lines.push("Line Items:");
  if (lineItems.length === 0) {
    lines.push("- Subscription or recharge charge");
  } else {
    for (const item of lineItems) {
      lines.push(`- ${item.label}: ${item.quantity} x ${formatInrFromPaise(item.unitAmountPaise)} = ${formatInrFromPaise(item.totalAmountPaise)}`);
    }
  }
  lines.push("");
  lines.push(`Taxable Amount: ${formatInrFromPaise(summary.taxablePaise)}`);
  lines.push(`GST Amount: ${formatInrFromPaise(summary.gstPaise)}`);
  lines.push(`Total (Tax Inclusive): ${formatInrFromPaise(summary.totalPaise)}`);
  lines.push("");
  lines.push("This is a system generated GST invoice.");

  const pdf = generateSimplePdf(lines);
  return {
    filename: `${summary.invoiceNumber}.pdf`,
    pdf,
    invoice: summary
  };
}

export async function getAutoRechargeSettings(userId: string): Promise<AutoRechargeSettings> {
  const workspaceId = await getWorkspaceIdByUserId(userId);
  const result = await pool.query<AutoRechargeSettingsRow>(
    `INSERT INTO auto_recharge_settings (workspace_id)
     VALUES ($1)
     ON CONFLICT (workspace_id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id
     RETURNING
       id,
       workspace_id,
       enabled,
       threshold_credits,
       recharge_credits,
       max_recharges_per_day,
       gateway_customer_id,
       gateway_token_id,
       last_triggered_at,
       last_status,
       failure_count,
       metadata_json,
       created_at,
       updated_at`,
    [workspaceId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Auto recharge settings not found");
  }
  return toAutoRechargeSettings(row);
}

export async function upsertAutoRechargeSettings(
  userId: string,
  input: AutoRechargeUpsertInput
): Promise<AutoRechargeSettings> {
  const workspaceId = await getWorkspaceIdByUserId(userId);
  const enabled = Boolean(input.enabled);
  const thresholdCredits = toNonNegativeInteger(input.thresholdCredits, 0);
  const rechargeCredits = toPositiveInteger(input.rechargeCredits, 1000);
  const maxRechargesPerDay = toPositiveInteger(input.maxRechargesPerDay, 1);
  const gatewayCustomerId = normalizeNullableText(input.gatewayCustomerId);
  const gatewayTokenId = normalizeNullableText(input.gatewayTokenId);

  if (enabled && (!gatewayCustomerId || !gatewayTokenId)) {
    throw new Error("gatewayCustomerId and gatewayTokenId are required when auto-recharge is enabled");
  }

  const result = await pool.query<AutoRechargeSettingsRow>(
    `INSERT INTO auto_recharge_settings (
       workspace_id,
       enabled,
       threshold_credits,
       recharge_credits,
       max_recharges_per_day,
       gateway_customer_id,
       gateway_token_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (workspace_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       threshold_credits = EXCLUDED.threshold_credits,
       recharge_credits = EXCLUDED.recharge_credits,
       max_recharges_per_day = EXCLUDED.max_recharges_per_day,
       gateway_customer_id = COALESCE(EXCLUDED.gateway_customer_id, auto_recharge_settings.gateway_customer_id),
       gateway_token_id = COALESCE(EXCLUDED.gateway_token_id, auto_recharge_settings.gateway_token_id),
       updated_at = NOW()
     RETURNING
       id,
       workspace_id,
       enabled,
       threshold_credits,
       recharge_credits,
       max_recharges_per_day,
       gateway_customer_id,
       gateway_token_id,
       last_triggered_at,
       last_status,
       failure_count,
       metadata_json,
       created_at,
       updated_at`,
    [workspaceId, enabled, thresholdCredits, rechargeCredits, maxRechargesPerDay, gatewayCustomerId, gatewayTokenId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to save auto-recharge settings");
  }
  return toAutoRechargeSettings(row);
}

export async function disableAutoRecharge(userId: string): Promise<AutoRechargeSettings> {
  const workspaceId = await getWorkspaceIdByUserId(userId);
  const result = await pool.query<AutoRechargeSettingsRow>(
    `UPDATE auto_recharge_settings
     SET enabled = FALSE,
         last_status = 'disabled_by_user',
         updated_at = NOW()
     WHERE workspace_id = $1
     RETURNING
       id,
       workspace_id,
       enabled,
       threshold_credits,
       recharge_credits,
       max_recharges_per_day,
       gateway_customer_id,
       gateway_token_id,
       last_triggered_at,
       last_status,
       failure_count,
       metadata_json,
       created_at,
       updated_at`,
    [workspaceId]
  );
  const row = result.rows[0];
  if (!row) {
    return getAutoRechargeSettings(userId);
  }
  return toAutoRechargeSettings(row);
}

async function logAutoRechargeAttempt(input: {
  client: import("pg").PoolClient;
  workspaceId: string;
  status: AutoRechargeAttemptStatus;
  reason: string;
  rechargeOrderId?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await input.client.query(
    `INSERT INTO auto_recharge_attempts (
       workspace_id,
       triggered_at,
       reason,
       status,
       recharge_order_id,
       error_message,
       metadata_json
     )
     VALUES ($1, NOW(), $2, $3, $4, $5, $6::jsonb)`,
    [
      input.workspaceId,
      input.reason,
      input.status,
      input.rechargeOrderId ?? null,
      input.errorMessage ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
}

async function runAutoRechargeForWorkspace(workspaceId: string): Promise<{
  processed: boolean;
  success: boolean;
  skipped: boolean;
}> {
  const now = new Date();
  const maxFailures = Math.max(1, Math.floor(env.AUTO_RECHARGE_MAX_FAILURES));

  return withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`auto_recharge:${workspaceId}`]);
    const contextResult = await client.query<
      AutoRechargeSettingsRow & {
        remaining_credits: number | null;
        owner_id: string;
      }
    >(
      `SELECT
         ars.id,
         ars.workspace_id,
         ars.enabled,
         ars.threshold_credits,
         ars.recharge_credits,
         ars.max_recharges_per_day,
         ars.gateway_customer_id,
         ars.gateway_token_id,
         ars.last_triggered_at,
         ars.last_status,
         ars.failure_count,
         ars.metadata_json,
         ars.created_at,
         ars.updated_at,
         cw.remaining_credits,
         w.owner_id
       FROM auto_recharge_settings ars
       JOIN workspaces w ON w.id = ars.workspace_id
       LEFT JOIN credit_wallet cw ON cw.workspace_id = ars.workspace_id
       WHERE ars.workspace_id = $1
       LIMIT 1
       FOR UPDATE`,
      [workspaceId]
    );

    const settings = contextResult.rows[0];
    if (!settings) {
      return { processed: false, success: false, skipped: true };
    }

    const remainingCredits = toNonNegativeInteger(settings.remaining_credits, 0);
    const thresholdCredits = toNonNegativeInteger(settings.threshold_credits, 0);
    if (!settings.enabled) {
      return { processed: false, success: false, skipped: true };
    }
    if (remainingCredits > thresholdCredits) {
      await logAutoRechargeAttempt({
        client,
        workspaceId,
        status: "skipped",
        reason: "threshold_not_reached",
        metadata: {
          remainingCredits,
          thresholdCredits
        }
      });
      return { processed: true, success: false, skipped: true };
    }
    if (!settings.gateway_customer_id || !settings.gateway_token_id) {
      await client.query(
        `UPDATE auto_recharge_settings
         SET enabled = FALSE,
             failure_count = failure_count + 1,
             last_triggered_at = NOW(),
             last_status = 'failed_missing_gateway_token',
             updated_at = NOW()
         WHERE workspace_id = $1`,
        [workspaceId]
      );
      await logAutoRechargeAttempt({
        client,
        workspaceId,
        status: "failed",
        reason: "missing_gateway_token",
        errorMessage: "Missing gateway token/customer for auto recharge"
      });
      return { processed: true, success: false, skipped: false };
    }

    const todayCountResult = await client.query<{ attempts: number }>(
      `SELECT COUNT(*)::int AS attempts
       FROM auto_recharge_attempts
       WHERE workspace_id = $1
         AND status = 'success'
         AND triggered_at >= date_trunc('day', NOW())`,
      [workspaceId]
    );
    const todaySuccessCount = toNonNegativeInteger(todayCountResult.rows[0]?.attempts, 0);
    const maxDaily = toPositiveInteger(settings.max_recharges_per_day, 1);
    if (todaySuccessCount >= maxDaily) {
      await logAutoRechargeAttempt({
        client,
        workspaceId,
        status: "skipped",
        reason: "max_daily_limit_reached",
        metadata: {
          todaySuccessCount,
          maxDaily
        }
      });
      return { processed: true, success: false, skipped: true };
    }

    const price = computeRechargePriceForCredits(settings.recharge_credits);
    const razorpay = getRazorpayClient();
    const createdOrder = (await razorpay.orders.create({
      amount: price.totalPaise,
      currency: "INR",
      receipt: `auto_recharge_${workspaceId}_${Date.now()}`,
      notes: {
        purchaseType: "workspace_recharge",
        mode: "auto_recharge",
        workspaceId,
        userId: settings.owner_id,
        credits: String(price.credits)
      }
    })) as RazorpayOrderEntity;

    const rechargeOrderResult = await client.query<CreditRechargeOrderRow>(
      `INSERT INTO credit_recharge_orders (
         workspace_id,
         user_id,
         razorpay_order_id,
         status,
         credits,
         amount_total_paise,
         amount_taxable_paise,
         gst_amount_paise,
         gst_rate_percent,
         currency,
         metadata_json
       )
       VALUES ($1, $2, $3, 'created', $4, $5, $6, $7, $8, $9, $10::jsonb)
       RETURNING
         id,
         workspace_id,
         user_id,
         razorpay_order_id,
         razorpay_payment_id,
         status,
         credits,
         amount_total_paise,
         amount_taxable_paise,
         gst_amount_paise,
         gst_rate_percent,
         currency,
         metadata_json,
         created_at,
         paid_at,
         updated_at`,
      [
        workspaceId,
        settings.owner_id,
        createdOrder.id,
        price.credits,
        price.totalPaise,
        price.taxablePaise,
        price.gstPaise,
        price.gstRatePercent,
        createdOrder.currency ?? "INR",
        JSON.stringify({
          source: "auto_recharge",
          triggeredAt: now.toISOString()
        })
      ]
    );
    const rechargeOrder = rechargeOrderResult.rows[0];
    if (!rechargeOrder) {
      throw new Error("Failed to create auto-recharge order");
    }

    try {
      const payment = await createRazorpayTokenCharge({
        amount: price.totalPaise,
        currency: "INR",
        order_id: createdOrder.id,
        customer_id: settings.gateway_customer_id,
        token: settings.gateway_token_id,
        recurring: 1,
        description: "Auto recharge credits"
      });

      const paymentStatus = String(payment.status ?? "").toLowerCase();
      const captured = paymentStatus === "captured";
      if (!captured || !payment.id) {
        throw new Error(`Auto-recharge payment not captured (status=${payment.status ?? "unknown"})`);
      }

      const paidAt =
        typeof payment.created_at === "number" && Number.isFinite(payment.created_at)
          ? new Date(payment.created_at * 1000).toISOString()
          : now.toISOString();

      await client.query(
        `UPDATE credit_recharge_orders
         SET status = 'paid',
             razorpay_payment_id = $2,
             paid_at = $3::timestamptz,
             updated_at = NOW(),
             metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $4::jsonb
         WHERE id = $1`,
        [
          rechargeOrder.id,
          payment.id,
          paidAt,
          JSON.stringify({
            source: "auto_recharge",
            paymentStatus: payment.status ?? null
          })
        ]
      );

      await applyRechargeCreditsInTransaction({
        client,
        workspaceId,
        credits: rechargeOrder.credits,
        referenceId: payment.id,
        reason: "Auto-recharge payment captured",
        metadata: {
          source: "auto_recharge",
          razorpayOrderId: createdOrder.id
        }
      });

      await issueInvoiceInTransaction({
        client,
        workspaceId,
        invoiceType: "recharge",
        sourceType: "recharge_order",
        sourceId: rechargeOrder.id,
        currency: rechargeOrder.currency,
        totalPaise: toNonNegativeInteger(rechargeOrder.amount_total_paise, 0),
        taxablePaise: toNonNegativeInteger(rechargeOrder.amount_taxable_paise, 0),
        gstPaise: toNonNegativeInteger(rechargeOrder.gst_amount_paise, 0),
        lineItems: buildRechargeLineItems(rechargeOrder.credits, toNonNegativeInteger(rechargeOrder.amount_total_paise, 0)),
        metadata: {
          source: "auto_recharge",
          razorpayPaymentId: payment.id
        }
      });

      await client.query(
        `UPDATE auto_recharge_settings
         SET failure_count = 0,
             last_triggered_at = NOW(),
             last_status = 'success',
             updated_at = NOW()
         WHERE workspace_id = $1`,
        [workspaceId]
      );
      await logAutoRechargeAttempt({
        client,
        workspaceId,
        status: "success",
        reason: "threshold_triggered",
        rechargeOrderId: rechargeOrder.id,
        metadata: {
          paymentId: payment.id,
          amountPaise: payment.amount ?? price.totalPaise
        }
      });

      return { processed: true, success: true, skipped: false };
    } catch (error) {
      const message = (error as Error).message || "Auto recharge failed";
      const nextFailureCount = toNonNegativeInteger(settings.failure_count, 0) + 1;
      const disableNow = nextFailureCount >= maxFailures;
      await client.query(
        `UPDATE credit_recharge_orders
         SET status = 'failed',
             updated_at = NOW(),
             metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $2::jsonb
         WHERE id = $1`,
        [
          rechargeOrder.id,
          JSON.stringify({
            source: "auto_recharge",
            error: message
          })
        ]
      );
      await client.query(
        `UPDATE auto_recharge_settings
         SET failure_count = $2,
             enabled = CASE WHEN $3 THEN FALSE ELSE enabled END,
             last_triggered_at = NOW(),
             last_status = $4,
             updated_at = NOW()
         WHERE workspace_id = $1`,
        [workspaceId, nextFailureCount, disableNow, disableNow ? "disabled_after_failures" : "failed"]
      );
      await logAutoRechargeAttempt({
        client,
        workspaceId,
        status: "failed",
        reason: "threshold_triggered",
        rechargeOrderId: rechargeOrder.id,
        errorMessage: message
      });
      return { processed: true, success: false, skipped: false };
    }
  });
}

export async function runAutoRechargeSweep(options?: {
  limit?: number;
}): Promise<{ scanned: number; processed: number; succeeded: number; failed: number; skipped: number }> {
  if (!env.AUTO_RECHARGE_CRON_ENABLED) {
    return { scanned: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0 };
  }
  const limit = Math.min(1000, Math.max(1, Math.floor(options?.limit ?? env.AUTO_RECHARGE_SWEEP_LIMIT)));
  const candidates = await pool.query<{ workspace_id: string }>(
    `SELECT ars.workspace_id
     FROM auto_recharge_settings ars
     JOIN credit_wallet cw ON cw.workspace_id = ars.workspace_id
     WHERE ars.enabled = TRUE
       AND cw.remaining_credits <= ars.threshold_credits
     ORDER BY cw.remaining_credits ASC
     LIMIT $1`,
    [limit]
  );

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const candidate of candidates.rows) {
    try {
      const outcome = await runAutoRechargeForWorkspace(candidate.workspace_id);
      if (!outcome.processed) {
        continue;
      }
      processed += 1;
      if (outcome.success) {
        succeeded += 1;
      } else if (outcome.skipped) {
        skipped += 1;
      } else {
        failed += 1;
      }
    } catch {
      processed += 1;
      failed += 1;
    }
  }

  return {
    scanned: candidates.rows.length,
    processed,
    succeeded,
    failed,
    skipped
  };
}

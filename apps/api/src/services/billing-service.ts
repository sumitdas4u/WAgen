import { createHmac, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";

export const BILLING_PLAN_CODES = ["starter", "pro", "business"] as const;
export type BillingPlanCode = (typeof BILLING_PLAN_CODES)[number];

interface BillingPlanConfig {
  code: BillingPlanCode;
  label: string;
  amountInr: number;
  totalCountDefault: number;
  trialDaysDefault: number;
  razorpayPlanId?: string;
}

const BILLING_PLANS: Record<BillingPlanCode, BillingPlanConfig> = {
  starter: {
    code: "starter",
    label: "Starter",
    amountInr: 499,
    totalCountDefault: 12,
    trialDaysDefault: 7,
    razorpayPlanId: env.RAZORPAY_PLAN_STARTER_ID
  },
  pro: {
    code: "pro",
    label: "Pro",
    amountInr: 999,
    totalCountDefault: 12,
    trialDaysDefault: 7,
    razorpayPlanId: env.RAZORPAY_PLAN_PRO_ID
  },
  business: {
    code: "business",
    label: "Business",
    amountInr: 1799,
    totalCountDefault: 12,
    trialDaysDefault: 7,
    razorpayPlanId: env.RAZORPAY_PLAN_BUSINESS_ID
  }
};

const OPEN_SUBSCRIPTION_STATUSES = new Set(["pending", "created", "authenticated"]);
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "authenticated"]);
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(["cancelled", "completed", "expired"]);

let razorpayClient: Razorpay | null = null;

interface RawSubscriptionRow {
  id: string;
  user_id: string;
  razorpay_customer_id: string | null;
  razorpay_subscription_id: string | null;
  razorpay_plan_id: string | null;
  plan_code: string;
  status: string;
  current_start_at: string | null;
  current_end_at: string | null;
  next_charge_at: string | null;
  cancelled_at: string | null;
  ended_at: string | null;
  expiry_date: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  last_payment_id: string | null;
  last_payment_status: string | null;
  last_payment_amount_paise: string | null;
  last_payment_currency: string | null;
  last_payment_method: string | null;
  last_payment_paid_at: string | null;
  last_payment_failure_reason: string | null;
}

export interface BillingPaymentSummary {
  razorpayPaymentId: string;
  status: string;
  amountPaise: number;
  currency: string;
  method: string | null;
  paidAt: string | null;
  failureReason: string | null;
}

export interface BillingSubscriptionSummary {
  id: string;
  userId: string;
  razorpayCustomerId: string | null;
  razorpaySubscriptionId: string | null;
  razorpayPlanId: string | null;
  planCode: string;
  status: string;
  currentStartAt: string | null;
  currentEndAt: string | null;
  nextChargeAt: string | null;
  cancelledAt: string | null;
  endedAt: string | null;
  expiryDate: string | null;
  createdAt: string;
  updatedAt: string;
  lastPayment: BillingPaymentSummary | null;
}

export interface UserBillingSummary extends BillingSubscriptionSummary {
  plan: BillingPlanConfig;
}

export interface AdminSubscriptionSummary extends BillingSubscriptionSummary {
  userName: string;
  userEmail: string;
}

export interface CreateUserSubscriptionInput {
  userId: string;
  userName: string;
  userEmail: string;
  planCode: BillingPlanCode;
  totalCount?: number;
  trialDays?: number;
}

export interface CreateUserSubscriptionResult {
  keyId: string;
  alreadyExists: boolean;
  checkout: {
    subscriptionId: string;
    planCode: BillingPlanCode;
    planLabel: string;
    amountInr: number;
  };
  subscription: UserBillingSummary;
}

interface RazorpaySubscriptionEntity {
  id: string;
  status?: string;
  customer_id?: string;
  plan_id?: string;
  total_count?: number;
  paid_count?: number;
  short_url?: string;
  current_start?: number;
  current_end?: number;
  charge_at?: number;
  ended_at?: number;
  cancel_at_cycle_end?: boolean;
  notes?: Record<string, unknown>;
}

interface RazorpayPaymentEntity {
  id: string;
  status?: string;
  amount?: number;
  currency?: string;
  method?: string;
  description?: string;
  created_at?: number;
  error_description?: string;
  subscription_id?: string;
  notes?: Record<string, unknown>;
}

interface RazorpayWebhookPayload {
  event: string;
  created_at?: number;
  contains?: string[];
  payload?: {
    subscription?: { entity?: RazorpaySubscriptionEntity };
    payment?: { entity?: RazorpayPaymentEntity };
  };
}

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

function getPlanConfig(planCode: BillingPlanCode): BillingPlanConfig {
  return BILLING_PLANS[planCode];
}

function getPlanId(planCode: BillingPlanCode): string {
  const planId = BILLING_PLANS[planCode].razorpayPlanId;
  if (!planId) {
    throw new Error(`Razorpay plan ID not configured for ${planCode}`);
  }
  return planId;
}

function parseNumber(value: string | null): number {
  return Number(value ?? 0);
}

function normalizePlanCode(value: unknown): BillingPlanCode | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "starter" || normalized === "pro" || normalized === "business") {
    return normalized;
  }
  return null;
}

function resolvePlanCodeFromPlanId(planId: unknown): BillingPlanCode | null {
  if (typeof planId !== "string" || !planId.trim()) {
    return null;
  }
  const trimmed = planId.trim();
  if (trimmed === env.RAZORPAY_PLAN_STARTER_ID) {
    return "starter";
  }
  if (trimmed === env.RAZORPAY_PLAN_PRO_ID) {
    return "pro";
  }
  if (trimmed === env.RAZORPAY_PLAN_BUSINESS_ID) {
    return "business";
  }
  return null;
}

function toIsoTimestampFromUnix(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

function inferStatusFromEvent(event: string): string | null {
  if (event === "subscription.activated" || event === "subscription.resumed") {
    return "active";
  }
  if (event === "subscription.completed") {
    return "completed";
  }
  if (event === "subscription.cancelled") {
    return "cancelled";
  }
  if (event === "subscription.halted") {
    return "halted";
  }
  if (event === "subscription.paused") {
    return "paused";
  }
  if (event === "payment.failed") {
    return "payment_failed";
  }
  return null;
}

function toSummary(row: RawSubscriptionRow): BillingSubscriptionSummary {
  return {
    id: row.id,
    userId: row.user_id,
    razorpayCustomerId: row.razorpay_customer_id,
    razorpaySubscriptionId: row.razorpay_subscription_id,
    razorpayPlanId: row.razorpay_plan_id,
    planCode: row.plan_code,
    status: row.status,
    currentStartAt: row.current_start_at,
    currentEndAt: row.current_end_at,
    nextChargeAt: row.next_charge_at,
    cancelledAt: row.cancelled_at,
    endedAt: row.ended_at,
    expiryDate: row.expiry_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastPayment: row.last_payment_id
      ? {
          razorpayPaymentId: row.last_payment_id,
          status: row.last_payment_status ?? "unknown",
          amountPaise: parseNumber(row.last_payment_amount_paise),
          currency: row.last_payment_currency ?? "INR",
          method: row.last_payment_method,
          paidAt: row.last_payment_paid_at,
          failureReason: row.last_payment_failure_reason
        }
      : null
  };
}

function toUserBillingSummary(row: RawSubscriptionRow): UserBillingSummary {
  const summary = toSummary(row);
  const normalized = normalizePlanCode(summary.planCode);
  return {
    ...summary,
    plan: normalized ? getPlanConfig(normalized) : BILLING_PLANS.starter
  };
}

async function syncUserPlan(userId: string, planCode: string, status: string): Promise<void> {
  if (ACTIVE_SUBSCRIPTION_STATUSES.has(status)) {
    await pool.query(
      `UPDATE users
       SET subscription_plan = $1
       WHERE id = $2`,
      [planCode, userId]
    );
    return;
  }

  if (TERMINAL_SUBSCRIPTION_STATUSES.has(status)) {
    await pool.query(
      `UPDATE users
       SET subscription_plan = 'trial'
       WHERE id = $1`,
      [userId]
    );
  }
}

async function fetchSubscriptionRowByUserId(userId: string): Promise<RawSubscriptionRow | null> {
  const result = await pool.query<RawSubscriptionRow>(
    `SELECT
       s.id,
       s.user_id,
       s.razorpay_customer_id,
       s.razorpay_subscription_id,
       s.razorpay_plan_id,
       s.plan_code,
       s.status,
       s.current_start_at,
       s.current_end_at,
       s.next_charge_at,
       s.cancelled_at,
       s.ended_at,
       s.expiry_date,
       s.metadata_json,
       s.created_at,
       s.updated_at,
       p.razorpay_payment_id AS last_payment_id,
       p.status AS last_payment_status,
       p.amount_paise::text AS last_payment_amount_paise,
       p.currency AS last_payment_currency,
       p.method AS last_payment_method,
       p.paid_at AS last_payment_paid_at,
       p.failure_reason AS last_payment_failure_reason
     FROM user_subscriptions s
     LEFT JOIN LATERAL (
       SELECT
         razorpay_payment_id,
         status,
         amount_paise,
         currency,
         method,
         paid_at,
         failure_reason
       FROM subscription_payments
       WHERE user_id = s.user_id
       ORDER BY created_at DESC
       LIMIT 1
     ) p ON TRUE
     WHERE s.user_id = $1
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] ?? null;
}

async function fetchSubscriptionRowByRazorpayId(
  razorpaySubscriptionId: string
): Promise<RawSubscriptionRow | null> {
  const result = await pool.query<RawSubscriptionRow>(
    `SELECT
       s.id,
       s.user_id,
       s.razorpay_customer_id,
       s.razorpay_subscription_id,
       s.razorpay_plan_id,
       s.plan_code,
       s.status,
       s.current_start_at,
       s.current_end_at,
       s.next_charge_at,
       s.cancelled_at,
       s.ended_at,
       s.expiry_date,
       s.metadata_json,
       s.created_at,
       s.updated_at,
       NULL::text AS last_payment_id,
       NULL::text AS last_payment_status,
       NULL::text AS last_payment_amount_paise,
       NULL::text AS last_payment_currency,
       NULL::text AS last_payment_method,
       NULL::timestamptz AS last_payment_paid_at,
       NULL::text AS last_payment_failure_reason
     FROM user_subscriptions s
     WHERE s.razorpay_subscription_id = $1
     LIMIT 1`,
    [razorpaySubscriptionId]
  );

  return result.rows[0] ?? null;
}

export function listBillingPlans(): BillingPlanConfig[] {
  return BILLING_PLAN_CODES.map((code) => BILLING_PLANS[code]);
}

export function getRazorpayCheckoutKey(): string {
  if (!env.RAZORPAY_KEY_ID) {
    throw new Error("Razorpay key ID is not configured on server");
  }
  return env.RAZORPAY_KEY_ID;
}

export async function getUserBillingSummary(userId: string): Promise<UserBillingSummary | null> {
  const row = await fetchSubscriptionRowByUserId(userId);
  return row ? toUserBillingSummary(row) : null;
}

export async function createUserSubscription(
  input: CreateUserSubscriptionInput
): Promise<CreateUserSubscriptionResult> {
  const client = getRazorpayClient();
  const keyId = getRazorpayCheckoutKey();
  const planConfig = getPlanConfig(input.planCode);
  const planId = getPlanId(input.planCode);
  const existing = await fetchSubscriptionRowByUserId(input.userId);

  if (existing && existing.razorpay_subscription_id && OPEN_SUBSCRIPTION_STATUSES.has(existing.status)) {
    const existingPlanCode = normalizePlanCode(existing.plan_code) ?? input.planCode;
    const existingPlanConfig = getPlanConfig(existingPlanCode);
    return {
      keyId,
      alreadyExists: true,
      checkout: {
        subscriptionId: existing.razorpay_subscription_id,
        planCode: existingPlanCode,
        planLabel: existingPlanConfig.label,
        amountInr: existingPlanConfig.amountInr
      },
      subscription: toUserBillingSummary(existing)
    };
  }

  if (existing && ACTIVE_SUBSCRIPTION_STATUSES.has(existing.status)) {
    throw new Error("An active subscription already exists for this account");
  }

  const totalCount = input.totalCount ?? planConfig.totalCountDefault;
  const trialDays = input.trialDays ?? planConfig.trialDaysDefault;
  const startAt =
    trialDays > 0 ? Math.floor(Date.now() / 1000) + Math.floor(trialDays * 24 * 60 * 60) : undefined;

  const created = (await client.subscriptions.create({
    plan_id: planId,
    total_count: totalCount,
    customer_notify: 1,
    ...(startAt ? { start_at: startAt } : {}),
    notes: {
      userId: input.userId,
      planCode: input.planCode
    }
  })) as RazorpaySubscriptionEntity;

  const metadata = {
    source: "create_subscription",
    shortUrl: created.short_url ?? null,
    totalCount: created.total_count ?? totalCount,
    paidCount: created.paid_count ?? 0,
    trialDays
  };

  const upsertResult = await pool.query<RawSubscriptionRow>(
    `INSERT INTO user_subscriptions (
       user_id,
       razorpay_subscription_id,
       razorpay_plan_id,
       plan_code,
       status,
       current_start_at,
       current_end_at,
       next_charge_at,
       ended_at,
       expiry_date,
       metadata_json
     )
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9::timestamptz, $10::timestamptz, $11::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET
       razorpay_subscription_id = EXCLUDED.razorpay_subscription_id,
       razorpay_plan_id = EXCLUDED.razorpay_plan_id,
       plan_code = EXCLUDED.plan_code,
       status = EXCLUDED.status,
       current_start_at = EXCLUDED.current_start_at,
       current_end_at = EXCLUDED.current_end_at,
       next_charge_at = EXCLUDED.next_charge_at,
       ended_at = EXCLUDED.ended_at,
       expiry_date = EXCLUDED.expiry_date,
       metadata_json = EXCLUDED.metadata_json,
       cancelled_at = NULL,
       updated_at = NOW()
     RETURNING
       id,
       user_id,
       razorpay_customer_id,
       razorpay_subscription_id,
       razorpay_plan_id,
       plan_code,
       status,
       current_start_at,
       current_end_at,
       next_charge_at,
       cancelled_at,
       ended_at,
       expiry_date,
       metadata_json,
       created_at,
       updated_at,
       NULL::text AS last_payment_id,
       NULL::text AS last_payment_status,
       NULL::text AS last_payment_amount_paise,
       NULL::text AS last_payment_currency,
       NULL::text AS last_payment_method,
       NULL::timestamptz AS last_payment_paid_at,
       NULL::text AS last_payment_failure_reason`,
    [
      input.userId,
      created.id,
      created.plan_id ?? planId,
      input.planCode,
      created.status ?? "created",
      toIsoTimestampFromUnix(created.current_start),
      toIsoTimestampFromUnix(created.current_end),
      toIsoTimestampFromUnix(created.charge_at),
      toIsoTimestampFromUnix(created.ended_at),
      toIsoTimestampFromUnix(created.current_end),
      JSON.stringify(metadata)
    ]
  );

  await syncUserPlan(input.userId, input.planCode, created.status ?? "created");

  const summary = toUserBillingSummary(upsertResult.rows[0]);

  return {
    keyId,
    alreadyExists: false,
    checkout: {
      subscriptionId: created.id,
      planCode: input.planCode,
      planLabel: planConfig.label,
      amountInr: planConfig.amountInr
    },
    subscription: summary
  };
}

export async function cancelUserSubscription(
  userId: string,
  options?: { atCycleEnd?: boolean }
): Promise<UserBillingSummary> {
  const existing = await fetchSubscriptionRowByUserId(userId);
  if (!existing || !existing.razorpay_subscription_id) {
    throw new Error("No subscription found for this account");
  }

  if (TERMINAL_SUBSCRIPTION_STATUSES.has(existing.status)) {
    return toUserBillingSummary(existing);
  }

  const client = getRazorpayClient();
  const cancelAtCycleEnd = Boolean(options?.atCycleEnd);
  const cancelled = (await client.subscriptions.cancel(
    existing.razorpay_subscription_id,
    cancelAtCycleEnd
  )) as RazorpaySubscriptionEntity;

  const nextStatus = cancelled.status ?? (cancelAtCycleEnd ? "cancel_pending" : "cancelled");
  const nowIso = new Date().toISOString();
  await pool.query(
    `UPDATE user_subscriptions
     SET status = $1,
         cancelled_at = CASE WHEN $2 THEN cancelled_at ELSE $3::timestamptz END,
         ended_at = COALESCE($4::timestamptz, ended_at),
         current_start_at = COALESCE($5::timestamptz, current_start_at),
         current_end_at = COALESCE($6::timestamptz, current_end_at),
         next_charge_at = COALESCE($7::timestamptz, next_charge_at),
         expiry_date = COALESCE($6::timestamptz, expiry_date),
         razorpay_customer_id = COALESCE($8, razorpay_customer_id),
         razorpay_plan_id = COALESCE($9, razorpay_plan_id),
         metadata_json = jsonb_set(
           COALESCE(metadata_json, '{}'::jsonb),
           '{cancelAtCycleEnd}',
           to_jsonb($2::boolean),
           true
         ),
         updated_at = NOW()
     WHERE user_id = $10`,
    [
      nextStatus,
      cancelAtCycleEnd,
      nowIso,
      toIsoTimestampFromUnix(cancelled.ended_at),
      toIsoTimestampFromUnix(cancelled.current_start),
      toIsoTimestampFromUnix(cancelled.current_end),
      toIsoTimestampFromUnix(cancelled.charge_at),
      cancelled.customer_id ?? null,
      cancelled.plan_id ?? null,
      userId
    ]
  );

  await syncUserPlan(userId, existing.plan_code, nextStatus);
  const fresh = await fetchSubscriptionRowByUserId(userId);
  if (!fresh) {
    throw new Error("Failed to refresh subscription state");
  }
  return toUserBillingSummary(fresh);
}

export async function listAdminSubscriptionSummaries(options?: {
  limit?: number;
  status?: string;
}): Promise<AdminSubscriptionSummary[]> {
  const limit = Math.min(500, Math.max(1, options?.limit ?? 200));
  const statusFilter = options?.status?.trim().toLowerCase() || null;

  const result = await pool.query<
    RawSubscriptionRow & {
      user_name: string;
      user_email: string;
    }
  >(
    `SELECT
       s.id,
       s.user_id,
       u.name AS user_name,
       u.email AS user_email,
       s.razorpay_customer_id,
       s.razorpay_subscription_id,
       s.razorpay_plan_id,
       s.plan_code,
       s.status,
       s.current_start_at,
       s.current_end_at,
       s.next_charge_at,
       s.cancelled_at,
       s.ended_at,
       s.expiry_date,
       s.metadata_json,
       s.created_at,
       s.updated_at,
       p.razorpay_payment_id AS last_payment_id,
       p.status AS last_payment_status,
       p.amount_paise::text AS last_payment_amount_paise,
       p.currency AS last_payment_currency,
       p.method AS last_payment_method,
       p.paid_at AS last_payment_paid_at,
       p.failure_reason AS last_payment_failure_reason
     FROM user_subscriptions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN LATERAL (
       SELECT
         razorpay_payment_id,
         status,
         amount_paise,
         currency,
         method,
         paid_at,
         failure_reason
       FROM subscription_payments
       WHERE user_id = s.user_id
       ORDER BY created_at DESC
       LIMIT 1
     ) p ON TRUE
     WHERE ($1::text IS NULL OR s.status = $1::text)
     ORDER BY COALESCE(s.current_end_at, s.updated_at) DESC
     LIMIT $2`,
    [statusFilter, limit]
  );

  return result.rows.map((row) => ({
    ...toSummary(row),
    userName: row.user_name,
    userEmail: row.user_email
  }));
}

function resolveWebhookUserId(
  existing: RawSubscriptionRow | null,
  entityNotes?: Record<string, unknown>
): string | null {
  if (existing?.user_id) {
    return existing.user_id;
  }

  const noteUserId = entityNotes?.userId;
  return typeof noteUserId === "string" && noteUserId.trim() ? noteUserId.trim() : null;
}

async function upsertSubscriptionFromWebhook(
  event: string,
  webhookPayload: RazorpayWebhookPayload,
  subscription: RazorpaySubscriptionEntity
): Promise<void> {
  if (!subscription.id) {
    return;
  }

  const existing = await fetchSubscriptionRowByRazorpayId(subscription.id);
  const userId = resolveWebhookUserId(existing, subscription.notes);
  if (!userId) {
    return;
  }

  const existingPlanCode = normalizePlanCode(existing?.plan_code);
  const notePlanCode = normalizePlanCode(subscription.notes?.planCode);
  const resolvedPlanCode =
    notePlanCode ??
    resolvePlanCodeFromPlanId(subscription.plan_id) ??
    existingPlanCode ??
    BILLING_PLANS.starter.code;
  const status = subscription.status ?? inferStatusFromEvent(event) ?? "pending";
  const currentStartAt = toIsoTimestampFromUnix(subscription.current_start);
  const currentEndAt = toIsoTimestampFromUnix(subscription.current_end);
  const endedAt = toIsoTimestampFromUnix(subscription.ended_at);
  const nextChargeAt = toIsoTimestampFromUnix(subscription.charge_at);
  const metadataJson = {
    source: "webhook",
    lastWebhookEvent: event,
    webhookSeenAt: new Date().toISOString(),
    webhookCreatedAt: toIsoTimestampFromUnix(webhookPayload.created_at),
    contains: webhookPayload.contains ?? []
  };

  await pool.query(
    `INSERT INTO user_subscriptions (
       user_id,
       razorpay_customer_id,
       razorpay_subscription_id,
       razorpay_plan_id,
       plan_code,
       status,
       current_start_at,
       current_end_at,
       next_charge_at,
       ended_at,
       expiry_date,
       metadata_json
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9::timestamptz, $10::timestamptz, $8::timestamptz, $11::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET
       razorpay_customer_id = COALESCE(EXCLUDED.razorpay_customer_id, user_subscriptions.razorpay_customer_id),
       razorpay_subscription_id = EXCLUDED.razorpay_subscription_id,
       razorpay_plan_id = COALESCE(EXCLUDED.razorpay_plan_id, user_subscriptions.razorpay_plan_id),
       plan_code = EXCLUDED.plan_code,
       status = EXCLUDED.status,
       current_start_at = COALESCE(EXCLUDED.current_start_at, user_subscriptions.current_start_at),
       current_end_at = COALESCE(EXCLUDED.current_end_at, user_subscriptions.current_end_at),
       next_charge_at = COALESCE(EXCLUDED.next_charge_at, user_subscriptions.next_charge_at),
       ended_at = COALESCE(EXCLUDED.ended_at, user_subscriptions.ended_at),
       expiry_date = COALESCE(EXCLUDED.current_end_at, user_subscriptions.expiry_date),
       cancelled_at = CASE
         WHEN EXCLUDED.status = 'cancelled' THEN COALESCE(user_subscriptions.cancelled_at, NOW())
         ELSE user_subscriptions.cancelled_at
       END,
       metadata_json = COALESCE(user_subscriptions.metadata_json, '{}'::jsonb) || EXCLUDED.metadata_json,
       updated_at = NOW()`,
    [
      userId,
      subscription.customer_id ?? null,
      subscription.id,
      subscription.plan_id ?? null,
      resolvedPlanCode,
      status,
      currentStartAt,
      currentEndAt,
      nextChargeAt,
      endedAt,
      JSON.stringify(metadataJson)
    ]
  );

  await syncUserPlan(userId, resolvedPlanCode, status);
}

async function upsertPaymentFromWebhook(
  event: string,
  payment: RazorpayPaymentEntity,
  fallbackSubscription?: RazorpaySubscriptionEntity
): Promise<void> {
  if (!payment.id) {
    return;
  }

  const subscriptionId = payment.subscription_id ?? fallbackSubscription?.id ?? null;
  let subscriptionRowId: string | null = null;
  let userId: string | null = null;

  if (subscriptionId) {
    const subResult = await pool.query<{ id: string; user_id: string }>(
      `SELECT id, user_id
       FROM user_subscriptions
       WHERE razorpay_subscription_id = $1
       LIMIT 1`,
      [subscriptionId]
    );
    if (subResult.rows[0]) {
      subscriptionRowId = subResult.rows[0].id;
      userId = subResult.rows[0].user_id;
    }
  }

  if (!userId) {
    const noteUserId = payment.notes?.userId;
    if (typeof noteUserId === "string" && noteUserId.trim()) {
      userId = noteUserId.trim();
    }
  }

  if (!userId) {
    return;
  }

  const status = payment.status ?? (event === "payment.failed" ? "failed" : "captured");
  await pool.query(
    `INSERT INTO subscription_payments (
       user_id,
       subscription_row_id,
       razorpay_payment_id,
       razorpay_subscription_id,
       status,
       amount_paise,
       currency,
       method,
       description,
       paid_at,
       failure_reason,
       raw_payload
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11, $12::jsonb)
     ON CONFLICT (razorpay_payment_id) DO UPDATE SET
       subscription_row_id = EXCLUDED.subscription_row_id,
       razorpay_subscription_id = EXCLUDED.razorpay_subscription_id,
       status = EXCLUDED.status,
       amount_paise = EXCLUDED.amount_paise,
       currency = EXCLUDED.currency,
       method = EXCLUDED.method,
       description = EXCLUDED.description,
       paid_at = EXCLUDED.paid_at,
       failure_reason = EXCLUDED.failure_reason,
       raw_payload = EXCLUDED.raw_payload`,
    [
      userId,
      subscriptionRowId,
      payment.id,
      subscriptionId,
      status,
      Number(payment.amount ?? 0),
      payment.currency ?? "INR",
      payment.method ?? null,
      payment.description ?? null,
      toIsoTimestampFromUnix(payment.created_at),
      payment.error_description ?? null,
      JSON.stringify(payment)
    ]
  );

  if (status === "failed" && subscriptionId) {
    await pool.query(
      `UPDATE user_subscriptions
       SET status = 'payment_failed',
           updated_at = NOW()
       WHERE razorpay_subscription_id = $1`,
      [subscriptionId]
    );
  }
}

export async function handleRazorpayWebhookEvent(payload: unknown): Promise<void> {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const webhook = payload as RazorpayWebhookPayload;
  if (!webhook.event) {
    return;
  }

  const subscriptionEntity = webhook.payload?.subscription?.entity;
  const paymentEntity = webhook.payload?.payment?.entity;

  if (subscriptionEntity) {
    await upsertSubscriptionFromWebhook(webhook.event, webhook, subscriptionEntity);
  }

  if (paymentEntity) {
    await upsertPaymentFromWebhook(webhook.event, paymentEntity, subscriptionEntity);
  }
}

export function verifyRazorpayWebhookSignature(rawBody: string, signature: string): boolean {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    return false;
  }
  if (!signature || !rawBody) {
    return false;
  }

  const expected = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(signature, "utf8");
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

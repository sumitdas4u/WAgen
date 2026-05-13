import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { pool, withTransaction } from "../db/pool.js";

export const COUPON_SCOPES = ["subscription"] as const;
export const COUPON_DISCOUNT_TYPES = ["percent", "fixed"] as const;
export const COUPON_STATUSES = ["active", "paused", "expired"] as const;
export const COUPON_PURCHASE_TYPES = ["subscription"] as const;
export const COUPON_REDEMPTION_STATUSES = ["pending", "paid", "failed", "cancelled", "expired"] as const;

export type CouponScope = (typeof COUPON_SCOPES)[number];
export type CouponDiscountType = (typeof COUPON_DISCOUNT_TYPES)[number];
export type CouponStatus = (typeof COUPON_STATUSES)[number];
export type CouponPurchaseType = (typeof COUPON_PURCHASE_TYPES)[number];
export type CouponRedemptionStatus = (typeof COUPON_REDEMPTION_STATUSES)[number];

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
};

const ACTIVE_REDEMPTION_STATUSES = ["pending", "paid"];

interface CouponRow {
  id: string;
  code: string;
  title: string;
  scope: CouponScope;
  discount_type: CouponDiscountType;
  discount_value: string | number;
  allowed_plans: string[] | null;
  max_redemptions: number | null;
  max_per_user: number | null;
  first_purchase_only: boolean;
  starts_at: string | null;
  expires_at: string | null;
  status: CouponStatus;
  razorpay_offer_id: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface CouponWithCountsRow extends CouponRow {
  redemption_count: string | number;
  paid_redemption_count: string | number;
}

interface CouponRedemptionRow {
  id: string;
  coupon_id: string;
  user_id: string;
  workspace_id: string | null;
  purchase_type: CouponPurchaseType;
  plan_code: string | null;
  credits: number | null;
  status: CouponRedemptionStatus;
  original_amount_paise: number;
  discount_amount_paise: number;
  final_amount_paise: number;
  gst_amount_paise: number;
  gst_rate_percent: string | number | null;
  currency: string;
  razorpay_subscription_id: string | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  metadata_json: Record<string, unknown> | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CouponRedemptionAdminRow extends CouponRedemptionRow {
  coupon_code: string;
  coupon_title: string;
  user_email: string | null;
  user_name: string | null;
  workspace_name: string | null;
}

export interface CouponSummary {
  id: string;
  code: string;
  title: string;
  scope: CouponScope;
  discountType: CouponDiscountType;
  discountValue: number;
  allowedPlans: string[];
  maxRedemptions: number | null;
  maxPerUser: number | null;
  firstPurchaseOnly: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  status: CouponStatus;
  razorpayOfferId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  redemptionCount?: number;
  paidRedemptionCount?: number;
}

export interface CouponRedemptionSummary {
  id: string;
  couponId: string;
  couponCode?: string;
  couponTitle?: string;
  userId: string;
  userEmail?: string | null;
  userName?: string | null;
  workspaceId: string | null;
  workspaceName?: string | null;
  purchaseType: CouponPurchaseType;
  planCode: string | null;
  credits: number | null;
  status: CouponRedemptionStatus;
  originalAmountPaise: number;
  discountAmountPaise: number;
  finalAmountPaise: number;
  gstAmountPaise: number;
  gstRatePercent: number | null;
  currency: string;
  razorpaySubscriptionId: string | null;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  metadata: Record<string, unknown>;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CouponPreview {
  code: string;
  title: string;
  scope: CouponScope;
  discountType: CouponDiscountType;
  discountValue: number;
  purchaseType: CouponPurchaseType;
  originalAmountPaise: number;
  discountAmountPaise: number;
  finalAmountPaise: number;
  currency: string;
  razorpayOfferId?: string | null;
  gatewayNote: string;
}

export interface CouponCreateInput {
  code: string;
  title: string;
  scope: CouponScope;
  discountType: CouponDiscountType;
  discountValue: number;
  allowedPlans?: string[];
  maxRedemptions?: number | null;
  maxPerUser?: number | null;
  firstPurchaseOnly?: boolean;
  startsAt?: string | null;
  expiresAt?: string | null;
  status?: CouponStatus;
  razorpayOfferId?: string | null;
  metadata?: Record<string, unknown>;
}

export type CouponUpdateInput = Partial<CouponCreateInput>;

export class CouponValidationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "CouponValidationError";
    this.statusCode = statusCode;
  }
}

export function isCouponValidationError(error: unknown): error is CouponValidationError {
  return error instanceof CouponValidationError;
}

export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

function toNumber(value: string | number | null | undefined, fallback = 0): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNonNegativeInteger(value: unknown, fallback = 0): number {
  const parsed = Math.floor(Number(value ?? fallback));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeAllowedPlans(plans: string[] | null | undefined): string[] {
  if (!Array.isArray(plans)) {
    return [];
  }
  return [...new Set(plans.map((plan) => plan.trim().toLowerCase()).filter(Boolean))];
}

function toCoupon(row: CouponRow | CouponWithCountsRow): CouponSummary {
  const withCounts = row as CouponWithCountsRow;
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    scope: row.scope,
    discountType: row.discount_type,
    discountValue: toNumber(row.discount_value),
    allowedPlans: normalizeAllowedPlans(row.allowed_plans),
    maxRedemptions: row.max_redemptions,
    maxPerUser: row.max_per_user,
    firstPurchaseOnly: Boolean(row.first_purchase_only),
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    status: row.status,
    razorpayOfferId: row.razorpay_offer_id,
    metadata: row.metadata_json ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    redemptionCount:
      "redemption_count" in row ? toNonNegativeInteger(withCounts.redemption_count, 0) : undefined,
    paidRedemptionCount:
      "paid_redemption_count" in row ? toNonNegativeInteger(withCounts.paid_redemption_count, 0) : undefined
  };
}

function toRedemption(row: CouponRedemptionRow | CouponRedemptionAdminRow): CouponRedemptionSummary {
  const admin = row as CouponRedemptionAdminRow;
  return {
    id: row.id,
    couponId: row.coupon_id,
    couponCode: "coupon_code" in row ? admin.coupon_code : undefined,
    couponTitle: "coupon_title" in row ? admin.coupon_title : undefined,
    userId: row.user_id,
    userEmail: "user_email" in row ? admin.user_email : undefined,
    userName: "user_name" in row ? admin.user_name : undefined,
    workspaceId: row.workspace_id,
    workspaceName: "workspace_name" in row ? admin.workspace_name : undefined,
    purchaseType: row.purchase_type,
    planCode: row.plan_code,
    credits: row.credits,
    status: row.status,
    originalAmountPaise: toNonNegativeInteger(row.original_amount_paise, 0),
    discountAmountPaise: toNonNegativeInteger(row.discount_amount_paise, 0),
    finalAmountPaise: toNonNegativeInteger(row.final_amount_paise, 0),
    gstAmountPaise: toNonNegativeInteger(row.gst_amount_paise, 0),
    gstRatePercent: row.gst_rate_percent === null ? null : toNumber(row.gst_rate_percent),
    currency: row.currency,
    razorpaySubscriptionId: row.razorpay_subscription_id,
    razorpayOrderId: row.razorpay_order_id,
    razorpayPaymentId: row.razorpay_payment_id,
    metadata: row.metadata_json ?? {},
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function calculateDiscountAmount(
  amountPaise: number,
  discountType: CouponDiscountType,
  discountValue: number
): number {
  if (amountPaise <= 0) {
    return 0;
  }
  const rawDiscount =
    discountType === "percent"
      ? Math.round(amountPaise * (Math.min(discountValue, 100) / 100))
      : Math.round(discountValue * 100);
  return Math.max(0, Math.min(amountPaise, rawDiscount));
}

async function loadCouponByCode(
  db: Queryable,
  code: string,
  options?: { lock?: boolean }
): Promise<CouponRow | null> {
  const normalized = normalizeCouponCode(code);
  if (!normalized) {
    return null;
  }

  const result = await db.query<CouponRow>(
    `SELECT
       id,
       code,
       title,
       scope,
       discount_type,
       discount_value::text AS discount_value,
       allowed_plans,
       max_redemptions,
       max_per_user,
       first_purchase_only,
       starts_at,
       expires_at,
       status,
       razorpay_offer_id,
       metadata_json,
       created_at,
       updated_at
     FROM coupons
     WHERE UPPER(code) = $1
     LIMIT 1
     ${options?.lock ? "FOR UPDATE" : ""}`,
    [normalized]
  );
  return result.rows[0] ?? null;
}

async function loadRedemptionCounts(
  db: Queryable,
  couponId: string,
  userId: string
): Promise<{ total: number; user: number }> {
  const result = await db.query<{ total_count: string; user_count: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = ANY($2::text[]))::text AS total_count,
       COUNT(*) FILTER (WHERE user_id = $3 AND status = ANY($2::text[]))::text AS user_count
     FROM coupon_redemptions
     WHERE coupon_id = $1`,
    [couponId, ACTIVE_REDEMPTION_STATUSES, userId]
  );
  const row = result.rows[0];
  return {
    total: toNonNegativeInteger(row?.total_count, 0),
    user: toNonNegativeInteger(row?.user_count, 0)
  };
}

async function hasPriorPaidPurchase(
  db: Queryable,
  userId: string
): Promise<boolean> {
  const result = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM subscription_payments
       WHERE user_id = $1
         AND status = 'captured'
       LIMIT 1
     ) AS exists`,
    [userId]
  );
  return Boolean(result.rows[0]?.exists);
}

async function validateCouponForUser(input: {
  db: Queryable;
  userId: string;
  code: string;
  purchaseType: CouponPurchaseType;
  planCode?: string | null;
  lock?: boolean;
}): Promise<CouponRow> {
  const coupon = await loadCouponByCode(input.db, input.code, { lock: input.lock });
  if (!coupon) {
    throw new CouponValidationError("Coupon code was not found");
  }

  const now = Date.now();
  if (coupon.status !== "active") {
    throw new CouponValidationError("Coupon is not active");
  }
  if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) {
    throw new CouponValidationError("Coupon is not active yet");
  }
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() <= now) {
    throw new CouponValidationError("Coupon has expired");
  }
  if (coupon.scope !== "subscription") {
    throw new CouponValidationError("Coupon is not valid for subscriptions");
  }

  const allowedPlans = normalizeAllowedPlans(coupon.allowed_plans);
  const planCode = input.planCode?.trim().toLowerCase() ?? "";
  if (allowedPlans.length > 0 && !allowedPlans.includes(planCode)) {
    throw new CouponValidationError("Coupon is not valid for the selected plan");
  }

  if (!coupon.razorpay_offer_id?.trim()) {
    throw new CouponValidationError("Subscription coupons require a Razorpay offer_id");
  }

  const counts = await loadRedemptionCounts(input.db, coupon.id, input.userId);
  if (coupon.max_redemptions !== null && counts.total >= coupon.max_redemptions) {
    throw new CouponValidationError("Coupon redemption limit has been reached", 409);
  }
  if (coupon.max_per_user !== null && counts.user >= coupon.max_per_user) {
    throw new CouponValidationError("You have already used this coupon", 409);
  }
  if (coupon.first_purchase_only) {
    const hasPrior = await hasPriorPaidPurchase(input.db, input.userId);
    if (hasPrior) {
      throw new CouponValidationError("Coupon is valid only for first purchase");
    }
  }

  return coupon;
}

function buildSubscriptionPreview(coupon: CouponRow, originalAmountPaise: number): CouponPreview {
  const discountValue = toNumber(coupon.discount_value);
  const discountAmountPaise = calculateDiscountAmount(
    originalAmountPaise,
    coupon.discount_type,
    discountValue
  );
  return {
    code: coupon.code,
    title: coupon.title,
    scope: coupon.scope,
    discountType: coupon.discount_type,
    discountValue,
    purchaseType: "subscription",
    originalAmountPaise,
    discountAmountPaise,
    finalAmountPaise: Math.max(0, originalAmountPaise - discountAmountPaise),
    currency: "INR",
    razorpayOfferId: coupon.razorpay_offer_id,
    gatewayNote: "Final subscription discount is applied by Razorpay using the linked offer_id during checkout."
  };
}

export async function previewCouponForUser(input: {
  userId: string;
  code: string;
  purchaseType: CouponPurchaseType;
  planCode?: string | null;
  originalAmountPaise?: number;
}): Promise<CouponPreview> {
  const coupon = await validateCouponForUser({
    db: pool,
    userId: input.userId,
    code: input.code,
    purchaseType: input.purchaseType,
    planCode: input.planCode
  });

  const originalAmountPaise = toNonNegativeInteger(input.originalAmountPaise, 0);
  if (originalAmountPaise <= 0) {
    throw new CouponValidationError("Selected plan amount is invalid");
  }
  return buildSubscriptionPreview(coupon, originalAmountPaise);
}

export async function createPendingSubscriptionCouponRedemption(input: {
  userId: string;
  workspaceId: string | null;
  code: string;
  planCode: string;
  originalAmountPaise: number;
  metadata?: Record<string, unknown>;
}): Promise<{ coupon: CouponSummary; redemption: CouponRedemptionSummary; preview: CouponPreview }> {
  return withTransaction(async (client) => {
    const coupon = await validateCouponForUser({
      db: client,
      userId: input.userId,
      code: input.code,
      purchaseType: "subscription",
      planCode: input.planCode,
      lock: true
    });
    const preview = buildSubscriptionPreview(coupon, input.originalAmountPaise);
    const insert = await client.query<CouponRedemptionRow>(
      `INSERT INTO coupon_redemptions (
         coupon_id,
         user_id,
         workspace_id,
         purchase_type,
         plan_code,
         status,
         original_amount_paise,
         discount_amount_paise,
         final_amount_paise,
         currency,
         metadata_json
       )
       VALUES ($1, $2, $3, 'subscription', $4, 'pending', $5, $6, $7, 'INR', $8::jsonb)
       RETURNING
         id,
         coupon_id,
         user_id,
         workspace_id,
         purchase_type,
         plan_code,
         credits,
         status,
         original_amount_paise,
         discount_amount_paise,
         final_amount_paise,
         gst_amount_paise,
         gst_rate_percent,
         currency,
         razorpay_subscription_id,
         razorpay_order_id,
         razorpay_payment_id,
         metadata_json,
         paid_at,
         created_at,
         updated_at`,
      [
        coupon.id,
        input.userId,
        input.workspaceId,
        input.planCode,
        preview.originalAmountPaise,
        preview.discountAmountPaise,
        preview.finalAmountPaise,
        JSON.stringify(input.metadata ?? {})
      ]
    );

    return {
      coupon: toCoupon(coupon),
      redemption: toRedemption(insert.rows[0]),
      preview
    };
  });
}

export async function attachRazorpaySubscriptionToCouponRedemption(input: {
  redemptionId: string;
  razorpaySubscriptionId: string;
}): Promise<void> {
  await pool.query(
    `UPDATE coupon_redemptions
     SET razorpay_subscription_id = $2,
         updated_at = NOW()
     WHERE id = $1
       AND status = 'pending'`,
    [input.redemptionId, input.razorpaySubscriptionId]
  );
}

export async function markCouponRedemptionFailed(input: {
  redemptionId?: string | null;
  razorpaySubscriptionId?: string | null;
  razorpayOrderId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
  const result = await pool.query(
    `UPDATE coupon_redemptions
     SET status = CASE WHEN status = 'paid' THEN status ELSE 'failed' END,
         metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $4::jsonb,
         updated_at = NOW()
     WHERE ($1::uuid IS NOT NULL AND id = $1::uuid)
        OR ($2::text IS NOT NULL AND razorpay_subscription_id = $2)
        OR ($3::text IS NOT NULL AND razorpay_order_id = $3)`,
    [
      input.redemptionId ?? null,
      input.razorpaySubscriptionId ?? null,
      input.razorpayOrderId ?? null,
      JSON.stringify({
        failureReason: input.reason ?? null,
        ...(input.metadata ?? {})
      })
    ]
  );
  return (result.rowCount ?? 0) > 0;
}

async function markCouponRedemptionPaidInTransaction(input: {
  client: PoolClient;
  redemptionId?: string | null;
  razorpaySubscriptionId?: string | null;
  razorpayOrderId?: string | null;
  razorpayPaymentId: string;
  finalAmountPaise: number;
  paidAt?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{ applied: boolean; redemption: CouponRedemptionSummary | null }> {
  const lookup = await input.client.query<CouponRedemptionRow>(
    `SELECT
       id,
       coupon_id,
       user_id,
       workspace_id,
       purchase_type,
       plan_code,
       credits,
       status,
       original_amount_paise,
       discount_amount_paise,
       final_amount_paise,
       gst_amount_paise,
       gst_rate_percent,
       currency,
       razorpay_subscription_id,
       razorpay_order_id,
       razorpay_payment_id,
       metadata_json,
       paid_at,
       created_at,
       updated_at
     FROM coupon_redemptions
     WHERE ($1::uuid IS NOT NULL AND id = $1::uuid)
        OR ($2::text IS NOT NULL AND razorpay_subscription_id = $2)
        OR ($3::text IS NOT NULL AND razorpay_order_id = $3)
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE`,
    [input.redemptionId ?? null, input.razorpaySubscriptionId ?? null, input.razorpayOrderId ?? null]
  );
  const redemption = lookup.rows[0];
  if (!redemption) {
    return { applied: false, redemption: null };
  }
  if (redemption.status === "paid") {
    return { applied: false, redemption: toRedemption(redemption) };
  }

  const update = await input.client.query<CouponRedemptionRow>(
    `UPDATE coupon_redemptions
     SET status = 'paid',
         razorpay_payment_id = COALESCE(razorpay_payment_id, $2),
         final_amount_paise = CASE WHEN $3 > 0 THEN $3 ELSE final_amount_paise END,
         paid_at = COALESCE(paid_at, $4::timestamptz),
         metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $5::jsonb,
         updated_at = NOW()
     WHERE id = $1
     RETURNING
       id,
       coupon_id,
       user_id,
       workspace_id,
       purchase_type,
       plan_code,
       credits,
       status,
       original_amount_paise,
       discount_amount_paise,
       final_amount_paise,
       gst_amount_paise,
       gst_rate_percent,
       currency,
       razorpay_subscription_id,
       razorpay_order_id,
       razorpay_payment_id,
       metadata_json,
       paid_at,
       created_at,
       updated_at`,
    [
      redemption.id,
      input.razorpayPaymentId,
      toNonNegativeInteger(input.finalAmountPaise, 0),
      input.paidAt ?? new Date().toISOString(),
      JSON.stringify(input.metadata ?? {})
    ]
  );

  return { applied: true, redemption: toRedemption(update.rows[0]) };
}

export async function markSubscriptionCouponRedemptionPaid(input: {
  razorpaySubscriptionId: string;
  razorpayPaymentId: string;
  finalAmountPaise: number;
  paidAt?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
  const result = await withTransaction(async (client) => {
    const marked = await markCouponRedemptionPaidInTransaction({
      client,
      razorpaySubscriptionId: input.razorpaySubscriptionId,
      razorpayPaymentId: input.razorpayPaymentId,
      finalAmountPaise: input.finalAmountPaise,
      paidAt: input.paidAt,
      metadata: input.metadata
    });
    if (marked.redemption) {
      await client.query(
        `UPDATE subscription_payments
         SET coupon_id = $2,
             coupon_redemption_id = $3,
             discount_amount_paise = $4
         WHERE razorpay_payment_id = $1`,
        [
          input.razorpayPaymentId,
          marked.redemption.couponId,
          marked.redemption.id,
          marked.redemption.discountAmountPaise
        ]
      );
      await client.query(
        `UPDATE user_subscriptions
         SET coupon_id = $2,
             coupon_redemption_id = $3,
             discount_amount_paise = $4,
             updated_at = NOW()
         WHERE razorpay_subscription_id = $1`,
        [
          input.razorpaySubscriptionId,
          marked.redemption.couponId,
          marked.redemption.id,
          marked.redemption.discountAmountPaise
        ]
      );
    }
    return marked.applied;
  });
  return result;
}

export async function listAdminCoupons(input?: {
  status?: CouponStatus | null;
  scope?: CouponScope | null;
  limit?: number;
}): Promise<CouponSummary[]> {
  const result = await pool.query<CouponWithCountsRow>(
    `SELECT
       c.id,
       c.code,
       c.title,
       c.scope,
       c.discount_type,
       c.discount_value::text AS discount_value,
       c.allowed_plans,
       c.max_redemptions,
       c.max_per_user,
       c.first_purchase_only,
       c.starts_at,
       c.expires_at,
       c.status,
       c.razorpay_offer_id,
       c.metadata_json,
       c.created_at,
       c.updated_at,
       COUNT(r.id)::text AS redemption_count,
       COUNT(r.id) FILTER (WHERE r.status = 'paid')::text AS paid_redemption_count
     FROM coupons c
     LEFT JOIN coupon_redemptions r ON r.coupon_id = c.id
     WHERE ($1::text IS NULL OR c.status = $1)
       AND ($2::text IS NULL OR c.scope = $2)
     GROUP BY c.id
     ORDER BY c.created_at DESC
     LIMIT $3`,
    [input?.status ?? null, input?.scope ?? null, input?.limit ?? 200]
  );
  return result.rows.map(toCoupon);
}

export async function createAdminCoupon(input: CouponCreateInput): Promise<CouponSummary> {
  const code = normalizeCouponCode(input.code);
  if (!code) {
    throw new CouponValidationError("Coupon code is required");
  }
  const result = await pool.query<CouponRow>(
    `INSERT INTO coupons (
       code,
       title,
       scope,
       discount_type,
       discount_value,
       allowed_plans,
       max_redemptions,
       max_per_user,
       first_purchase_only,
       starts_at,
       expires_at,
       status,
       razorpay_offer_id,
       metadata_json
     )
     VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10::timestamptz, $11::timestamptz, $12, $13, $14::jsonb)
     RETURNING
       id,
       code,
       title,
       scope,
       discount_type,
       discount_value::text AS discount_value,
       allowed_plans,
       max_redemptions,
       max_per_user,
       first_purchase_only,
       starts_at,
       expires_at,
       status,
       razorpay_offer_id,
       metadata_json,
       created_at,
       updated_at`,
    [
      code,
      input.title.trim(),
      input.scope,
      input.discountType,
      input.discountValue,
      normalizeAllowedPlans(input.allowedPlans),
      input.maxRedemptions ?? null,
      input.maxPerUser ?? null,
      Boolean(input.firstPurchaseOnly),
      input.startsAt ?? null,
      input.expiresAt ?? null,
      input.status ?? "active",
      input.razorpayOfferId?.trim() || null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
  return toCoupon(result.rows[0]);
}

export async function updateAdminCoupon(couponId: string, input: CouponUpdateInput): Promise<CouponSummary> {
  const assignments: string[] = [];
  const values: unknown[] = [couponId];
  const push = (sql: string, value: unknown) => {
    values.push(value);
    assignments.push(sql.replace("?", `$${values.length}`));
  };

  if (typeof input.code === "string") push("code = ?", normalizeCouponCode(input.code));
  if (typeof input.title === "string") push("title = ?", input.title.trim());
  if (input.scope) push("scope = ?", input.scope);
  if (input.discountType) push("discount_type = ?", input.discountType);
  if (typeof input.discountValue === "number") push("discount_value = ?", input.discountValue);
  if (Array.isArray(input.allowedPlans)) push("allowed_plans = ?::text[]", normalizeAllowedPlans(input.allowedPlans));
  if ("maxRedemptions" in input) push("max_redemptions = ?", input.maxRedemptions ?? null);
  if ("maxPerUser" in input) push("max_per_user = ?", input.maxPerUser ?? null);
  if (typeof input.firstPurchaseOnly === "boolean") push("first_purchase_only = ?", input.firstPurchaseOnly);
  if ("startsAt" in input) push("starts_at = ?::timestamptz", input.startsAt ?? null);
  if ("expiresAt" in input) push("expires_at = ?::timestamptz", input.expiresAt ?? null);
  if (input.status) push("status = ?", input.status);
  if ("razorpayOfferId" in input) push("razorpay_offer_id = ?", input.razorpayOfferId?.trim() || null);
  if (input.metadata) push("metadata_json = ?::jsonb", JSON.stringify(input.metadata));

  if (assignments.length === 0) {
    const existing = await pool.query<CouponRow>(
      `SELECT
         id,
         code,
         title,
         scope,
         discount_type,
         discount_value::text AS discount_value,
         allowed_plans,
         max_redemptions,
         max_per_user,
         first_purchase_only,
         starts_at,
         expires_at,
         status,
         razorpay_offer_id,
         metadata_json,
         created_at,
         updated_at
       FROM coupons
       WHERE id = $1`,
      [couponId]
    );
    if (!existing.rows[0]) {
      throw new CouponValidationError("Coupon not found", 404);
    }
    return toCoupon(existing.rows[0]);
  }

  const result = await pool.query<CouponRow>(
    `UPDATE coupons
     SET ${assignments.join(", ")},
         updated_at = NOW()
     WHERE id = $1
     RETURNING
       id,
       code,
       title,
       scope,
       discount_type,
       discount_value::text AS discount_value,
       allowed_plans,
       max_redemptions,
       max_per_user,
       first_purchase_only,
       starts_at,
       expires_at,
       status,
       razorpay_offer_id,
       metadata_json,
       created_at,
       updated_at`,
    values
  );
  if (!result.rows[0]) {
    throw new CouponValidationError("Coupon not found", 404);
  }
  return toCoupon(result.rows[0]);
}

export async function listCouponRedemptions(input: {
  couponId: string;
  status?: CouponRedemptionStatus | null;
  limit?: number;
}): Promise<CouponRedemptionSummary[]> {
  const result = await pool.query<CouponRedemptionAdminRow>(
    `SELECT
       r.id,
       r.coupon_id,
       r.user_id,
       r.workspace_id,
       r.purchase_type,
       r.plan_code,
       r.credits,
       r.status,
       r.original_amount_paise,
       r.discount_amount_paise,
       r.final_amount_paise,
       r.gst_amount_paise,
       r.gst_rate_percent,
       r.currency,
       r.razorpay_subscription_id,
       r.razorpay_order_id,
       r.razorpay_payment_id,
       r.metadata_json,
       r.paid_at,
       r.created_at,
       r.updated_at,
       c.code AS coupon_code,
       c.title AS coupon_title,
       u.email AS user_email,
       u.name AS user_name,
       w.name AS workspace_name
     FROM coupon_redemptions r
     JOIN coupons c ON c.id = r.coupon_id
     LEFT JOIN users u ON u.id = r.user_id
     LEFT JOIN workspaces w ON w.id = r.workspace_id
     WHERE r.coupon_id = $1
       AND ($2::text IS NULL OR r.status = $2)
     ORDER BY r.created_at DESC
     LIMIT $3`,
    [input.couponId, input.status ?? null, input.limit ?? 200]
  );
  return result.rows.map(toRedemption);
}

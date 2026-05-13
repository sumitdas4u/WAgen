import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPoolQuery, mockWithTransaction } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockWithTransaction: vi.fn()
}));

vi.mock("../db/pool.js", () => ({
  pool: { query: mockPoolQuery },
  withTransaction: mockWithTransaction
}));

import { CouponValidationError, previewCouponForUser } from "./coupon-service.js";

const activeCoupon = {
  id: "coupon-1",
  code: "SAVE20",
  title: "Save 20",
  scope: "subscription",
  discount_type: "percent",
  discount_value: "20",
  allowed_plans: ["pro"],
  max_redemptions: null,
  max_per_user: null,
  first_purchase_only: false,
  starts_at: null,
  expires_at: null,
  status: "active",
  razorpay_offer_id: "offer_123",
  metadata_json: {},
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

beforeEach(() => {
  vi.clearAllMocks();
  mockWithTransaction.mockReset();
});

describe("coupon-service preview", () => {
  it("returns a valid subscription coupon preview", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [activeCoupon] })
      .mockResolvedValueOnce({ rows: [{ total_count: "0", user_count: "0" }] });

    const preview = await previewCouponForUser({
      userId: "user-1",
      code: "save20",
      purchaseType: "subscription",
      planCode: "pro",
      originalAmountPaise: 100_000
    });

    expect(preview.code).toBe("SAVE20");
    expect(preview.discountAmountPaise).toBe(20_000);
    expect(preview.finalAmountPaise).toBe(80_000);
    expect(preview.razorpayOfferId).toBe("offer_123");
  });

  it("rejects expired coupons before counting redemptions", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ ...activeCoupon, expires_at: "2020-01-01T00:00:00.000Z" }]
    });

    await expect(previewCouponForUser({
      userId: "user-1",
      code: "SAVE20",
      purchaseType: "subscription",
      planCode: "pro",
      originalAmountPaise: 100_000
    })).rejects.toThrow(CouponValidationError);

    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });

  it("rejects subscription coupons for the wrong plan", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [activeCoupon] });

    await expect(previewCouponForUser({
      userId: "user-1",
      code: "SAVE20",
      purchaseType: "subscription",
      planCode: "starter",
      originalAmountPaise: 100_000
    })).rejects.toThrow("selected plan");
  });

  it("enforces max redemptions", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ ...activeCoupon, max_redemptions: 2, allowed_plans: [] }] })
      .mockResolvedValueOnce({ rows: [{ total_count: "2", user_count: "0" }] });

    await expect(previewCouponForUser({
      userId: "user-1",
      code: "SAVE20",
      purchaseType: "subscription",
      planCode: "pro",
      originalAmountPaise: 100_000
    })).rejects.toThrow("limit");
  });

  it("rejects subscription money coupons without Razorpay offer_id", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ ...activeCoupon, allowed_plans: [], razorpay_offer_id: null }]
    });

    await expect(previewCouponForUser({
      userId: "user-1",
      code: "SAVE20",
      purchaseType: "subscription",
      planCode: "pro",
      originalAmountPaise: 100_000
    })).rejects.toThrow("offer_id");
  });

});

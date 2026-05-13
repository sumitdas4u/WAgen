import { useEffect, useMemo, useState } from "react";
import {
  createAdminCoupon,
  fetchAdminCouponRedemptions,
  fetchAdminCoupons,
  updateAdminCoupon,
  type AdminCoupon,
  type AdminCouponRedemption,
  type CouponScope,
  type CouponStatus
} from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const PLAN_CODES = ["starter", "pro", "business"] as const;

type PlanCode = (typeof PLAN_CODES)[number];

interface CouponFormState {
  code: string;
  title: string;
  scope: CouponScope;
  discountType: "percent" | "fixed";
  discountValue: string;
  allowedPlans: PlanCode[];
  maxRedemptions: string;
  maxPerUser: string;
  firstPurchaseOnly: boolean;
  startsAt: string;
  expiresAt: string;
  status: CouponStatus;
  razorpayOfferId: string;
}

const DEFAULT_FORM: CouponFormState = {
  code: "",
  title: "",
  scope: "subscription",
  discountType: "percent",
  discountValue: "20",
  allowedPlans: [],
  maxRedemptions: "",
  maxPerUser: "1",
  firstPurchaseOnly: false,
  startsAt: "",
  expiresAt: "",
  status: "active",
  razorpayOfferId: ""
};

function toIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "-";
}

function fmtInr(paise: number): string {
  return (paise / 100).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  });
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "active" || status === "paid"
      ? "#16a34a"
      : status === "failed" || status === "expired"
        ? "#dc2626"
        : "#64748b";
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 12, fontSize: "0.75rem", fontWeight: 700, background: `${color}16`, color }}>
      {status}
    </span>
  );
}

export function CouponsPage() {
  const { token } = useSuperAdmin();
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  const [redemptions, setRedemptions] = useState<AdminCouponRedemption[]>([]);
  const [selectedCoupon, setSelectedCoupon] = useState<AdminCoupon | null>(null);
  const [statusFilter, setStatusFilter] = useState<CouponStatus | "">("");
  const [scopeFilter, setScopeFilter] = useState<CouponScope | "">("");
  const [form, setForm] = useState<CouponFormState>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const loadCoupons = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchAdminCoupons(token, {
        status: statusFilter || undefined,
        scope: scopeFilter || undefined,
        limit: 300
      });
      setCoupons(response.coupons);
      if (selectedCoupon) {
        const fresh = response.coupons.find((coupon) => coupon.id === selectedCoupon.id) ?? null;
        setSelectedCoupon(fresh);
      }
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCoupons();
  }, [token, statusFilter, scopeFilter]);

  const loadRedemptions = async (coupon: AdminCoupon) => {
    setSelectedCoupon(coupon);
    setLoading(true);
    setError(null);
    try {
      const response = await fetchAdminCouponRedemptions(token, coupon.id, { limit: 300 });
      setRedemptions(response.redemptions);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const selectedPlanLabel = useMemo(
    () => form.allowedPlans.length === 0 ? "All plans" : form.allowedPlans.join(", "),
    [form.allowedPlans]
  );

  const submit = async () => {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const response = await createAdminCoupon(token, {
        code: form.code,
        title: form.title,
        scope: form.scope,
        discountType: form.discountType,
        discountValue: Number(form.discountValue),
        allowedPlans: form.allowedPlans,
        maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
        maxPerUser: form.maxPerUser ? Number(form.maxPerUser) : null,
        firstPurchaseOnly: form.firstPurchaseOnly,
        startsAt: toIso(form.startsAt),
        expiresAt: toIso(form.expiresAt),
        status: form.status,
        razorpayOfferId: form.razorpayOfferId || null
      });
      setInfo(`Created coupon ${response.coupon.code}.`);
      setForm(DEFAULT_FORM);
      await loadCoupons();
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const setCouponStatus = async (coupon: AdminCoupon, status: CouponStatus) => {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      await updateAdminCoupon(token, coupon.id, { status });
      setInfo(`${coupon.code} is now ${status}.`);
      await loadCoupons();
      if (selectedCoupon?.id === coupon.id) {
        await loadRedemptions({ ...coupon, status });
      }
    } catch (updateError) {
      setError((updateError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem", gap: "1rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>Coupons</h1>
        <button className="ghost-btn" onClick={() => void loadCoupons()} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <section className="finance-panel" style={{ marginBottom: "1.25rem" }}>
        <h2>Create Coupon</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.85rem" }}>
          <label>
            Code
            <input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} />
          </label>
          <label>
            Title
            <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
          </label>
          <label>
            Scope
            <select value={form.scope} onChange={(event) => setForm((current) => ({ ...current, scope: event.target.value as CouponScope }))}>
              <option value="subscription">Subscription</option>
            </select>
          </label>
          <label>
            Discount Type
            <select value={form.discountType} onChange={(event) => setForm((current) => ({ ...current, discountType: event.target.value as "percent" | "fixed" }))}>
              <option value="percent">Percent</option>
              <option value="fixed">Fixed INR</option>
            </select>
          </label>
          <label>
            Discount Value
            <input type="number" min="0" value={form.discountValue} onChange={(event) => setForm((current) => ({ ...current, discountValue: event.target.value }))} />
          </label>
          <label>
            Max Redemptions
            <input type="number" min="1" value={form.maxRedemptions} onChange={(event) => setForm((current) => ({ ...current, maxRedemptions: event.target.value }))} placeholder="Unlimited" />
          </label>
          <label>
            Max Per User
            <input type="number" min="1" value={form.maxPerUser} onChange={(event) => setForm((current) => ({ ...current, maxPerUser: event.target.value }))} placeholder="Unlimited" />
          </label>
          <label>
            Status
            <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as CouponStatus }))}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="expired">Expired</option>
            </select>
          </label>
          <label>
            Starts At
            <input type="datetime-local" value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} />
          </label>
          <label>
            Expires At
            <input type="datetime-local" value={form.expiresAt} onChange={(event) => setForm((current) => ({ ...current, expiresAt: event.target.value }))} />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Razorpay offer_id
            <input value={form.razorpayOfferId} onChange={(event) => setForm((current) => ({ ...current, razorpayOfferId: event.target.value }))} placeholder="offer_..." />
            <small style={{ display: "block", color: "#64748b", marginTop: 4 }}>
              Create this offer in Razorpay Dashboard, then paste the offer_id here.
            </small>
          </label>
        </div>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.85rem", alignItems: "center" }}>
          {PLAN_CODES.map((plan) => (
            <label key={plan} style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={form.allowedPlans.includes(plan)}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    allowedPlans: event.target.checked
                      ? [...current.allowedPlans, plan]
                      : current.allowedPlans.filter((item) => item !== plan)
                  }));
                }}
              />
              {plan}
            </label>
          ))}
          <label style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
            <input type="checkbox" checked={form.firstPurchaseOnly} onChange={(event) => setForm((current) => ({ ...current, firstPurchaseOnly: event.target.checked }))} />
            First purchase only
          </label>
          <span style={{ color: "#64748b", fontSize: "0.8rem" }}>{selectedPlanLabel}</span>
        </div>
        <button className="ghost-btn" style={{ marginTop: "1rem" }} onClick={() => void submit()} disabled={loading}>
          Create Coupon
        </button>
      </section>

      <section className="finance-panel" style={{ marginBottom: "1.25rem" }}>
        <h2>Coupons</h2>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as CouponStatus | "")}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="expired">Expired</option>
          </select>
          <select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value as CouponScope | "")}>
            <option value="">All scopes</option>
            <option value="subscription">Subscription</option>
          </select>
        </div>
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>Code</th><th>Scope</th><th>Discount</th><th>Plans</th><th>Usage</th><th>Status</th><th>Razorpay Offer</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((coupon) => (
                <tr key={coupon.id}>
                  <td><strong>{coupon.code}</strong><br /><span style={{ color: "#64748b", fontSize: "0.78rem" }}>{coupon.title}</span></td>
                  <td>{coupon.scope}</td>
                  <td>{coupon.discountType === "percent" ? `${coupon.discountValue}%` : `INR ${coupon.discountValue}`}</td>
                  <td>{coupon.allowedPlans.length ? coupon.allowedPlans.join(", ") : "All"}</td>
                  <td>{coupon.paidRedemptionCount ?? 0} paid / {coupon.redemptionCount ?? 0} total</td>
                  <td><StatusBadge status={coupon.status} /></td>
                  <td style={{ fontSize: "0.78rem" }}>{coupon.razorpayOfferId ?? "-"}</td>
                  <td>
                    <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                      <button className="ghost-btn" onClick={() => void loadRedemptions(coupon)}>Redemptions</button>
                      {coupon.status !== "paused" && <button className="ghost-btn" onClick={() => void setCouponStatus(coupon, "paused")}>Pause</button>}
                      {coupon.status !== "expired" && <button className="ghost-btn" onClick={() => void setCouponStatus(coupon, "expired")}>Expire</button>}
                      {coupon.status !== "active" && <button className="ghost-btn" onClick={() => void setCouponStatus(coupon, "active")}>Activate</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {coupons.length === 0 && (
                <tr><td colSpan={8} style={{ color: "#64748b", textAlign: "center" }}>No coupons found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedCoupon ? (
        <section className="finance-panel">
          <h2>Redemptions: {selectedCoupon.code}</h2>
          <div className="finance-table-wrap">
            <table className="finance-table">
              <thead>
                <tr>
                  <th>User</th><th>Purchase</th><th>Status</th><th>Original</th><th>Discount</th><th>Final</th><th>Gateway</th><th>Created</th>
                </tr>
              </thead>
              <tbody>
                {redemptions.map((redemption) => (
                  <tr key={redemption.id}>
                    <td>{redemption.userEmail ?? redemption.userId}<br /><span style={{ color: "#64748b", fontSize: "0.78rem" }}>{redemption.workspaceName ?? "-"}</span></td>
                    <td>{redemption.purchaseType}{redemption.planCode ? ` / ${redemption.planCode}` : ""}{redemption.credits ? ` / ${redemption.credits} credits` : ""}</td>
                    <td><StatusBadge status={redemption.status} /></td>
                    <td>{fmtInr(redemption.originalAmountPaise)}</td>
                    <td>{fmtInr(redemption.discountAmountPaise)}</td>
                    <td>{fmtInr(redemption.finalAmountPaise)}</td>
                    <td style={{ fontSize: "0.75rem" }}>
                      {redemption.razorpaySubscriptionId ?? redemption.razorpayOrderId ?? "-"}
                    </td>
                    <td>{fmtDate(redemption.createdAt)}</td>
                  </tr>
                ))}
                {redemptions.length === 0 && (
                  <tr><td colSpan={8} style={{ color: "#64748b", textAlign: "center" }}>No redemptions yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {info && <p className="info-text" style={{ marginTop: "1rem" }}>{info}</p>}
      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}

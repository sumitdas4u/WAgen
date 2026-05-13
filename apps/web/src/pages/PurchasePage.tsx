import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import {
  cancelBillingSubscription,
  createBillingSubscription,
  fetchBillingPlans,
  fetchMyPlanEntitlements,
  fetchMySubscription,
  previewCoupon,
  type BillingPlan,
  type BillingSubscriptionSummary,
  type CouponPreview,
  type PlanEntitlements
} from "../lib/api";
import "./landing-orchids/orchids-landing.css";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: (payload: unknown) => void) => void;
    };
  }
}

const PLAN_ORDER: BillingPlan["code"][] = ["starter", "pro", "business"];
const PLAN_PITCHES: Record<BillingPlan["code"], string> = {
  starter: "For small businesses getting started \u2014 300 AI credits/month.",
  pro: "Recommended automation plan \u2014 600 AI credits/month.",
  business: "High-volume & developer plan \u2014 1,200 AI credits/month."
};
const PLAN_FEATURES: Record<BillingPlan["code"], string[]> = {
  starter: [
    "WhatsApp Business API",
    "300 AI Credits / month",
    "1 Active Flow",
    "Unlimited Broadcast",
    "2 Knowledge Sources",
    "Email support",
  ],
  pro: [
    "WhatsApp Business API",
    "600 AI Credits / month",
    "3 Active Flows (Advanced Flows)",
    "Unlimited Broadcast",
    "5 Knowledge Sources",
    "Sequences & Webhooks",
    "Google Sheets & Calendar",
    "Priority ticket support",
  ],
  business: [
    "WhatsApp Business API",
    "1,200 AI Credits / month",
    "25 Active Flows (Advanced Flows)",
    "Unlimited Broadcast",
    "15 Knowledge Sources",
    "Public API & API Keys",
    "Priority support",
  ],
};

const PLAN_DISPLAY_LABELS: Record<string, string> = {
  starter: "Starter",
  pro: "Growth",
  business: "Pro"
};

function getQueryPlan(search: string): BillingPlan["code"] | null {
  const value = new URLSearchParams(search).get("plan");
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "growth") {
    return "pro";
  }
  if (normalized === "starter" || normalized === "pro" || normalized === "business") {
    return normalized;
  }
  return null;
}

function getQueryCoupon(search: string): string | null {
  const value = new URLSearchParams(search).get("coupon");
  const code = value?.trim();
  return code || null;
}

function fmtInr(paise: number): string {
  return (paise / 100).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  });
}

async function loadRazorpayScript(): Promise<boolean> {
  if (window.Razorpay) {
    return true;
  }

  const existing = document.querySelector<HTMLScriptElement>('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
  if (existing) {
    return new Promise((resolve) => {
      existing.addEventListener("load", () => resolve(Boolean(window.Razorpay)), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
    });
  }

  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function PurchasePage() {
  const { token, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<BillingPlan["code"]>("pro");
  const [subscription, setSubscription] = useState<BillingSubscriptionSummary | null>(null);
  const [entitlements, setEntitlements] = useState<PlanEntitlements | null>(null);
  const [keyIdAvailable, setKeyIdAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [couponCodeInput, setCouponCodeInput] = useState("");
  const [appliedCouponCode, setAppliedCouponCode] = useState<string | null>(null);
  const [couponPreview, setCouponPreview] = useState<CouponPreview | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);

  const orderedPlans = useMemo(() => {
    const available = new Map(plans.map((plan) => [plan.code, plan]));
    return PLAN_ORDER.map((code) => available.get(code)).filter((plan): plan is BillingPlan => Boolean(plan));
  }, [plans]);

  const refreshBilling = async () => {
    if (!token) {
      return;
    }
    const [plansResponse, entitlementResponse] = await Promise.all([
      fetchBillingPlans(),
      fetchMyPlanEntitlements(token)
    ]);
    const availablePlans = plansResponse.plans.filter((plan) => plan.available);
    setKeyIdAvailable(plansResponse.keyIdAvailable);
    setPlans(availablePlans);
    setSubscription(entitlementResponse.subscription);
    setEntitlements(entitlementResponse.entitlements);

    if (availablePlans.length > 0 && !availablePlans.some((plan) => plan.code === selectedPlan)) {
      setSelectedPlan(availablePlans[0].code);
    }
  };

  useEffect(() => {
    if (!token) {
      navigate("/signup");
      return;
    }
    const planFromQuery = getQueryPlan(location.search);
    if (planFromQuery) {
      setSelectedPlan(planFromQuery);
    }
    const couponFromQuery = getQueryCoupon(location.search);
    if (couponFromQuery) {
      setCouponCodeInput(couponFromQuery);
    }

    setLoading(true);
    setError(null);
    void refreshBilling()
      .catch((loadError) => {
        setError((loadError as Error).message);
      })
      .finally(() => setLoading(false));
  }, [location.search, navigate, token]);

  const handleApplyCoupon = async (code = couponCodeInput, options?: { quiet?: boolean }) => {
    if (!token) {
      return;
    }
    const normalized = code.trim();
    if (!normalized) {
      setCouponMessage("Enter an offer code first.");
      setCouponPreview(null);
      setAppliedCouponCode(null);
      return;
    }

    setCouponLoading(true);
    if (!options?.quiet) {
      setCouponMessage(null);
    }
    try {
      const response = await previewCoupon(token, {
        code: normalized,
        purchaseType: "subscription",
        planCode: selectedPlan
      });
      setCouponPreview(response.preview);
      setAppliedCouponCode(response.preview.code);
      setCouponCodeInput(response.preview.code);
      setCouponMessage(`Offer ${response.preview.code} applied.`);
    } catch (couponError) {
      setCouponPreview(null);
      setAppliedCouponCode(null);
      setCouponMessage((couponError as Error).message);
    } finally {
      setCouponLoading(false);
    }
  };

  useEffect(() => {
    const couponFromQuery = getQueryCoupon(location.search);
    if (!token || !couponFromQuery || orderedPlans.length === 0) {
      return;
    }
    if (appliedCouponCode?.toUpperCase() === couponFromQuery.toUpperCase() && couponPreview) {
      return;
    }
    void handleApplyCoupon(couponFromQuery, { quiet: true });
  }, [token, location.search, orderedPlans.length, selectedPlan, appliedCouponCode, couponPreview]);

  const handleSubscribe = async () => {
    if (!token) {
      return;
    }
    if (!keyIdAvailable) {
      setError("Razorpay checkout is not configured yet. Set billing keys in backend env first.");
      return;
    }
    if (!plans.some((plan) => plan.code === selectedPlan)) {
      setError("Selected plan is not available right now.");
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const response = await createBillingSubscription(token, {
        planCode: selectedPlan,
        couponCode: appliedCouponCode ?? undefined
      });
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded || !window.Razorpay) {
        throw new Error("Unable to load Razorpay checkout");
      }

      const razorpay = new window.Razorpay({
        key: response.keyId,
        name: "WAgen AI",
        description: `${response.checkout.planLabel} monthly subscription`,
        subscription_id: response.checkout.subscriptionId,
        handler: () => {
          setInfo("Payment authorized. Activation is being confirmed.");
          void (async () => {
            for (let attempt = 0; attempt < 48; attempt += 1) {
              try {
                const latest = await fetchMySubscription(token);
                if (latest.subscription) {
                  setSubscription(latest.subscription);
                  const status = (latest.subscription.status || "").toLowerCase();
                  if (status === "active") {
                    setInfo("Subscription activated successfully.");
                    return;
                  }
                  if (status === "authenticated" || status === "created" || status === "pending") {
                    setInfo("Mandate authorized. Waiting for first charge confirmation from Razorpay.");
                  }
                }
              } catch {
                // Keep polling for webhook completion.
              }
              await sleep(2500);
            }
            setInfo("Payment authorized. Activation is taking longer than expected. Click Refresh in a few seconds.");
          })();
        },
        prefill: {
          name: user?.name ?? "",
          email: user?.email ?? ""
        },
        theme: {
          color: "#17a65a"
        },
        modal: {
          ondismiss: () => {
            setInfo("Checkout closed. You can retry anytime.");
          }
        }
      });

      razorpay.on("payment.failed", (eventPayload) => {
        const payload = eventPayload as { error?: { description?: string } };
        setError(payload.error?.description || "Payment failed. Please try again.");
        void refreshBilling().catch(() => {
          // Best-effort refresh after failed checkout.
        });
      });
      razorpay.open();
      setInfo("Checkout opened. Approve UPI AutoPay mandate to activate recurring billing.");
    } catch (checkoutError) {
      setError((checkoutError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const response = await cancelBillingSubscription(token, { atCycleEnd: true });
      setSubscription(response.subscription);
      setInfo("Cancellation requested. Subscription stays active until current cycle ends.");
    } catch (cancelError) {
      setError((cancelError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="orch-page">
      <header className="orch-nav-wrap">
        <div className="orch-nav">
          <Link to="/" className="orch-brand">
            <span>Wagen</span>AI
          </Link>
          <div className="orch-nav-actions">
            <button className="orch-btn ghost" onClick={() => navigate("/dashboard")}>
              Dashboard
            </button>
            <button
              className="orch-btn primary"
              onClick={() => {
                setLoading(true);
                setError(null);
                void refreshBilling()
                  .catch((refreshError) => setError((refreshError as Error).message))
                  .finally(() => setLoading(false));
              }}
              disabled={loading}
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      <section className="orch-section">
        <div className="orch-heading">
          <h2>Choose Your Subscription</h2>
          <p>UPI AutoPay, cards, and netbanking are supported through Razorpay recurring billing.</p>
          <p>
            Billing center is now available in Dashboard.{" "}
            <button type="button" className="ghost-btn" onClick={() => navigate("/dashboard?tab=billing")}>
              Open Dashboard Billing
            </button>
          </p>
        </div>

        {entitlements?.planCode === "trial" ? (
          <article className="orch-card purchase-status-card">
            <h3>You&apos;re on the Free Trial</h3>
            <p>Your trial includes: <strong>200 AI credits</strong>, <strong>1 active flow</strong>, <strong>1 knowledge source</strong>, <strong>1,000 broadcast recipients/month</strong>.</p>
            <p>Subscribe to a paid plan below to unlock full limits.</p>
          </article>
        ) : entitlements ? (
          <article className="orch-card purchase-status-card">
            <h3>Current Plan: {PLAN_DISPLAY_LABELS[entitlements.planCode] ?? entitlements.planCode.toUpperCase()}</h3>
            <p>AI Credits / month: <strong>{entitlements.aiCreditsMonthly}</strong> · Active Flows: <strong>{entitlements.maxActiveFlows}</strong> · Knowledge Sources: <strong>{entitlements.maxKnowledgeSources}</strong></p>
          </article>
        ) : null}

        {!keyIdAvailable ? (
          <article className="orch-card purchase-status-card">
            <h3>Billing Setup Pending</h3>
            <p>Razorpay key is not configured on backend. Add billing env values, then refresh this page.</p>
          </article>
        ) : null}

        {subscription ? (
          <article className="orch-card purchase-status-card">
            <h3>Current Subscription Status</h3>
            <p>
              Plan: <strong>{subscription.plan.label}</strong> | Status: <strong>{subscription.status}</strong>
            </p>
            <p>
              Next renewal: <strong>{subscription.currentEndAt ? new Date(subscription.currentEndAt).toLocaleString() : "-"}</strong>
            </p>
            <p>
              Razorpay Subscription ID: <strong>{subscription.razorpaySubscriptionId ?? "-"}</strong>
            </p>
            {subscription.lastPayment ? (
              <p>
                Last payment: <strong>{(subscription.lastPayment.amountPaise / 100).toFixed(2)} {subscription.lastPayment.currency}</strong> (
                {subscription.lastPayment.status})
              </p>
            ) : null}
            <div className="orch-hero-actions">
              <button
                className="orch-btn outline"
                onClick={handleCancelSubscription}
                disabled={loading || !subscription.razorpaySubscriptionId}
              >
                Cancel at Cycle End
              </button>
            </div>
          </article>
        ) : null}

        {orderedPlans.length === 0 ? (
          <article className="orch-card purchase-status-card">
            <h3>No Plans Available</h3>
            <p>Razorpay plan IDs are not configured yet. Add `RAZORPAY_PLAN_*` env values on backend.</p>
          </article>
        ) : null}

        <div className="orch-grid-3 purchase-grid">
          {orderedPlans.map((plan) => (
            <article
              key={plan.code}
              className={
                selectedPlan === plan.code
                  ? `orch-plan ${plan.code === "pro" ? "featured" : ""} purchase-plan selected`
                  : `orch-plan ${plan.code === "pro" ? "featured" : ""} purchase-plan`
              }
            >
              <h3>{plan.label}</h3>
              <small>{PLAN_PITCHES[plan.code]}</small>
              <p className="orch-price">
                INR {plan.amountInr.toLocaleString()} <span>/ month</span>
              </p>
              <ul>
                {PLAN_FEATURES[plan.code].map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <button
                className="orch-btn outline"
                onClick={() => {
                  setSelectedPlan(plan.code);
                  setAppliedCouponCode(null);
                  setCouponPreview(null);
                }}
              >
                Select {plan.label}
              </button>
            </article>
          ))}
        </div>

        <div className="orch-support purchase-cta">
          <h2>Complete Purchase</h2>
          <p>
            Selected plan: <strong>{PLAN_DISPLAY_LABELS[selectedPlan] ?? selectedPlan.toUpperCase()}</strong>. Approve UPI AutoPay mandate during checkout.
          </p>
          <div className="purchase-coupon-panel">
            <label htmlFor="purchase-coupon">Offer code</label>
            <div className="purchase-coupon-row">
              <input
                id="purchase-coupon"
                value={couponCodeInput}
                onChange={(event) => {
                  setCouponCodeInput(event.target.value);
                  setCouponMessage(null);
                  if (appliedCouponCode && event.target.value.trim().toUpperCase() !== appliedCouponCode.toUpperCase()) {
                    setAppliedCouponCode(null);
                    setCouponPreview(null);
                  }
                }}
                placeholder="Enter coupon code"
              />
              <button
                type="button"
                className="orch-btn outline"
                onClick={() => void handleApplyCoupon()}
                disabled={couponLoading}
              >
                {couponLoading ? "Checking..." : "Apply"}
              </button>
            </div>
            {couponPreview ? (
              <div className="purchase-coupon-preview">
                <span>Original: <strong>{fmtInr(couponPreview.originalAmountPaise)}</strong></span>
                <span>Discount preview: <strong>{fmtInr(couponPreview.discountAmountPaise)}</strong></span>
                <span>Estimated after offer: <strong>{fmtInr(couponPreview.finalAmountPaise)}</strong></span>
                <small>{couponPreview.gatewayNote}</small>
              </div>
            ) : null}
            {couponMessage ? <p className={couponPreview ? "info-text" : "error-text"}>{couponMessage}</p> : null}
          </div>
          <div className="orch-hero-actions">
            <button
              className="orch-btn light"
              onClick={handleSubscribe}
              disabled={loading || !keyIdAvailable || orderedPlans.length === 0}
            >
              {loading ? "Processing..." : "Pay with Razorpay"}
            </button>
            <button className="orch-btn dark" onClick={() => navigate("/dashboard")}>
              Skip for Now
            </button>
          </div>
        </div>

        {info && <p className="info-text">{info}</p>}
        {error && <p className="error-text">{error}</p>}
      </section>
    </main>
  );
}

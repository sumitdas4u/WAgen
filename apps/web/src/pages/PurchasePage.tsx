import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import {
  cancelBillingSubscription,
  createBillingSubscription,
  fetchBillingPlans,
  fetchMySubscription,
  type BillingPlan,
  type BillingSubscriptionSummary
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
const PLAN_FEATURES: Record<BillingPlan["code"], string[]> = {
  starter: ["1 WhatsApp Number", "Basic AI training", "24/7 auto-replies", "Email support"],
  pro: ["1 WhatsApp Number", "Advanced AI training", "Unlimited replies", "Analytics dashboard", "Lead collection"],
  business: ["Up to 3 Numbers", "Custom AI voice and tone", "Premium templates", "Priority support", "Optional API access"]
};

function getQueryPlan(search: string): BillingPlan["code"] | null {
  const value = new URLSearchParams(search).get("plan");
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "starter" || normalized === "pro" || normalized === "business") {
    return normalized;
  }
  return null;
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

export function PurchasePage() {
  const { token, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<BillingPlan["code"]>("pro");
  const [subscription, setSubscription] = useState<BillingSubscriptionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const orderedPlans = useMemo(() => {
    const available = new Map(plans.map((plan) => [plan.code, plan]));
    return PLAN_ORDER.map((code) => available.get(code)).filter((plan): plan is BillingPlan => Boolean(plan));
  }, [plans]);

  const refreshBilling = async () => {
    if (!token) {
      return;
    }
    const [plansResponse, subscriptionResponse] = await Promise.all([
      fetchBillingPlans(),
      fetchMySubscription(token)
    ]);
    const availablePlans = plansResponse.plans.filter((plan) => plan.available);
    setPlans(availablePlans);
    setSubscription(subscriptionResponse.subscription);
  };

  useEffect(() => {
    if (!token) {
      return;
    }
    const planFromQuery = getQueryPlan(location.search);
    if (planFromQuery) {
      setSelectedPlan(planFromQuery);
    }

    setLoading(true);
    setError(null);
    void refreshBilling()
      .catch((loadError) => {
        setError((loadError as Error).message);
      })
      .finally(() => setLoading(false));
  }, [location.search, token]);

  const handleSubscribe = async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const response = await createBillingSubscription(token, { planCode: selectedPlan });
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded || !window.Razorpay) {
        throw new Error("Unable to load Razorpay checkout");
      }

      const razorpay = new window.Razorpay({
        key: response.keyId,
        name: "WagenAI",
        description: `${response.checkout.planLabel} monthly subscription`,
        subscription_id: response.checkout.subscriptionId,
        handler: () => {
          setInfo("Payment authorized. Waiting for webhook confirmation to activate subscription.");
          void refreshBilling().catch(() => undefined);
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
            <button className="orch-btn primary" onClick={() => void refreshBilling()} disabled={loading}>
              Refresh
            </button>
          </div>
        </div>
      </header>

      <section className="orch-section">
        <div className="orch-heading">
          <h2>Choose Your Subscription</h2>
          <p>UPI AutoPay, cards, and netbanking are supported through Razorpay recurring billing.</p>
        </div>

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
              <small>{plan.trialDaysDefault}-day free trial, recurring monthly billing</small>
              <p className="orch-price">
                INR {plan.amountInr.toLocaleString()} <span>/ month</span>
              </p>
              <ul>
                {PLAN_FEATURES[plan.code].map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <button className="orch-btn outline" onClick={() => setSelectedPlan(plan.code)}>
                Select {plan.label}
              </button>
            </article>
          ))}
        </div>

        <div className="orch-support purchase-cta">
          <h2>Complete Purchase</h2>
          <p>
            Selected plan: <strong>{selectedPlan.toUpperCase()}</strong>. Approve UPI AutoPay mandate during checkout.
          </p>
          <div className="orch-hero-actions">
            <button className="orch-btn light" onClick={handleSubscribe} disabled={loading}>
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

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  fetchDashboardOverview,
  previewCoupon,
  type BillingPlan,
  type CouponPreview,
  type DashboardOverviewResponse
} from "../../lib/api";
import { useDashboardShell } from "../../shared/dashboard/shell-context";

const DEFAULT_DEMO_YOUTUBE_ID = "M7lc1UVf-VE";
const DEMO_SCHEDULE_URL = "https://calendly.com/sumitdas4u/30min";
const OFFER_PLAN_CODES: BillingPlan["code"][] = ["pro", "starter", "business"];
const PLAN_LABELS: Record<BillingPlan["code"], string> = {
  starter: "Starter",
  pro: "Growth",
  business: "Pro"
};

function fmtNumber(value: number | null | undefined): string {
  return Math.max(0, Number(value ?? 0)).toLocaleString();
}

function fmtInr(paise: number): string {
  return (paise / 100).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  });
}

function getQueryCoupon(search: string): string | null {
  const code = new URLSearchParams(search).get("coupon")?.trim();
  return code || null;
}

function statusLabel(value: boolean): string {
  return value ? "Connected" : "Not connected";
}

type OfferStatus = "success" | "error" | null;

export function DashboardHomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token, bootstrap } = useDashboardShell();
  const [overview, setOverview] = useState<DashboardOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offerCode, setOfferCode] = useState("");
  const [offerLoading, setOfferLoading] = useState(false);
  const [offerStatus, setOfferStatus] = useState<OfferStatus>(null);
  const [offerMessage, setOfferMessage] = useState<string | null>(null);
  const [offerPreview, setOfferPreview] = useState<CouponPreview | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchDashboardOverview(token)
      .then(setOverview)
      .catch((loadError) => setError((loadError as Error).message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    const coupon = getQueryCoupon(location.search);
    if (coupon) {
      setOfferCode(coupon);
    }
  }, [location.search]);

  const channels = overview?.channels;
  const websiteConnected = channels?.website.connected ?? Boolean(bootstrap?.channelSummary.website.enabled);
  const qrConnected = channels?.qr.connected ?? bootstrap?.channelSummary.whatsapp.status === "connected";
  const apiConnected = channels?.api.connected ?? Boolean(bootstrap?.channelSummary.metaApi.connected);
  const connected = overview?.setup?.connected ?? (websiteConnected || qrConnected || apiConnected);
  const demoId = (import.meta.env.VITE_DASHBOARD_DEMO_YOUTUBE_ID || DEFAULT_DEMO_YOUTUBE_ID).trim();
  const demoSrc = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(demoId)}`;
  const userName = bootstrap?.userSummary.name || "there";
  const stepsLeft = overview?.setup?.stepsLeft ?? (connected ? 2 : 3);
  const planCode = bootstrap?.planEntitlements.planCode ?? "free";
  const creditsRemaining = bootstrap?.creditsSummary.remaining_credits ?? 0;
  const creditsTotal = bootstrap?.creditsSummary.total_credits ?? 0;

  const channelRows = [
    {
      label: "Official API",
      connected: apiConnected,
      status: channels?.api.status ?? (apiConnected ? "connected" : "not_connected"),
      detail: channels?.api.phoneNumber ?? "Recommended setup",
      to: "/dashboard/settings/api"
    },
    {
      label: "WhatsApp QR",
      connected: qrConnected,
      status: channels?.qr.status ?? bootstrap?.channelSummary.whatsapp.status ?? "not_connected",
      detail: channels?.qr.phoneNumber ?? bootstrap?.channelSummary.whatsapp.phoneNumber ?? "Scan to connect",
      to: "/dashboard/settings/qr"
    },
    {
      label: "Website Widget",
      connected: websiteConnected,
      status: channels?.website.status ?? (websiteConnected ? "active" : "not_connected"),
      detail: "Website chat channel",
      to: "/dashboard/settings/web"
    }
  ];
  const activeChannel = channelRows.find((channel) => channel.connected);

  const resolveOffer = async (code: string) => {
    let lastError: Error | null = null;
    for (const planCodeToTry of OFFER_PLAN_CODES) {
      try {
        const response = await previewCoupon(token, {
          code,
          purchaseType: "subscription",
          planCode: planCodeToTry
        });
        return { planCode: planCodeToTry, preview: response.preview };
      } catch (couponError) {
        lastError = couponError as Error;
      }
    }
    throw lastError ?? new Error("This offer code is not available for current plans.");
  };

  const handleOfferSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedCode = offerCode.trim();
    if (!normalizedCode) {
      setOfferStatus("error");
      setOfferMessage("Enter an offer access code first.");
      setOfferPreview(null);
      return;
    }

    setOfferLoading(true);
    setOfferStatus(null);
    setOfferMessage(null);
    setOfferPreview(null);
    try {
      const result = await resolveOffer(normalizedCode);
      const params = new URLSearchParams({
        coupon: result.preview.code,
        plan: result.planCode
      });
      setOfferStatus("success");
      setOfferPreview(result.preview);
      setOfferCode(result.preview.code);
      setOfferMessage(`Offer ${result.preview.code} is ready for the ${PLAN_LABELS[result.planCode]} plan.`);
      navigate(`/purchase?${params.toString()}`);
    } catch (couponError) {
      setOfferStatus("error");
      setOfferMessage((couponError as Error).message);
    } finally {
      setOfferLoading(false);
    }
  };

  return (
    <div className="dashboard-home">
      <section className="dashboard-home-welcome">
        <h1>Hey {userName}, Welcome to WAgen AI!</h1>
        <div className="dashboard-home-actions" aria-label="Quick actions">
          <a href={DEMO_SCHEDULE_URL} target="_blank" rel="noreferrer">Schedule Live Demo</a>
          <button type="button" onClick={() => navigate("/dashboard/settings/api")}>Setup Guide</button>
          <button type="button" onClick={() => navigate("/dashboard/studio/test")}>Watch Tutorials</button>
        </div>
      </section>

      <section className="dashboard-offer-banner" aria-label="Offer access banner">
        <div className="dashboard-offer-left">
          <span className="dashboard-offer-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20" focusable="false">
              <rect x="4" y="8" width="12" height="8" rx="1.5" />
              <path d="M3.5 8h13M10 8v8M7.2 5.3C6.4 4.5 5 5 5.1 6.2 5.2 7.6 7.2 8 10 8c-1.1-1.5-1.9-2.3-2.8-2.7ZM12.8 5.3c.8-.8 2.2-.3 2.1.9-.1 1.4-2.1 1.8-4.9 1.8 1.1-1.5 1.9-2.3 2.8-2.7Z" />
            </svg>
          </span>
          <div className="dashboard-offer-copy">
            <strong>Got any offer access code?</strong>
            <span>Activate your special discounted offer now!</span>
          </div>
        </div>
        <form className="dashboard-offer-controls" onSubmit={handleOfferSubmit}>
          <input
            value={offerCode}
            onChange={(event) => setOfferCode(event.target.value)}
            placeholder="Enter access code"
            aria-label="Offer access code"
            disabled={offerLoading}
          />
          <button type="submit" disabled={offerLoading}>
            {offerLoading ? "Checking..." : "Activate ->"}
          </button>
        </form>
        {offerMessage ? (
          <p className={offerStatus === "success" ? "dashboard-offer-status success" : "dashboard-offer-status error"}>
            {offerMessage}
            {offerPreview ? ` Discount preview: ${fmtInr(offerPreview.discountAmountPaise)}.` : null}
          </p>
        ) : null}
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      <div className="dashboard-home-grid">
        <main className="dashboard-home-main">
          <section className="dashboard-setup-card">
            <div className="dashboard-setup-head">
              <h2>Setup FREE WhatsApp Business Account</h2>
              <span>{stepsLeft} steps left</span>
            </div>

            <div className="dashboard-setup-panel">
              <span className="dashboard-setup-step-label">START</span>
              <div className="dashboard-setup-content">
                <div className="dashboard-setup-copy">
                  <div className="dashboard-check-index">{connected ? "OK" : "1"}</div>
                  <div>
                    <h3>Apply for WhatsApp Business API</h3>
                    <p>Click on Continue With Facebook to apply for WhatsApp Business API</p>
                    <span>Requirements to apply for WhatsApp Business API</span>
                    <small>A Registered Business & Working Website.</small>
                  </div>
                </div>

                <div>
                  <div className="dashboard-demo-video">
                    <iframe
                      title="WAgen dashboard demo"
                      src={demoSrc}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  </div>
                  <div className="dashboard-demo-actions">
                    <a href={DEMO_SCHEDULE_URL} target="_blank" rel="noreferrer">Schedule Meetings</a>
                    <Link to="/dashboard/settings/api" className="primary">Continue With Facebook</Link>
                  </div>
                </div>
              </div>
            </div>

            <Link className="dashboard-all-steps" to="/dashboard/settings/api">All Steps</Link>
          </section>
        </main>

        <aside className="dashboard-home-side">
          <section className="dashboard-side-card">
            <h2>Workspace Channels</h2>
            <div className={connected ? "dashboard-channel-summary connected" : "dashboard-channel-summary"}>
              <strong>{connected ? "Connected" : "Setup required"}</strong>
              <span>{activeChannel ? `${activeChannel.label} is feeding the dashboard` : "Connect Website, QR, or Official API"}</span>
            </div>
            {channelRows.map((channel) => (
              <button key={channel.label} type="button" onClick={() => navigate(channel.to)} className="dashboard-side-row">
                <span>{channel.label}</span>
                <strong className={channel.connected ? "ok" : ""}>{statusLabel(channel.connected)}</strong>
              </button>
            ))}
            <div className="dashboard-key-features">
              <span>Live Chat</span>
              <span>Broadcast</span>
              <span>Sequences</span>
              <span>Analytics</span>
            </div>
          </section>

          <section className="dashboard-side-card">
            <h2>AI Credits</h2>
            <p className="dashboard-side-stat">{fmtNumber(creditsRemaining)}</p>
            <span>{fmtNumber(creditsTotal)} monthly credits</span>
            <button type="button" onClick={() => navigate("/dashboard/account/ai-wallet")}>Open Wallet</button>
          </section>

          <section className="dashboard-side-card">
            <h2>Current Plan</h2>
            <p className="dashboard-side-stat capitalize">{planCode}</p>
            <span>{connected ? "Workspace is ready" : "No active channel yet"}</span>
            <button type="button" onClick={() => navigate("/purchase")}>Get a Plan</button>
          </section>
        </aside>
      </div>

      {loading ? <p className="info-text">Loading workspace overview...</p> : null}
    </div>
  );
}

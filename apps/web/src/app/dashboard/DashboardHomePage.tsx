import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchDashboardOverview, type DashboardOverviewResponse } from "../../lib/api";
import { DashboardIcon } from "../../shared/dashboard/icons";
import type { DashboardIconName } from "../../shared/dashboard/module-contracts";
import { useDashboardShell } from "../../shared/dashboard/shell-context";

const DEFAULT_DEMO_YOUTUBE_ID = "M7lc1UVf-VE";
const DEMO_SCHEDULE_URL = "https://calendly.com/sumitdas4u/30min";

function fmtNumber(value: number | null | undefined): string {
  return Math.max(0, Number(value ?? 0)).toLocaleString();
}

function statusLabel(value: boolean): string {
  return value ? "Connected" : "Not connected";
}

interface FeatureLink {
  label: string;
  icon: DashboardIconName;
  to: string;
  detail: string;
}

const FEATURES: FeatureLink[] = [
  { label: "Chats", icon: "chats", to: "/dashboard/inbox-v2", detail: "Live conversations" },
  { label: "Contacts", icon: "leads", to: "/dashboard/leads", detail: "Lead directory" },
  { label: "Broadcast", icon: "broadcast", to: "/dashboard/broadcast", detail: "Campaign sends" },
  { label: "Sequence", icon: "sequence", to: "/dashboard/sequence", detail: "Follow-up journeys" },
  { label: "Chat Bot", icon: "agents", to: "/dashboard/agents", detail: "AI agents and flows" },
  { label: "Analytics", icon: "analytics", to: "/dashboard/analytics", detail: "Reports and delivery" },
  { label: "Settings", icon: "settings", to: "/dashboard/settings/api", detail: "Channels and API" },
  { label: "Account", icon: "account", to: "/dashboard/account/details", detail: "Plan and profile" }
];

const CONNECTION_CHAIN = [
  { label: "Channels", to: "/dashboard/settings/api" },
  { label: "Conversations", to: "/dashboard/inbox-v2" },
  { label: "Contacts", to: "/dashboard/leads" },
  { label: "AI / Flows / Knowledge", to: "/dashboard/agents" },
  { label: "Broadcast / Sequence", to: "/dashboard/broadcast" },
  { label: "Analytics / Billing", to: "/dashboard/analytics" }
];

export function DashboardHomePage() {
  const navigate = useNavigate();
  const { token, bootstrap } = useDashboardShell();
  const [overview, setOverview] = useState<DashboardOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchDashboardOverview(token)
      .then(setOverview)
      .catch((loadError) => setError((loadError as Error).message))
      .finally(() => setLoading(false));
  }, [token]);

  const channels = overview?.channels;
  const websiteConnected = channels?.website.connected ?? Boolean(bootstrap?.channelSummary.website.enabled);
  const qrConnected = channels?.qr.connected ?? bootstrap?.channelSummary.whatsapp.status === "connected";
  const apiConnected = channels?.api.connected ?? Boolean(bootstrap?.channelSummary.metaApi.connected);
  const connected = overview?.setup?.connected ?? (websiteConnected || qrConnected || apiConnected);
  const demoId = (import.meta.env.VITE_DASHBOARD_DEMO_YOUTUBE_ID || DEFAULT_DEMO_YOUTUBE_ID).trim();
  const demoSrc = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(demoId)}`;
  const userName = bootstrap?.userSummary.name || "there";
  const stepsLeft = overview?.setup?.stepsLeft ?? (connected ? 2 : 3);

  const channelCards = useMemo(
    () => [
      {
        label: "Official API",
        connected: apiConnected,
        status: channels?.api.status ?? (apiConnected ? "connected" : "not_connected"),
        detail: channels?.api.phoneNumber ?? "Recommended primary channel",
        to: "/dashboard/settings/api"
      },
      {
        label: "WhatsApp QR",
        connected: qrConnected,
        status: channels?.qr.status ?? bootstrap?.channelSummary.whatsapp.status ?? "not_connected",
        detail: channels?.qr.phoneNumber ?? bootstrap?.channelSummary.whatsapp.phoneNumber ?? "QR session channel",
        to: "/dashboard/settings/qr"
      },
      {
        label: "Website Widget",
        connected: websiteConnected,
        status: channels?.website.status ?? (websiteConnected ? "active" : "not_connected"),
        detail: "Web chat entry point",
        to: "/dashboard/settings/web"
      }
    ],
    [apiConnected, bootstrap, channels, qrConnected, websiteConnected]
  );

  const checklist = overview?.setup?.checklist ?? [
    {
      id: "connect-channel",
      label: "Connect a channel",
      complete: connected,
      primaryCta: { label: "Connect API", to: "/dashboard/settings/api" },
      secondaryCtas: [
        { label: "QR", to: "/dashboard/settings/qr" },
        { label: "Web", to: "/dashboard/settings/web" }
      ]
    },
    {
      id: "configure-ai",
      label: "Configure AI agent and knowledge",
      complete: Boolean(bootstrap?.agentSummary.hasConfiguredProfile),
      primaryCta: { label: "AI Agents", to: "/dashboard/agents" },
      secondaryCtas: [
        { label: "Knowledge", to: "/dashboard/studio/knowledge" },
        { label: "Flows", to: "/dashboard/studio/flows" }
      ]
    },
    {
      id: "start-operating",
      label: "Start operating",
      complete: false,
      primaryCta: { label: "Open Chats", to: "/dashboard/inbox-v2" },
      secondaryCtas: [
        { label: "Broadcast", to: "/dashboard/broadcast" },
        { label: "Analytics", to: "/dashboard/analytics" }
      ]
    }
  ];

  const planCode = bootstrap?.planEntitlements.planCode ?? "trial";
  const creditsRemaining = bootstrap?.creditsSummary.remaining_credits ?? 0;
  const creditsTotal = bootstrap?.creditsSummary.total_credits ?? 0;

  return (
    <div className="dashboard-home">
      <section className="dashboard-home-welcome">
        <div>
          <h1>Hey {userName}, welcome to WAgen AI</h1>
          <p>{connected ? "Your workspace is connected and ready to operate." : "Connect a channel to start receiving conversations."}</p>
        </div>
        <div className="dashboard-home-actions" aria-label="Quick actions">
          <a href={DEMO_SCHEDULE_URL} target="_blank" rel="noreferrer">Schedule Live Demo</a>
          <button type="button" onClick={() => navigate("/dashboard/settings/api")}>Setup Guide</button>
          <button type="button" onClick={() => navigate("/dashboard/studio/test")}>Watch Tutorials</button>
        </div>
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      <div className="dashboard-home-grid">
        <div className="dashboard-home-main">
          <section className="dashboard-setup-card">
            <div className="dashboard-setup-head">
              <div>
                <span className={connected ? "dashboard-home-pill connected" : "dashboard-home-pill"}>{connected ? "Connected" : "Setup"}</span>
                <h2>{connected ? "Workspace connection overview" : "Connect WAgen to your first channel"}</h2>
              </div>
              <span>{stepsLeft} steps left</span>
            </div>

            <div className="dashboard-setup-body">
              <div className="dashboard-checklist">
                {checklist.map((item, index) => (
                  <article key={item.id} className={item.complete ? "dashboard-check-row done" : "dashboard-check-row"}>
                    <div className="dashboard-check-index">{item.complete ? "OK" : index + 1}</div>
                    <div>
                      <h3>{item.label}</h3>
                      <div className="dashboard-check-actions">
                        <Link to={item.primaryCta.to}>{item.primaryCta.label}</Link>
                        {item.secondaryCtas.map((cta) => (
                          <Link key={cta.to} to={cta.to}>{cta.label}</Link>
                        ))}
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              <div className="dashboard-demo-video">
                <iframe
                  title="WAgen dashboard demo"
                  src={demoSrc}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
            </div>
          </section>

          <section className="dashboard-connected-card">
            <div>
              <h2>{connected ? "Active channel feed" : "No active channel yet"}</h2>
              <p>
                {connected
                  ? "Connected channels feed conversations into Contacts, AI workflows, Broadcast, Sequence, and Analytics."
                  : "Official API is recommended, with QR and Web available as alternatives."}
              </p>
            </div>
            <div className="dashboard-channel-cards">
              {channelCards.map((channel) => (
                <Link key={channel.label} to={channel.to} className={channel.connected ? "dashboard-channel-card active" : "dashboard-channel-card"}>
                  <strong>{channel.label}</strong>
                  <span>{statusLabel(channel.connected)} · {channel.status}</span>
                  <small>{channel.detail}</small>
                </Link>
              ))}
            </div>
          </section>

          <section className="dashboard-feature-grid" aria-label="Feature entry points">
            {FEATURES.map((feature) => (
              <Link key={feature.to} to={feature.to} className="dashboard-feature-tile">
                <span className="dashboard-feature-icon"><DashboardIcon name={feature.icon} /></span>
                <strong>{feature.label}</strong>
                <small>{feature.detail}</small>
              </Link>
            ))}
          </section>

          <section className="dashboard-chain">
            {CONNECTION_CHAIN.map((node, index) => (
              <Link key={node.to} to={node.to}>
                <span>{node.label}</span>
                {index < CONNECTION_CHAIN.length - 1 ? <b>-&gt;</b> : null}
              </Link>
            ))}
          </section>
        </div>

        <aside className="dashboard-home-side">
          <section className="dashboard-side-card">
            <h2>Channel status</h2>
            {channelCards.map((channel) => (
              <button key={channel.label} type="button" onClick={() => navigate(channel.to)} className="dashboard-side-row">
                <span>{channel.label}</span>
                <strong className={channel.connected ? "ok" : ""}>{statusLabel(channel.connected)}</strong>
              </button>
            ))}
          </section>

          <section className="dashboard-side-card">
            <h2>AI credits</h2>
            <p className="dashboard-side-stat">{fmtNumber(creditsRemaining)}</p>
            <span>{fmtNumber(creditsTotal)} monthly credits</span>
            <button type="button" onClick={() => navigate("/dashboard/account/ai-wallet")}>Open Wallet</button>
          </section>

          <section className="dashboard-side-card">
            <h2>Current plan</h2>
            <p className="dashboard-side-stat capitalize">{planCode}</p>
            <button type="button" onClick={() => navigate("/dashboard/account/subscription")}>Manage Plan</button>
          </section>

          <section className="dashboard-side-card">
            <h2>Quick launch</h2>
            <button type="button" onClick={() => navigate("/dashboard/inbox-v2")}>Open Chats</button>
            <button type="button" onClick={() => navigate("/dashboard/broadcast")}>Create Broadcast</button>
            <button type="button" onClick={() => navigate("/dashboard/analytics")}>View Analytics</button>
          </section>
        </aside>
      </div>

      {loading ? <p className="info-text">Loading workspace overview...</p> : null}
    </div>
  );
}

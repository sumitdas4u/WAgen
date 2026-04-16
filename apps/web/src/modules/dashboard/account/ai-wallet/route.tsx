import "./../account.css";

const FEATURE_CARDS = [
  {
    icon: "🧠",
    title: "AI token balance",
    body: "Track how many AI tokens your workspace has consumed this month across all chatbot interactions."
  },
  {
    icon: "📊",
    title: "Usage breakdown",
    body: "See token consumption split by model, channel (WhatsApp, Web, QR), and conversation type."
  },
  {
    icon: "🔄",
    title: "Monthly reset",
    body: "AI tokens reset at the start of each billing cycle in line with your plan allowance."
  },
  {
    icon: "⚡",
    title: "Top-up packs",
    body: "Buy additional AI token packs when your monthly allocation runs low — available in flexible sizes."
  }
];

export function Component() {
  return (
    <div className="acc-page">
      <div className="acc-page-header">
        <h1 className="acc-page-title">AI Wallet</h1>
      </div>

      {/* ── Placeholder overview card ──────────────────────────────────────── */}
      <div className="acc-card">
        <div className="acc-card-head">
          <div>
            <h2 className="acc-card-title">AI token balance</h2>
            <p className="acc-card-subtitle">Monthly AI token usage across all models and channels</p>
          </div>
          <span className="acc-plan-pill plan-trial">Coming soon</span>
        </div>
        <div className="acc-card-body">
          <div className="acc-credit-meter">
            <div className="acc-credit-bar-wrap">
              <div className="acc-credit-bar-fill" style={{ width: "0%" }} />
            </div>
            <div className="acc-credit-labels">
              <span>0 tokens used</span>
              <span>0%</span>
              <span>— tokens total</span>
            </div>
          </div>
        </div>
        <div className="acc-stats-row">
          <div className="acc-stat-cell">
            <p className="acc-stat-label">Total (period)</p>
            <p className="acc-stat-value acc-stat-placeholder">—</p>
          </div>
          <div className="acc-stat-cell">
            <p className="acc-stat-label">Used</p>
            <p className="acc-stat-value acc-stat-placeholder">—</p>
          </div>
          <div className="acc-stat-cell">
            <p className="acc-stat-label">Remaining</p>
            <p className="acc-stat-value acc-stat-placeholder">—</p>
          </div>
          <div className="acc-stat-cell">
            <p className="acc-stat-label">Resets on</p>
            <p className="acc-stat-value acc-stat-placeholder">—</p>
          </div>
        </div>
      </div>

      {/* ── Coming soon banner ─────────────────────────────────────────────── */}
      <div className="acc-ai-wallet-banner">
        <div className="acc-ai-wallet-banner-inner">
          <p className="acc-ai-wallet-banner-title">Full AI Wallet launching soon</p>
          <p className="acc-ai-wallet-banner-body">
            Detailed token analytics, per-model usage breakdown, and top-up packs are being built.
            You'll be notified when this section goes live.
          </p>
        </div>
      </div>

      {/* ── Feature preview cards ──────────────────────────────────────────── */}
      <div className="acc-card">
        <div className="acc-card-head">
          <h2 className="acc-card-title">What's coming</h2>
        </div>
        <div className="acc-card-body">
          <div className="acc-addons-grid">
            {FEATURE_CARDS.map((f) => (
              <div key={f.title} className="acc-addon-card acc-feature-preview-card">
                <span className="acc-feature-preview-icon">{f.icon}</span>
                <p className="acc-addon-name">{f.title}</p>
                <p className="acc-addon-desc">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function prefetchData() {
  return undefined;
}

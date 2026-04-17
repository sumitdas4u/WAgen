import "./../account.css";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../../lib/auth-context";
import { fetchAiWallet, type AiWalletStatus, type AiLedgerRow, type AiUsageByAction, type AiUsageByDay } from "../../../../lib/api";

const ACTION_LABELS: Record<string, string> = {
  chatbot_reply:        "Chatbot reply",
  rag_embed_query:      "KB retrieval",
  kb_ingest_chunk:      "KB ingestion",
  template_generate:    "Template generate",
  onboarding_autofill:  "Onboarding autofill",
  flow_draft_generate:  "Flow draft generate",
  ai_agent_flow:        "AI agent / calendar",
  image_analyze:        "Image analysis",
  ai_text_assist:       "Message rewrite/translate",
  ai_lead_summary:      "Lead summary",
  ai_intent_classify:   "Intent classification",
  plan_monthly_reset:   "Monthly reset",
  plan_signup_credit:   "Signup credit",
  plan_activation:      "Plan activation",
};

function fmtAction(action: string) {
  return ACTION_LABELS[action] ?? action.replace(/_/g, " ");
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function DailyChart({ data }: { data: AiUsageByDay[] }) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map(d => d.tokens_used), 1);
  return (
    <div className="acc-card">
      <div className="acc-card-head">
        <h2 className="acc-card-title">Daily token burn</h2>
        <span style={{ fontSize: "0.75rem", color: "#5f6f86" }}>Last 30 days</span>
      </div>
      <div className="acc-card-body" style={{ paddingBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "80px", overflowX: "auto" }}>
          {data.map(d => {
            const h = Math.max(4, Math.round((d.tokens_used / max) * 80));
            const label = d.day.slice(5); // MM-DD
            return (
              <div
                key={d.day}
                title={`${d.day}: ${d.tokens_used.toLocaleString()} tokens (${d.calls} calls)`}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", flex: "1 0 18px", minWidth: "18px", cursor: "default" }}
              >
                <div
                  style={{
                    width: "100%",
                    height: `${h}px`,
                    background: "#2563eb",
                    borderRadius: "3px 3px 0 0",
                    opacity: 0.75,
                    transition: "opacity 120ms ease"
                  }}
                />
                <span style={{ fontSize: "0.58rem", color: "#94a3b8", writingMode: "vertical-rl", transform: "rotate(180deg)", whiteSpace: "nowrap" }}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.75rem", color: "#5f6f86" }}>
          Total: <strong>{data.reduce((s, d) => s + d.tokens_used, 0).toLocaleString()}</strong> tokens across <strong>{data.reduce((s, d) => s + d.calls, 0).toLocaleString()}</strong> calls in the last 30 days
        </p>
      </div>
    </div>
  );
}

function BalanceMeter({ status }: { status: AiWalletStatus }) {
  const pct = status.monthlyQuota > 0
    ? Math.max(0, Math.min(100, (status.balance / status.monthlyQuota) * 100))
    : 0;
  const barClass = pct <= 10 ? "acc-credit-bar-fill is-critical"
    : pct <= 25 ? "acc-credit-bar-fill is-low"
    : "acc-credit-bar-fill";
  const used = Math.max(0, status.monthlyQuota - status.balance);

  return (
    <div className="acc-credit-meter">
      <div className="acc-credit-bar-wrap">
        <div className={barClass} style={{ width: `${pct.toFixed(1)}%` }} />
      </div>
      <div className="acc-credit-labels">
        <span>{used.toLocaleString()} used</span>
        <span>{pct.toFixed(0)}% remaining</span>
        <span>{status.monthlyQuota.toLocaleString()} total</span>
      </div>
    </div>
  );
}

export function Component() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<AiWalletStatus | null>(null);
  const [ledger, setLedger] = useState<AiLedgerRow[]>([]);
  const [usageByAction, setUsageByAction] = useState<AiUsageByAction[]>([]);
  const [usageByDay, setUsageByDay] = useState<AiUsageByDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetchAiWallet(token)
      .then(data => {
        setStatus(data.status);
        setLedger(data.ledger);
        setUsageByAction(data.usageByAction);
        setUsageByDay(data.usageByDay ?? []);
      })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [token]);

  const planCode = status?.planCode ?? user?.subscription_plan ?? "trial";
  const pillClass = `acc-plan-pill plan-${planCode}`;

  return (
    <div className="acc-page">
      <div className="acc-page-header">
        <h1 className="acc-page-title">AI Wallet</h1>
        <div className="acc-header-actions">
          <button
            style={{ appearance: "none", height: "2.2rem", padding: "0 0.75rem", border: "1px solid #e2eaf4", borderRadius: "8px", background: "#fff", font: "inherit", fontSize: "0.8rem", fontWeight: 600, color: "#122033", cursor: "pointer" }}
            onClick={() => navigate("/dashboard/billing")}
          >
            Upgrade plan
          </button>
        </div>
      </div>

      {/* ── Balance card ─────────────────────────────────────────────────── */}
      <div className="acc-card">
        <div className="acc-card-head">
          <div>
            <h2 className="acc-card-title">AI token balance</h2>
            <p className="acc-card-subtitle">Monthly AI token usage across all models and channels</p>
          </div>
          <span className={pillClass}>{planCode}</span>
        </div>

        {loading ? (
          <div className="acc-card-body" style={{ color: "#5f6f86", fontSize: "0.85rem" }}>Loading…</div>
        ) : error ? (
          <div className="acc-card-body" style={{ color: "#be123c", fontSize: "0.85rem" }}>{error}</div>
        ) : status ? (
          <>
            <div className="acc-card-body">
              <BalanceMeter status={status} />
              {status.isLow && (
                <p style={{ margin: 0, fontSize: "0.8rem", color: "#b45309", fontWeight: 600 }}>
                  ⚠ Your AI token balance is running low. Consider upgrading your plan.
                </p>
              )}
              {!status.canUseAiGeneration && (
                <p style={{ margin: 0, fontSize: "0.8rem", color: "#be123c", fontWeight: 600 }}>
                  AI generation features are locked. Upgrade your plan or wait for the monthly reset.
                </p>
              )}
            </div>
            <div className="acc-stats-row">
              <div className="acc-stat-cell">
                <p className="acc-stat-label">Balance</p>
                <p className="acc-stat-value">{Math.max(0, status.balance).toLocaleString()}</p>
              </div>
              <div className="acc-stat-cell">
                <p className="acc-stat-label">Used this month</p>
                <p className="acc-stat-value">
                  {Math.max(0, status.monthlyQuota - status.balance).toLocaleString()}
                </p>
              </div>
              <div className="acc-stat-cell">
                <p className="acc-stat-label">Monthly quota</p>
                <p className="acc-stat-value">{status.monthlyQuota.toLocaleString()}</p>
              </div>
              <div className="acc-stat-cell">
                <p className="acc-stat-label">Plan</p>
                <p className="acc-stat-value" style={{ fontSize: "1rem", textTransform: "capitalize" }}>{planCode}</p>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* ── Usage by action ──────────────────────────────────────────────── */}
      {!loading && usageByAction.length > 0 && (
        <div className="acc-card">
          <div className="acc-card-head">
            <h2 className="acc-card-title">Usage breakdown</h2>
            <span style={{ fontSize: "0.75rem", color: "#5f6f86" }}>Last 30 days</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#fafbfd", borderBottom: "1px solid #edf2f7" }}>
                  <th style={{ padding: "0.65rem 1.25rem", textAlign: "left", fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "#5f6f86" }}>Feature</th>
                  <th style={{ padding: "0.65rem 1.25rem", textAlign: "right", fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "#5f6f86" }}>Calls</th>
                  <th style={{ padding: "0.65rem 1.25rem", textAlign: "right", fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "#5f6f86" }}>Tokens used</th>
                </tr>
              </thead>
              <tbody>
                {usageByAction.map(row => (
                  <tr key={row.action_type} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "0.7rem 1.25rem", fontSize: "0.84rem", fontWeight: 500, color: "#334155" }}>{fmtAction(row.action_type)}</td>
                    <td style={{ padding: "0.7rem 1.25rem", textAlign: "right", fontSize: "0.84rem", color: "#5f6f86" }}>{row.calls.toLocaleString()}</td>
                    <td style={{ padding: "0.7rem 1.25rem", textAlign: "right", fontSize: "0.84rem", fontWeight: 700, color: "#122033" }}>{row.tokens_used.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Daily chart ──────────────────────────────────────────────────── */}
      {!loading && <DailyChart data={usageByDay} />}

      {/* ── Token ledger ─────────────────────────────────────────────────── */}
      {!loading && ledger.length > 0 && (
        <div className="acc-card">
          <div className="acc-card-head">
            <h2 className="acc-card-title">Transaction history</h2>
            <span style={{ fontSize: "0.75rem", color: "#5f6f86" }}>Last 50 entries</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#fafbfd", borderBottom: "1px solid #edf2f7" }}>
                  <th style={{ padding: "0.65rem 1.25rem", textAlign: "left", fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "#5f6f86" }}>Date</th>
                  <th style={{ padding: "0.65rem 1.25rem", textAlign: "left", fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "#5f6f86" }}>Action</th>
                  <th style={{ padding: "0.65rem 1.25rem", textAlign: "right", fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "#5f6f86" }}>Amount</th>
                  <th style={{ padding: "0.65rem 1.25rem", textAlign: "right", fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "#5f6f86" }}>Balance after</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map(row => {
                  const isCredit = row.amount > 0;
                  return (
                    <tr key={row.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "0.7rem 1.25rem", fontSize: "0.78rem", color: "#5f6f86", whiteSpace: "nowrap" }}>{fmtDate(row.created_at)}</td>
                      <td style={{ padding: "0.7rem 1.25rem", fontSize: "0.84rem", fontWeight: 500, color: "#334155" }}>{fmtAction(row.action_type)}</td>
                      <td style={{ padding: "0.7rem 1.25rem", textAlign: "right", fontSize: "0.84rem", fontWeight: 700, color: isCredit ? "#166534" : "#be123c" }}>
                        {isCredit ? "+" : ""}{row.amount.toLocaleString()}
                      </td>
                      <td style={{ padding: "0.7rem 1.25rem", textAlign: "right", fontSize: "0.84rem", color: "#475569" }}>{row.balance_after.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {!loading && !error && ledger.length === 0 && (
        <div className="acc-card">
          <div className="acc-card-body" style={{ textAlign: "center", color: "#5f6f86", fontSize: "0.85rem" }}>
            <p style={{ margin: 0 }}>No AI activity yet. Start using the chatbot, templates, or flows to see token usage here.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function prefetchData() {
  return undefined;
}

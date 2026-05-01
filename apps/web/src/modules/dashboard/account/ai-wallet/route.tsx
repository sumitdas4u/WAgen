import "./../account.css";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  createWorkspaceBillingRechargeOrder,
  fetchAiWallet,
  fetchWorkspaceBillingOverview,
  fetchWorkspaceBillingTransactions,
  type AiLedgerRow,
  type AiUsageByAction,
  type AiUsageByDay,
  type AiWalletStatus
} from "../../../../lib/api";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: (payload: unknown) => void) => void;
    };
  }
}

function fmtInr(paise: number | null): string {
  return ((paise ?? 0) / 100).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  });
}

async function loadRazorpayScript(): Promise<boolean> {
  if (window.Razorpay) return true;
  const existing = document.querySelector<HTMLScriptElement>(
    'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
  );
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

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

const AI_RECHARGE_PACK_PRICES: Record<number, number> = {
  120: 49_900,
  260: 99_900,
  600: 199_900
};
const AI_RECHARGE_PACKS = Object.keys(AI_RECHARGE_PACK_PRICES).map(Number);

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
  recharge_purchase:    "Recharge purchase",
  admin_adjustment:     "Admin adjustment",
  admin_reset:          "Admin reset",
  billing_migration_backfill: "Billing migration backfill",
};

function fmtAction(action: string) {
  return ACTION_LABELS[action] ?? action.replace(/_/g, " ");
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function creditsUsed(row: AiUsageByAction | AiUsageByDay): number {
  return row.credits_used ?? row.tokens_used;
}

function DailyChart({ data }: { data: AiUsageByDay[] }) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map(d => creditsUsed(d)), 1);
  return (
    <div className="acc-card">
      <div className="acc-card-head">
        <h2 className="acc-card-title">Daily AI credit usage</h2>
        <span style={{ fontSize: "0.75rem", color: "#5f6f86" }}>Last 30 days</span>
      </div>
      <div className="acc-card-body" style={{ paddingBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "80px", overflowX: "auto" }}>
          {data.map(d => {
            const used = creditsUsed(d);
            const h = Math.max(4, Math.round((used / max) * 80));
            const label = d.day.slice(5); // MM-DD
            return (
              <div
                key={d.day}
                title={`${d.day}: ${used.toLocaleString()} AI credits (${d.calls} calls)`}
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
          Total: <strong>{data.reduce((s, d) => s + creditsUsed(d), 0).toLocaleString()}</strong> AI credits across <strong>{data.reduce((s, d) => s + d.calls, 0).toLocaleString()}</strong> calls in the last 30 days
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
  const { token, refetchBootstrap } = useDashboardShell();

  const [status, setStatus] = useState<AiWalletStatus | null>(null);
  const [ledger, setLedger] = useState<AiLedgerRow[]>([]);
  const [usageByAction, setUsageByAction] = useState<AiUsageByAction[]>([]);
  const [usageByDay, setUsageByDay] = useState<AiUsageByDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rechargeCredits, setRechargeCredits] = useState("120");
  const [rechargeInfo, setRechargeInfo] = useState<string | null>(null);
  const [rechargeError, setRechargeError] = useState<string | null>(null);

  const loadWallet = () => {
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
  };

  useEffect(() => {
    loadWallet();
  }, [token]);

  const planCode = status?.planCode ?? "trial";
  const pillClass = `acc-plan-pill plan-${planCode}`;

  const breakdown = useMemo(() => {
    const requestedCredits = Math.floor(Number(rechargeCredits) || 0);
    const credits = AI_RECHARGE_PACK_PRICES[requestedCredits] ? requestedCredits : 120;
    const totalPaise = AI_RECHARGE_PACK_PRICES[credits] ?? AI_RECHARGE_PACK_PRICES[120]!;
    const taxablePaise = Math.round(totalPaise / 1.18);
    const gstPaise = totalPaise - taxablePaise;
    return { credits, totalPaise, taxablePaise, gstPaise };
  }, [rechargeCredits]);

  const rechargeMutation = useMutation({
    mutationFn: () =>
      createWorkspaceBillingRechargeOrder(token, { credits: breakdown.credits }),
    onSuccess: async (orderRes) => {
      const baselineBalance = status?.balance ?? 0;
      const loaded = await loadRazorpayScript();
      if (!loaded || !window.Razorpay) {
        setRechargeError("Unable to load Razorpay checkout");
        return;
      }
      const razorpay = new window.Razorpay({
        key: orderRes.order.keyId,
        amount: orderRes.order.amountTotalPaise,
        currency: orderRes.order.currency,
        name: "WagenAI",
        description: `${orderRes.order.credits} AI credits`,
        order_id: orderRes.order.razorpayOrderId,
        handler: () => {
          setRechargeInfo("Payment captured — waiting for confirmation…");
          void (async () => {
            for (let i = 0; i < 12; i++) {
              try {
                const [latestOverview, latestTx] = await Promise.all([
                  fetchWorkspaceBillingOverview(token),
                  fetchWorkspaceBillingTransactions(token, {
                    type: "recharge_order",
                    limit: 10
                  })
                ]);
                const settled = latestTx.items.some(
                  (item) =>
                    item.referenceId === orderRes.order.razorpayOrderId &&
                    (item.status ?? "").toLowerCase() === "paid"
                );
                const latestRemaining =
                  latestOverview.overview.aiCredits?.remaining ?? latestOverview.overview.credits.remaining;
                const increased = latestRemaining > baselineBalance;
                if (settled || increased) {
                  await refetchBootstrap();
                  loadWallet();
                  setRechargeInfo("Recharge successful. Credits updated.");
                  return;
                }
              } catch {
                // keep polling
              }
              await sleep(2500);
            }
            await refetchBootstrap();
            loadWallet();
            setRechargeInfo("Payment captured. Credits will update shortly.");
          })();
        },
        theme: { color: "#111827" }
      });
      razorpay.on("payment.failed", (evt) => {
        const p = evt as { error?: { description?: string } };
        setRechargeError(p.error?.description ?? "Payment failed");
      });
      razorpay.open();
    },
    onError: (e) => setRechargeError((e as Error).message)
  });

  return (
    <div className="acc-page">
      <div className="acc-page-header">
        <h1 className="acc-page-title">AI Credits</h1>
      </div>

      {/* ── Balance card ─────────────────────────────────────────────────── */}
      <div className="acc-card">
        <div className="acc-card-head">
          <div>
            <h2 className="acc-card-title">AI credit balance</h2>
            <p className="acc-card-subtitle">Monthly AI automation credits across all models and channels</p>
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
                  Your AI credit balance is running low. Recharge or consider upgrading your plan.
                </p>
              )}
              {!status.canUseAiGeneration && (
                <p style={{ margin: 0, fontSize: "0.8rem", color: "#be123c", fontWeight: 600 }}>
                  AI generation features are locked. Recharge, upgrade your plan, or wait for the monthly reset.
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

      {/* ── Buy AI credits (recharge) ─────────────────────────────────────── */}
      <div className="acc-card">
        <div className="acc-card-head">
          <div>
            <h2 className="acc-card-title">Buy AI credits</h2>
            <p className="acc-card-subtitle">One-time AI automation top-up via Razorpay</p>
          </div>
        </div>
        <div className="acc-card-body">
          <div className="acc-recharge-presets">
            {AI_RECHARGE_PACKS.map((c) => (
              <button
                key={c}
                type="button"
                className={`acc-preset-btn${rechargeCredits === String(c) ? " is-active" : ""}`}
                onClick={() => setRechargeCredits(String(c))}
              >
                {c.toLocaleString()} AI credits
              </button>
            ))}
          </div>
          <div className="acc-form-row-inline" style={{ alignItems: "flex-end" }}>
            <div className="acc-form-row">
              <label className="acc-label" htmlFor="aiw-amount">AI recharge pack</label>
              <select
                id="aiw-amount"
                className="acc-input"
                value={rechargeCredits}
                onChange={(e) => setRechargeCredits(e.target.value)}
              >
                {AI_RECHARGE_PACKS.map((credits) => (
                  <option key={credits} value={credits}>{credits.toLocaleString()} AI credits</option>
                ))}
              </select>
            </div>
            <div className="acc-recharge-breakdown">
              <span>Taxable: <strong>{fmtInr(breakdown.taxablePaise)}</strong></span>
              <span>GST (18%): <strong>{fmtInr(breakdown.gstPaise)}</strong></span>
              <span className="acc-breakdown-total">Total: <strong>{fmtInr(breakdown.totalPaise)}</strong></span>
            </div>
          </div>
          {rechargeError && <p className="acc-save-error">{rechargeError}</p>}
          {rechargeInfo && <p className="acc-save-success">{rechargeInfo}</p>}
          <div className="acc-form-actions" style={{ borderTop: "none", paddingTop: 0 }}>
            <button
              className="acc-save-btn"
              onClick={() => {
                setRechargeError(null);
                setRechargeInfo(null);
                rechargeMutation.mutate();
              }}
              disabled={rechargeMutation.isPending}
            >
              {rechargeMutation.isPending ? "Opening…" : `Pay ${fmtInr(breakdown.totalPaise)} via Razorpay`}
            </button>
          </div>
        </div>
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
                  <th style={{ padding: "0.65rem 1.25rem", textAlign: "right", fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "#5f6f86" }}>AI credits used</th>
                </tr>
              </thead>
              <tbody>
                {usageByAction.map(row => (
                  <tr key={row.action_type} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "0.7rem 1.25rem", fontSize: "0.84rem", fontWeight: 500, color: "#334155" }}>{fmtAction(row.action_type)}</td>
                    <td style={{ padding: "0.7rem 1.25rem", textAlign: "right", fontSize: "0.84rem", color: "#5f6f86" }}>{row.calls.toLocaleString()}</td>
                    <td style={{ padding: "0.7rem 1.25rem", textAlign: "right", fontSize: "0.84rem", fontWeight: 700, color: "#122033" }}>{creditsUsed(row).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Daily chart ──────────────────────────────────────────────────── */}
      {!loading && <DailyChart data={usageByDay} />}

      {/* ── AI credit ledger ─────────────────────────────────────────────── */}
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
            <p style={{ margin: 0 }}>No AI activity yet. Start using the chatbot, templates, or flows to see AI credit usage here.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function prefetchData() {
  return undefined;
}

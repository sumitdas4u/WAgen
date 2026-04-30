import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createWorkspaceBillingRechargeOrder,
  fetchWorkspaceBillingOverview,
  fetchWorkspaceBillingTransactions,
  fetchWorkspaceBillingUsage,
  type WorkspaceBillingTransaction
} from "../../../../lib/api";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";
import "./../account.css";

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

function fmtDateTime(value: string | null): string {
  if (!value) return "—";
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? new Date(ts).toLocaleString("en-IN") : "—";
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

const TX_TYPE_LABELS: Record<string, string> = {
  all: "All types",
  deduction: "Deduction",
  renewal: "Renewal",
  addon_purchase: "Add-on purchase",
  recharge_order: "Recharge",
  invoice: "Invoice"
};

export function Component() {
  const { token, refetchBootstrap } = useDashboardShell();

  const [rechargeCredits, setRechargeCredits] = useState("120");
  const [rechargeInfo, setRechargeInfo] = useState<string | null>(null);
  const [rechargeError, setRechargeError] = useState<string | null>(null);

  const [txType, setTxType] = useState("all");
  const [txItems, setTxItems] = useState<WorkspaceBillingTransaction[]>([]);
  const [txCursor, setTxCursor] = useState<string | null>(null);
  const [txLoading, setTxLoading] = useState(false);

  const overviewQuery = useQuery({
    queryKey: ["billing-overview", token],
    queryFn: () => fetchWorkspaceBillingOverview(token),
    select: (d) => d.overview
  });

  const usageQuery = useQuery({
    queryKey: ["billing-usage", token],
    queryFn: () => fetchWorkspaceBillingUsage(token, { months: 12 }),
    select: (d) => d.usage
  });

  const loadTransactions = useCallback(
    async (cursor: string | null, reset: boolean) => {
      setTxLoading(true);
      try {
        const res = await fetchWorkspaceBillingTransactions(token, {
          cursor: cursor ?? undefined,
          limit: 20,
          type: txType === "all" ? null : txType
        });
        setTxItems((prev) => (reset ? res.items : [...prev, ...res.items]));
        setTxCursor(res.nextCursor);
      } finally {
        setTxLoading(false);
      }
    },
    [token, txType]
  );

  // Reload when type filter or token changes
  useEffect(() => {
    void loadTransactions(null, true);
  }, [loadTransactions]);

  const overview = overviewQuery.data;
  const usage = usageQuery.data;

  const creditPct = overview
    ? overview.credits.total > 0
      ? Math.round((overview.credits.remaining / overview.credits.total) * 100)
      : 0
    : 0;

  const isLow = creditPct < 20 && creditPct >= 5;
  const isCritical = creditPct < 5;

  const breakdown = useMemo(() => {
    const credits = Math.max(1, Math.floor(Number(rechargeCredits) || 0));
    const totalPaise = Math.max(100, Math.round(credits * 500));
    const taxablePaise = Math.round(totalPaise / 1.18);
    const gstPaise = totalPaise - taxablePaise;
    return { credits, totalPaise, taxablePaise, gstPaise };
  }, [rechargeCredits]);

  const maxUsage = useMemo(
    () => Math.max(1, ...(usage?.points ?? []).map((p) => p.spentCredits)),
    [usage]
  );

  const rechargeMutation = useMutation({
    mutationFn: () =>
      createWorkspaceBillingRechargeOrder(token, { credits: breakdown.credits }),
    onSuccess: async (orderRes) => {
      const baselineRemaining = overview?.credits.remaining ?? 0;
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
                const increased = latestOverview.overview.credits.remaining > baselineRemaining;
                if (settled || increased) {
                  await overviewQuery.refetch();
                  await refetchBootstrap();
                  void loadTransactions(null, true);
                  setRechargeInfo("Recharge successful. Credits updated.");
                  return;
                }
              } catch {
                // keep polling
              }
              await sleep(2500);
            }
            await overviewQuery.refetch();
            await refetchBootstrap();
            void loadTransactions(null, true);
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

      {/* ── Balance overview ───────────────────────────────────────────────── */}
      <div className="acc-card">
        <div className="acc-card-head">
          <div>
            <h2 className="acc-card-title">AI credit balance</h2>
            <p className="acc-card-subtitle">AI automation credits for this billing period</p>
          </div>
          {isCritical && (
            <span className="acc-plan-pill" style={{ background: "#ffe4e6", border: "1px solid #fecdd3", color: "#be123c" }}>
              Critical
            </span>
          )}
          {isLow && !isCritical && (
            <span className="acc-plan-pill" style={{ background: "#fef3c7", border: "1px solid #fde68a", color: "#92400e" }}>
              Low
            </span>
          )}
        </div>
        {overview ? (
          <>
            {isCritical || isLow ? (
              <div className="acc-warning-banner" style={{ margin: "0 1.25rem" }}>
                Only {overview.credits.remaining.toLocaleString()} credits remaining.{" "}
                {isCritical ? "Recharge now to avoid disruption." : "Consider topping up soon."}
              </div>
            ) : null}
            <div className="acc-card-body" style={{ paddingTop: "1rem" }}>
              <div className="acc-credit-meter">
                <div className="acc-credit-bar-wrap">
                  <div
                    className={`acc-credit-bar-fill${isCritical ? " is-critical" : isLow ? " is-low" : ""}`}
                    style={{ width: `${creditPct}%` }}
                  />
                </div>
                <div className="acc-credit-labels">
                  <span>{overview.credits.remaining.toLocaleString()} remaining</span>
                  <span>{creditPct}%</span>
                  <span>{overview.credits.total.toLocaleString()} total</span>
                </div>
              </div>
            </div>
            <div className="acc-stats-row">
              <div className="acc-stat-cell">
                <p className="acc-stat-label">Total (period)</p>
                <p className="acc-stat-value">{overview.credits.total.toLocaleString()}</p>
              </div>
              <div className="acc-stat-cell">
                <p className="acc-stat-label">Used</p>
                <p className="acc-stat-value">{overview.credits.used.toLocaleString()}</p>
              </div>
              <div className="acc-stat-cell">
                <p className="acc-stat-label">Remaining</p>
                <p className="acc-stat-value">{overview.credits.remaining.toLocaleString()}</p>
              </div>
              <div className="acc-stat-cell">
                <p className="acc-stat-label">Auto-recharge</p>
                <p className="acc-stat-value" style={{ fontSize: "0.85rem" }}>
                  <span className={`acc-status-dot ${overview.autoRecharge.enabled ? "acc-status-dot--on" : "acc-status-dot--off"}`}>
                    {overview.autoRecharge.enabled ? "On" : "Off"}
                  </span>
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="acc-card-body">
            <p style={{ color: "#5f6f86", fontSize: "0.83rem" }}>Loading…</p>
          </div>
        )}
      </div>

      {/* ── Recharge ───────────────────────────────────────────────────────── */}
      <div className="acc-card">
        <div className="acc-card-head">
          <div>
            <h2 className="acc-card-title">Buy AI credits</h2>
            <p className="acc-card-subtitle">One-time AI automation top-up via Razorpay</p>
          </div>
        </div>
        <div className="acc-card-body">
          <div className="acc-recharge-presets">
            {[120, 260, 600].map((c) => (
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
              <label className="acc-label" htmlFor="crd-amount">AI credits</label>
              <input
                id="crd-amount"
                className="acc-input"
                type="number"
                min={1}
                value={rechargeCredits}
                onChange={(e) => setRechargeCredits(e.target.value)}
              />
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

      {/* ── Usage history ─────────────────────────────────────────────────── */}
      <div className="acc-card">
        <div className="acc-card-head">
          <div>
            <h2 className="acc-card-title">Usage history</h2>
            <p className="acc-card-subtitle">
              Credits spent over the last 12 months
              {usage ? ` · ${usage.totals.spentCredits.toLocaleString()} total` : ""}
            </p>
          </div>
        </div>
        <div className="acc-card-body">
          {usageQuery.isLoading ? (
            <p style={{ color: "#5f6f86", fontSize: "0.83rem" }}>Loading…</p>
          ) : (
            <div className="acc-usage-bars">
              {(usage?.points ?? []).map((point) => (
                <div key={point.month} className="acc-usage-bar-row">
                  <span className="acc-usage-month">{point.month}</span>
                  <div className="acc-usage-track">
                    <div
                      className="acc-usage-fill"
                      style={{ width: `${Math.round((point.spentCredits / maxUsage) * 100)}%` }}
                    />
                  </div>
                  <span className="acc-usage-value">{point.spentCredits.toLocaleString()}</span>
                </div>
              ))}
              {(usage?.points ?? []).length === 0 && (
                <p style={{ color: "#5f6f86", fontSize: "0.83rem" }}>No usage data yet</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Transactions ──────────────────────────────────────────────────── */}
      <div className="acc-table-card">
        <div className="acc-toolbar">
          <div>
            <p className="acc-card-title">Transactions</p>
            <p className="acc-card-subtitle" style={{ marginTop: "0.15rem" }}>Credit additions and deductions</p>
          </div>
          <select
            className="acc-select"
            style={{ width: "auto", height: "2.2rem" }}
            value={txType}
            onChange={(e) => setTxType(e.target.value)}
          >
            {Object.entries(TX_TYPE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>
        <table className="acc-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Credits</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            {txLoading && txItems.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "#5f6f86" }}>Loading…</td></tr>
            ) : txItems.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "#5f6f86" }}>No transactions found</td></tr>
            ) : (
              txItems.map((tx) => (
                <tr key={`${tx.source}-${tx.itemId}`}>
                  <td>{fmtDateTime(tx.createdAt)}</td>
                  <td style={{ textTransform: "capitalize" }}>{tx.type.replace(/_/g, " ")}</td>
                  <td>
                    <span style={{ color: tx.credits < 0 ? "#be123c" : "#166534", fontWeight: 700 }}>
                      {tx.credits > 0 ? "+" : ""}{tx.credits.toLocaleString()}
                    </span>
                  </td>
                  <td>{tx.amountPaise === null ? "—" : fmtInr(tx.amountPaise)}</td>
                  <td>
                    {tx.status ? (
                      <span className={`acc-plan-pill ${tx.status === "paid" || tx.status === "success" ? "plan-business" : tx.status === "pending" ? "plan-starter" : "plan-trial"}`}>
                        {tx.status}
                      </span>
                    ) : "—"}
                  </td>
                  <td style={{ fontSize: "0.75rem", color: "#5f6f86", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {tx.referenceId ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {txCursor && (
          <div style={{ padding: "0.75rem 1.25rem", borderTop: "1px solid #edf2f7" }}>
            <button
              className="acc-secondary-btn"
              onClick={() => void loadTransactions(txCursor, false)}
              disabled={txLoading}
              style={{ width: "100%" }}
            >
              {txLoading ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function prefetchData() {
  return undefined;
}

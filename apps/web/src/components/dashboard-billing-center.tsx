import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createWorkspaceBillingRechargeOrder,
  disableWorkspaceAutoRecharge,
  downloadWorkspaceBillingInvoice,
  fetchWorkspaceAutoRechargeSettings,
  fetchWorkspaceBillingInvoices,
  fetchWorkspaceBillingOverview,
  fetchWorkspaceBillingProfile,
  fetchWorkspaceBillingRenewals,
  fetchWorkspaceBillingTransactions,
  fetchWorkspaceBillingUsage,
  upsertWorkspaceAutoRechargeSettings,
  updateWorkspaceBillingProfile,
  type WorkspaceAutoRechargeSettings,
  type WorkspaceBillingInvoice,
  type WorkspaceBillingOverview,
  type WorkspaceBillingProfile,
  type WorkspaceBillingTransaction,
  type WorkspaceBillingUsageSeries,
  type WorkspaceRenewalHistoryItem
} from "../lib/api";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: (payload: unknown) => void) => void;
    };
  }
}

type BillingSubTab = "usage" | "transactions" | "billing";

interface DashboardBillingCenterProps {
  token: string;
  onCreditsRefresh?: () => Promise<void> | void;
}

function formatInrFromPaise(value: number | null): string {
  const paise = value ?? 0;
  return (paise / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) {
    return "-";
  }
  return new Date(ts).toLocaleString("en-IN");
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

export function DashboardBillingCenter({ token, onCreditsRefresh }: DashboardBillingCenterProps) {
  const navigate = useNavigate();
  const [subTab, setSubTab] = useState<BillingSubTab>("usage");
  const [overview, setOverview] = useState<WorkspaceBillingOverview | null>(null);
  const [usage, setUsage] = useState<WorkspaceBillingUsageSeries | null>(null);
  const [transactions, setTransactions] = useState<WorkspaceBillingTransaction[]>([]);
  const [transactionsCursor, setTransactionsCursor] = useState<string | null>(null);
  const [transactionsType, setTransactionsType] = useState<string>("all");
  const [renewals, setRenewals] = useState<WorkspaceRenewalHistoryItem[]>([]);
  const [invoices, setInvoices] = useState<WorkspaceBillingInvoice[]>([]);
  const [profile, setProfile] = useState<WorkspaceBillingProfile | null>(null);
  const [autoSettings, setAutoSettings] = useState<WorkspaceAutoRechargeSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingAuto, setSavingAuto] = useState(false);
  const [rechargeLoading, setRechargeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [rechargeCredits, setRechargeCredits] = useState<string>("1000");

  const [profileDraft, setProfileDraft] = useState({
    legalName: "",
    gstin: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    pincode: "",
    country: "IN",
    billingEmail: "",
    billingPhone: ""
  });
  const [autoDraft, setAutoDraft] = useState({
    enabled: false,
    thresholdCredits: "50",
    rechargeCredits: "1000",
    maxRechargesPerDay: "1",
    gatewayCustomerId: "",
    gatewayTokenId: ""
  });

  const loadTransactions = useCallback(
    async (cursor?: string | null, reset = false) => {
      setTxLoading(true);
      try {
        const response = await fetchWorkspaceBillingTransactions(token, {
          cursor: cursor ?? undefined,
          limit: 20,
          type: transactionsType === "all" ? null : transactionsType
        });
        setTransactions((current) => (reset ? response.items : [...current, ...response.items]));
        setTransactionsCursor(response.nextCursor);
      } finally {
        setTxLoading(false);
      }
    },
    [token, transactionsType]
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewRes, usageRes, profileRes, renewalsRes, autoRes, invoicesRes] = await Promise.all([
        fetchWorkspaceBillingOverview(token),
        fetchWorkspaceBillingUsage(token, { months: 12 }),
        fetchWorkspaceBillingProfile(token),
        fetchWorkspaceBillingRenewals(token, { limit: 20 }),
        fetchWorkspaceAutoRechargeSettings(token),
        fetchWorkspaceBillingInvoices(token, { limit: 20 })
      ]);
      setOverview(overviewRes.overview);
      setUsage(usageRes.usage);
      setProfile(profileRes.profile);
      setRenewals(renewalsRes.renewals);
      setAutoSettings(autoRes.settings);
      setInvoices(invoicesRes.invoices);
      setProfileDraft({
        legalName: profileRes.profile.legalName ?? "",
        gstin: profileRes.profile.gstin ?? "",
        addressLine1: profileRes.profile.addressLine1 ?? "",
        addressLine2: profileRes.profile.addressLine2 ?? "",
        city: profileRes.profile.city ?? "",
        state: profileRes.profile.state ?? "",
        pincode: profileRes.profile.pincode ?? "",
        country: profileRes.profile.country ?? "IN",
        billingEmail: profileRes.profile.billingEmail ?? "",
        billingPhone: profileRes.profile.billingPhone ?? ""
      });
      setAutoDraft({
        enabled: autoRes.settings.enabled,
        thresholdCredits: String(autoRes.settings.thresholdCredits),
        rechargeCredits: String(autoRes.settings.rechargeCredits),
        maxRechargesPerDay: String(autoRes.settings.maxRechargesPerDay),
        gatewayCustomerId: autoRes.settings.gatewayCustomerId ?? "",
        gatewayTokenId: autoRes.settings.gatewayTokenId ?? ""
      });
      await loadTransactions(null, true);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }, [loadTransactions, token]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    void loadTransactions(null, true);
  }, [loadTransactions, transactionsType]);

  const lowCreditWarning = useMemo(() => {
    const total = overview?.credits.total ?? 0;
    const remaining = overview?.credits.remaining ?? 0;
    if (total <= 0) {
      return null;
    }
    const percent = (remaining / total) * 100;
    if (percent >= 10) {
      return null;
    }
    return `Only ${remaining} credits left this month. Upgrade plan or buy add-on credits.`;
  }, [overview]);

  const rechargeBreakdown = useMemo(() => {
    const credits = Math.max(1, Math.floor(Number(rechargeCredits) || 0));
    const unitPaise = 49.9;
    const totalPaise = Math.max(100, Math.round(credits * unitPaise));
    const taxablePaise = Math.round(totalPaise / 1.18);
    const gstPaise = totalPaise - taxablePaise;
    return { credits, totalPaise, taxablePaise, gstPaise };
  }, [rechargeCredits]);

  const handleRecharge = async () => {
    setRechargeLoading(true);
    setError(null);
    setInfo(null);
    try {
      const orderResponse = await createWorkspaceBillingRechargeOrder(token, { credits: rechargeBreakdown.credits });
      const loaded = await loadRazorpayScript();
      if (!loaded || !window.Razorpay) {
        throw new Error("Unable to load Razorpay checkout");
      }
      const razorpay = new window.Razorpay({
        key: orderResponse.order.keyId,
        amount: orderResponse.order.amountTotalPaise,
        currency: orderResponse.order.currency,
        name: "WagenAI",
        description: `${orderResponse.order.credits} conversation credits recharge`,
        order_id: orderResponse.order.razorpayOrderId,
        handler: () => {
          setInfo("Payment captured. Refreshing billing data...");
          void loadAll();
          void onCreditsRefresh?.();
        },
        theme: { color: "#111827" }
      });
      razorpay.on("payment.failed", (eventPayload) => {
        const payload = eventPayload as { error?: { description?: string } };
        setError(payload.error?.description ?? "Payment failed");
      });
      razorpay.open();
    } catch (rechargeError) {
      setError((rechargeError as Error).message);
    } finally {
      setRechargeLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    setError(null);
    setInfo(null);
    try {
      const response = await updateWorkspaceBillingProfile(token, {
        legalName: profileDraft.legalName || null,
        gstin: profileDraft.gstin || null,
        addressLine1: profileDraft.addressLine1 || null,
        addressLine2: profileDraft.addressLine2 || null,
        city: profileDraft.city || null,
        state: profileDraft.state || null,
        pincode: profileDraft.pincode || null,
        country: profileDraft.country || null,
        billingEmail: profileDraft.billingEmail || null,
        billingPhone: profileDraft.billingPhone || null
      });
      setProfile(response.profile);
      setInfo("Billing profile saved.");
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveAutoRecharge = async () => {
    setSavingAuto(true);
    setError(null);
    setInfo(null);
    try {
      const response = await upsertWorkspaceAutoRechargeSettings(token, {
        enabled: autoDraft.enabled,
        thresholdCredits: Math.max(0, Math.floor(Number(autoDraft.thresholdCredits) || 0)),
        rechargeCredits: Math.max(1, Math.floor(Number(autoDraft.rechargeCredits) || 1)),
        maxRechargesPerDay: Math.max(1, Math.floor(Number(autoDraft.maxRechargesPerDay) || 1)),
        gatewayCustomerId: autoDraft.gatewayCustomerId || null,
        gatewayTokenId: autoDraft.gatewayTokenId || null
      });
      setAutoSettings(response.settings);
      setInfo("Auto-recharge settings saved.");
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSavingAuto(false);
    }
  };

  const handleDisableAutoRecharge = async () => {
    setSavingAuto(true);
    setError(null);
    setInfo(null);
    try {
      const response = await disableWorkspaceAutoRecharge(token);
      setAutoSettings(response.settings);
      setAutoDraft((current) => ({ ...current, enabled: false }));
      setInfo("Auto-recharge disabled.");
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSavingAuto(false);
    }
  };

  const handleDownloadInvoice = async (invoiceId: string) => {
    setError(null);
    try {
      const { blob, filename } = await downloadWorkspaceBillingInvoice(token, invoiceId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError((downloadError as Error).message);
    }
  };

  return (
    <section className="billing-center-shell">
      <article className="billing-center-summary">
        <div>
          <p className="billing-kicker">Credit Balance</p>
          <h2>{overview ? `${overview.credits.remaining} / ${overview.credits.total}` : "-- / --"}</h2>
          <p className="tiny-note">
            Plan: {overview?.plan.name ?? "-"} | Next renewal: {formatDateTime(overview?.subscription.nextBillingDate ?? null)}
          </p>
        </div>
        <div className="billing-auto-actions">
          <button className="primary-btn" type="button" onClick={handleRecharge} disabled={rechargeLoading}>
            {rechargeLoading ? "Opening..." : "Recharge Now"}
          </button>
          <button className="ghost-btn" type="button" onClick={() => navigate("/purchase")}>
            Renew / Change Plan
          </button>
        </div>
      </article>

      {lowCreditWarning ? <div className="credits-warning-banner">{lowCreditWarning}</div> : null}

      <article className="billing-recharge-card">
        <div className="billing-recharge-header">
          <strong>Choose Recharge Amount</strong>
          <div className="billing-recharge-presets">
            {[1000, 5000, 10000].map((credits) => (
              <button key={credits} type="button" onClick={() => setRechargeCredits(String(credits))}>
                {credits.toLocaleString()} credits
              </button>
            ))}
          </div>
        </div>
        <div className="billing-recharge-row">
          <label>
            Credits
            <input
              type="number"
              min={1}
              value={rechargeCredits}
              onChange={(event) => setRechargeCredits(event.target.value)}
            />
          </label>
          <div className="billing-recharge-meta">
            <small>Taxable: {formatInrFromPaise(rechargeBreakdown.taxablePaise)}</small>
            <small>GST: {formatInrFromPaise(rechargeBreakdown.gstPaise)}</small>
            <strong>Total: {formatInrFromPaise(rechargeBreakdown.totalPaise)}</strong>
          </div>
        </div>
      </article>

      <nav className="billing-subtabs">
        <button className={subTab === "usage" ? "active" : ""} type="button" onClick={() => setSubTab("usage")}>
          Credit Usage
        </button>
        <button
          className={subTab === "transactions" ? "active" : ""}
          type="button"
          onClick={() => setSubTab("transactions")}
        >
          Transactions
        </button>
        <button className={subTab === "billing" ? "active" : ""} type="button" onClick={() => setSubTab("billing")}>
          Billing
        </button>
      </nav>

      {subTab === "usage" ? (
        <article className="finance-panel">
          <h3>Total credits spent: {usage?.totals.spentCredits ?? 0}</h3>
          <div className="billing-usage-bars">
            {(usage?.points ?? []).map((point) => (
              <div key={point.month} className="billing-usage-bar-row">
                <span>{point.month}</span>
                <div className="billing-usage-bar-track">
                  <div
                    className="billing-usage-bar-fill"
                    style={{
                      width: `${Math.min(
                        100,
                        ((point.spentCredits || 0) / Math.max(1, usage?.totals.spentCredits || 1)) * 100
                      )}%`
                    }}
                  />
                </div>
                <strong>{point.spentCredits}</strong>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {subTab === "transactions" ? (
        <article className="finance-panel">
          <div className="billing-transactions-head">
            <h3>Transactions</h3>
            <select value={transactionsType} onChange={(event) => setTransactionsType(event.target.value)}>
              <option value="all">All</option>
              <option value="deduction">Deduction</option>
              <option value="renewal">Renewal</option>
              <option value="addon_purchase">Add-on</option>
              <option value="recharge_order">Recharge orders</option>
              <option value="invoice">Invoices</option>
            </select>
          </div>
          <div className="finance-table-wrap">
            <table className="finance-table">
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
                {transactions.map((transaction) => (
                  <tr key={`${transaction.source}-${transaction.itemId}`}>
                    <td>{formatDateTime(transaction.createdAt)}</td>
                    <td>{transaction.type}</td>
                    <td>{transaction.credits}</td>
                    <td>{transaction.amountPaise === null ? "-" : formatInrFromPaise(transaction.amountPaise)}</td>
                    <td>{transaction.status ?? "-"}</td>
                    <td>{transaction.referenceId ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {transactionsCursor ? (
            <button className="ghost-btn" type="button" onClick={() => void loadTransactions(transactionsCursor)} disabled={txLoading}>
              {txLoading ? "Loading..." : "Load More"}
            </button>
          ) : null}
        </article>
      ) : null}

      {subTab === "billing" ? (
        <section className="billing-columns">
          <article className="finance-panel">
            <h3>Billing Profile</h3>
            <div className="billing-form-grid">
              <label>Legal Name<input value={profileDraft.legalName} onChange={(event) => setProfileDraft((current) => ({ ...current, legalName: event.target.value }))} /></label>
              <label>GSTIN<input value={profileDraft.gstin} onChange={(event) => setProfileDraft((current) => ({ ...current, gstin: event.target.value.toUpperCase() }))} /></label>
              <label>Address 1<input value={profileDraft.addressLine1} onChange={(event) => setProfileDraft((current) => ({ ...current, addressLine1: event.target.value }))} /></label>
              <label>Address 2<input value={profileDraft.addressLine2} onChange={(event) => setProfileDraft((current) => ({ ...current, addressLine2: event.target.value }))} /></label>
              <label>City<input value={profileDraft.city} onChange={(event) => setProfileDraft((current) => ({ ...current, city: event.target.value }))} /></label>
              <label>State<input value={profileDraft.state} onChange={(event) => setProfileDraft((current) => ({ ...current, state: event.target.value }))} /></label>
              <label>Pincode<input value={profileDraft.pincode} onChange={(event) => setProfileDraft((current) => ({ ...current, pincode: event.target.value }))} /></label>
              <label>Country<input value={profileDraft.country} onChange={(event) => setProfileDraft((current) => ({ ...current, country: event.target.value.toUpperCase() }))} /></label>
              <label>Email<input value={profileDraft.billingEmail} onChange={(event) => setProfileDraft((current) => ({ ...current, billingEmail: event.target.value }))} /></label>
              <label>Phone<input value={profileDraft.billingPhone} onChange={(event) => setProfileDraft((current) => ({ ...current, billingPhone: event.target.value }))} /></label>
            </div>
            <button className="primary-btn" type="button" onClick={handleSaveProfile} disabled={savingProfile}>
              {savingProfile ? "Saving..." : "Save Billing Profile"}
            </button>
          </article>

          <article className="finance-panel">
            <h3>Auto Recharge</h3>
            <div className="billing-form-grid">
              <label>
                <input
                  type="checkbox"
                  checked={autoDraft.enabled}
                  onChange={(event) => setAutoDraft((current) => ({ ...current, enabled: event.target.checked }))}
                />
                Enable Auto-Recharge
              </label>
              <label>Threshold Credits<input type="number" value={autoDraft.thresholdCredits} onChange={(event) => setAutoDraft((current) => ({ ...current, thresholdCredits: event.target.value }))} /></label>
              <label>Recharge Credits<input type="number" value={autoDraft.rechargeCredits} onChange={(event) => setAutoDraft((current) => ({ ...current, rechargeCredits: event.target.value }))} /></label>
              <label>Max per Day<input type="number" value={autoDraft.maxRechargesPerDay} onChange={(event) => setAutoDraft((current) => ({ ...current, maxRechargesPerDay: event.target.value }))} /></label>
              <label>Gateway Customer ID<input value={autoDraft.gatewayCustomerId} onChange={(event) => setAutoDraft((current) => ({ ...current, gatewayCustomerId: event.target.value }))} /></label>
              <label>Gateway Token ID<input value={autoDraft.gatewayTokenId} onChange={(event) => setAutoDraft((current) => ({ ...current, gatewayTokenId: event.target.value }))} /></label>
            </div>
            <div className="billing-auto-actions">
              <button className="primary-btn" type="button" onClick={handleSaveAutoRecharge} disabled={savingAuto}>
                {savingAuto ? "Saving..." : "Save Auto-Recharge"}
              </button>
              <button className="ghost-btn" type="button" onClick={handleDisableAutoRecharge} disabled={savingAuto}>
                Disable
              </button>
            </div>
            <small className="tiny-note">
              Status: {autoSettings?.lastStatus ?? "-"} | Failures: {autoSettings?.failureCount ?? 0}
            </small>
          </article>

          <article className="finance-panel">
            <h3>Renewal History</h3>
            <div className="finance-table-wrap">
              <table className="finance-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Plan</th>
                    <th>Credits Reset</th>
                    <th>Payment</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {renewals.map((renewal) => (
                    <tr key={renewal.renewalId}>
                      <td>{formatDateTime(renewal.renewedAt)}</td>
                      <td>{renewal.planName ?? renewal.planCode ?? "-"}</td>
                      <td>{renewal.creditsReset}</td>
                      <td>{renewal.payment.amountPaise === null ? "-" : formatInrFromPaise(renewal.payment.amountPaise)}</td>
                      <td>{renewal.payment.status ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="finance-panel">
            <h3>Invoices</h3>
            <div className="finance-table-wrap">
              <table className="finance-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Total</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>{invoice.invoiceNumber}</td>
                      <td>{formatDateTime(invoice.createdAt)}</td>
                      <td>{invoice.invoiceType}</td>
                      <td>{formatInrFromPaise(invoice.totalPaise)}</td>
                      <td>
                        <button className="ghost-btn" type="button" onClick={() => void handleDownloadInvoice(invoice.id)}>
                          Download
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      ) : null}

      {loading ? <p className="tiny-note">Loading billing data...</p> : null}
      {info ? <p className="info-text">{info}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}

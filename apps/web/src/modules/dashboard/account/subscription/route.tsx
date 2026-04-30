import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  disableWorkspaceAutoRecharge,
  downloadWorkspaceBillingInvoice,
  fetchWorkspaceAutoRechargeSettings,
  fetchWorkspaceBillingInvoices,
  fetchWorkspaceBillingOverview,
  fetchWorkspaceBillingProfile,
  fetchWorkspaceBillingRenewals,
  updateWorkspaceBillingProfile,
  upsertWorkspaceAutoRechargeSettings,
  type WorkspaceAutoRechargeSettings,
  type WorkspaceBillingInvoice,
  type WorkspaceBillingProfile
} from "../../../../lib/api";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";
import "./../account.css";

const PLAN_LABELS: Record<string, string> = {
  trial: "Trial",
  starter: "Starter",
  pro: "Pro",
  business: "Business"
};

function fmtInr(paise: number | null): string {
  return ((paise ?? 0) / 100).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  });
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? new Date(ts).toLocaleDateString("en-IN") : "—";
}

function ProfileForm({
  initial,
  token,
  onSaved
}: {
  initial: WorkspaceBillingProfile;
  token: string;
  onSaved: (p: WorkspaceBillingProfile) => void;
}) {
  const [draft, setDraft] = useState({
    legalName: initial.legalName ?? "",
    gstin: initial.gstin ?? "",
    addressLine1: initial.addressLine1 ?? "",
    addressLine2: initial.addressLine2 ?? "",
    city: initial.city ?? "",
    state: initial.state ?? "",
    pincode: initial.pincode ?? "",
    country: initial.country ?? "IN",
    billingEmail: initial.billingEmail ?? "",
    billingPhone: initial.billingPhone ?? ""
  });
  const [savedOk, setSavedOk] = useState(false);

  const set = (key: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));

  const mutation = useMutation({
    mutationFn: () =>
      updateWorkspaceBillingProfile(token, {
        legalName: draft.legalName || null,
        gstin: draft.gstin || null,
        addressLine1: draft.addressLine1 || null,
        addressLine2: draft.addressLine2 || null,
        city: draft.city || null,
        state: draft.state || null,
        pincode: draft.pincode || null,
        country: draft.country || null,
        billingEmail: draft.billingEmail || null,
        billingPhone: draft.billingPhone || null
      }),
    onSuccess: (res) => {
      onSaved(res.profile);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    }
  });

  return (
    <>
      <div className="acc-form-row-inline">
        <div className="acc-form-row">
          <label className="acc-label" htmlFor="sub-legal-name">Legal name</label>
          <input id="sub-legal-name" className="acc-input" value={draft.legalName} onChange={set("legalName")} placeholder="Acme Pvt. Ltd." />
        </div>
        <div className="acc-form-row">
          <label className="acc-label" htmlFor="sub-gstin">GSTIN</label>
          <input id="sub-gstin" className="acc-input" value={draft.gstin} onChange={(e) => setDraft((d) => ({ ...d, gstin: e.target.value.toUpperCase() }))} placeholder="22AAAAA0000A1Z5" />
        </div>
      </div>
      <div className="acc-form-row-inline">
        <div className="acc-form-row">
          <label className="acc-label" htmlFor="sub-addr1">Address line 1</label>
          <input id="sub-addr1" className="acc-input" value={draft.addressLine1} onChange={set("addressLine1")} placeholder="Street / building" />
        </div>
        <div className="acc-form-row">
          <label className="acc-label" htmlFor="sub-addr2">Address line 2</label>
          <input id="sub-addr2" className="acc-input" value={draft.addressLine2} onChange={set("addressLine2")} placeholder="Area / locality" />
        </div>
      </div>
      <div className="acc-form-row-inline">
        <div className="acc-form-row">
          <label className="acc-label" htmlFor="sub-city">City</label>
          <input id="sub-city" className="acc-input" value={draft.city} onChange={set("city")} placeholder="Mumbai" />
        </div>
        <div className="acc-form-row">
          <label className="acc-label" htmlFor="sub-state">State</label>
          <input id="sub-state" className="acc-input" value={draft.state} onChange={set("state")} placeholder="Maharashtra" />
        </div>
      </div>
      <div className="acc-form-row-inline">
        <div className="acc-form-row">
          <label className="acc-label" htmlFor="sub-pincode">Pincode</label>
          <input id="sub-pincode" className="acc-input" value={draft.pincode} onChange={set("pincode")} placeholder="400001" />
        </div>
        <div className="acc-form-row">
          <label className="acc-label" htmlFor="sub-country">Country code</label>
          <input id="sub-country" className="acc-input" value={draft.country} onChange={(e) => setDraft((d) => ({ ...d, country: e.target.value.toUpperCase() }))} placeholder="IN" maxLength={2} />
        </div>
      </div>
      <div className="acc-form-row-inline">
        <div className="acc-form-row">
          <label className="acc-label" htmlFor="sub-bemail">Billing email</label>
          <input id="sub-bemail" className="acc-input" type="email" value={draft.billingEmail} onChange={set("billingEmail")} placeholder="billing@yourcompany.com" />
        </div>
        <div className="acc-form-row">
          <label className="acc-label" htmlFor="sub-bphone">Billing phone</label>
          <input id="sub-bphone" className="acc-input" type="tel" value={draft.billingPhone} onChange={set("billingPhone")} placeholder="+91 98765 43210" />
        </div>
      </div>
      <div className="acc-form-actions" style={{ borderTop: "none", paddingTop: 0 }}>
        {mutation.isError && (
          <span className="acc-save-error">
            {mutation.error instanceof Error ? mutation.error.message : "Save failed"}
          </span>
        )}
        {savedOk && <span className="acc-save-success">Profile saved</span>}
        <button className="acc-save-btn" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save billing profile"}
        </button>
      </div>
    </>
  );
}

function AutoRechargeForm({
  initial,
  token,
  onSaved
}: {
  initial: WorkspaceAutoRechargeSettings;
  token: string;
  onSaved: (s: WorkspaceAutoRechargeSettings) => void;
}) {
  const [draft, setDraft] = useState({
    enabled: initial.enabled,
    thresholdCredits: String(initial.thresholdCredits),
    rechargeCredits: String(initial.rechargeCredits),
    maxRechargesPerDay: String(initial.maxRechargesPerDay),
    gatewayCustomerId: initial.gatewayCustomerId ?? "",
    gatewayTokenId: initial.gatewayTokenId ?? ""
  });
  const [savedOk, setSavedOk] = useState(false);

  const saveMutation = useMutation({
    mutationFn: () =>
      upsertWorkspaceAutoRechargeSettings(token, {
        enabled: draft.enabled,
        thresholdCredits: Math.max(0, Math.floor(Number(draft.thresholdCredits) || 0)),
        rechargeCredits: Math.max(1, Math.floor(Number(draft.rechargeCredits) || 1)),
        maxRechargesPerDay: Math.max(1, Math.floor(Number(draft.maxRechargesPerDay) || 1)),
        gatewayCustomerId: draft.gatewayCustomerId || null,
        gatewayTokenId: draft.gatewayTokenId || null
      }),
    onSuccess: (res) => {
      onSaved(res.settings);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    }
  });

  const disableMutation = useMutation({
    mutationFn: () => disableWorkspaceAutoRecharge(token),
    onSuccess: (res) => {
      onSaved(res.settings);
      setDraft((d) => ({ ...d, enabled: false }));
    }
  });

  const isBusy = saveMutation.isPending || disableMutation.isPending;

  return (
    <>
      <label className="acc-toggle-row">
        <input
          type="checkbox"
          className="acc-toggle-checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
        />
        <span className="acc-toggle-track">
          <span className="acc-toggle-thumb" />
        </span>
        <span className="acc-label" style={{ marginBottom: 0 }}>Enable auto-recharge</span>
      </label>
      {draft.enabled && (
        <div className="acc-form-row-inline">
          <div className="acc-form-row">
            <label className="acc-label" htmlFor="sub-threshold">Trigger threshold (AI credits)</label>
            <input id="sub-threshold" className="acc-input" type="number" min={0} value={draft.thresholdCredits} onChange={(e) => setDraft((d) => ({ ...d, thresholdCredits: e.target.value }))} />
            <span className="acc-input-hint">Auto-recharge fires when balance drops below this</span>
          </div>
          <div className="acc-form-row">
            <label className="acc-label" htmlFor="sub-recharge-credits">AI recharge pack</label>
            <input id="sub-recharge-credits" className="acc-input" type="number" min={1} value={draft.rechargeCredits} onChange={(e) => setDraft((d) => ({ ...d, rechargeCredits: e.target.value }))} />
          </div>
          <div className="acc-form-row">
            <label className="acc-label" htmlFor="sub-max-per-day">Max recharges per day</label>
            <input id="sub-max-per-day" className="acc-input" type="number" min={1} value={draft.maxRechargesPerDay} onChange={(e) => setDraft((d) => ({ ...d, maxRechargesPerDay: e.target.value }))} />
          </div>
          <div className="acc-form-row">
            <label className="acc-label" htmlFor="sub-gw-customer">Gateway customer ID</label>
            <input id="sub-gw-customer" className="acc-input" value={draft.gatewayCustomerId} onChange={(e) => setDraft((d) => ({ ...d, gatewayCustomerId: e.target.value }))} placeholder="cust_..." />
          </div>
          <div className="acc-form-row">
            <label className="acc-label" htmlFor="sub-gw-token">Gateway token ID</label>
            <input id="sub-gw-token" className="acc-input" value={draft.gatewayTokenId} onChange={(e) => setDraft((d) => ({ ...d, gatewayTokenId: e.target.value }))} placeholder="token_..." />
          </div>
        </div>
      )}
      {initial.lastStatus && (
        <p className="acc-auto-status">
          Last status: <strong>{initial.lastStatus}</strong> · Failures: {initial.failureCount}
        </p>
      )}
      <div className="acc-form-actions" style={{ borderTop: "none", paddingTop: 0 }}>
        {(saveMutation.isError || disableMutation.isError) && (
          <span className="acc-save-error">Save failed</span>
        )}
        {savedOk && <span className="acc-save-success">Saved</span>}
        {draft.enabled && (
          <button className="acc-secondary-btn" onClick={() => disableMutation.mutate()} disabled={isBusy}>
            Disable
          </button>
        )}
        <button className="acc-save-btn" onClick={() => saveMutation.mutate()} disabled={isBusy}>
          {saveMutation.isPending ? "Saving…" : "Save auto-recharge"}
        </button>
      </div>
    </>
  );
}

function InvoiceRow({
  invoice,
  token
}: {
  invoice: WorkspaceBillingInvoice;
  token: string;
}) {
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleDownload = async () => {
    setDownloading(true);
    setErr(null);
    try {
      const { blob, filename } = await downloadWorkspaceBillingInvoice(token, invoice.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <tr>
      <td>{invoice.invoiceNumber}</td>
      <td>{fmtDate(invoice.createdAt)}</td>
      <td style={{ textTransform: "capitalize" }}>{invoice.invoiceType}</td>
      <td>{fmtInr(invoice.totalPaise)}</td>
      <td>
        <span className={`acc-plan-pill ${invoice.status === "issued" ? "plan-starter" : "plan-trial"}`}>
          {invoice.status}
        </span>
      </td>
      <td>
        {err ? (
          <span className="acc-save-error">{err}</span>
        ) : (
          <button className="acc-secondary-btn" onClick={handleDownload} disabled={downloading} style={{ height: "1.8rem", fontSize: "0.75rem" }}>
            {downloading ? "…" : "Download"}
          </button>
        )}
      </td>
    </tr>
  );
}

export function Component() {
  const navigate = useNavigate();
  const { token, bootstrap } = useDashboardShell();
  const queryClient = useQueryClient();

  const planCode = bootstrap?.planEntitlements.planCode ?? "trial";

  const overviewQuery = useQuery({
    queryKey: ["billing-overview", token],
    queryFn: () => fetchWorkspaceBillingOverview(token),
    select: (d) => d.overview
  });

  const profileQuery = useQuery({
    queryKey: ["billing-profile", token],
    queryFn: () => fetchWorkspaceBillingProfile(token),
    select: (d) => d.profile
  });

  const renewalsQuery = useQuery({
    queryKey: ["billing-renewals", token],
    queryFn: () => fetchWorkspaceBillingRenewals(token, { limit: 20 }),
    select: (d) => d.renewals
  });

  const autoQuery = useQuery({
    queryKey: ["billing-auto", token],
    queryFn: () => fetchWorkspaceAutoRechargeSettings(token),
    select: (d) => d.settings
  });

  const invoicesQuery = useQuery({
    queryKey: ["billing-invoices", token],
    queryFn: () => fetchWorkspaceBillingInvoices(token, { limit: 20 }),
    select: (d) => d.invoices
  });

  const overview = overviewQuery.data;
  const profile = profileQuery.data;
  const autoSettings = autoQuery.data;

  return (
    <div className="acc-page">
      <div className="acc-page-header">
        <h1 className="acc-page-title">Subscription</h1>
        <div className="acc-header-actions">
          <button className="acc-save-btn" onClick={() => navigate("/purchase")}>
            Change plan
          </button>
        </div>
      </div>

      {/* ── Plan overview ─────────────────────────────────────────────────── */}
      <div className="acc-card">
        <div className="acc-card-head">
          <div>
            <h2 className="acc-card-title">Current plan</h2>
            <p className="acc-card-subtitle">Your active subscription and renewal details</p>
          </div>
          <span className={`acc-plan-pill plan-${planCode}`}>
            {PLAN_LABELS[planCode] ?? planCode}
          </span>
        </div>
        {overview ? (
          <div className="acc-stats-row">
            <div className="acc-stat-cell">
              <p className="acc-stat-label">Plan</p>
              <p className="acc-stat-value" style={{ fontSize: "1rem" }}>{overview.plan.name ?? planCode}</p>
            </div>
            <div className="acc-stat-cell">
              <p className="acc-stat-label">Monthly credits</p>
              <p className="acc-stat-value">{overview.plan.monthlyCredits.toLocaleString()}</p>
            </div>
            <div className="acc-stat-cell">
              <p className="acc-stat-label">Status</p>
              <p className="acc-stat-value" style={{ fontSize: "0.85rem" }}>
                <span className={`acc-plan-pill ${overview.subscription.status === "active" ? "plan-business" : "plan-trial"}`}>
                  {overview.subscription.status ?? "—"}
                </span>
              </p>
            </div>
            <div className="acc-stat-cell">
              <p className="acc-stat-label">Next renewal</p>
              <p className="acc-stat-value" style={{ fontSize: "0.95rem" }}>
                {fmtDate(overview.subscription.nextBillingDate)}
              </p>
            </div>
            <div className="acc-stat-cell">
              <p className="acc-stat-label">Monthly price</p>
              <p className="acc-stat-value" style={{ fontSize: "0.95rem" }}>
                {fmtInr(overview.plan.priceMonthly)}
              </p>
            </div>
          </div>
        ) : overviewQuery.isLoading ? (
          <div className="acc-card-body"><p style={{ color: "#5f6f86", fontSize: "0.83rem" }}>Loading…</p></div>
        ) : null}
      </div>

      {/* ── Billing profile ───────────────────────────────────────────────── */}
      <div className="acc-card">
        <div className="acc-card-head">
          <div>
            <h2 className="acc-card-title">Billing profile</h2>
            <p className="acc-card-subtitle">Used on invoices — GSTIN, legal name, and address</p>
          </div>
        </div>
        <div className="acc-card-body">
          {profile ? (
            <ProfileForm
              key={profile.workspaceId}
              initial={profile}
              token={token}
              onSaved={(p) => queryClient.setQueryData(["billing-profile", token], { profile: p })}
            />
          ) : profileQuery.isLoading ? (
            <p style={{ color: "#5f6f86", fontSize: "0.83rem" }}>Loading…</p>
          ) : null}
        </div>
      </div>

      {/* ── Auto-recharge ─────────────────────────────────────────────────── */}
      <div className="acc-card">
        <div className="acc-card-head">
          <div>
            <h2 className="acc-card-title">Auto-recharge</h2>
            <p className="acc-card-subtitle">Automatically top up credits when balance runs low</p>
          </div>
          {autoSettings && (
            <span className={`acc-plan-pill ${autoSettings.enabled ? "plan-business" : "plan-trial"}`}>
              {autoSettings.enabled ? "Enabled" : "Disabled"}
            </span>
          )}
        </div>
        <div className="acc-card-body">
          {autoSettings ? (
            <AutoRechargeForm
              key={autoSettings.workspaceId}
              initial={autoSettings}
              token={token}
              onSaved={(s) => queryClient.setQueryData(["billing-auto", token], { settings: s })}
            />
          ) : autoQuery.isLoading ? (
            <p style={{ color: "#5f6f86", fontSize: "0.83rem" }}>Loading…</p>
          ) : null}
        </div>
      </div>

      {/* ── Renewal history ───────────────────────────────────────────────── */}
      <div className="acc-table-card">
        <div className="acc-toolbar">
          <div>
            <p className="acc-card-title">Renewal history</p>
            <p className="acc-card-subtitle" style={{ marginTop: "0.15rem" }}>Monthly plan renewals and payments</p>
          </div>
        </div>
        <table className="acc-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Plan</th>
              <th>Credits reset</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {renewalsQuery.isLoading ? (
              <tr><td colSpan={5} style={{ textAlign: "center", color: "#5f6f86" }}>Loading…</td></tr>
            ) : (renewalsQuery.data ?? []).length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: "center", color: "#5f6f86" }}>No renewals yet</td></tr>
            ) : (
              (renewalsQuery.data ?? []).map((r) => (
                <tr key={r.renewalId}>
                  <td>{fmtDate(r.renewedAt)}</td>
                  <td>{r.planName ?? r.planCode ?? "—"}</td>
                  <td>{r.creditsReset.toLocaleString()}</td>
                  <td>{r.payment.amountPaise === null ? "—" : fmtInr(r.payment.amountPaise)}</td>
                  <td>
                    <span className={`acc-plan-pill ${r.payment.status === "paid" ? "plan-business" : "plan-trial"}`}>
                      {r.payment.status ?? "—"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Invoices ──────────────────────────────────────────────────────── */}
      <div className="acc-table-card">
        <div className="acc-toolbar">
          <div>
            <p className="acc-card-title">Invoices</p>
            <p className="acc-card-subtitle" style={{ marginTop: "0.15rem" }}>Tax invoices for subscriptions and recharges</p>
          </div>
        </div>
        <table className="acc-table">
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Date</th>
              <th>Type</th>
              <th>Total</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {invoicesQuery.isLoading ? (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "#5f6f86" }}>Loading…</td></tr>
            ) : (invoicesQuery.data ?? []).length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "#5f6f86" }}>No invoices yet</td></tr>
            ) : (
              (invoicesQuery.data ?? []).map((inv) => (
                <InvoiceRow key={inv.id} invoice={inv} token={token} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function prefetchData() {
  return undefined;
}

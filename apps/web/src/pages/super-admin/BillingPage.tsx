import { useEffect, useState } from "react";
import { fetchAdminSubscriptions, fetchAdminBillingPayments, type AdminSubscriptionSummary, type BillingPaymentEntry } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const STATUS_COLORS: Record<string, string> = {
  active: "#22c55e",
  trial: "#3b82f6",
  past_due: "#ef4444",
  cancelled: "#94a3b8",
  paid: "#22c55e",
  failed: "#ef4444",
  created: "#f59e0b",
  refunded: "#8b5cf6",
};

type Tab = "subscriptions" | "payments";

const fmt = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

export function BillingPage() {
  const { token } = useSuperAdmin();
  const [tab, setTab] = useState<Tab>("subscriptions");
  const [subs, setSubs] = useState<AdminSubscriptionSummary[]>([]);
  const [payments, setPayments] = useState<BillingPaymentEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchAdminSubscriptions(token, { limit: 500 }),
      fetchAdminBillingPayments(token, 500),
    ])
      .then(([sRes, pRes]) => { setSubs(sRes.subscriptions); setPayments(pRes.payments); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [token]);

  const refresh = () => {
    setLoading(true);
    Promise.all([
      fetchAdminSubscriptions(token, { limit: 500 }),
      fetchAdminBillingPayments(token, 500),
    ])
      .then(([sRes, pRes]) => { setSubs(sRes.subscriptions); setPayments(pRes.payments); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  };

  const filteredSubs = subs.filter((s) => {
    if (statusFilter && s.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.userEmail.toLowerCase().includes(q) || s.userName.toLowerCase().includes(q) || s.planCode.toLowerCase().includes(q);
    }
    return true;
  });

  const filteredPayments = payments.filter((p) => {
    if (typeFilter && p.type !== typeFilter) return false;
    if (statusFilter && p.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return p.userEmail.toLowerCase().includes(q) || p.workspaceName.toLowerCase().includes(q);
    }
    return true;
  });

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "subscriptions", label: `Subscriptions (${subs.length})` },
    { key: "payments", label: `Payments (${payments.length})` },
  ];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>Billing & Subscriptions</h1>
        <button className="ghost-btn" onClick={refresh} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", borderBottom: "2px solid #e2e8f0", paddingBottom: "2px" }}>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "6px 16px", border: "none", background: "none", cursor: "pointer",
            fontWeight: tab === t.key ? 700 : 400,
            color: tab === t.key ? "#ef8354" : "#64748b",
            borderBottom: tab === t.key ? "2px solid #ef8354" : "2px solid transparent",
            marginBottom: "-2px", fontSize: "0.88rem",
          }}>{t.label}</button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder={tab === "subscriptions" ? "Search user / plan…" : "Search user / workspace…"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem", width: 240 }}
        />
        {tab === "subscriptions" ? (
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem" }}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="trial">Trial</option>
            <option value="past_due">Past Due</option>
            <option value="cancelled">Cancelled</option>
          </select>
        ) : (
          <>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem" }}>
              <option value="">All types</option>
              <option value="subscription">Subscription</option>
              <option value="recharge">Recharge</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem" }}>
              <option value="">All statuses</option>
              <option value="paid">Paid</option>
              <option value="failed">Failed</option>
              <option value="created">Pending</option>
              <option value="refunded">Refunded</option>
            </select>
          </>
        )}
      </div>

      {/* Subscriptions tab */}
      {tab === "subscriptions" && (
        <section className="finance-panel">
          <div className="finance-table-wrap">
            <table className="finance-table">
              <thead>
                <tr>
                  <th>User</th><th>Email</th><th>Plan</th><th>Status</th>
                  <th>Razorpay ID</th><th>Period End</th><th>Last Payment</th><th>Pay Status</th><th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubs.map((s) => (
                  <tr key={s.id}>
                    <td>{s.userName}</td>
                    <td style={{ fontSize: "0.8rem" }}>{s.userEmail}</td>
                    <td>{s.planCode}</td>
                    <td>
                      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 12, fontSize: "0.75rem", fontWeight: 600, background: `${STATUS_COLORS[s.status] ?? "#ccc"}20`, color: STATUS_COLORS[s.status] ?? "#666" }}>
                        {s.status}
                      </span>
                    </td>
                    <td style={{ fontSize: "0.78rem" }}>{s.razorpaySubscriptionId ?? "-"}</td>
                    <td style={{ fontSize: "0.8rem" }}>{s.currentEndAt ? new Date(s.currentEndAt).toLocaleString() : "-"}</td>
                    <td style={{ fontSize: "0.8rem" }}>{s.lastPayment ? fmt(s.lastPayment.amountPaise) : "-"}</td>
                    <td style={{ fontSize: "0.8rem" }}>{s.lastPayment?.status ?? "-"}</td>
                    <td style={{ fontSize: "0.78rem" }}>{new Date(s.updatedAt).toLocaleString()}</td>
                  </tr>
                ))}
                {filteredSubs.length === 0 && !loading && (
                  <tr><td colSpan={9} style={{ textAlign: "center", color: "#94a3b8", padding: "2rem" }}>No subscriptions found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Payments tab */}
      {tab === "payments" && (
        <section className="finance-panel">
          <div className="finance-table-wrap">
            <table className="finance-table">
              <thead>
                <tr>
                  <th>Type</th><th>Workspace</th><th>Email</th><th>Amount</th>
                  <th>Status</th><th>Method</th><th>Razorpay ID</th><th>Paid At</th><th>Created</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.map((p) => (
                  <tr key={p.id} style={{ background: p.status === "failed" ? "#fff5f5" : undefined }}>
                    <td>
                      <span style={{ padding: "2px 7px", borderRadius: 10, fontSize: "0.72rem", fontWeight: 600, background: p.type === "subscription" ? "#e0f2fe" : "#f0fdf4", color: p.type === "subscription" ? "#0369a1" : "#16a34a" }}>
                        {p.type}
                      </span>
                    </td>
                    <td style={{ fontSize: "0.82rem" }}>{p.workspaceName}</td>
                    <td style={{ fontSize: "0.78rem" }}>{p.userEmail}</td>
                    <td style={{ fontWeight: 600 }}>{fmt(p.amountPaise)}</td>
                    <td>
                      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 12, fontSize: "0.75rem", fontWeight: 600, background: `${STATUS_COLORS[p.status] ?? "#ccc"}20`, color: STATUS_COLORS[p.status] ?? "#666" }}>
                        {p.status}
                      </span>
                    </td>
                    <td style={{ fontSize: "0.78rem" }}>{p.method ?? "-"}</td>
                    <td style={{ fontSize: "0.72rem", color: "#94a3b8", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>{p.razorpayId ?? "-"}</td>
                    <td style={{ fontSize: "0.78rem" }}>{p.paidAt ? new Date(p.paidAt).toLocaleString() : "-"}</td>
                    <td style={{ fontSize: "0.78rem" }}>{new Date(p.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
                {filteredPayments.length === 0 && !loading && (
                  <tr><td colSpan={9} style={{ textAlign: "center", color: "#94a3b8", padding: "2rem" }}>No payments found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}

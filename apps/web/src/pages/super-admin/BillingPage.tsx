import { useEffect, useState } from "react";
import { fetchAdminSubscriptions, type AdminSubscriptionSummary } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const STATUS_COLORS: Record<string, string> = {
  active: "#22c55e",
  trial: "#3b82f6",
  past_due: "#ef4444",
  cancelled: "#94a3b8",
};

export function BillingPage() {
  const { token } = useSuperAdmin();
  const [subs, setSubs] = useState<AdminSubscriptionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    fetchAdminSubscriptions(token, { limit: 500 })
      .then((r) => setSubs(r.subscriptions))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [token]);

  const filtered = subs.filter((s) => {
    if (statusFilter && s.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.userEmail.toLowerCase().includes(q) || s.userName.toLowerCase().includes(q) || s.planCode.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>Billing & Subscriptions</h1>
        <button className="ghost-btn" onClick={() => {
          setLoading(true);
          fetchAdminSubscriptions(token, { limit: 500 }).then((r) => setSubs(r.subscriptions)).catch((e) => setError((e as Error).message)).finally(() => setLoading(false));
        }} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Search user / plan…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem", width: 240 }}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem" }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="trial">Trial</option>
          <option value="past_due">Past Due</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <span style={{ fontSize: "0.82rem", color: "#64748b" }}>{filtered.length} subscription{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      <section className="finance-panel">
        <h2>Subscriptions</h2>
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>User</th><th>Email</th><th>Plan</th><th>Status</th>
                <th>Razorpay ID</th><th>Period End</th><th>Last Payment</th><th>Pay Status</th><th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td>{s.userName}</td>
                  <td style={{ fontSize: "0.8rem" }}>{s.userEmail}</td>
                  <td>{s.planCode}</td>
                  <td>
                    <span style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 12,
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      background: `${STATUS_COLORS[s.status] ?? "#ccc"}20`,
                      color: STATUS_COLORS[s.status] ?? "#666",
                    }}>
                      {s.status}
                    </span>
                  </td>
                  <td style={{ fontSize: "0.78rem" }}>{s.razorpaySubscriptionId ?? "-"}</td>
                  <td style={{ fontSize: "0.8rem" }}>{s.currentEndAt ? new Date(s.currentEndAt).toLocaleString() : "-"}</td>
                  <td style={{ fontSize: "0.8rem" }}>
                    {s.lastPayment ? `₹${(s.lastPayment.amountPaise / 100).toFixed(2)}` : "-"}
                  </td>
                  <td style={{ fontSize: "0.8rem" }}>{s.lastPayment?.status ?? "-"}</td>
                  <td style={{ fontSize: "0.78rem" }}>{new Date(s.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "#94a3b8", padding: "2rem" }}>No subscriptions found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}

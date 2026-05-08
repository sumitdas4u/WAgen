import { useEffect, useState } from "react";
import {
  fetchAdminUsers,
  fetchAdminUserUsage,
  type AdminUserUsage,
  type UsageAnalyticsResponse,
} from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const fmt = (v: number) => `₹${v.toFixed(4)}`;

export function UsersPage() {
  const { token } = useSuperAdmin();
  const [users, setUsers] = useState<AdminUserUsage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [aiFilter, setAiFilter] = useState("");
  const [usageUser, setUsageUser] = useState<AdminUserUsage | null>(null);
  const [usage, setUsage] = useState<UsageAnalyticsResponse["usage"] | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchAdminUsers(token, { limit: 500 })
      .then((r) => setUsers(r.users))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [token]);

  const openUsage = async (user: AdminUserUsage) => {
    setUsageUser(user); setUsage(null); setUsageLoading(true);
    try {
      const r = await fetchAdminUserUsage(token, user.userId, { days: 30, limit: 200 });
      setUsage(r.usage);
    } catch (e) { setError((e as Error).message); } finally { setUsageLoading(false); }
  };

  const plans = [...new Set(users.map((u) => u.plan))].sort();

  const filtered = users.filter((u) => {
    if (planFilter && u.plan !== planFilter) return false;
    if (aiFilter === "on" && !u.aiActive) return false;
    if (aiFilter === "off" && u.aiActive) return false;
    if (search) {
      const q = search.toLowerCase();
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.phone ?? "").includes(q);
    }
    return true;
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>Users</h1>
        <span style={{ fontSize: "0.82rem", color: "#64748b" }}>{filtered.length} of {users.length}</span>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Search name / email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem", width: 260 }}
        />
        <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem" }}>
          <option value="">All plans</option>
          {plans.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={aiFilter} onChange={(e) => setAiFilter(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem" }}>
          <option value="">AI status: all</option>
          <option value="on">AI: On</option>
          <option value="off">AI: Off</option>
        </select>
      </div>

      <section className="finance-panel">
        {loading && <p className="tiny-note">Loading…</p>}
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>Name</th><th>Email</th><th>Phone</th><th>Plan</th><th>AI</th>
                <th>Conversations</th><th>Messages</th><th>Chunks</th>
                <th>Tokens</th><th>Cost</th><th>Joined</th><th>Usage</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.userId}>
                  <td>{u.name}</td>
                  <td style={{ fontSize: "0.8rem" }}>{u.email}</td>
                  <td style={{ fontSize: "0.8rem" }}>{u.phone ?? "—"}</td>
                  <td>{u.plan}</td>
                  <td>
                    <span style={{ color: u.aiActive ? "#22c55e" : "#94a3b8", fontWeight: 600, fontSize: "0.8rem" }}>
                      {u.aiActive ? "On" : "Off"}
                    </span>
                  </td>
                  <td>{u.conversations}</td>
                  <td>{u.messages}</td>
                  <td>{u.chunks}</td>
                  <td>{u.totalTokens.toLocaleString()}</td>
                  <td>{fmt(u.costInr)}</td>
                  <td style={{ fontSize: "0.8rem" }}>{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td>
                    <button className="ghost-btn" style={{ padding: "3px 8px", fontSize: "0.78rem" }} onClick={() => void openUsage(u)}>View</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={12} style={{ textAlign: "center", color: "#94a3b8", padding: "2rem" }}>No users found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}

      {usageUser && (
        <div className="kb-modal-backdrop" onClick={() => setUsageUser(null)}>
          <div className="kb-modal kb-modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>Usage: {usageUser.name} (Last 30 days)</h3>
            {usageLoading && <p className="tiny-note">Loading…</p>}
            {!usageLoading && usage && (
              <>
                <div className="overview-grid finance-grid">
                  <article><h3>AI Messages</h3><p>{usage.messages}</p></article>
                  <article><h3>Total Tokens</h3><p>{usage.total_tokens.toLocaleString()}</p></article>
                  <article><h3>Cost</h3><p>{fmt(usage.estimated_cost_inr)}</p></article>
                  <article><h3>Avg / Message</h3><p>{fmt(usage.messages > 0 ? usage.estimated_cost_inr / usage.messages : 0)}</p></article>
                </div>
                {usage.by_model.length > 0 && (
                  <div className="finance-table-wrap" style={{ marginTop: "1rem" }}>
                    <table className="finance-table">
                      <thead><tr><th>Model</th><th>Messages</th><th>Tokens</th><th>Cost</th></tr></thead>
                      <tbody>
                        {usage.by_model.map((r) => (
                          <tr key={r.ai_model}>
                            <td>{r.ai_model}</td><td>{r.messages}</td>
                            <td>{r.total_tokens}</td><td>{fmt(r.estimated_cost_inr)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            <div className="kb-modal-actions">
              <button className="primary-btn" onClick={() => setUsageUser(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

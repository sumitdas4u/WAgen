import { useEffect, useState } from "react";
import { fetchAdminBroadcasts, cancelAdminBroadcast, type AdminBroadcast } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const STATUS_COLORS: Record<string, string> = {
  running: "#3b82f6",
  completed: "#22c55e",
  cancelled: "#94a3b8",
  draft: "#64748b",
  scheduled: "#f59e0b",
  paused: "#f97316",
};

export function BroadcastsPage() {
  const { token } = useSuperAdmin();
  const [broadcasts, setBroadcasts] = useState<AdminBroadcast[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchAdminBroadcasts(token, { limit: 300, status: statusFilter || undefined });
      setBroadcasts(r.broadcasts);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [token, statusFilter]);

  const handleCancel = async (b: AdminBroadcast) => {
    if (!confirm(`Cancel campaign "${b.name}"?`)) return;
    setLoading(true); setError(null); setInfo(null);
    try {
      await cancelAdminBroadcast(token, b.id);
      setInfo(`Cancelled: ${b.name}`);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  const filtered = broadcasts.filter((b) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return b.name.toLowerCase().includes(q) || b.userEmail.toLowerCase().includes(q) || b.userName.toLowerCase().includes(q);
  });

  const pct = (n: number, total: number) => total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "—";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>Broadcasts</h1>
        <button className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Search name / workspace…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem", width: 240 }}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem" }}>
          <option value="">All statuses</option>
          <option value="running">Running</option>
          <option value="scheduled">Scheduled</option>
          <option value="completed">Completed</option>
          <option value="paused">Paused</option>
          <option value="cancelled">Cancelled</option>
          <option value="draft">Draft</option>
        </select>
        <span style={{ fontSize: "0.82rem", color: "#64748b" }}>{filtered.length} campaign{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      <section className="finance-panel">
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>Name</th><th>Workspace</th><th>Status</th>
                <th>Total</th><th>Sent</th><th>Delivered</th><th>Read</th><th>Failed</th>
                <th>Del. Rate</th><th>Scheduled</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.id}>
                  <td><strong>{b.name}</strong></td>
                  <td>{b.userName}<br /><small style={{ color: "#64748b", fontSize: "0.78rem" }}>{b.userEmail}</small></td>
                  <td>
                    <span style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 12,
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      background: `${STATUS_COLORS[b.status] ?? "#ccc"}20`,
                      color: STATUS_COLORS[b.status] ?? "#666",
                    }}>
                      {b.status}
                    </span>
                  </td>
                  <td>{b.totalCount}</td>
                  <td>{b.sentCount}</td>
                  <td>{b.deliveredCount}</td>
                  <td>{b.readCount}</td>
                  <td style={{ color: b.failedCount > 0 ? "#be123c" : undefined }}>{b.failedCount}</td>
                  <td>{pct(b.deliveredCount, b.sentCount)}</td>
                  <td style={{ fontSize: "0.78rem" }}>{b.scheduledAt ? new Date(b.scheduledAt).toLocaleString() : "-"}</td>
                  <td>
                    {(b.status === "running" || b.status === "scheduled" || b.status === "paused") && (
                      <button
                        className="ghost-btn"
                        style={{ color: "#be123c", borderColor: "#fecdd3", fontSize: "0.8rem", padding: "3px 8px" }}
                        disabled={loading}
                        onClick={() => void handleCancel(b)}
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={11} style={{ textAlign: "center", color: "#94a3b8", padding: "2rem" }}>No broadcasts found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {info && <p className="info-text" style={{ marginTop: "1rem" }}>{info}</p>}
      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}

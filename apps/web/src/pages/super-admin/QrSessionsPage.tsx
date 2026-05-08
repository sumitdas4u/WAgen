import { useEffect, useState } from "react";
import { fetchAdminQrSessions, type AdminQrSession } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const STATUS_COLORS: Record<string, string> = {
  connected: "#22c55e",
  connecting: "#f59e0b",
  disconnected: "#94a3b8",
};

export function QrSessionsPage() {
  const { token } = useSuperAdmin();
  const [sessions, setSessions] = useState<AdminQrSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchAdminQrSessions(token);
      setSessions(r.sessions);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [token]);

  const filtered = sessions.filter((s) => {
    if (statusFilter && s.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.userEmail.toLowerCase().includes(q) || s.userName.toLowerCase().includes(q) || (s.phoneNumber ?? "").includes(q);
    }
    return true;
  });

  const statuses = [...new Set(sessions.map((s) => s.status))].sort();

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>WhatsApp QR Sessions</h1>
        <button className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Search user / phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem", width: 240 }}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem" }}>
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span style={{ fontSize: "0.82rem", color: "#64748b" }}>{filtered.length} session{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      <section className="finance-panel">
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>User</th><th>Email</th><th>Phone</th><th>Status</th><th>Enabled</th><th>Last Connected</th><th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.userId}>
                  <td>{s.userName}</td>
                  <td style={{ fontSize: "0.8rem" }}>{s.userEmail}</td>
                  <td>{s.phoneNumber ?? "-"}</td>
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
                  <td>
                    <span style={{ color: s.enabled ? "#22c55e" : "#94a3b8", fontWeight: 600, fontSize: "0.8rem" }}>
                      {s.enabled ? "Yes" : "No"}
                    </span>
                  </td>
                  <td style={{ fontSize: "0.8rem" }}>{s.lastConnectedAt ? new Date(s.lastConnectedAt).toLocaleString() : "Never"}</td>
                  <td style={{ fontSize: "0.8rem" }}>{new Date(s.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "#94a3b8", padding: "2rem" }}>No QR sessions found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}

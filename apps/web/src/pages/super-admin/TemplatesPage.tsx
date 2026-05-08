import { useEffect, useState } from "react";
import { fetchAdminTemplates, type AdminTemplate } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const STATUS_COLORS: Record<string, string> = {
  APPROVED: "#22c55e",
  PENDING: "#f59e0b",
  REJECTED: "#ef4444",
  PAUSED: "#94a3b8",
  DISABLED: "#64748b",
};

export function TemplatesPage() {
  const { token } = useSuperAdmin();
  const [templates, setTemplates] = useState<AdminTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  const load = async (status?: string) => {
    setLoading(true); setError(null);
    try {
      const r = await fetchAdminTemplates(token, { limit: 400, status: status || undefined });
      setTemplates(r.templates);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => { void load(statusFilter); }, [token, statusFilter]);

  const filtered = templates.filter((t) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return t.name.toLowerCase().includes(q) || t.userEmail.toLowerCase().includes(q) || t.userName.toLowerCase().includes(q);
  });

  // Count rejections per workspace for rejection rate display
  const rejectionCounts = templates.reduce<Record<string, { total: number; rejected: number }>>((acc, t) => {
    if (!acc[t.userEmail]) acc[t.userEmail] = { total: 0, rejected: 0 };
    acc[t.userEmail]!.total++;
    if (t.status === "REJECTED") acc[t.userEmail]!.rejected++;
    return acc;
  }, {});

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>Templates</h1>
        <button className="ghost-btn" onClick={() => void load(statusFilter)} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Search template / workspace…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem", width: 240 }}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem" }}>
          <option value="">All statuses</option>
          <option value="APPROVED">Approved</option>
          <option value="PENDING">Pending</option>
          <option value="REJECTED">Rejected</option>
          <option value="PAUSED">Paused</option>
        </select>
        <span style={{ fontSize: "0.82rem", color: "#64748b" }}>{filtered.length} template{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      <section className="finance-panel">
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>Name</th><th>Workspace</th><th>Category</th><th>Language</th>
                <th>Status</th><th>Quality</th><th>Rejection Rate</th><th>Rejection Reason</th><th>Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const ws = rejectionCounts[t.userEmail];
                const rejRate = ws && ws.total > 0 ? (ws.rejected / ws.total) : 0;
                return (
                  <tr key={t.id}>
                    <td><strong>{t.name}</strong></td>
                    <td>{t.userName}<br /><small style={{ color: "#64748b", fontSize: "0.78rem" }}>{t.userEmail}</small></td>
                    <td style={{ fontSize: "0.8rem" }}>{t.category}</td>
                    <td style={{ fontSize: "0.8rem" }}>{t.language}</td>
                    <td>
                      <span style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 12,
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        background: `${STATUS_COLORS[t.status] ?? "#ccc"}20`,
                        color: STATUS_COLORS[t.status] ?? "#666",
                      }}>
                        {t.status}
                      </span>
                    </td>
                    <td style={{ fontSize: "0.8rem" }}>{t.qualityScore ?? "-"}</td>
                    <td>
                      {ws && ws.total > 0 && (
                        <span style={{
                          fontSize: "0.78rem",
                          fontWeight: 600,
                          color: rejRate > 0.2 ? "#ef4444" : rejRate > 0.1 ? "#f59e0b" : "#64748b",
                        }}>
                          {(rejRate * 100).toFixed(0)}% ({ws.rejected}/{ws.total})
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: "0.78rem", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.metaRejectionReason ?? "-"}
                    </td>
                    <td style={{ fontSize: "0.78rem" }}>{new Date(t.createdAt).toLocaleDateString()}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "#94a3b8", padding: "2rem" }}>No templates found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}

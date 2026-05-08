import { useEffect, useState } from "react";
import { fetchAdminAuditLogs, type AdminAuditLogEntry } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

export function AuditLogsPage() {
  const { token } = useSuperAdmin();
  const [logs, setLogs] = useState<AdminAuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState("");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchAdminAuditLogs(token, { limit: 300, action: actionFilter || undefined });
      setLogs(r.logs);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [token, actionFilter]);

  const actions = [...new Set(logs.map((l) => l.action.split(".")[0] ?? l.action))].sort();

  const filtered = logs.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (l.adminEmail ?? "").toLowerCase().includes(q) ||
      l.action.toLowerCase().includes(q) ||
      (l.workspaceId ?? "").includes(q)
    );
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>Audit Logs</h1>
        <button className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Search admin / action / workspace…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem", width: 280 }}
        />
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem" }}>
          <option value="">All actions</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <span style={{ fontSize: "0.82rem", color: "#64748b" }}>{filtered.length} log{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      <section className="finance-panel">
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>Admin</th><th>Action</th><th>Workspace</th><th>IP</th><th>When</th><th>Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <>
                  <tr key={l.id} style={{ cursor: "pointer" }} onClick={() => setExpandedId(expandedId === l.id ? null : l.id)}>
                    <td style={{ fontSize: "0.8rem" }}>{l.adminEmail ?? "system"}</td>
                    <td>
                      <span style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 12,
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        background: l.action.includes("delete") || l.action.includes("cancel") ? "#fee2e2" : "#f1f5f9",
                        color: l.action.includes("delete") || l.action.includes("cancel") ? "#be123c" : "#475569",
                      }}>
                        {l.action}
                      </span>
                    </td>
                    <td style={{ fontSize: "0.78rem" }}>{l.workspaceId ? l.workspaceId.slice(0, 8) + "…" : "-"}</td>
                    <td style={{ fontSize: "0.78rem" }}>{l.ipAddress ?? "-"}</td>
                    <td style={{ fontSize: "0.78rem" }}>{new Date(l.createdAt).toLocaleString()}</td>
                    <td>
                      <button
                        className="ghost-btn"
                        style={{ padding: "2px 8px", fontSize: "0.75rem" }}
                        onClick={(e) => { e.stopPropagation(); setExpandedId(expandedId === l.id ? null : l.id); }}
                      >
                        {expandedId === l.id ? "Hide" : "Show"}
                      </button>
                    </td>
                  </tr>
                  {expandedId === l.id && (
                    <tr key={`${l.id}-expand`}>
                      <td colSpan={6} style={{ background: "#f8fafc", padding: "0.75rem 1rem" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", maxWidth: 900 }}>
                          <div>
                            <p style={{ margin: "0 0 0.4rem", fontSize: "0.75rem", fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>Details</p>
                            <pre style={{ margin: 0, fontSize: "0.75rem", whiteSpace: "pre-wrap", background: "#fff", padding: "0.5rem", borderRadius: 5, border: "1px solid #e2eaf4" }}>
                              {JSON.stringify(l.detailsJson, null, 2)}
                            </pre>
                          </div>
                          {(l.beforeJson || l.afterJson) && (
                            <div>
                              <p style={{ margin: "0 0 0.4rem", fontSize: "0.75rem", fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>Before / After</p>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                                <div>
                                  <p style={{ margin: "0 0 0.2rem", fontSize: "0.7rem", color: "#64748b" }}>Before</p>
                                  <pre style={{ margin: 0, fontSize: "0.72rem", whiteSpace: "pre-wrap", background: "#fef3c7", padding: "0.5rem", borderRadius: 5, border: "1px solid #fde68a" }}>
                                    {JSON.stringify(l.beforeJson, null, 2)}
                                  </pre>
                                </div>
                                <div>
                                  <p style={{ margin: "0 0 0.2rem", fontSize: "0.7rem", color: "#64748b" }}>After</p>
                                  <pre style={{ margin: 0, fontSize: "0.72rem", whiteSpace: "pre-wrap", background: "#dcfce7", padding: "0.5rem", borderRadius: 5, border: "1px solid #bbf7d0" }}>
                                    {JSON.stringify(l.afterJson, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "#94a3b8", padding: "2rem" }}>No audit logs found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}

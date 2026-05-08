import { useEffect, useState } from "react";
import { fetchAdminWebhookLogs, type AdminWebhookLogEntry } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

export function WebhookLogsPage() {
  const { token } = useSuperAdmin();
  const [logs, setLogs] = useState<AdminWebhookLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failureOnly, setFailureOnly] = useState(false);
  const [search, setSearch] = useState("");

  const load = async (failure = failureOnly) => {
    setLoading(true); setError(null);
    try {
      const r = await fetchAdminWebhookLogs(token, { failure, limit: 300 });
      setLogs(r.logs);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => { void load(failureOnly); }, [token, failureOnly]);

  const filtered = logs.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return l.userEmail.toLowerCase().includes(q) || l.endpointUrl.toLowerCase().includes(q) || l.event.toLowerCase().includes(q);
  });

  const failureCount = logs.filter((l) => !l.success).length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>Webhook Logs</h1>
        <button className="ghost-btn" onClick={() => void load(failureOnly)} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </div>

      {failureCount > 0 && (
        <div style={{ marginBottom: "1rem", padding: "10px 16px", borderRadius: 8, background: "#fff1f2", border: "1px solid #fecdd3", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "#be123c", fontWeight: 700, fontSize: "0.88rem" }}>
            {failureCount} failed delivery{failureCount !== 1 ? "ies" : "y"} in current view
          </span>
          <button
            onClick={() => setFailureOnly((v) => !v)}
            style={{ marginLeft: "auto", background: "none", border: "1px solid #fca5a5", color: "#be123c", borderRadius: 5, padding: "3px 10px", cursor: "pointer", fontSize: "0.8rem" }}
          >
            {failureOnly ? "Show All" : "Show Failures Only"}
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Search user / URL / event…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem", width: 280 }}
        />
        <span style={{ fontSize: "0.82rem", color: "#64748b" }}>{filtered.length} log{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      <section className="finance-panel">
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>User</th><th>URL</th><th>Event</th><th>Status</th><th>Attempt</th><th>Result</th><th>Error</th><th>Delivered At</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.id} style={!l.success ? { background: "#fff1f2" } : undefined}>
                  <td style={{ fontSize: "0.8rem" }}>{l.userEmail}</td>
                  <td style={{ fontSize: "0.78rem", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.endpointUrl}>
                    {l.endpointUrl}
                  </td>
                  <td>
                    <span style={{ fontSize: "0.78rem", background: "#f1f5f9", padding: "2px 6px", borderRadius: 4 }}>{l.event}</span>
                  </td>
                  <td>
                    <span style={{
                      fontSize: "0.78rem",
                      fontWeight: 700,
                      color: l.statusCode && l.statusCode >= 200 && l.statusCode < 300 ? "#22c55e" : "#ef4444",
                    }}>
                      {l.statusCode ?? "—"}
                    </span>
                  </td>
                  <td style={{ textAlign: "center" }}>{l.attempt}</td>
                  <td>
                    <span style={{
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      color: l.success ? "#22c55e" : "#ef4444",
                    }}>
                      {l.success ? "OK" : "FAIL"}
                    </span>
                  </td>
                  <td style={{ fontSize: "0.78rem", color: "#be123c", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.errorMessage ?? undefined}>
                    {l.errorMessage ?? "-"}
                  </td>
                  <td style={{ fontSize: "0.78rem" }}>{new Date(l.deliveredAt).toLocaleString()}</td>
                </tr>
              ))}
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "#94a3b8", padding: "2rem" }}>No webhook logs found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}

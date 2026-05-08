import { useEffect, useState } from "react";
import { fetchAdminAiLogs, type AdminAiLogEntry } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const fmt = (v: number) => `₹${v.toFixed(4)}`;

export function AiLogsPage() {
  const { token } = useSuperAdmin();
  const [logs, setLogs] = useState<AdminAiLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelFilter, setModelFilter] = useState("");
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchAdminAiLogs(token, { limit: 300, model: modelFilter || undefined });
      setLogs(r.logs);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [token, modelFilter]);

  const models = [...new Set(logs.map((l) => l.model).filter(Boolean))].sort() as string[];

  const filtered = logs.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return l.userEmail.toLowerCase().includes(q) || (l.actionType ?? "").toLowerCase().includes(q) || (l.module ?? "").toLowerCase().includes(q);
  });

  const totalCost = filtered.reduce((s, l) => s + l.estimatedCostInr, 0);
  const totalTokens = filtered.reduce((s, l) => s + l.totalTokens, 0);
  const totalCredits = filtered.reduce((s, l) => s + l.creditsDeducted, 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>AI Logs</h1>
        <button className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </div>

      <div className="overview-grid" style={{ marginBottom: "1.5rem" }}>
        <article><h3>Entries Shown</h3><p>{filtered.length.toLocaleString()}</p></article>
        <article><h3>Total Tokens</h3><p>{totalTokens.toLocaleString()}</p></article>
        <article><h3>Est. Cost</h3><p>{fmt(totalCost)}</p></article>
        <article><h3>Credits Used</h3><p>{totalCredits.toLocaleString()}</p></article>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Search email / action / module…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem", width: 280 }}
        />
        <select value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem" }}>
          <option value="">All models</option>
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <section className="finance-panel">
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>User</th><th>Action</th><th>Module</th><th>Model</th>
                <th>Prompt</th><th>Completion</th><th>Total Tokens</th><th>Cost</th><th>Credits</th><th>Status</th><th>When</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.id}>
                  <td style={{ fontSize: "0.8rem" }}>{l.userEmail}</td>
                  <td style={{ fontSize: "0.78rem" }}>{l.actionType}</td>
                  <td style={{ fontSize: "0.78rem" }}>{l.module ?? "-"}</td>
                  <td style={{ fontSize: "0.78rem" }}>{l.model ?? "-"}</td>
                  <td style={{ textAlign: "right" }}>{l.promptTokens.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>{l.completionTokens.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>{l.totalTokens.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>{fmt(l.estimatedCostInr)}</td>
                  <td style={{ textAlign: "right" }}>{l.creditsDeducted}</td>
                  <td>
                    <span style={{
                      fontSize: "0.72rem",
                      fontWeight: 600,
                      color: l.status === "finalized" ? "#22c55e" : l.status === "failed" ? "#ef4444" : "#94a3b8",
                    }}>
                      {l.status}
                    </span>
                  </td>
                  <td style={{ fontSize: "0.78rem" }}>{new Date(l.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={11} style={{ textAlign: "center", color: "#94a3b8", padding: "2rem" }}>No AI log entries found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}

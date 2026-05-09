import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { fetchAdminAiLogs, fetchAiCostSummary, type AdminAiLogEntry, type AiCostSummaryEntry } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const fmt = (v: number) => `₹${v.toFixed(4)}`;
const fmtShort = (v: number) => `₹${v.toFixed(2)}`;

const COLORS = ["#ef8354", "#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#10b981"];

type Tab = "logs" | "cost";
type GroupBy = "model" | "workspace" | "module" | "day";

export function AiLogsPage() {
  const { token } = useSuperAdmin();
  const [tab, setTab] = useState<Tab>("logs");
  const [logs, setLogs] = useState<AdminAiLogEntry[]>([]);
  const [costSeries, setCostSeries] = useState<AiCostSummaryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelFilter, setModelFilter] = useState("");
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("model");
  const [days, setDays] = useState(30);

  const loadLogs = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchAdminAiLogs(token, { limit: 300, model: modelFilter || undefined });
      setLogs(r.logs);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  const loadCost = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchAiCostSummary(token, groupBy, days);
      setCostSeries(r.series);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => { void loadLogs(); }, [token, modelFilter]);
  useEffect(() => { if (tab === "cost") void loadCost(); }, [token, tab, groupBy, days]);

  const models = [...new Set(logs.map((l) => l.model).filter(Boolean))].sort() as string[];

  const filtered = logs.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return l.userEmail.toLowerCase().includes(q) || (l.actionType ?? "").toLowerCase().includes(q) || (l.module ?? "").toLowerCase().includes(q);
  });

  const totalCost = filtered.reduce((s, l) => s + l.estimatedCostInr, 0);
  const totalTokens = filtered.reduce((s, l) => s + l.totalTokens, 0);
  const totalCredits = filtered.reduce((s, l) => s + l.creditsDeducted, 0);
  const totalCostSeries = costSeries.reduce((s, e) => s + e.costInr, 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>AI Logs</h1>
        <button className="ghost-btn" onClick={() => tab === "logs" ? void loadLogs() : void loadCost()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", borderBottom: "2px solid #e2e8f0", paddingBottom: "2px" }}>
        {(["logs", "cost"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "6px 16px", border: "none", background: "none", cursor: "pointer",
            fontWeight: tab === t ? 700 : 400,
            color: tab === t ? "#ef8354" : "#64748b",
            borderBottom: tab === t ? "2px solid #ef8354" : "2px solid transparent",
            marginBottom: "-2px", fontSize: "0.88rem",
          }}>{t === "logs" ? "Usage Logs" : "Cost Breakdown"}</button>
        ))}
      </div>

      {/* Logs tab */}
      {tab === "logs" && (
        <>
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
                        <span style={{ fontSize: "0.72rem", fontWeight: 600, color: l.status === "finalized" ? "#22c55e" : l.status === "failed" ? "#ef4444" : "#94a3b8" }}>
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
        </>
      )}

      {/* Cost breakdown tab */}
      {tab === "cost" && (
        <>
          <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", alignItems: "center", flexWrap: "wrap" }}>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem" }}>
              <option value="model">By Model</option>
              <option value="workspace">By Workspace</option>
              <option value="module">By Module</option>
              <option value="day">By Day (trend)</option>
            </select>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem" }}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <span style={{ fontSize: "0.82rem", color: "#64748b" }}>Total: <strong>{fmtShort(totalCostSeries)}</strong></span>
          </div>

          <section className="finance-panel" style={{ marginBottom: "1.25rem" }}>
            <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 1rem" }}>
              Cost {groupBy === "day" ? "Trend" : `by ${groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}`}
            </h3>
            {costSeries.length === 0 ? (
              <p className="tiny-note">No data for this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={costSeries} layout={groupBy === "day" ? "horizontal" : "vertical"} margin={{ left: 20, right: 20, top: 4, bottom: 4 }}>
                  {groupBy === "day" ? (
                    <>
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={(v: number) => `₹${v.toFixed(2)}`} tick={{ fontSize: 11 }} />
                    </>
                  ) : (
                    <>
                      <XAxis type="number" tickFormatter={(v: number) => `₹${v.toFixed(2)}`} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="label" width={160} tick={{ fontSize: 11 }} />
                    </>
                  )}
                  <Tooltip formatter={(v) => [`₹${Number(v).toFixed(4)}`, "Cost (INR)"]} />
                  <Bar dataKey="costInr" radius={[3, 3, 3, 3]}>
                    {costSeries.map((_entry, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </section>

          <section className="finance-panel">
            <div className="finance-table-wrap">
              <table className="finance-table">
                <thead>
                  <tr><th>{groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}</th><th>Cost (INR)</th><th>Tokens</th><th>Messages</th></tr>
                </thead>
                <tbody>
                  {costSeries.map((e, idx) => (
                    <tr key={idx}>
                      <td>{e.label}</td>
                      <td style={{ fontWeight: 600 }}>{fmtShort(e.costInr)}</td>
                      <td>{e.tokens.toLocaleString()}</td>
                      <td>{e.messages.toLocaleString()}</td>
                    </tr>
                  ))}
                  {costSeries.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: "center", color: "#94a3b8", padding: "2rem" }}>No data</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}

import { useEffect, useState } from "react";
import { fetchBroadcastReputation, type BroadcastReputationEntry } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const RISK_COLORS: Record<string, { bg: string; color: string }> = {
  safe: { bg: "#dcfce7", color: "#16a34a" },
  warning: { bg: "#fef9c3", color: "#ca8a04" },
  danger: { bg: "#ffedd5", color: "#c2410c" },
  blocked: { bg: "#fee2e2", color: "#dc2626" },
};

function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? "#16a34a" : score >= 60 ? "#ca8a04" : score >= 40 ? "#c2410c" : "#dc2626";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 60, height: 6, borderRadius: 3, background: "#e2eaf4", overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.3s" }} />
      </div>
      <span style={{ fontSize: "0.82rem", fontWeight: 700 }}>{score}</span>
    </div>
  );
}

function pct(val: number | null): string {
  if (val === null) return "—";
  return `${val.toFixed(1)}%`;
}

export function BroadcastHealthPage() {
  const { token } = useSuperAdmin();
  const [entries, setEntries] = useState<BroadcastReputationEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [riskFilter, setRiskFilter] = useState("");

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchBroadcastReputation(token);
      setEntries(r.entries);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [token]);

  const riskCounts = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.riskLevel] = (acc[e.riskLevel] ?? 0) + 1;
    return acc;
  }, {});

  const filtered = riskFilter ? entries.filter((e) => e.riskLevel === riskFilter) : entries;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>Broadcast Health</h1>
        <button className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </div>

      <div className="overview-grid" style={{ marginBottom: "1.5rem" }}>
        {Object.entries(RISK_COLORS).map(([level, style]) => (
          <article
            key={level}
            onClick={() => setRiskFilter(riskFilter === level ? "" : level)}
            style={{ cursor: "pointer", border: riskFilter === level ? `2px solid ${style.color}` : undefined }}
          >
            <h3 style={{ color: style.color, textTransform: "capitalize" }}>{level}</h3>
            <p>{riskCounts[level] ?? 0}</p>
          </article>
        ))}
      </div>

      {entries.length === 0 && !loading ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#94a3b8", background: "#fff", borderRadius: 10, border: "1px solid #e2eaf4" }}>
          No broadcast reputation data yet. Scores are computed after campaigns complete.
        </div>
      ) : (
        <>
          {riskFilter && (
            <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "0.85rem", color: "#64748b" }}>Filtering: {riskFilter}</span>
              <button className="ghost-btn" style={{ fontSize: "0.8rem", padding: "2px 8px" }} onClick={() => setRiskFilter("")}>Clear</button>
            </div>
          )}
          <section className="finance-panel">
            <div className="finance-table-wrap">
              <table className="finance-table">
                <thead>
                  <tr>
                    <th>Workspace</th><th>Owner</th><th>Score</th><th>Risk</th>
                    <th>Sent</th><th>Delivery%</th><th>Read%</th><th>Failure%</th><th>Template Reject%</th><th>Last Scored</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => {
                    const rc = RISK_COLORS[e.riskLevel] ?? RISK_COLORS["safe"]!;
                    return (
                      <tr key={e.workspaceId} style={{ background: e.riskLevel === "blocked" ? "#fff1f2" : e.riskLevel === "danger" ? "#fffbeb" : undefined }}>
                        <td><strong>{e.workspaceName}</strong></td>
                        <td style={{ fontSize: "0.8rem" }}>{e.ownerEmail}</td>
                        <td><ScoreBar score={e.reputationScore} /></td>
                        <td>
                          <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: "0.75rem", fontWeight: 700, background: rc.bg, color: rc.color, textTransform: "capitalize" }}>
                            {e.riskLevel}
                          </span>
                        </td>
                        <td>{e.totalSent.toLocaleString()}</td>
                        <td>{pct(e.deliveryRate)}</td>
                        <td>{pct(e.readRate)}</td>
                        <td style={{ color: e.failureRate !== null && e.failureRate > 10 ? "#dc2626" : undefined }}>
                          {pct(e.failureRate)}
                        </td>
                        <td style={{ color: e.templateRejectionRate !== null && e.templateRejectionRate > 20 ? "#dc2626" : undefined }}>
                          {pct(e.templateRejectionRate)}
                        </td>
                        <td style={{ fontSize: "0.78rem" }}>
                          {e.lastCalculatedAt ? new Date(e.lastCalculatedAt).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && !loading && (
                    <tr><td colSpan={10} style={{ textAlign: "center", color: "#94a3b8", padding: "2rem" }}>No workspaces match filter</td></tr>
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

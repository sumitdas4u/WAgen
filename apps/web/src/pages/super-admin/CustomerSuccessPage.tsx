import { useEffect, useState } from "react";
import { fetchAdminWorkspaceHealth, type WorkspaceHealthSummary } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const TIER_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  power_user: { bg: "#dcfce7", color: "#16a34a", label: "Power User" },
  engaged: { bg: "#dbeafe", color: "#1d4ed8", label: "Engaged" },
  at_risk: { bg: "#fff7ed", color: "#c2410c", label: "At Risk" },
  inactive: { bg: "#f1f5f9", color: "#64748b", label: "Inactive" },
};

export function CustomerSuccessPage() {
  const { token } = useSuperAdmin();
  const [workspaces, setWorkspaces] = useState<WorkspaceHealthSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    fetchAdminWorkspaceHealth(token)
      .then((r) => setWorkspaces(r.workspaces))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [token]);

  const tierCounts = workspaces.reduce<Record<string, number>>((acc, w) => {
    acc[w.tier] = (acc[w.tier] ?? 0) + 1;
    return acc;
  }, {});

  const filtered = tierFilter ? workspaces.filter((w) => w.tier === tierFilter) : workspaces;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>Customer Success</h1>
        <span style={{ fontSize: "0.82rem", color: "#64748b" }}>{workspaces.length} workspaces with health scores</span>
      </div>

      <div className="overview-grid" style={{ marginBottom: "1.5rem" }}>
        {Object.entries(TIER_COLORS).map(([tier, meta]) => (
          <article
            key={tier}
            onClick={() => setTierFilter(tierFilter === tier ? "" : tier)}
            style={{ cursor: "pointer", border: tierFilter === tier ? `2px solid ${meta.color}` : undefined }}
          >
            <h3 style={{ color: meta.color }}>{meta.label}</h3>
            <p>{tierCounts[tier] ?? 0}</p>
          </article>
        ))}
      </div>

      {workspaces.length === 0 && !loading ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#94a3b8", background: "#fff", borderRadius: 10, border: "1px solid #e2eaf4" }}>
          No health scores computed yet. Health scores are calculated daily by the worker cron.
        </div>
      ) : (
        <>
          {tierFilter && (
            <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "0.85rem", color: "#64748b" }}>Filtering: {TIER_COLORS[tierFilter]?.label}</span>
              <button className="ghost-btn" style={{ fontSize: "0.8rem", padding: "2px 8px" }} onClick={() => setTierFilter("")}>Clear</button>
            </div>
          )}
          <section className="finance-panel">
            <div className="finance-table-wrap">
              <table className="finance-table">
                <thead>
                  <tr>
                    <th>Workspace</th><th>Owner</th><th>Score</th><th>Tier</th>
                    <th>AI Active</th><th>Has Broadcast</th><th>Last Scored</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((w) => {
                    const tc = TIER_COLORS[w.tier] ?? TIER_COLORS["inactive"]!;
                    return (
                      <tr key={w.workspaceId}>
                        <td><strong>{w.workspaceName}</strong></td>
                        <td style={{ fontSize: "0.8rem" }}>{w.ownerEmail}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ width: 60, height: 6, borderRadius: 3, background: "#e2eaf4", overflow: "hidden" }}>
                              <div style={{ width: `${w.score}%`, height: "100%", background: tc.color, borderRadius: 3, transition: "width 0.3s" }} />
                            </div>
                            <span style={{ fontSize: "0.82rem", fontWeight: 700 }}>{w.score}</span>
                          </div>
                        </td>
                        <td>
                          <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: "0.75rem", fontWeight: 700, background: tc.bg, color: tc.color }}>
                            {tc.label}
                          </span>
                        </td>
                        <td>
                          <span style={{ color: w.aiEnabled ? "#22c55e" : "#94a3b8", fontWeight: 600, fontSize: "0.8rem" }}>
                            {w.aiEnabled ? "Yes" : "No"}
                          </span>
                        </td>
                        <td>
                          <span style={{ color: w.hasActiveBroadcast ? "#22c55e" : "#94a3b8", fontWeight: 600, fontSize: "0.8rem" }}>
                            {w.hasActiveBroadcast ? "Yes" : "No"}
                          </span>
                        </td>
                        <td style={{ fontSize: "0.78rem" }}>{new Date(w.calculatedAt).toLocaleDateString()}</td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && !loading && (
                    <tr><td colSpan={7} style={{ textAlign: "center", color: "#94a3b8", padding: "2rem" }}>No workspaces match filter</td></tr>
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

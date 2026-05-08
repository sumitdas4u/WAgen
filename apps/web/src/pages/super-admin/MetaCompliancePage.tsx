import { useEffect, useState } from "react";
import { fetchMetaComplianceEvents, type MetaComplianceEvent } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const SEVERITY_COLORS: Record<string, { bg: string; color: string }> = {
  critical: { bg: "#fee2e2", color: "#dc2626" },
  warn: { bg: "#fef9c3", color: "#ca8a04" },
  info: { bg: "#dbeafe", color: "#1d4ed8" },
};

const EVENT_LABELS: Record<string, string> = {
  template_rejected: "Template Rejected",
  quality_score_low: "Quality Score Low",
  messaging_limit_reduced: "Limit Reduced",
  "24h_window_violation": "24h Window Violation",
  marketing_opt_out: "Marketing Opt-Out",
  account_flagged: "Account Flagged",
};

export function MetaCompliancePage() {
  const { token } = useSuperAdmin();
  const [events, setEvents] = useState<MetaComplianceEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState("");

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchMetaComplianceEvents(token, 300);
      setEvents(r.events);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [token]);

  const severityCounts = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.severity] = (acc[e.severity] ?? 0) + 1;
    return acc;
  }, {});

  const workspaceCounts = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.workspaceId] = (acc[e.workspaceId] ?? 0) + 1;
    return acc;
  }, {});
  const workspacesWithIssues = Object.values(workspaceCounts).filter((c) => c > 0).length;

  const filtered = severityFilter ? events.filter((e) => e.severity === severityFilter) : events;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>Meta Compliance</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: "0.82rem", color: "#64748b" }}>{workspacesWithIssues} workspaces with events</span>
          <button className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        </div>
      </div>

      <div className="overview-grid" style={{ marginBottom: "1.5rem" }}>
        {Object.entries(SEVERITY_COLORS).map(([severity, style]) => (
          <article
            key={severity}
            onClick={() => setSeverityFilter(severityFilter === severity ? "" : severity)}
            style={{ cursor: "pointer", border: severityFilter === severity ? `2px solid ${style.color}` : undefined }}
          >
            <h3 style={{ color: style.color, textTransform: "capitalize" }}>{severity}</h3>
            <p>{severityCounts[severity] ?? 0}</p>
          </article>
        ))}
        <article>
          <h3 style={{ color: "#122033" }}>Total Events</h3>
          <p>{events.length}</p>
        </article>
      </div>

      {events.length === 0 && !loading ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#94a3b8", background: "#fff", borderRadius: 10, border: "1px solid #e2eaf4" }}>
          No Meta compliance events recorded. Events are created when Meta reports template rejections, quality drops, or account issues.
        </div>
      ) : (
        <>
          {severityFilter && (
            <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "0.85rem", color: "#64748b" }}>Filtering: {severityFilter}</span>
              <button className="ghost-btn" style={{ fontSize: "0.8rem", padding: "2px 8px" }} onClick={() => setSeverityFilter("")}>Clear</button>
            </div>
          )}
          <section className="finance-panel">
            <div className="finance-table-wrap">
              <table className="finance-table">
                <thead>
                  <tr>
                    <th>Workspace</th><th>Owner</th><th>Event Type</th><th>Severity</th><th>Connection</th><th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => {
                    const sc = SEVERITY_COLORS[e.severity] ?? SEVERITY_COLORS["info"]!;
                    return (
                      <tr key={e.id} style={{ background: e.severity === "critical" ? "#fff1f2" : undefined }}>
                        <td><strong>{e.workspaceName}</strong></td>
                        <td style={{ fontSize: "0.8rem" }}>{e.ownerEmail}</td>
                        <td>
                          <span style={{ fontSize: "0.82rem" }}>
                            {EVENT_LABELS[e.eventType] ?? e.eventType}
                          </span>
                        </td>
                        <td>
                          <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: "0.75rem", fontWeight: 700, background: sc.bg, color: sc.color, textTransform: "capitalize" }}>
                            {e.severity}
                          </span>
                        </td>
                        <td style={{ fontSize: "0.78rem", color: "#64748b" }}>{e.connectionId ? e.connectionId.slice(0, 8) + "…" : "—"}</td>
                        <td style={{ fontSize: "0.78rem" }}>{new Date(e.createdAt).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && !loading && (
                    <tr><td colSpan={6} style={{ textAlign: "center", color: "#94a3b8", padding: "2rem" }}>No events match filter</td></tr>
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

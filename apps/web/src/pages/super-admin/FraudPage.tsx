import { useEffect, useState } from "react";
import { fetchAdminFraudSignals, resolveAdminFraudSignal, type AdminFraudSignal } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const SEVERITY_COLORS: Record<string, { bg: string; color: string }> = {
  high: { bg: "#fee2e2", color: "#be123c" },
  medium: { bg: "#fff7ed", color: "#c2410c" },
  low: { bg: "#f1f5f9", color: "#64748b" },
};

export function FraudPage() {
  const { token } = useSuperAdmin();
  const [signals, setSignals] = useState<AdminFraudSignal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [unresolvedOnly, setUnresolvedOnly] = useState(true);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchAdminFraudSignals(token, { unresolved: unresolvedOnly });
      setSignals(r.signals);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [token, unresolvedOnly]);

  const handleResolve = async (signal: AdminFraudSignal) => {
    setLoading(true); setError(null); setInfo(null);
    try {
      await resolveAdminFraudSignal(token, signal.id);
      setInfo(`Resolved: ${signal.signalType} for ${signal.workspaceName}`);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>Fraud Detection</h1>
        <div className="header-actions">
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", cursor: "pointer" }}>
            <input type="checkbox" checked={unresolvedOnly} onChange={(e) => setUnresolvedOnly(e.target.checked)} />
            Unresolved only
          </label>
          <button className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        </div>
      </div>

      {signals.length === 0 && !loading ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#94a3b8", background: "#fff", borderRadius: 10, border: "1px solid #e2eaf4" }}>
          {unresolvedOnly ? "No unresolved fraud signals. All clear!" : "No fraud signals recorded."}
        </div>
      ) : (
        <section className="finance-panel">
          <div className="finance-table-wrap">
            <table className="finance-table">
              <thead>
                <tr>
                  <th>User</th><th>Workspace</th><th>Signal Type</th><th>Severity</th>
                  <th>Auto-Actioned</th><th>Resolved</th><th>Detected</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((s) => {
                  const sc = SEVERITY_COLORS[s.severity] ?? SEVERITY_COLORS["low"]!;
                  return (
                    <tr key={s.id}>
                      <td style={{ fontSize: "0.8rem" }}>{s.userEmail}</td>
                      <td>{s.workspaceName}</td>
                      <td>
                        <code style={{ background: "#f1f5f9", padding: "2px 6px", borderRadius: 4, fontSize: "0.78rem" }}>{s.signalType}</code>
                      </td>
                      <td>
                        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: "0.75rem", fontWeight: 700, background: sc.bg, color: sc.color }}>
                          {s.severity}
                        </span>
                      </td>
                      <td>
                        <span style={{ color: s.autoActioned ? "#ef4444" : "#94a3b8", fontWeight: 600, fontSize: "0.8rem" }}>
                          {s.autoActioned ? "Yes" : "No"}
                        </span>
                      </td>
                      <td style={{ fontSize: "0.8rem" }}>{s.resolvedAt ? new Date(s.resolvedAt).toLocaleString() : "Pending"}</td>
                      <td style={{ fontSize: "0.78rem" }}>{new Date(s.createdAt).toLocaleString()}</td>
                      <td>
                        {!s.resolvedAt && (
                          <button className="ghost-btn" style={{ fontSize: "0.78rem", padding: "3px 8px" }} disabled={loading} onClick={() => void handleResolve(s)}>
                            Resolve
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {info && <p className="info-text" style={{ marginTop: "1rem" }}>{info}</p>}
      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}

import { useEffect, useState } from "react";
import { fetchAdminAbuseFlags, resolveAdminAbuseFlag, type AdminAbuseFlag } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const SEVERITY_COLORS: Record<string, { bg: string; color: string }> = {
  critical: { bg: "#fee2e2", color: "#be123c" },
  warn: { bg: "#fff7ed", color: "#c2410c" },
  info: { bg: "#eff6ff", color: "#1d4ed8" },
};

export function AbuseFlagsPage() {
  const { token } = useSuperAdmin();
  const [flags, setFlags] = useState<AdminAbuseFlag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [unresolvedOnly, setUnresolvedOnly] = useState(true);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchAdminAbuseFlags(token, { unresolved: unresolvedOnly });
      setFlags(r.flags);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [token, unresolvedOnly]);

  const handleResolve = async (flag: AdminAbuseFlag) => {
    setLoading(true); setError(null); setInfo(null);
    try {
      await resolveAdminAbuseFlag(token, flag.id);
      setInfo(`Resolved: ${flag.flagType} for ${flag.workspaceName}`);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>Abuse Flags</h1>
        <div className="header-actions">
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", cursor: "pointer" }}>
            <input type="checkbox" checked={unresolvedOnly} onChange={(e) => setUnresolvedOnly(e.target.checked)} />
            Unresolved only
          </label>
          <button className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        </div>
      </div>

      {flags.length === 0 && !loading ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#94a3b8", background: "#fff", borderRadius: 10, border: "1px solid #e2eaf4" }}>
          {unresolvedOnly ? "No unresolved abuse flags. All clear!" : "No abuse flags recorded."}
        </div>
      ) : (
        <section className="finance-panel">
          <div className="finance-table-wrap">
            <table className="finance-table">
              <thead>
                <tr>
                  <th>Workspace</th><th>Owner</th><th>Flag Type</th><th>Severity</th>
                  <th>Auto-Actioned</th><th>Resolved</th><th>Created</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {flags.map((f) => {
                  const sc = SEVERITY_COLORS[f.severity] ?? SEVERITY_COLORS["warn"]!;
                  return (
                    <tr key={f.id}>
                      <td><strong>{f.workspaceName}</strong></td>
                      <td style={{ fontSize: "0.8rem" }}>{f.ownerEmail}</td>
                      <td>
                        <code style={{ background: "#f1f5f9", padding: "2px 6px", borderRadius: 4, fontSize: "0.78rem" }}>{f.flagType}</code>
                      </td>
                      <td>
                        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: "0.75rem", fontWeight: 700, background: sc.bg, color: sc.color }}>
                          {f.severity}
                        </span>
                      </td>
                      <td>
                        <span style={{ color: f.autoActioned ? "#ef4444" : "#94a3b8", fontWeight: 600, fontSize: "0.8rem" }}>
                          {f.autoActioned ? "Yes" : "No"}
                        </span>
                      </td>
                      <td style={{ fontSize: "0.8rem" }}>{f.resolvedAt ? new Date(f.resolvedAt).toLocaleString() : "Pending"}</td>
                      <td style={{ fontSize: "0.78rem" }}>{new Date(f.createdAt).toLocaleString()}</td>
                      <td>
                        {!f.resolvedAt && (
                          <button className="ghost-btn" style={{ fontSize: "0.78rem", padding: "3px 8px" }} disabled={loading} onClick={() => void handleResolve(f)}>
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

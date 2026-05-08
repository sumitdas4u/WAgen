import { useEffect, useState } from "react";
import { fetchAdminAuditLogs, type AdminAuditLogEntry } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

export function ActivityPage() {
  const { token } = useSuperAdmin();
  const [logs, setLogs] = useState<AdminAuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchAdminAuditLogs(token, { limit: 100 });
      setLogs(r.logs);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => {
    void load();
    const interval = setInterval(() => { void load(); }, 30000);
    return () => clearInterval(interval);
  }, [token]);

  const ACTION_ICONS: Record<string, string> = {
    "workspace.": "🏢",
    "broadcast.": "📢",
    "kill_switch.": "⚡",
    "credits.": "💳",
    "plan.": "📋",
    "provider.": "🤖",
    "model.": "🔧",
    "user.": "👤",
  };

  const getIcon = (action: string) => {
    for (const [prefix, icon] of Object.entries(ACTION_ICONS)) {
      if (action.startsWith(prefix)) return icon;
    }
    return "📝";
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: "0 0 0.2rem" }}>Activity Feed</h1>
          <p style={{ margin: 0, fontSize: "0.8rem", color: "#64748b" }}>Recent admin actions — auto-refreshes every 30s</p>
        </div>
        <button className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {logs.map((l) => (
          <div key={l.id} style={{
            background: "#fff",
            border: "1px solid #e2eaf4",
            borderRadius: 8,
            padding: "0.75rem 1rem",
            display: "flex",
            alignItems: "flex-start",
            gap: "0.75rem",
          }}>
            <span style={{ fontSize: "1.2rem", flexShrink: 0, marginTop: 2 }}>{getIcon(l.action)}</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <span style={{
                  padding: "2px 8px",
                  borderRadius: 10,
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  background: "#f1f5f9",
                  color: "#475569",
                }}>
                  {l.action}
                </span>
                {l.adminEmail && (
                  <span style={{ fontSize: "0.8rem", color: "#64748b" }}>by {l.adminEmail}</span>
                )}
                {l.workspaceId && (
                  <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>ws: {l.workspaceId.slice(0, 8)}…</span>
                )}
              </div>
              {Object.keys(l.detailsJson).length > 0 && (
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.78rem", color: "#64748b" }}>
                  {Object.entries(l.detailsJson)
                    .slice(0, 3)
                    .map(([k, v]) => `${k}: ${String(v)}`)
                    .join(" · ")}
                </p>
              )}
            </div>
            <span style={{ fontSize: "0.75rem", color: "#94a3b8", flexShrink: 0 }}>
              {new Date(l.createdAt).toLocaleTimeString()}
            </span>
          </div>
        ))}
        {logs.length === 0 && !loading && (
          <div style={{ textAlign: "center", padding: "3rem", color: "#94a3b8", background: "#fff", borderRadius: 10, border: "1px solid #e2eaf4" }}>
            No activity recorded yet.
          </div>
        )}
      </div>

      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}

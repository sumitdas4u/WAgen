import { useEffect, useState } from "react";
import { fetchAdminSystemHealth, type SystemHealthResponse, type WorkerHeartbeat } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

function StatusBadge({ status }: { status: "ok" | "down" | "unavailable" | "degraded" | "stale" | "missing" }) {
  const colors: Record<string, { bg: string; color: string; label: string }> = {
    ok: { bg: "#dcfce7", color: "#16a34a", label: "Operational" },
    down: { bg: "#fee2e2", color: "#be123c", label: "Down" },
    unavailable: { bg: "#f1f5f9", color: "#64748b", label: "Not Configured" },
    degraded: { bg: "#fff7ed", color: "#c2410c", label: "Degraded" },
    stale: { bg: "#fef9c3", color: "#ca8a04", label: "Stale" },
    missing: { bg: "#fee2e2", color: "#dc2626", label: "Missing" },
  };
  const c = colors[status];
  return (
    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 12, fontSize: "0.78rem", fontWeight: 700, background: c.bg, color: c.color }}>
      {c.label}
    </span>
  );
}

export function SystemHealthPage() {
  const { token } = useSuperAdmin();
  const [health, setHealth] = useState<SystemHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchAdminSystemHealth(token);
      setHealth(r);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [token]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: "0 0 0.2rem" }}>System Health</h1>
          {health && (
            <p style={{ margin: 0, fontSize: "0.8rem", color: "#64748b" }}>
              Last checked: {new Date(health.checkedAt).toLocaleString()}
            </p>
          )}
        </div>
        <button className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? "Checking…" : "Check Now"}</button>
      </div>

      {health && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
          <div style={{ background: "#fff", border: "1px solid #e2eaf4", borderRadius: 10, padding: "1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700 }}>PostgreSQL</h3>
              <StatusBadge status={health.postgres.status} />
            </div>
            <p style={{ margin: 0, fontSize: "0.82rem", color: "#64748b" }}>
              Latency: <strong>{health.postgres.latencyMs}ms</strong>
            </p>
          </div>

          <div style={{ background: "#fff", border: "1px solid #e2eaf4", borderRadius: 10, padding: "1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700 }}>Redis / BullMQ</h3>
              <StatusBadge status={health.redis.status} />
            </div>
            <p style={{ margin: 0, fontSize: "0.82rem", color: "#64748b" }}>
              {health.redis.status === "ok" ? "Queue workers connected" : "Redis not configured or unreachable"}
            </p>
          </div>

          <div style={{ background: "#fff", border: "1px solid #e2eaf4", borderRadius: 10, padding: "1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700 }}>AI Provider</h3>
              <StatusBadge status="ok" />
            </div>
            <p style={{ margin: 0, fontSize: "0.82rem", color: "#64748b" }}>
              Use the <strong>Test Connection</strong> button in Settings to check live AI provider status.
            </p>
          </div>
        </div>
      )}

      {health && health.workers.length > 0 && (
        <section className="finance-panel" style={{ marginTop: "1.5rem" }}>
          <h3 style={{ margin: "0 0 1rem", fontSize: "0.95rem", fontWeight: 700, color: "#122033" }}>Worker Heartbeats</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.75rem" }}>
            {health.workers.map((w: WorkerHeartbeat) => (
              <div key={w.workerName} style={{ background: w.status === "stale" ? "#fffbeb" : "#f8fafc", border: `1px solid ${w.status === "stale" ? "#fde68a" : "#e2eaf4"}`, borderRadius: 8, padding: "0.9rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <strong style={{ fontSize: "0.85rem", color: "#122033" }}>{w.workerName}</strong>
                  <StatusBadge status={w.status} />
                </div>
                <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748b" }}>
                  Last ping: {new Date(w.lastPingAt).toLocaleTimeString()}
                  {w.staleSecs > 0 && ` (${w.staleSecs}s ago)`}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {health && health.workers.length === 0 && (
        <div style={{ marginTop: "1.5rem", textAlign: "center", padding: "2rem", color: "#94a3b8", background: "#fff", borderRadius: 10, border: "1px solid #e2eaf4" }}>
          No worker heartbeats recorded yet. Workers ping every 30 seconds once started.
        </div>
      )}

      {!health && !loading && !error && (
        <div style={{ textAlign: "center", padding: "3rem", color: "#94a3b8" }}>Click "Check Now" to run a health check.</div>
      )}

      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}

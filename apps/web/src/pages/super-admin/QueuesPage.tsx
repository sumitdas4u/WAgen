import { useEffect, useRef, useState } from "react";
import { fetchAdminQueues, retryAdminQueueFailed, pauseAdminQueue, type AdminQueueStat } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

export function QueuesPage() {
  const { token } = useSuperAdmin();
  const [queues, setQueues] = useState<AdminQueueStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const r = await fetchAdminQueues(token);
      setQueues(r.queues);
      setLastRefresh(new Date());
    } catch (e) { setError((e as Error).message); } finally { if (!silent) setLoading(false); }
  };

  useEffect(() => {
    void load();
    intervalRef.current = setInterval(() => { void load(true); }, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [token]);

  const handleRetry = async (queueName: string) => {
    setLoading(true); setError(null); setInfo(null);
    try {
      await retryAdminQueueFailed(token, queueName);
      setInfo(`Queued retry for failed jobs in ${queueName}`);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  const handlePause = async (queueName: string, pause: boolean) => {
    setLoading(true); setError(null); setInfo(null);
    try {
      await pauseAdminQueue(token, queueName, pause);
      setInfo(`${queueName} ${pause ? "paused" : "resumed"}`);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  const totalFailed = queues.reduce((s, q) => s + q.failed, 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: "0 0 0.2rem" }}>Queue Monitor</h1>
          <p style={{ margin: 0, fontSize: "0.8rem", color: "#64748b" }}>
            Auto-refreshes every 30s
            {lastRefresh && ` · Last: ${lastRefresh.toLocaleTimeString()}`}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {totalFailed > 0 && (
            <span style={{ padding: "3px 10px", borderRadius: 12, background: "#fee2e2", color: "#be123c", fontSize: "0.8rem", fontWeight: 700 }}>
              {totalFailed} failed
            </span>
          )}
          <button className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        {queues.map((q) => (
          <div key={q.name} style={{
            background: "#fff",
            border: `1px solid ${q.failed > 0 ? "#fca5a5" : "#e2eaf4"}`,
            borderRadius: 10,
            padding: "1rem 1.25rem",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
              <h3 style={{ fontSize: "0.85rem", fontWeight: 700, color: "#122033", margin: 0, wordBreak: "break-word" }}>{q.name}</h3>
              {q.failed > 0 && (
                <span style={{ padding: "2px 8px", borderRadius: 10, background: "#fee2e2", color: "#be123c", fontSize: "0.72rem", fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>
                  {q.failed} failed
                </span>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem", marginBottom: "0.75rem" }}>
              {[
                { label: "Waiting", value: q.waiting, color: "#f59e0b" },
                { label: "Active", value: q.active, color: "#3b82f6" },
                { label: "Delayed", value: q.delayed, color: "#8b5cf6" },
                { label: "Completed", value: q.completed, color: "#22c55e" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ textAlign: "center", background: "#f8fafc", borderRadius: 6, padding: "6px 4px" }}>
                  <div style={{ fontSize: "1.1rem", fontWeight: 700, color }}>{value.toLocaleString()}</div>
                  <div style={{ fontSize: "0.68rem", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: "0.4rem" }}>
              {q.failed > 0 && (
                <button
                  className="ghost-btn"
                  style={{ flex: 1, fontSize: "0.78rem", padding: "4px 8px", borderColor: "#fca5a5", color: "#be123c" }}
                  disabled={loading}
                  onClick={() => void handleRetry(q.name)}
                >
                  Retry Failed
                </button>
              )}
              <button
                className="ghost-btn"
                style={{ flex: 1, fontSize: "0.78rem", padding: "4px 8px" }}
                disabled={loading}
                onClick={() => void handlePause(q.name, true)}
              >
                Pause
              </button>
              <button
                className="ghost-btn"
                style={{ flex: 1, fontSize: "0.78rem", padding: "4px 8px" }}
                disabled={loading}
                onClick={() => void handlePause(q.name, false)}
              >
                Resume
              </button>
            </div>
          </div>
        ))}

        {queues.length === 0 && !loading && (
          <div style={{ gridColumn: "1 / -1", textAlign: "center", color: "#94a3b8", padding: "3rem" }}>
            No queue data available. Ensure Redis is connected and workers are running.
          </div>
        )}
      </div>

      {info && <p className="info-text" style={{ marginTop: "1rem" }}>{info}</p>}
      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}

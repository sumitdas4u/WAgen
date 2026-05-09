import { useEffect, useRef, useState } from "react";
import { fetchAdminAuditLogs, type AdminAuditLogEntry } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

interface LiveEvent {
  id: string;
  type: string;
  workspaceId?: string;
  workspaceName?: string;
  detail?: Record<string, unknown>;
  timestamp: string;
  source: "live" | "audit";
  action?: string;
  adminEmail?: string;
  detailsJson?: Record<string, unknown>;
}

const ACTION_ICONS: Record<string, string> = {
  "workspace.": "🏢",
  "broadcast.": "📢",
  "kill_switch.": "⚡",
  "credits.": "💳",
  "plan.": "📋",
  "provider.": "🤖",
  "model.": "🔧",
  "user.": "👤",
  "prompt.": "✏️",
  "spend_limits.": "💰",
  "system.": "⚙️",
};

function getIcon(action?: string): string {
  if (!action) return "📡";
  for (const [prefix, icon] of Object.entries(ACTION_ICONS)) {
    if (action.startsWith(prefix)) return icon;
  }
  return "📝";
}

function auditEntryToEvent(l: AdminAuditLogEntry): LiveEvent {
  return {
    id: l.id,
    type: l.action,
    workspaceId: l.workspaceId ?? undefined,
    timestamp: l.createdAt,
    source: "audit",
    action: l.action,
    adminEmail: l.adminEmail ?? undefined,
    detailsJson: l.detailsJson,
  };
}

const API_BASE = import.meta.env.VITE_API_URL ?? "";

export function ActivityPage() {
  const { token } = useSuperAdmin();
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const eventsRef = useRef<LiveEvent[]>([]);

  const pushEvent = (ev: LiveEvent) => {
    eventsRef.current = [ev, ...eventsRef.current].slice(0, 200);
    setEvents([...eventsRef.current]);
  };

  // Load initial audit log as baseline
  useEffect(() => {
    fetchAdminAuditLogs(token, { limit: 50 })
      .then((r) => {
        const initial = r.logs.map(auditEntryToEvent);
        eventsRef.current = initial;
        setEvents(initial);
      })
      .catch(() => {/* non-fatal */});
  }, [token]);

  // Connect SSE
  useEffect(() => {
    const url = `${API_BASE}/api/admin/activity/stream`;
    const es = new EventSource(url, {
      // Pass token via query param since EventSource doesn't support custom headers
    });

    // SSE spec: open without auth headers — we need a workaround.
    // Instead, use fetch-based SSE via ReadableStream if token auth is needed.
    // For now, the SSE endpoint falls back to cookie auth; if that fails, we poll.
    esRef.current = es;

    es.onopen = () => { setConnected(true); setError(null); };
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string) as Omit<LiveEvent, "id" | "source">;
        pushEvent({ ...data, id: `live-${Date.now()}-${Math.random()}`, source: "live" });
      } catch { /* ignore malformed */ }
    };
    es.onerror = () => {
      setConnected(false);
      es.close();
      // Fall back to polling every 15s
      const fallback = setInterval(() => {
        fetchAdminAuditLogs(token, { limit: 20 })
          .then((r) => {
            for (const l of r.logs) {
              if (!eventsRef.current.find((ev) => ev.id === l.id)) {
                pushEvent(auditEntryToEvent(l));
              }
            }
          })
          .catch(() => {/* ignore */});
      }, 15_000);
      return () => clearInterval(fallback);
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [token]);

  const refresh = () => {
    fetchAdminAuditLogs(token, { limit: 50 })
      .then((r) => {
        eventsRef.current = r.logs.map(auditEntryToEvent);
        setEvents([...eventsRef.current]);
      })
      .catch((e) => setError((e as Error).message));
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: "0 0 0.2rem" }}>Activity Feed</h1>
          <p style={{ margin: 0, fontSize: "0.8rem", color: "#64748b" }}>
            {connected
              ? <><span style={{ color: "#16a34a", fontWeight: 600 }}>● Live</span> — real-time events via SSE</>
              : "Polling audit log every 15s"}
          </p>
        </div>
        <button className="ghost-btn" onClick={refresh}>Refresh</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {events.map((ev) => (
          <div key={ev.id} style={{
            background: "#fff",
            border: `1px solid ${ev.source === "live" ? "#bfdbfe" : "#e2eaf4"}`,
            borderRadius: 8,
            padding: "0.75rem 1rem",
            display: "flex",
            alignItems: "flex-start",
            gap: "0.75rem",
          }}>
            <span style={{ fontSize: "1.2rem", flexShrink: 0, marginTop: 2 }}>
              {getIcon(ev.action ?? ev.type)}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                {ev.source === "live" && (
                  <span style={{ padding: "2px 6px", borderRadius: 6, fontSize: "0.68rem", fontWeight: 700, background: "#dbeafe", color: "#1d4ed8" }}>
                    LIVE
                  </span>
                )}
                <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: "0.75rem", fontWeight: 600, background: "#f1f5f9", color: "#475569" }}>
                  {ev.action ?? ev.type}
                </span>
                {ev.adminEmail && (
                  <span style={{ fontSize: "0.8rem", color: "#64748b" }}>by {ev.adminEmail}</span>
                )}
                {(ev.workspaceName ?? ev.workspaceId) && (
                  <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                    {ev.workspaceName ?? ev.workspaceId?.slice(0, 8) + "…"}
                  </span>
                )}
              </div>
              {ev.detailsJson && Object.keys(ev.detailsJson).length > 0 && (
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.78rem", color: "#64748b" }}>
                  {Object.entries(ev.detailsJson).slice(0, 3).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}
                </p>
              )}
              {ev.detail && Object.keys(ev.detail).length > 0 && (
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.78rem", color: "#64748b" }}>
                  {Object.entries(ev.detail).slice(0, 3).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}
                </p>
              )}
            </div>
            <span style={{ fontSize: "0.75rem", color: "#94a3b8", flexShrink: 0 }}>
              {new Date(ev.timestamp).toLocaleTimeString()}
            </span>
          </div>
        ))}
        {events.length === 0 && (
          <div style={{ textAlign: "center", padding: "3rem", color: "#94a3b8", background: "#fff", borderRadius: 10, border: "1px solid #e2eaf4" }}>
            No activity yet. Events will appear here in real time.
          </div>
        )}
      </div>

      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}

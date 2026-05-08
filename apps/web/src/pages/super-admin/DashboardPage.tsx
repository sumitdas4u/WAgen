import { useEffect, useState } from "react";
import {
  fetchAdminOverview,
  fetchAdminUsers,
  fetchAdminSubscriptions,
  fetchAdminWorkspaces,
  fetchAdminUserUsage,
  fetchAdminAlerts,
  fetchAdminSessions,
  adjustAdminWorkspaceCredits,
  resetAdminWorkspaceWallet,
  updateAdminWorkspaceStatus,
  type AdminOverview,
  type AdminUserUsage,
  type AdminSubscriptionSummary,
  type AdminWorkspaceSummary,
  type UsageAnalyticsResponse,
  type AdminAlert,
  type AdminSession,
} from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const fmt = (v: number) => `INR ${v.toFixed(4)}`;

const ALERT_COLORS: Record<string, { bg: string; border: string; dot: string }> = {
  critical: { bg: "#fff5f5", border: "#fecaca", dot: "#ef4444" },
  warn: { bg: "#fffbeb", border: "#fde68a", dot: "#f59e0b" },
};

export function DashboardPage() {
  const { token } = useSuperAdmin();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUserUsage[]>([]);
  const [subscriptions, setSubscriptions] = useState<AdminSubscriptionSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<AdminWorkspaceSummary[]>([]);
  const [alerts, setAlerts] = useState<AdminAlert[]>([]);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [usageUser, setUsageUser] = useState<AdminUserUsage | null>(null);
  const [usage, setUsage] = useState<UsageAnalyticsResponse["usage"] | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, us, subs, ws, al, sess] = await Promise.all([
        fetchAdminOverview(token),
        fetchAdminUsers(token, { limit: 300 }),
        fetchAdminSubscriptions(token, { limit: 300 }),
        fetchAdminWorkspaces(token, { limit: 500 }),
        fetchAdminAlerts(token).catch(() => ({ alerts: [] as AdminAlert[] })),
        fetchAdminSessions(token, 20).catch(() => ({ sessions: [] as AdminSession[] })),
      ]);
      setOverview(ov.overview);
      setUsers(us.users);
      setSubscriptions(subs.subscriptions);
      setWorkspaces(ws.workspaces);
      setAlerts(al.alerts);
      setSessions(sess.sessions);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [token]);

  const handleStatus = async (ws: AdminWorkspaceSummary, status: "active" | "suspended" | "deleted") => {
    setLoading(true); setError(null); setInfo(null);
    try {
      await updateAdminWorkspaceStatus(token, ws.workspaceId, { status });
      setInfo(`${ws.workspaceName} is now ${status}.`);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  const handleAdjust = async (ws: AdminWorkspaceSummary, delta: number) => {
    setLoading(true); setError(null); setInfo(null);
    try {
      await adjustAdminWorkspaceCredits(token, { workspaceId: ws.workspaceId, deltaCredits: delta, reason: "Super admin adjustment" });
      setInfo(`Adjusted ${ws.workspaceName} by ${delta} credits.`);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  const handleReset = async (ws: AdminWorkspaceSummary) => {
    setLoading(true); setError(null); setInfo(null);
    try {
      await resetAdminWorkspaceWallet(token, { workspaceId: ws.workspaceId, reason: "Super admin reset" });
      setInfo(`Reset ${ws.workspaceName} wallet.`);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  const openUsage = async (user: AdminUserUsage) => {
    setUsageUser(user); setUsage(null); setUsageLoading(true); setError(null);
    try {
      const r = await fetchAdminUserUsage(token, user.userId, { days: 30, limit: 200 });
      setUsage(r.usage);
    } catch (e) { setError((e as Error).message); } finally { setUsageLoading(false); }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>Dashboard</h1>
        <button className="ghost-btn" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* System Alerts */}
      {alerts.length > 0 && (
        <section style={{ marginBottom: "1.5rem", display: "flex", flexDirection: "column", gap: "8px" }}>
          {alerts.map((a, i) => {
            const c = ALERT_COLORS[a.severity] ?? ALERT_COLORS.warn;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 16px",
                  background: c.bg,
                  border: `1px solid ${c.border}`,
                  borderRadius: "8px",
                  fontSize: "0.84rem",
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.dot, flexShrink: 0 }} />
                <span style={{ color: "#122033", fontWeight: 600 }}>{a.message}</span>
                <span style={{ marginLeft: "auto", fontSize: "0.74rem", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {a.severity}
                </span>
              </div>
            );
          })}
        </section>
      )}

      {/* Overview stats */}
      <section className="overview-grid" style={{ marginBottom: "1.5rem" }}>
        <article><h3>Total SaaS Users</h3><p>{overview?.totalUsers ?? 0}</p></article>
        <article><h3>Active Agents</h3><p>{overview?.activeAgents ?? 0}</p></article>
        <article><h3>Total Messages</h3><p>{overview?.totalMessages ?? 0}</p></article>
        <article><h3>Knowledge Chunks</h3><p>{overview?.totalChunks ?? 0}</p></article>
      </section>

      {/* Recent Admin Logins */}
      {sessions.length > 0 && (
        <section className="finance-panel" style={{ marginBottom: "1.5rem" }}>
          <h2>Recent Admin Logins</h2>
          <div className="finance-table-wrap">
            <table className="finance-table">
              <thead>
                <tr>
                  <th>Admin</th><th>IP Address</th><th>User Agent</th><th>When</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.adminEmail}</td>
                    <td>{s.ipAddress ?? "-"}</td>
                    <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.userAgent ?? "-"}
                    </td>
                    <td>{new Date(s.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Users analytics */}
      <section className="finance-panel">
        <h2>All Users Analytics</h2>
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>Name</th><th>Email</th><th>Plan</th><th>AI</th>
                <th>Conversations</th><th>Messages</th><th>Chunks</th>
                <th>Tokens</th><th>Cost (INR)</th><th>Created</th><th>Usage</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.plan}</td>
                  <td>{u.aiActive ? "On" : "Off"}</td>
                  <td>{u.conversations}</td>
                  <td>{u.messages}</td>
                  <td>{u.chunks}</td>
                  <td>{u.totalTokens}</td>
                  <td>{u.costInr.toFixed(4)}</td>
                  <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td>
                    <button className="ghost-btn" onClick={() => void openUsage(u)}>View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Workspace credit control */}
      <section className="finance-panel">
        <h2>Workspace Credit Control</h2>
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>Workspace</th><th>Owner</th><th>Status</th><th>Plan</th><th>Credits</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((ws) => (
                <tr key={ws.workspaceId}>
                  <td>{ws.workspaceName}</td>
                  <td>{ws.ownerName}<br /><small>{ws.ownerEmail}</small></td>
                  <td>{ws.workspaceStatus}</td>
                  <td>{ws.planName ?? ws.planCode ?? "-"}</td>
                  <td>{ws.remainingCredits} / {ws.totalCredits}</td>
                  <td>
                    <div className="header-actions">
                      <button className="ghost-btn" disabled={loading}
                        onClick={() => void handleStatus(ws, ws.workspaceStatus === "active" ? "suspended" : "active")}>
                        {ws.workspaceStatus === "active" ? "Suspend" : "Activate"}
                      </button>
                      <button className="ghost-btn" disabled={loading} onClick={() => void handleAdjust(ws, 100)}>+100</button>
                      <button className="ghost-btn" disabled={loading} onClick={() => void handleAdjust(ws, -100)}>-100</button>
                      <button className="ghost-btn" disabled={loading} onClick={() => void handleReset(ws)}>Reset Wallet</button>
                      <button className="ghost-btn" disabled={loading || ws.workspaceStatus === "deleted"}
                        onClick={() => void handleStatus(ws, "deleted")}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Subscriptions */}
      <section className="finance-panel">
        <h2>Subscription & Payment Details</h2>
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>User</th><th>Email</th><th>Plan</th><th>Status</th>
                <th>Razorpay ID</th><th>Current End</th><th>Last Payment</th><th>Pay Status</th><th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((s) => (
                <tr key={s.id}>
                  <td>{s.userName}</td>
                  <td>{s.userEmail}</td>
                  <td>{s.planCode}</td>
                  <td>{s.status}</td>
                  <td>{s.razorpaySubscriptionId ?? "-"}</td>
                  <td>{s.currentEndAt ? new Date(s.currentEndAt).toLocaleString() : "-"}</td>
                  <td>{s.lastPayment ? `${(s.lastPayment.amountPaise / 100).toFixed(2)} ${s.lastPayment.currency}` : "-"}</td>
                  <td>{s.lastPayment?.status ?? "-"}</td>
                  <td>{new Date(s.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {info && <p className="info-text" style={{ marginTop: "1rem" }}>{info}</p>}
      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}

      {/* Usage modal */}
      {usageUser && (
        <div className="kb-modal-backdrop" onClick={() => setUsageUser(null)}>
          <div className="kb-modal kb-modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>Usage: {usageUser.name} (Last 30 days)</h3>
            {usageLoading && <p className="tiny-note">Loading usage…</p>}
            {!usageLoading && usage && (
              <>
                <div className="overview-grid finance-grid">
                  <article><h3>AI Messages</h3><p>{usage.messages}</p></article>
                  <article><h3>Total Tokens</h3><p>{usage.total_tokens}</p></article>
                  <article><h3>Cost (INR)</h3><p>{fmt(usage.estimated_cost_inr)}</p></article>
                  <article><h3>Avg / Message</h3><p>{fmt(usage.messages > 0 ? usage.estimated_cost_inr / usage.messages : 0)}</p></article>
                </div>
                <div className="finance-panels">
                  <article className="finance-panel">
                    <h2>Cost by Model</h2>
                    {usage.by_model.length ? (
                      <div className="finance-table-wrap">
                        <table className="finance-table">
                          <thead><tr><th>Model</th><th>Messages</th><th>Tokens</th><th>Cost (INR)</th></tr></thead>
                          <tbody>
                            {usage.by_model.map((r) => (
                              <tr key={r.ai_model}>
                                <td>{r.ai_model}</td><td>{r.messages}</td>
                                <td>{r.total_tokens}</td><td>{fmt(r.estimated_cost_inr)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <p className="empty-note">No model data yet.</p>}
                  </article>
                  <article className="finance-panel">
                    <h2>Recent Message Cost</h2>
                    {usage.recent_messages.length ? (
                      <div className="finance-table-wrap">
                        <table className="finance-table">
                          <thead><tr><th>Time</th><th>Phone</th><th>Model</th><th>Tokens</th><th>Cost (INR)</th></tr></thead>
                          <tbody>
                            {usage.recent_messages.slice(0, 60).map((r) => (
                              <tr key={r.message_id}>
                                <td>{new Date(r.created_at).toLocaleString()}</td>
                                <td>{r.conversation_phone}</td><td>{r.ai_model}</td>
                                <td>{r.total_tokens}</td><td>{fmt(r.estimated_cost_inr)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <p className="empty-note">No messages yet.</p>}
                  </article>
                </div>
              </>
            )}
            <div className="kb-modal-actions">
              <button className="primary-btn" onClick={() => setUsageUser(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

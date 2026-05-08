import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  fetchAdminUserDetail,
  toggleAdminUserAiActive,
  forceAdminPasswordReset,
  fetchAdminUserUsage,
  type AdminUserDetail,
  type UsageAnalyticsResponse,
} from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const fmt = (v: number) => `₹${v.toFixed(4)}`;

const PLAN_COLORS: Record<string, { bg: string; color: string }> = {
  trial: { bg: "#e0f2fe", color: "#0369a1" },
  starter: { bg: "#f0fdf4", color: "#16a34a" },
  pro: { bg: "#eff6ff", color: "#2563eb" },
  business: { bg: "#faf5ff", color: "#7c3aed" },
};

function Badge({ label, color = "#64748b", bg = "#f1f5f9" }: { label: string; color?: string; bg?: string }) {
  return (
    <span style={{ background: bg, color, padding: "2px 10px", borderRadius: 12, fontSize: "0.75rem", fontWeight: 600 }}>
      {label}
    </span>
  );
}

export function UserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const { token } = useSuperAdmin();
  const navigate = useNavigate();

  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [usage, setUsage] = useState<UsageAnalyticsResponse["usage"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    Promise.all([
      fetchAdminUserDetail(token, userId),
      fetchAdminUserUsage(token, userId, { days: 30, limit: 200 }),
    ])
      .then(([uRes, usageRes]) => {
        setUser(uRes.user);
        setUsage(usageRes.usage);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [token, userId]);

  const handleToggleAi = async () => {
    if (!userId || !user) return;
    setToggling(true);
    setActionMsg(null);
    try {
      await toggleAdminUserAiActive(token, userId, !user.aiActive);
      setUser({ ...user, aiActive: !user.aiActive });
      setActionMsg(`AI ${!user.aiActive ? "enabled" : "disabled"} successfully.`);
    } catch (e) { setError((e as Error).message); }
    finally { setToggling(false); }
  };

  const handleForceReset = async () => {
    if (!userId) return;
    setResetting(true);
    setActionMsg(null);
    try {
      await forceAdminPasswordReset(token, userId);
      setActionMsg("Password reset email sent successfully.");
    } catch (e) { setError((e as Error).message); }
    finally { setResetting(false); }
  };

  if (loading) return <p className="tiny-note">Loading user…</p>;
  if (!user) return <p className="tiny-note">User not found.</p>;

  const planC = PLAN_COLORS[user.planCode ?? ""] ?? { bg: "#f1f5f9", color: "#475569" };

  return (
    <div>
      {/* Back */}
      <button className="ghost-btn" style={{ marginBottom: "0.75rem", fontSize: "0.8rem" }} onClick={() => navigate("/super-admin/users")}>
        ← Back to Users
      </button>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>{user.name}</h1>
            {user.planCode && <Badge label={user.planCode} bg={planC.bg} color={planC.color} />}
            <Badge
              label={user.aiActive ? "AI On" : "AI Off"}
              bg={user.aiActive ? "#dcfce7" : "#f1f5f9"}
              color={user.aiActive ? "#16a34a" : "#94a3b8"}
            />
          </div>
          <p style={{ color: "#64748b", fontSize: "0.85rem", margin: "4px 0 0" }}>
            {user.email}{user.phone ? ` · ${user.phone}` : ""} · Joined {new Date(user.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button className="primary-btn" disabled={toggling} onClick={() => void handleToggleAi()}
            style={{ background: user.aiActive ? "#dc2626" : "#22c55e", border: "none" }}>
            {toggling ? "…" : user.aiActive ? "Disable AI" : "Enable AI"}
          </button>
          <button className="ghost-btn" disabled={resetting} onClick={() => void handleForceReset()}>
            {resetting ? "Sending…" : "Force Password Reset"}
          </button>
        </div>
      </div>

      {actionMsg && <p style={{ color: "#16a34a", fontSize: "0.85rem", marginBottom: "1rem", background: "#dcfce7", padding: "8px 12px", borderRadius: 6 }}>{actionMsg}</p>}
      {error && <p className="error-text" style={{ marginBottom: "1rem" }}>{error}</p>}

      {/* Stats grid */}
      <div className="overview-grid" style={{ marginBottom: "1.5rem" }}>
        <article><h3>AI Token Balance</h3><p>{user.aiTokenBalance.toLocaleString()}</p></article>
        <article><h3>Total Tokens Used</h3><p>{user.totalTokens.toLocaleString()}</p></article>
        <article><h3>Total AI Cost</h3><p>{fmt(user.totalCostInr)}</p></article>
        <article><h3>Conversations</h3><p>{user.totalConversations.toLocaleString()}</p></article>
        <article><h3>Messages</h3><p>{user.totalMessages.toLocaleString()}</p></article>
        <article><h3>Broadcasts</h3><p>{user.totalBroadcasts.toLocaleString()}</p></article>
        <article><h3>KB Chunks</h3><p>{user.totalChunks.toLocaleString()}</p></article>
        <article>
          <h3>Workspace</h3>
          <p style={{ fontSize: "0.8rem" }}>
            {user.workspaceName ?? "—"}
            {user.workspaceId && (
              <button className="ghost-btn" style={{ marginLeft: 6, padding: "1px 6px", fontSize: "0.72rem" }}
                onClick={() => navigate(`/super-admin/workspaces/${user.workspaceId}`)}>
                View
              </button>
            )}
          </p>
        </article>
      </div>

      {/* User details */}
      <section className="finance-panel" style={{ marginBottom: "1.25rem" }}>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.75rem" }}>Account Details</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem 1.5rem", fontSize: "0.85rem", color: "#334155" }}>
          <div><span style={{ color: "#64748b" }}>User ID:</span> <span style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{user.userId}</span></div>
          <div><span style={{ color: "#64748b" }}>Plan:</span> {user.planName ?? user.planCode ?? "—"}</div>
          <div><span style={{ color: "#64748b" }}>Subscription:</span> {user.subscriptionStatus ?? "—"}</div>
          <div><span style={{ color: "#64748b" }}>AI Active:</span> {user.aiActive ? "Yes" : "No"}</div>
        </div>
      </section>

      {/* AI Usage (last 30 days) */}
      {usage && (
        <section className="finance-panel">
          <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.75rem" }}>AI Usage — Last 30 Days</h3>
          <div className="overview-grid finance-grid" style={{ marginBottom: "1rem" }}>
            <article><h3>AI Messages</h3><p>{usage.messages}</p></article>
            <article><h3>Total Tokens</h3><p>{usage.total_tokens.toLocaleString()}</p></article>
            <article><h3>Cost</h3><p>{fmt(usage.estimated_cost_inr)}</p></article>
            <article><h3>Avg/Message</h3><p>{fmt(usage.messages > 0 ? usage.estimated_cost_inr / usage.messages : 0)}</p></article>
          </div>
          {usage.by_model.length > 0 && (
            <div className="finance-table-wrap">
              <table className="finance-table">
                <thead>
                  <tr><th>Model</th><th>Messages</th><th>Tokens</th><th>Cost</th></tr>
                </thead>
                <tbody>
                  {usage.by_model.map((r) => (
                    <tr key={r.ai_model}>
                      <td>{r.ai_model}</td>
                      <td>{r.messages}</td>
                      <td>{r.total_tokens.toLocaleString()}</td>
                      <td>{fmt(r.estimated_cost_inr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

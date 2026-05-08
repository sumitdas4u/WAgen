import { useEffect, useState } from "react";
import {
  fetchAdminWorkspaces,
  updateAdminWorkspaceStatus,
  adjustAdminWorkspaceCredits,
  resetAdminWorkspaceWallet,
  type AdminWorkspaceSummary,
} from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const STATUS_COLORS: Record<string, string> = {
  active: "#22c55e",
  suspended: "#f59e0b",
  deleted: "#ef4444",
};

export function WorkspacesPage() {
  const { token } = useSuperAdmin();
  const [workspaces, setWorkspaces] = useState<AdminWorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [adjustAmount, setAdjustAmount] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchAdminWorkspaces(token, { limit: 500 });
      setWorkspaces(r.workspaces);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [token]);

  const handleStatus = async (ws: AdminWorkspaceSummary, status: "active" | "suspended" | "deleted") => {
    if (status === "deleted" && !confirm(`Permanently delete "${ws.workspaceName}"?`)) return;
    setLoading(true); setError(null); setInfo(null);
    try {
      await updateAdminWorkspaceStatus(token, ws.workspaceId, { status });
      setInfo(`${ws.workspaceName} → ${status}`);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  const handleAdjust = async (ws: AdminWorkspaceSummary) => {
    const raw = adjustAmount[ws.workspaceId] ?? "";
    const delta = parseInt(raw, 10);
    if (!Number.isFinite(delta) || delta === 0) { setError("Enter a non-zero integer"); return; }
    setLoading(true); setError(null); setInfo(null);
    try {
      await adjustAdminWorkspaceCredits(token, { workspaceId: ws.workspaceId, deltaCredits: delta, reason: "Super admin adjustment" });
      setInfo(`Adjusted ${ws.workspaceName} by ${delta} credits`);
      setAdjustAmount((a) => ({ ...a, [ws.workspaceId]: "" }));
      await load();
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  const handleReset = async (ws: AdminWorkspaceSummary) => {
    if (!confirm(`Reset wallet for "${ws.workspaceName}"?`)) return;
    setLoading(true); setError(null); setInfo(null);
    try {
      await resetAdminWorkspaceWallet(token, { workspaceId: ws.workspaceId, reason: "Super admin reset" });
      setInfo(`Wallet reset for ${ws.workspaceName}`);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  const filtered = workspaces.filter((ws) => {
    if (statusFilter && ws.workspaceStatus !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return ws.workspaceName.toLowerCase().includes(q) || ws.ownerEmail.toLowerCase().includes(q) || ws.ownerName.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>Workspaces</h1>
        <button className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Search workspace / owner…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem", width: 260 }}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem" }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="deleted">Deleted</option>
        </select>
        <span style={{ fontSize: "0.82rem", color: "#64748b" }}>{filtered.length} workspace{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      <section className="finance-panel">
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>Workspace</th><th>Owner</th><th>Plan</th><th>Status</th>
                <th>Credits</th><th>Subscription</th><th>Adjust Credits</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ws) => (
                <tr key={ws.workspaceId}>
                  <td><strong>{ws.workspaceName}</strong></td>
                  <td>{ws.ownerName}<br /><small style={{ color: "#64748b" }}>{ws.ownerEmail}</small></td>
                  <td>{ws.planName ?? ws.planCode ?? "-"}</td>
                  <td>
                    <span style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 12,
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      background: `${STATUS_COLORS[ws.workspaceStatus] ?? "#ccc"}20`,
                      color: STATUS_COLORS[ws.workspaceStatus] ?? "#666",
                    }}>
                      {ws.workspaceStatus}
                    </span>
                  </td>
                  <td>{ws.remainingCredits} / {ws.totalCredits}</td>
                  <td>{ws.subscriptionStatus ?? "-"}</td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input
                        type="number"
                        placeholder="±delta"
                        value={adjustAmount[ws.workspaceId] ?? ""}
                        onChange={(e) => setAdjustAmount((a) => ({ ...a, [ws.workspaceId]: e.target.value }))}
                        style={{ width: 70, padding: "4px 6px", borderRadius: 5, border: "1px solid #ddd", fontSize: "0.8rem" }}
                      />
                      <button className="ghost-btn" style={{ padding: "4px 8px" }} disabled={loading} onClick={() => void handleAdjust(ws)}>Apply</button>
                    </div>
                  </td>
                  <td>
                    <div className="header-actions">
                      <button
                        className="ghost-btn"
                        disabled={loading}
                        onClick={() => void handleStatus(ws, ws.workspaceStatus === "active" ? "suspended" : "active")}
                      >
                        {ws.workspaceStatus === "active" ? "Suspend" : "Activate"}
                      </button>
                      <button className="ghost-btn" disabled={loading} onClick={() => void handleReset(ws)}>Reset Wallet</button>
                      <button
                        className="ghost-btn"
                        disabled={loading || ws.workspaceStatus === "deleted"}
                        style={{ color: "#be123c", borderColor: "#fecdd3" }}
                        onClick={() => void handleStatus(ws, "deleted")}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "#94a3b8", padding: "2rem" }}>No workspaces found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {info && <p className="info-text" style={{ marginTop: "1rem" }}>{info}</p>}
      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}

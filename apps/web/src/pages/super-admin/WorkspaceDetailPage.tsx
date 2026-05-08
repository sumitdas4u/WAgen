import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  fetchAdminWorkspaceDetail,
  fetchWorkspaceCreditLedger,
  overrideWorkspacePlan,
  fetchWorkspaceNotes,
  createWorkspaceNote,
  updateWorkspaceNote,
  deleteWorkspaceNote,
  fetchWorkspaceSpendLimits,
  setWorkspaceSpendLimits,
  type AdminWorkspaceDetail,
  type CreditLedgerEntry,
  type AdminNote,
  type WorkspaceSpendLimits,
} from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const fmt = (v: number) => `₹${v.toFixed(2)}`;

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  active: { bg: "#dcfce7", color: "#16a34a" },
  suspended: { bg: "#fef3c7", color: "#d97706" },
  deleted: { bg: "#fee2e2", color: "#dc2626" },
  trial: { bg: "#e0f2fe", color: "#0369a1" },
};

function Badge({ label, variant = "default" }: { label: string; variant?: string }) {
  const c = STATUS_COLORS[variant] ?? { bg: "#f1f5f9", color: "#475569" };
  return (
    <span style={{ background: c.bg, color: c.color, padding: "2px 10px", borderRadius: 12, fontSize: "0.75rem", fontWeight: 600 }}>
      {label}
    </span>
  );
}

type Tab = "overview" | "ledger" | "notes" | "spend";

export function WorkspaceDetailPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { token } = useSuperAdmin();
  const navigate = useNavigate();

  const [workspace, setWorkspace] = useState<AdminWorkspaceDetail | null>(null);
  const [ledger, setLedger] = useState<CreditLedgerEntry[]>([]);
  const [notes, setNotes] = useState<AdminNote[]>([]);
  const [spendLimits, setSpendLimits] = useState<WorkspaceSpendLimits | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Plan override state
  const [overridePlan, setOverridePlan] = useState("");
  const [planSaving, setPlanSaving] = useState(false);

  // Notes state
  const [newNote, setNewNote] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  // Spend limits form
  const [spendForm, setSpendForm] = useState({ dailyCapInr: "", monthlyCapInr: "", actionOnBreach: "pause_ai", notifyEmail: "" });
  const [spendSaving, setSpendSaving] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    Promise.all([
      fetchAdminWorkspaceDetail(token, workspaceId),
      fetchWorkspaceCreditLedger(token, workspaceId, 100),
      fetchWorkspaceNotes(token, workspaceId),
      fetchWorkspaceSpendLimits(token, workspaceId),
    ])
      .then(([wRes, lRes, nRes, sRes]) => {
        setWorkspace(wRes.workspace);
        setOverridePlan(wRes.workspace.planCode ?? "");
        setLedger(lRes.entries);
        setNotes(nRes.notes);
        const sl = sRes.limits;
        setSpendLimits(sl);
        if (sl) {
          setSpendForm({
            dailyCapInr: sl.dailyCapInr !== null ? String(sl.dailyCapInr) : "",
            monthlyCapInr: sl.monthlyCapInr !== null ? String(sl.monthlyCapInr) : "",
            actionOnBreach: sl.actionOnBreach,
            notifyEmail: sl.notifyEmail ?? "",
          });
        }
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [token, workspaceId]);

  const handlePlanOverride = async () => {
    if (!workspaceId || !overridePlan) return;
    setPlanSaving(true);
    try {
      await overrideWorkspacePlan(token, workspaceId, overridePlan);
      const res = await fetchAdminWorkspaceDetail(token, workspaceId);
      setWorkspace(res.workspace);
    } catch (e) { setError((e as Error).message); }
    finally { setPlanSaving(false); }
  };

  const handleAddNote = async () => {
    if (!workspaceId || !newNote.trim()) return;
    setNoteSaving(true);
    try {
      const res = await createWorkspaceNote(token, workspaceId, newNote.trim());
      setNotes([res.note, ...notes]);
      setNewNote("");
    } catch (e) { setError((e as Error).message); }
    finally { setNoteSaving(false); }
  };

  const handlePinNote = async (noteId: string, isPinned: boolean) => {
    if (!workspaceId) return;
    try {
      const res = await updateWorkspaceNote(token, workspaceId, noteId, { isPinned });
      setNotes(notes.map((n) => n.id === noteId ? res.note : n).sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0)));
    } catch (e) { setError((e as Error).message); }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!workspaceId) return;
    try {
      await deleteWorkspaceNote(token, workspaceId, noteId);
      setNotes(notes.filter((n) => n.id !== noteId));
    } catch (e) { setError((e as Error).message); }
  };

  const handleSaveSpendLimits = async () => {
    if (!workspaceId) return;
    setSpendSaving(true);
    try {
      const res = await setWorkspaceSpendLimits(token, workspaceId, {
        dailyCapInr: spendForm.dailyCapInr ? Number(spendForm.dailyCapInr) : null,
        monthlyCapInr: spendForm.monthlyCapInr ? Number(spendForm.monthlyCapInr) : null,
        actionOnBreach: spendForm.actionOnBreach,
        notifyEmail: spendForm.notifyEmail || null,
      });
      setSpendLimits(res.limits);
    } catch (e) { setError((e as Error).message); }
    finally { setSpendSaving(false); }
  };

  if (loading) return <p className="tiny-note">Loading workspace…</p>;
  if (!workspace) return <p className="tiny-note">Workspace not found.</p>;

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "overview", label: "Overview" },
    { key: "ledger", label: `Credit Ledger (${ledger.length})` },
    { key: "notes", label: `Notes (${notes.length})` },
    { key: "spend", label: "AI Spend Limits" },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <button className="ghost-btn" style={{ marginBottom: "0.75rem", fontSize: "0.8rem" }} onClick={() => navigate("/super-admin/workspaces")}>
          ← Back to Workspaces
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>{workspace.workspaceName}</h1>
          <Badge label={workspace.status} variant={workspace.status} />
          {workspace.planCode && <Badge label={workspace.planCode} variant={workspace.subscriptionStatus === "active" ? "active" : "default"} />}
        </div>
        <p style={{ color: "#64748b", fontSize: "0.85rem", margin: "4px 0 0" }}>
          {workspace.ownerEmail} · Joined {new Date(workspace.createdAt).toLocaleDateString()}
        </p>
      </div>

      {error && <p className="error-text" style={{ marginBottom: "1rem" }}>{error}</p>}

      {/* Tab bar */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", borderBottom: "2px solid #e2e8f0", paddingBottom: "2px" }}>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "6px 16px", border: "none", background: "none", cursor: "pointer",
            fontWeight: tab === t.key ? 700 : 400,
            color: tab === t.key ? "#ef8354" : "#64748b",
            borderBottom: tab === t.key ? "2px solid #ef8354" : "2px solid transparent",
            marginBottom: "-2px", fontSize: "0.88rem",
          }}>{t.label}</button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === "overview" && (
        <div>
          <div className="overview-grid" style={{ marginBottom: "1.5rem" }}>
            <article><h3>Total Credits</h3><p>{workspace.totalCredits.toLocaleString()}</p></article>
            <article><h3>Used Credits</h3><p>{workspace.usedCredits.toLocaleString()}</p></article>
            <article><h3>Remaining</h3><p>{workspace.remainingCredits.toLocaleString()}</p></article>
            <article><h3>Conversations</h3><p>{workspace.totalConversations.toLocaleString()}</p></article>
            <article><h3>Messages</h3><p>{workspace.totalMessages.toLocaleString()}</p></article>
            <article><h3>Broadcasts</h3><p>{workspace.totalBroadcasts.toLocaleString()}</p></article>
            <article><h3>Knowledge Chunks</h3><p>{workspace.totalKnowledgeChunks.toLocaleString()}</p></article>
            <article><h3>AI Active</h3><p style={{ color: workspace.aiActive ? "#22c55e" : "#94a3b8" }}>{workspace.aiActive ? "Yes" : "No"}</p></article>
          </div>

          {/* Owner info */}
          <section className="finance-panel" style={{ marginBottom: "1.25rem" }}>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.75rem" }}>Owner</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem 1.5rem", fontSize: "0.85rem", color: "#334155" }}>
              <div><span style={{ color: "#64748b" }}>Name:</span> {workspace.ownerName}</div>
              <div><span style={{ color: "#64748b" }}>Email:</span> {workspace.ownerEmail}</div>
              <div><span style={{ color: "#64748b" }}>Phone:</span> {workspace.ownerPhone ?? "—"}</div>
              <div><span style={{ color: "#64748b" }}>Plan:</span> {workspace.planName ?? workspace.planCode ?? "—"}</div>
              <div><span style={{ color: "#64748b" }}>Subscription:</span> {workspace.subscriptionStatus ?? "—"}</div>
              <div><span style={{ color: "#64748b" }}>Next Billing:</span> {workspace.nextBillingDate ? new Date(workspace.nextBillingDate).toLocaleDateString() : "—"}</div>
            </div>
          </section>

          {/* Plan Override */}
          <section className="finance-panel">
            <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.75rem" }}>Override Plan</h3>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
              <select value={overridePlan} onChange={(e) => setOverridePlan(e.target.value)}
                style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem" }}>
                <option value="">— select plan —</option>
                <option value="trial">Trial</option>
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
                <option value="business">Business</option>
              </select>
              <button className="primary-btn" disabled={planSaving || !overridePlan} onClick={() => void handlePlanOverride()}>
                {planSaving ? "Saving…" : "Apply Plan"}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Credit Ledger tab */}
      {tab === "ledger" && (
        <section className="finance-panel">
          {ledger.length === 0 ? (
            <p className="tiny-note">No credit transactions found.</p>
          ) : (
            <div className="finance-table-wrap">
              <table className="finance-table">
                <thead>
                  <tr><th>Type</th><th>Credits</th><th>Reason</th><th>Reference</th><th>Date</th></tr>
                </thead>
                <tbody>
                  {ledger.map((e) => (
                    <tr key={e.id}>
                      <td><span style={{ fontWeight: 600, color: e.credits >= 0 ? "#16a34a" : "#dc2626" }}>{e.type}</span></td>
                      <td style={{ fontWeight: 600, color: e.credits >= 0 ? "#16a34a" : "#dc2626" }}>
                        {e.credits >= 0 ? "+" : ""}{e.credits.toLocaleString()}
                      </td>
                      <td style={{ fontSize: "0.8rem", color: "#64748b" }}>{e.reason ?? "—"}</td>
                      <td style={{ fontSize: "0.75rem", color: "#94a3b8", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{e.referenceId ?? "—"}</td>
                      <td style={{ fontSize: "0.8rem" }}>{new Date(e.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Notes tab */}
      {tab === "notes" && (
        <div>
          <section className="finance-panel" style={{ marginBottom: "1rem" }}>
            <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.75rem" }}>Add Note</h3>
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Write an internal note about this workspace…"
              style={{ width: "100%", minHeight: 80, padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem", resize: "vertical", boxSizing: "border-box" }}
            />
            <div style={{ marginTop: "0.5rem" }}>
              <button className="primary-btn" disabled={noteSaving || !newNote.trim()} onClick={() => void handleAddNote()}>
                {noteSaving ? "Posting…" : "Post Note"}
              </button>
            </div>
          </section>

          {notes.length === 0 ? (
            <p className="tiny-note">No notes yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {notes.map((n) => (
                <div key={n.id} style={{
                  background: n.isPinned ? "#fefce8" : "#fff",
                  border: `1px solid ${n.isPinned ? "#fde047" : "#e2e8f0"}`,
                  borderRadius: 8, padding: "0.75rem 1rem"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                    <div style={{ fontSize: "0.85rem", color: "#334155", whiteSpace: "pre-wrap", flex: 1 }}>{n.content}</div>
                    <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                      <button className="ghost-btn" style={{ padding: "2px 8px", fontSize: "0.75rem" }}
                        onClick={() => void handlePinNote(n.id, !n.isPinned)}>
                        {n.isPinned ? "Unpin" : "Pin"}
                      </button>
                      <button className="ghost-btn" style={{ padding: "2px 8px", fontSize: "0.75rem", color: "#dc2626" }}
                        onClick={() => void handleDeleteNote(n.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                  <p style={{ margin: "6px 0 0", fontSize: "0.75rem", color: "#94a3b8" }}>
                    {n.adminEmail} · {new Date(n.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Spend Limits tab */}
      {tab === "spend" && (
        <section className="finance-panel">
          <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 1rem" }}>AI Spend Limits</h3>

          {spendLimits && (
            <div className="overview-grid" style={{ marginBottom: "1.25rem" }}>
              <article><h3>Today's Spend</h3><p>{fmt(spendLimits.currentDaySpendInr)}</p></article>
              <article><h3>Month Spend</h3><p>{fmt(spendLimits.currentMonthSpendInr)}</p></article>
              <article>
                <h3>Breached</h3>
                <p style={{ color: spendLimits.breachedAt ? "#dc2626" : "#22c55e" }}>
                  {spendLimits.breachedAt ? new Date(spendLimits.breachedAt).toLocaleDateString() : "No"}
                </p>
              </article>
              <article><h3>Action</h3><p style={{ fontSize: "0.8rem" }}>{spendLimits.actionOnBreach}</p></article>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem 1.25rem" }}>
            <label style={{ fontSize: "0.85rem", color: "#475569" }}>
              Daily Cap (INR, blank = no cap)
              <input type="number" min="0" value={spendForm.dailyCapInr} onChange={(e) => setSpendForm({ ...spendForm, dailyCapInr: e.target.value })}
                placeholder="e.g. 500" style={{ display: "block", width: "100%", marginTop: 4, padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem", boxSizing: "border-box" }} />
            </label>
            <label style={{ fontSize: "0.85rem", color: "#475569" }}>
              Monthly Cap (INR, blank = no cap)
              <input type="number" min="0" value={spendForm.monthlyCapInr} onChange={(e) => setSpendForm({ ...spendForm, monthlyCapInr: e.target.value })}
                placeholder="e.g. 10000" style={{ display: "block", width: "100%", marginTop: 4, padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem", boxSizing: "border-box" }} />
            </label>
            <label style={{ fontSize: "0.85rem", color: "#475569" }}>
              Action on Breach
              <select value={spendForm.actionOnBreach} onChange={(e) => setSpendForm({ ...spendForm, actionOnBreach: e.target.value })}
                style={{ display: "block", width: "100%", marginTop: 4, padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem" }}>
                <option value="pause_ai">Pause AI</option>
                <option value="alert_only">Alert Only</option>
                <option value="pause_ai_and_alert">Pause AI + Alert</option>
              </select>
            </label>
            <label style={{ fontSize: "0.85rem", color: "#475569" }}>
              Notify Email (optional)
              <input type="email" value={spendForm.notifyEmail} onChange={(e) => setSpendForm({ ...spendForm, notifyEmail: e.target.value })}
                placeholder="alerts@example.com" style={{ display: "block", width: "100%", marginTop: 4, padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem", boxSizing: "border-box" }} />
            </label>
          </div>
          <div style={{ marginTop: "1rem" }}>
            <button className="primary-btn" disabled={spendSaving} onClick={() => void handleSaveSpendLimits()}>
              {spendSaving ? "Saving…" : "Save Limits"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

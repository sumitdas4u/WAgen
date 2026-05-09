import { useEffect, useState } from "react";
import {
  fetchAdminFeatureFlags,
  updateAdminFeatureFlag,
  createAdminFeatureFlag,
  fetchWorkspaceFeatureFlagOverrides,
  setWorkspaceFeatureFlagOverride,
  removeWorkspaceFeatureFlagOverride,
  type AdminFeatureFlag,
  type WorkspaceFeatureFlagOverride,
} from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

export function FeatureFlagsPage() {
  const { token } = useSuperAdmin();
  const [flags, setFlags] = useState<AdminFeatureFlag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newFlag, setNewFlag] = useState({ key: "", name: "", description: "" });

  // Workspace override modal state
  const [overrideModal, setOverrideModal] = useState<{ flagKey: string; flagName: string } | null>(null);
  const [overrideWorkspaceId, setOverrideWorkspaceId] = useState("");
  const [overrideEnabled, setOverrideEnabled] = useState(true);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrides, setOverrides] = useState<WorkspaceFeatureFlagOverride[]>([]);
  const [overrideSaving, setOverrideSaving] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchAdminFeatureFlags(token);
      setFlags(r.flags);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [token]);

  const handleToggle = async (flag: AdminFeatureFlag) => {
    setLoading(true); setError(null); setInfo(null);
    try {
      await updateAdminFeatureFlag(token, flag.key, { enabledGlobally: !flag.enabledGlobally });
      setInfo(`${flag.name}: ${!flag.enabledGlobally ? "enabled" : "disabled"} globally`);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  const handleRollout = async (flag: AdminFeatureFlag, pct: number) => {
    setLoading(true); setError(null); setInfo(null);
    try {
      await updateAdminFeatureFlag(token, flag.key, { rolloutPercent: pct });
      setInfo(`${flag.name} rollout set to ${pct}%`);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  const handleCreate = async () => {
    if (!newFlag.key.trim() || !newFlag.name.trim()) { setError("Key and Name are required"); return; }
    setLoading(true); setError(null); setInfo(null);
    try {
      await createAdminFeatureFlag(token, { ...newFlag, enabledGlobally: false, rolloutPercent: 0 });
      setInfo(`Feature flag "${newFlag.key}" created`);
      setNewFlag({ key: "", name: "", description: "" });
      setShowCreate(false);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  const openOverrideModal = async (flag: AdminFeatureFlag) => {
    setOverrideModal({ flagKey: flag.key, flagName: flag.name });
    setOverrideWorkspaceId(""); setOverrideEnabled(true); setOverrideReason(""); setOverrides([]);
  };

  const loadOverrides = async (workspaceId: string) => {
    if (!workspaceId.match(/^[0-9a-f-]{36}$/i)) return;
    try {
      const r = await fetchWorkspaceFeatureFlagOverrides(token, workspaceId);
      setOverrides(r.overrides);
    } catch { /* non-fatal */ }
  };

  const handleSetOverride = async () => {
    if (!overrideModal || !overrideWorkspaceId.match(/^[0-9a-f-]{36}$/i)) {
      setError("Enter a valid workspace UUID"); return;
    }
    setOverrideSaving(true); setError(null);
    try {
      await setWorkspaceFeatureFlagOverride(token, overrideWorkspaceId, overrideModal.flagKey, overrideEnabled, overrideReason || undefined);
      setInfo(`Override set for ${overrideModal.flagKey} on workspace ${overrideWorkspaceId.slice(0, 8)}…`);
      await loadOverrides(overrideWorkspaceId);
    } catch (e) { setError((e as Error).message); } finally { setOverrideSaving(false); }
  };

  const handleRemoveOverride = async (workspaceId: string, flagKey: string) => {
    try {
      await removeWorkspaceFeatureFlagOverride(token, workspaceId, flagKey);
      setOverrides((prev) => prev.filter((o) => o.flagKey !== flagKey));
      setInfo("Override removed");
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>Feature Flags</h1>
        <div className="header-actions">
          <button className="ghost-btn" onClick={() => setShowCreate(true)}>New Flag</button>
          <button className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        </div>
      </div>

      {flags.length === 0 && !loading ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#94a3b8", background: "#fff", borderRadius: 10, border: "1px solid #e2eaf4" }}>
          No feature flags yet. Create one to get started.
        </div>
      ) : (
        <section className="finance-panel">
          <div className="finance-table-wrap">
            <table className="finance-table">
              <thead>
                <tr>
                  <th>Key</th><th>Name</th><th>Description</th>
                  <th>Global</th><th>Rollout %</th><th>Last Updated</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {flags.map((f) => (
                  <tr key={f.id}>
                    <td><code style={{ background: "#f1f5f9", padding: "2px 6px", borderRadius: 4, fontSize: "0.78rem" }}>{f.key}</code></td>
                    <td><strong>{f.name}</strong></td>
                    <td style={{ fontSize: "0.8rem", color: "#64748b", maxWidth: 200 }}>{f.description ?? "-"}</td>
                    <td>
                      <button
                        onClick={() => void handleToggle(f)}
                        disabled={loading}
                        style={{ padding: "4px 12px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: "0.78rem", fontWeight: 700, background: f.enabledGlobally ? "#dcfce7" : "#f1f5f9", color: f.enabledGlobally ? "#16a34a" : "#94a3b8", transition: "all 0.2s" }}
                      >
                        {f.enabledGlobally ? "ON" : "OFF"}
                      </button>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="range" min={0} max={100} value={f.rolloutPercent}
                          onChange={(e) => { const pct = parseInt(e.target.value, 10); setFlags((prev) => prev.map((x) => x.id === f.id ? { ...x, rolloutPercent: pct } : x)); }}
                          onMouseUp={(e) => void handleRollout(f, parseInt((e.target as HTMLInputElement).value, 10))}
                          onTouchEnd={(e) => void handleRollout(f, parseInt((e.target as HTMLInputElement).value, 10))}
                          style={{ width: 80 }} disabled={loading}
                        />
                        <span style={{ fontSize: "0.8rem", fontWeight: 600, minWidth: 28 }}>{f.rolloutPercent}%</span>
                      </div>
                    </td>
                    <td style={{ fontSize: "0.78rem" }}>{new Date(f.updatedAt).toLocaleDateString()}</td>
                    <td>
                      <div style={{ display: "flex", gap: "0.4rem" }}>
                        <button className="ghost-btn" style={{ fontSize: "0.78rem", padding: "3px 8px" }} disabled={loading} onClick={() => void handleToggle(f)}>
                          {f.enabledGlobally ? "Disable" : "Enable"}
                        </button>
                        <button className="ghost-btn" style={{ fontSize: "0.78rem", padding: "3px 8px", color: "#6366f1" }} disabled={loading} onClick={() => void openOverrideModal(f)}>
                          Override
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {info && <p className="info-text" style={{ marginTop: "1rem" }}>{info}</p>}
      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}

      {/* Create Flag Modal */}
      {showCreate && (
        <div className="kb-modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="kb-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h3>New Feature Flag</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: "0.3rem" }}>Key *</label>
                <input value={newFlag.key} onChange={(e) => setNewFlag((d) => ({ ...d, key: e.target.value.replace(/\s+/g, "_").toLowerCase() }))}
                  placeholder="new_inbox_ui" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #ddd", boxSizing: "border-box", fontSize: "0.85rem" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: "0.3rem" }}>Name *</label>
                <input value={newFlag.name} onChange={(e) => setNewFlag((d) => ({ ...d, name: e.target.value }))}
                  placeholder="New Inbox UI" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #ddd", boxSizing: "border-box", fontSize: "0.85rem" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: "0.3rem" }}>Description</label>
                <input value={newFlag.description} onChange={(e) => setNewFlag((d) => ({ ...d, description: e.target.value }))}
                  placeholder="Optional description" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #ddd", boxSizing: "border-box", fontSize: "0.85rem" }} />
              </div>
            </div>
            <div className="kb-modal-actions">
              <button className="ghost-btn" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="primary-btn" onClick={() => void handleCreate()} disabled={loading}>Create Flag</button>
            </div>
          </div>
        </div>
      )}

      {/* Workspace Override Modal */}
      {overrideModal && (
        <div className="kb-modal-backdrop" onClick={() => setOverrideModal(null)}>
          <div className="kb-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <h3>Workspace Override — <code style={{ fontSize: "0.9rem" }}>{overrideModal.flagKey}</code></h3>
            <p style={{ fontSize: "0.82rem", color: "#64748b", margin: "0 0 1rem" }}>
              Set a per-workspace override that takes precedence over global setting and rollout %.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: "0.3rem" }}>Workspace ID (UUID)</label>
                <input value={overrideWorkspaceId}
                  onChange={(e) => { setOverrideWorkspaceId(e.target.value); void loadOverrides(e.target.value); }}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #ddd", boxSizing: "border-box", fontSize: "0.85rem" }} />
              </div>
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>Override value:</label>
                <button onClick={() => setOverrideEnabled(true)} style={{ padding: "4px 14px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 700, fontSize: "0.78rem", background: overrideEnabled ? "#dcfce7" : "#f1f5f9", color: overrideEnabled ? "#16a34a" : "#94a3b8" }}>ON</button>
                <button onClick={() => setOverrideEnabled(false)} style={{ padding: "4px 14px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 700, fontSize: "0.78rem", background: !overrideEnabled ? "#fee2e2" : "#f1f5f9", color: !overrideEnabled ? "#dc2626" : "#94a3b8" }}>OFF</button>
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: "0.3rem" }}>Reason (optional)</label>
                <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="e.g. beta tester, support exception"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #ddd", boxSizing: "border-box", fontSize: "0.85rem" }} />
              </div>
            </div>

            {overrides.length > 0 && (
              <div style={{ marginBottom: "1rem" }}>
                <p style={{ fontSize: "0.8rem", fontWeight: 600, margin: "0 0 0.5rem", color: "#475569" }}>Existing overrides for this workspace:</p>
                {overrides.map((o) => (
                  <div key={o.flagKey} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "#f8fafc", borderRadius: 6, marginBottom: "0.3rem", fontSize: "0.8rem" }}>
                    <span><code>{o.flagKey}</code> → <strong style={{ color: o.enabled ? "#16a34a" : "#dc2626" }}>{o.enabled ? "ON" : "OFF"}</strong></span>
                    <button className="ghost-btn" style={{ fontSize: "0.72rem", padding: "2px 6px", color: "#dc2626" }} onClick={() => void handleRemoveOverride(overrideWorkspaceId, o.flagKey)}>Remove</button>
                  </div>
                ))}
              </div>
            )}

            <div className="kb-modal-actions">
              <button className="ghost-btn" onClick={() => setOverrideModal(null)}>Close</button>
              <button className="primary-btn" onClick={() => void handleSetOverride()} disabled={overrideSaving || !overrideWorkspaceId}>
                {overrideSaving ? "Saving…" : "Set Override"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

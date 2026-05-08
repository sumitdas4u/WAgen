import { useEffect, useState } from "react";
import { fetchAdminFeatureFlags, updateAdminFeatureFlag, createAdminFeatureFlag, type AdminFeatureFlag } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

export function FeatureFlagsPage() {
  const { token } = useSuperAdmin();
  const [flags, setFlags] = useState<AdminFeatureFlag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newFlag, setNewFlag] = useState({ key: "", name: "", description: "" });

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
                        style={{
                          padding: "4px 12px",
                          borderRadius: 20,
                          border: "none",
                          cursor: "pointer",
                          fontSize: "0.78rem",
                          fontWeight: 700,
                          background: f.enabledGlobally ? "#dcfce7" : "#f1f5f9",
                          color: f.enabledGlobally ? "#16a34a" : "#94a3b8",
                          transition: "all 0.2s",
                        }}
                      >
                        {f.enabledGlobally ? "ON" : "OFF"}
                      </button>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={f.rolloutPercent}
                          onChange={(e) => {
                            const pct = parseInt(e.target.value, 10);
                            setFlags((prev) => prev.map((x) => x.id === f.id ? { ...x, rolloutPercent: pct } : x));
                          }}
                          onMouseUp={(e) => void handleRollout(f, parseInt((e.target as HTMLInputElement).value, 10))}
                          onTouchEnd={(e) => void handleRollout(f, parseInt((e.target as HTMLInputElement).value, 10))}
                          style={{ width: 80 }}
                          disabled={loading}
                        />
                        <span style={{ fontSize: "0.8rem", fontWeight: 600, minWidth: 28 }}>{f.rolloutPercent}%</span>
                      </div>
                    </td>
                    <td style={{ fontSize: "0.78rem" }}>{new Date(f.updatedAt).toLocaleDateString()}</td>
                    <td>
                      <button
                        className="ghost-btn"
                        style={{ fontSize: "0.78rem", padding: "3px 8px" }}
                        disabled={loading}
                        onClick={() => void handleToggle(f)}
                      >
                        {f.enabledGlobally ? "Disable" : "Enable"}
                      </button>
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

      {showCreate && (
        <div className="kb-modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="kb-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h3>New Feature Flag</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: "0.3rem" }}>Key *</label>
                <input
                  value={newFlag.key}
                  onChange={(e) => setNewFlag((d) => ({ ...d, key: e.target.value.replace(/\s+/g, "_").toLowerCase() }))}
                  placeholder="new_inbox_ui"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #ddd", boxSizing: "border-box", fontSize: "0.85rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: "0.3rem" }}>Name *</label>
                <input
                  value={newFlag.name}
                  onChange={(e) => setNewFlag((d) => ({ ...d, name: e.target.value }))}
                  placeholder="New Inbox UI"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #ddd", boxSizing: "border-box", fontSize: "0.85rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: "0.3rem" }}>Description</label>
                <input
                  value={newFlag.description}
                  onChange={(e) => setNewFlag((d) => ({ ...d, description: e.target.value }))}
                  placeholder="Optional description"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #ddd", boxSizing: "border-box", fontSize: "0.85rem" }}
                />
              </div>
            </div>
            <div className="kb-modal-actions">
              <button className="ghost-btn" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="primary-btn" onClick={() => void handleCreate()} disabled={loading}>Create Flag</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

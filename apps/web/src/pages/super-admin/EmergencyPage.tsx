import { useEffect, useState } from "react";
import { fetchAdminKillSwitches, enableAdminKillSwitch, disableAdminKillSwitch, type AdminKillSwitch } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const SWITCH_LABELS: Record<string, { label: string; description: string; danger: boolean }> = {
  pause_all_broadcasts: {
    label: "Pause All Broadcasts",
    description: "Stops all running campaign-dispatch and campaign-message-send queue jobs. Messages already in flight may still be delivered.",
    danger: false,
  },
  pause_all_ai: {
    label: "Pause All AI Replies",
    description: "Disables AI reply generation across all workspaces immediately. Manual replies still work.",
    danger: false,
  },
  disable_meta_sending: {
    label: "Disable Meta (WABA) Sending",
    description: "Blocks all outbound messages via the Meta WABA API. Returns 503 to callers.",
    danger: true,
  },
  disable_qr_sending: {
    label: "Disable QR Sending",
    description: "Blocks all outbound messages via Baileys QR sessions. Returns 503 to callers.",
    danger: true,
  },
  pause_workers: {
    label: "Pause All Workers",
    description: "Pauses all 8 BullMQ managed queues. Jobs remain in queue but are not processed.",
    danger: true,
  },
  maintenance_mode: {
    label: "Maintenance Mode",
    description: "Returns 503 Service Unavailable on all API routes. Use only for planned downtime.",
    danger: true,
  },
};

export function EmergencyPage() {
  const { token } = useSuperAdmin();
  const [switches, setSwitches] = useState<AdminKillSwitch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchAdminKillSwitches(token);
      setSwitches(r.switches);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [token]);

  const anyEnabled = switches.some((s) => s.enabled);

  const handleToggle = async (key: string, currentlyEnabled: boolean) => {
    if (!currentlyEnabled) {
      setConfirmKey(key);
      setReason("");
      return;
    }
    setLoading(true); setError(null); setInfo(null);
    try {
      await disableAdminKillSwitch(token, key);
      setInfo(`Kill switch "${key}" disabled`);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  const confirmEnable = async () => {
    if (!confirmKey) return;
    setLoading(true); setError(null); setInfo(null);
    setConfirmKey(null);
    try {
      await enableAdminKillSwitch(token, confirmKey, reason || undefined);
      setInfo(`Kill switch "${confirmKey}" ENABLED`);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: "0 0 0.25rem" }}>Emergency Controls</h1>
          <p style={{ margin: 0, fontSize: "0.82rem", color: "#64748b" }}>Platform-wide kill switches for incident response. Use with extreme caution.</p>
        </div>
        <button className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </div>

      {anyEnabled && (
        <div style={{ marginBottom: "1.25rem", padding: "12px 16px", borderRadius: 8, background: "#fee2e2", border: "1px solid #fca5a5" }}>
          <strong style={{ color: "#be123c", fontSize: "0.9rem" }}>
            ⚡ {switches.filter((s) => s.enabled).length} kill switch{switches.filter((s) => s.enabled).length !== 1 ? "es are" : " is"} currently ACTIVE
          </strong>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: "1rem" }}>
        {switches.map((s) => {
          const meta = SWITCH_LABELS[s.key] ?? { label: s.key, description: "", danger: false };
          return (
            <div key={s.key} style={{
              background: "#fff",
              border: `2px solid ${s.enabled ? "#fca5a5" : "#e2eaf4"}`,
              borderRadius: 10,
              padding: "1.25rem",
              transition: "border-color 0.2s",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                <h3 style={{ fontSize: "0.9rem", fontWeight: 700, color: s.enabled ? "#be123c" : "#122033", margin: 0 }}>
                  {meta.label}
                </h3>
                <span style={{
                  padding: "2px 10px",
                  borderRadius: 12,
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  background: s.enabled ? "#fee2e2" : "#f1f5f9",
                  color: s.enabled ? "#be123c" : "#94a3b8",
                }}>
                  {s.enabled ? "ACTIVE" : "OFF"}
                </span>
              </div>
              <p style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", color: "#64748b", lineHeight: 1.5 }}>{meta.description}</p>
              {s.enabled && (
                <div style={{ marginBottom: "0.75rem", padding: "8px 10px", background: "#fff7ed", borderRadius: 6, border: "1px solid #fed7aa" }}>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#92400e" }}>
                    <strong>Enabled by:</strong> {s.enabledBy ?? "unknown"}
                    {s.enabledAt && <><br /><strong>At:</strong> {new Date(s.enabledAt).toLocaleString()}</>}
                    {s.reason && <><br /><strong>Reason:</strong> {s.reason}</>}
                  </p>
                </div>
              )}
              <button
                className={s.enabled ? "primary-btn" : "ghost-btn"}
                style={{
                  width: "100%",
                  background: s.enabled ? "#22c55e" : meta.danger ? "#fee2e2" : undefined,
                  borderColor: s.enabled ? "#22c55e" : meta.danger ? "#fca5a5" : undefined,
                  color: s.enabled ? "#fff" : meta.danger ? "#be123c" : undefined,
                }}
                disabled={loading}
                onClick={() => void handleToggle(s.key, s.enabled)}
              >
                {s.enabled ? "Disable (Turn Off)" : "Enable Kill Switch"}
              </button>
            </div>
          );
        })}
      </div>

      {info && <p className="info-text" style={{ marginTop: "1rem" }}>{info}</p>}
      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}

      {confirmKey && (
        <div className="kb-modal-backdrop" onClick={() => setConfirmKey(null)}>
          <div className="kb-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h3 style={{ color: "#be123c" }}>Enable Kill Switch: {SWITCH_LABELS[confirmKey]?.label ?? confirmKey}</h3>
            <p style={{ fontSize: "0.88rem", color: "#64748b" }}>{SWITCH_LABELS[confirmKey]?.description}</p>
            <p style={{ fontSize: "0.88rem", color: "#ef4444", fontWeight: 600 }}>This will immediately affect all active users on the platform.</p>
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: "0.3rem" }}>Reason (optional)</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Investigating Meta API incident"
                style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #ddd", boxSizing: "border-box", fontSize: "0.85rem" }}
              />
            </div>
            <div className="kb-modal-actions">
              <button className="ghost-btn" onClick={() => setConfirmKey(null)}>Cancel</button>
              <button
                onClick={() => void confirmEnable()}
                style={{ background: "#be123c", color: "#fff", border: "none", padding: "8px 20px", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: "0.88rem" }}
              >
                Enable Kill Switch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

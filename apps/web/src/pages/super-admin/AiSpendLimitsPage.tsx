import { useEffect, useState } from "react";
import { fetchWorkspaceSpendLimits, setWorkspaceSpendLimits, type WorkspaceSpendLimits } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const ACTION_LABELS: Record<string, string> = {
  pause_ai: "Pause AI",
  alert_only: "Alert Only",
  pause_ai_and_alert: "Pause AI + Alert",
};

interface SpendLimitsFormState {
  workspaceId: string;
  dailyCapInr: string;
  monthlyCapInr: string;
  actionOnBreach: string;
  notifyEmail: string;
}

export function AiSpendLimitsPage() {
  const { token } = useSuperAdmin();
  const [form, setForm] = useState<SpendLimitsFormState>({
    workspaceId: "",
    dailyCapInr: "",
    monthlyCapInr: "",
    actionOnBreach: "pause_ai",
    notifyEmail: "",
  });
  const [limits, setLimits] = useState<WorkspaceSpendLimits | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const lookup = async () => {
    if (!form.workspaceId.trim()) { setError("Enter a workspace ID"); return; }
    setLoading(true); setError(null); setInfo(null); setLimits(null);
    try {
      const r = await fetchWorkspaceSpendLimits(token, form.workspaceId.trim());
      if (r.limits) {
        setLimits(r.limits);
        setForm((prev) => ({
          ...prev,
          dailyCapInr: r.limits?.dailyCapInr !== null && r.limits?.dailyCapInr !== undefined ? String(r.limits.dailyCapInr) : "",
          monthlyCapInr: r.limits?.monthlyCapInr !== null && r.limits?.monthlyCapInr !== undefined ? String(r.limits.monthlyCapInr) : "",
          actionOnBreach: r.limits?.actionOnBreach ?? "pause_ai",
          notifyEmail: r.limits?.notifyEmail ?? "",
        }));
      } else {
        setInfo("No spend limits set for this workspace. Configure below to create them.");
      }
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  const save = async () => {
    if (!form.workspaceId.trim()) { setError("Enter a workspace ID"); return; }
    setSaving(true); setError(null); setInfo(null);
    try {
      const r = await setWorkspaceSpendLimits(token, form.workspaceId.trim(), {
        dailyCapInr: form.dailyCapInr ? Number(form.dailyCapInr) : null,
        monthlyCapInr: form.monthlyCapInr ? Number(form.monthlyCapInr) : null,
        actionOnBreach: form.actionOnBreach,
        notifyEmail: form.notifyEmail || null,
      });
      setLimits(r.limits);
      setInfo("Spend limits saved successfully.");
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };

  const inputStyle = {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #dde2ea",
    borderRadius: 6,
    fontSize: "0.9rem",
    boxSizing: "border-box" as const,
    background: "#fff",
  };

  const labelStyle = {
    display: "block" as const,
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "#475569",
    marginBottom: 4,
  };

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: "0 0 0.4rem" }}>AI Spend Limits</h1>
        <p style={{ margin: 0, color: "#64748b", fontSize: "0.9rem" }}>
          Set daily and monthly AI cost caps per workspace. When a cap is breached the configured action runs automatically.
        </p>
      </div>

      {/* Workspace Lookup */}
      <section className="finance-panel" style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ margin: "0 0 1rem", fontSize: "0.95rem", fontWeight: 700, color: "#122033" }}>Lookup Workspace</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Workspace ID (UUID)</label>
            <input
              style={inputStyle}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={form.workspaceId}
              onChange={(e) => setForm((prev) => ({ ...prev, workspaceId: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") void lookup(); }}
            />
          </div>
          <button className="primary-btn" onClick={() => void lookup()} disabled={loading} style={{ whiteSpace: "nowrap" }}>
            {loading ? "Looking up…" : "Lookup"}
          </button>
        </div>
        {info && <p className="info-text" style={{ marginTop: "0.75rem" }}>{info}</p>}
        {error && <p className="error-text" style={{ marginTop: "0.75rem" }}>{error}</p>}
      </section>

      {/* Current Status */}
      {limits && (
        <section className="finance-panel" style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ margin: "0 0 1rem", fontSize: "0.95rem", fontWeight: 700, color: "#122033" }}>Current Usage</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "1rem" }}>
            <article style={{ background: "#f8fafc", border: "1px solid #e2eaf4", borderRadius: 8, padding: "1rem" }}>
              <h3 style={{ margin: "0 0 0.25rem", fontSize: "0.78rem", color: "#64748b", fontWeight: 600 }}>Today&apos;s Spend</h3>
              <p style={{ margin: 0, fontSize: "1.4rem", fontWeight: 800, color: "#122033" }}>₹{limits.currentDaySpendInr.toFixed(2)}</p>
              {limits.dailyCapInr !== null && (
                <p style={{ margin: "0.2rem 0 0", fontSize: "0.78rem", color: "#94a3b8" }}>Cap: ₹{limits.dailyCapInr}</p>
              )}
            </article>
            <article style={{ background: "#f8fafc", border: "1px solid #e2eaf4", borderRadius: 8, padding: "1rem" }}>
              <h3 style={{ margin: "0 0 0.25rem", fontSize: "0.78rem", color: "#64748b", fontWeight: 600 }}>Month&apos;s Spend</h3>
              <p style={{ margin: 0, fontSize: "1.4rem", fontWeight: 800, color: "#122033" }}>₹{limits.currentMonthSpendInr.toFixed(2)}</p>
              {limits.monthlyCapInr !== null && (
                <p style={{ margin: "0.2rem 0 0", fontSize: "0.78rem", color: "#94a3b8" }}>Cap: ₹{limits.monthlyCapInr}</p>
              )}
            </article>
            <article style={{ background: limits.breachedAt ? "#fee2e2" : "#f8fafc", border: `1px solid ${limits.breachedAt ? "#fca5a5" : "#e2eaf4"}`, borderRadius: 8, padding: "1rem" }}>
              <h3 style={{ margin: "0 0 0.25rem", fontSize: "0.78rem", color: "#64748b", fontWeight: 600 }}>Breach Status</h3>
              <p style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: limits.breachedAt ? "#dc2626" : "#22c55e" }}>
                {limits.breachedAt ? "Breached" : "OK"}
              </p>
              {limits.breachedAt && (
                <p style={{ margin: "0.2rem 0 0", fontSize: "0.78rem", color: "#94a3b8" }}>{new Date(limits.breachedAt).toLocaleString()}</p>
              )}
            </article>
            <article style={{ background: "#f8fafc", border: "1px solid #e2eaf4", borderRadius: 8, padding: "1rem" }}>
              <h3 style={{ margin: "0 0 0.25rem", fontSize: "0.78rem", color: "#64748b", fontWeight: 600 }}>On Breach</h3>
              <p style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#122033" }}>{ACTION_LABELS[limits.actionOnBreach] ?? limits.actionOnBreach}</p>
            </article>
          </div>
        </section>
      )}

      {/* Configuration Form */}
      {(limits !== undefined) && (
        <section className="finance-panel">
          <h3 style={{ margin: "0 0 1rem", fontSize: "0.95rem", fontWeight: 700, color: "#122033" }}>Configure Limits</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <label style={labelStyle}>Daily Cap (INR) — leave blank to remove</label>
              <input
                style={inputStyle}
                type="number"
                min={0}
                step={1}
                placeholder="e.g. 500"
                value={form.dailyCapInr}
                onChange={(e) => setForm((prev) => ({ ...prev, dailyCapInr: e.target.value }))}
              />
            </div>
            <div>
              <label style={labelStyle}>Monthly Cap (INR) — leave blank to remove</label>
              <input
                style={inputStyle}
                type="number"
                min={0}
                step={1}
                placeholder="e.g. 10000"
                value={form.monthlyCapInr}
                onChange={(e) => setForm((prev) => ({ ...prev, monthlyCapInr: e.target.value }))}
              />
            </div>
            <div>
              <label style={labelStyle}>Action on Breach</label>
              <select
                style={inputStyle}
                value={form.actionOnBreach}
                onChange={(e) => setForm((prev) => ({ ...prev, actionOnBreach: e.target.value }))}
              >
                <option value="pause_ai">Pause AI</option>
                <option value="alert_only">Alert Only</option>
                <option value="pause_ai_and_alert">Pause AI + Alert</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Notification Email (optional)</label>
              <input
                style={inputStyle}
                type="email"
                placeholder="notify@example.com"
                value={form.notifyEmail}
                onChange={(e) => setForm((prev) => ({ ...prev, notifyEmail: e.target.value }))}
              />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="primary-btn" onClick={() => void save()} disabled={saving || !form.workspaceId}>
              {saving ? "Saving…" : "Save Limits"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

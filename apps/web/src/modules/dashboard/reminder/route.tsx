import { lazy, Suspense, useState } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { fetchReminderConfigs } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import type { DashboardModulePrefetchContext } from "../../../shared/dashboard/module-contracts";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { useReminderConfigsQuery, useUpsertReminderConfigMutation, useReminderDispatchLogQuery } from "./queries";
import "./reminder.css";

function slugify(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function NewReminderModal({ onClose, onCreated }: { onClose: () => void; onCreated: (key: string) => void }) {
  const { token } = useAuth();
  const upsertMutation = useUpsertReminderConfigMutation(token ?? "");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");

  const configKey = slugify(label);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configKey) { setError("Enter a name."); return; }
    try {
      await upsertMutation.mutateAsync({
        configKey,
        input: { reminderType: "custom", customLabel: label.trim(), enabled: false }
      });
      onCreated(configKey);
    } catch {
      setError("Failed to create reminder.");
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(18,32,51,0.45)",
      display: "grid", placeItems: "center"
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 14, padding: "1.5rem",
        width: "min(420px, 90vw)", display: "grid", gap: "1rem"
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "1.1rem", fontWeight: 700, color: "#122033" }}>
          New Reminder
        </div>

        <form onSubmit={handleCreate} style={{ display: "grid", gap: "0.85rem" }}>
          <div className="rm-field">
            <label className="rm-label">Reminder Name</label>
            <input
              className="rm-input"
              autoFocus
              placeholder="e.g. Policy Renewal, Wedding Anniversary, Membership Expiry"
              value={label}
              onChange={(e) => { setLabel(e.target.value); setError(""); }}
            />
            {configKey && (
              <span className="rm-label-hint">Key: <code>{configKey}</code></span>
            )}
            {error && <span style={{ fontSize: "0.8rem", color: "#dc2626" }}>{error}</span>}
          </div>

          <div style={{ display: "flex", gap: "0.6rem", justifyContent: "flex-end" }}>
            <button type="button" className="rm-btn rm-btn-ghost rm-btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="rm-btn rm-btn-primary rm-btn-sm"
              disabled={!configKey || upsertMutation.isPending}
            >
              {upsertMutation.isPending ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const REMINDER_META_LABELS: Record<string, { icon: string; label: string }> = {
  birthday:    { icon: "🎂", label: "Birthday" },
  anniversary: { icon: "💍", label: "Anniversary" }
};

const STATUS_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  sent:      { color: "#166534", bg: "#dcfce7", border: "#bbf7d0" },
  failed:    { color: "#be123c", bg: "#ffe4e6", border: "#fecdd3" },
  pending:   { color: "#92400e", bg: "#fef3c7", border: "#fde68a" },
  delivered: { color: "#1d4ed8", bg: "#dbeafe", border: "#bfdbfe" }
};

function DispatchLogSection() {
  const { token } = useAuth();
  const [days, setDays] = useState(7);
  const { data: logs, isLoading } = useReminderDispatchLogQuery(token ?? "", { days });

  return (
    <div className="rm-table-card">
      <div className="rm-toolbar">
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.95rem", fontWeight: 700, color: "#122033" }}>
          Recent Dispatch Log
        </div>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              style={{
                appearance: "none", height: "1.9rem", padding: "0 0.65rem",
                border: "1px solid #e2eaf4", borderRadius: 8,
                background: days === d ? "#f0f4ff" : "#fff",
                borderColor: days === d ? "#c7d6f7" : "#e2eaf4",
                color: days === d ? "#2563eb" : "#5f6f86",
                fontSize: "0.75rem", fontWeight: 600, cursor: "pointer"
              }}
            >
              Last {d} days
            </button>
          ))}
        </div>
      </div>
      <div className="rm-table-wrap">
        <table className="rm-table">
          <thead>
            <tr>
              <th>Contact</th>
              <th>Type</th>
              <th>Date</th>
              <th>Template</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={5} className="rm-table-empty">Loading…</td></tr>
            )}
            {!isLoading && (!logs || logs.length === 0) && (
              <tr><td colSpan={5} className="rm-table-empty">No dispatches in the last {days} days.</td></tr>
            )}
            {logs?.map((log) => {
              const meta = REMINDER_META_LABELS[log.config_key] ?? { icon: "📅", label: log.config_key };
              const st = STATUS_STYLE[log.status] ?? STATUS_STYLE["pending"];
              const d = new Date(log.sent_at);
              const dateStr = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
              return (
                <tr key={log.id} style={{ cursor: "default" }}>
                  <td>
                    <div style={{ fontWeight: 700, color: "#122033", fontSize: "0.85rem" }}>{log.contact_name ?? "—"}</div>
                    <div style={{ fontSize: "0.75rem", color: "#5f6f86" }}>{log.contact_phone}</div>
                  </td>
                  <td>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: "0.3rem",
                      padding: "2px 8px", borderRadius: 999,
                      background: "#f0f4ff", border: "1px solid #c7d6f7",
                      fontSize: "0.75rem", fontWeight: 700, color: "#1d4ed8"
                    }}>
                      {meta.icon} {meta.label}
                    </span>
                  </td>
                  <td style={{ color: "#2563eb", fontWeight: 600, fontSize: "0.83rem" }}>{dateStr}</td>
                  <td style={{ fontSize: "0.8rem", color: "#475569" }}>{log.template_name ?? "—"}</td>
                  <td>
                    <span style={{
                      display: "inline-flex", alignItems: "center",
                      padding: "2px 8px", borderRadius: 999,
                      background: st.bg, border: `1px solid ${st.border}`,
                      fontSize: "0.7rem", fontWeight: 800, letterSpacing: "0.04em",
                      textTransform: "uppercase", color: st.color
                    }}>
                      {log.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReminderOverviewPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const { data: configs, isLoading, error } = useReminderConfigsQuery(token ?? "");
  const [showModal, setShowModal] = useState(false);

  if (isLoading) return <div className="rm-loading">Loading reminders…</div>;
  if (error) return <div className="rm-loading" style={{ color: "#dc2626" }}>Failed to load reminders.</div>;

  return (
    <div className="rm-page">
      {showModal && (
        <NewReminderModal
          onClose={() => setShowModal(false)}
          onCreated={(key) => {
            setShowModal(false);
            navigate(`/dashboard/reminder/${key}/capture`);
          }}
        />
      )}
      <div className="rm-list-hero">
        <div className="rm-hero-copy">
          <span className="rm-eyebrow">Automation</span>
          <h1 className="rm-hero-title">Reminders</h1>
          <p className="rm-hero-desc">Date-based capture &amp; campaign automation — birthdays, anniversaries and custom events.</p>
        </div>
        <div className="rm-hero-actions">
          <button className="rm-btn rm-btn-primary" style={{ fontSize: "0.82rem" }} onClick={() => setShowModal(true)}>
            + New Reminder
          </button>
        </div>
      </div>

      <div className="rm-table-card">
        <div className="rm-toolbar">
          <div className="rm-toolbar-left">
            <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#5f6f86" }}>
              {configs?.length ?? 0} reminder{configs?.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        <div className="rm-table-wrap">
          <table className="rm-table">
            <thead>
              <tr>
                <th>Reminder</th>
                <th>Status</th>
                <th>Capture</th>
                <th>Campaign</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(!configs || configs.length === 0) && (
                <tr>
                  <td colSpan={5} className="rm-table-empty">No reminders configured yet.</td>
                </tr>
              )}
              {configs?.map((config) => {
                const meta = REMINDER_META_LABELS[config.config_key] ?? { icon: "📅", label: config.custom_label ?? config.config_key };
                return (
                  <tr key={config.config_key} onClick={() => navigate(`/dashboard/reminder/${config.config_key}/capture`)}>
                    <td>
                      <div className="rm-row-identity">
                        <div className="rm-row-icon">{meta.icon}</div>
                        <div>
                          <div className="rm-row-name">{config.custom_label ?? meta.label}</div>
                          <div className="rm-row-type">{config.reminder_type}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`rm-pill ${config.enabled ? "rm-pill-enabled" : "rm-pill-disabled"}`}>
                        {config.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </td>
                    <td>
                      <span className={`rm-pill ${config.capture_enabled ? "rm-pill-on" : "rm-pill-off"}`}>
                        {config.capture_enabled ? "On" : "Off"}
                      </span>
                    </td>
                    <td>
                      <span className={`rm-pill ${config.campaign_enabled ? "rm-pill-on" : "rm-pill-off"}`}>
                        {config.campaign_enabled ? "On" : "Off"}
                      </span>
                    </td>
                    <td>
                      <div className="rm-row-actions">
                        <button
                          className="rm-btn rm-btn-ghost rm-btn-sm"
                          onClick={(e) => { e.stopPropagation(); navigate(`/dashboard/reminder/${config.config_key}/capture`); }}
                        >
                          Capture
                        </button>
                        <button
                          className="rm-btn rm-btn-ghost rm-btn-sm"
                          onClick={(e) => { e.stopPropagation(); navigate(`/dashboard/reminder/${config.config_key}/campaign`); }}
                        >
                          Campaign
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <DispatchLogSection />
    </div>
  );
}

const LazyCaptureDetail = lazy(() =>
  import("./[config_key]/capture").then((m) => ({ default: m.CapturePage }))
);
const LazyCampaignDetail = lazy(() =>
  import("./[config_key]/campaign").then((m) => ({ default: m.CampaignPage }))
);

function CaptureDetailPage() {
  return (
    <Suspense fallback={<div className="rm-loading">Loading…</div>}>
      <LazyCaptureDetail />
    </Suspense>
  );
}

function CampaignDetailPage() {
  return (
    <Suspense fallback={<div className="rm-loading">Loading…</div>}>
      <LazyCampaignDetail />
    </Suspense>
  );
}

export function Component() {
  return (
    <Routes>
      <Route index element={<ReminderOverviewPage />} />
      <Route path=":configKey/capture" element={<CaptureDetailPage />} />
      <Route path=":configKey/campaign" element={<CampaignDetailPage />} />
      <Route path="*" element={<Navigate to="/dashboard/reminder" replace />} />
    </Routes>
  );
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await queryClient.prefetchQuery({
    queryKey: dashboardQueryKeys.reminderConfigs,
    queryFn: () => fetchReminderConfigs(token).then((result) => result.configs)
  });
}

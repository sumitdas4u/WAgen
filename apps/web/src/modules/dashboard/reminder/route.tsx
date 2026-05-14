import { lazy, Suspense, useState } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { fetchReminderConfigs } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import type { DashboardModulePrefetchContext } from "../../../shared/dashboard/module-contracts";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { useReminderConfigsQuery, useUpsertReminderConfigMutation } from "./queries";
import "./reminder.css";

const REMINDER_META: Record<string, { icon: string; label: string }> = {
  birthday:    { icon: "🎂", label: "Birthday" },
  anniversary: { icon: "💍", label: "Anniversary" }
};

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
                const meta = REMINDER_META[config.config_key] ?? { icon: "📅", label: config.custom_label ?? config.config_key };
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

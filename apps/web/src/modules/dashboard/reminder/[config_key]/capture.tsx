import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../../../lib/auth-context";
import { useReminderConfigsQuery, useUpsertReminderConfigMutation } from "../queries";
import { CaptureSettingsForm } from "../components/CaptureSettingsForm";
import type { ReminderConfigWriteInput } from "../../../../lib/api";
import "../reminder.css";

export function CapturePage() {
  const { configKey } = useParams<{ configKey: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const { data: configs, isLoading } = useReminderConfigsQuery(token ?? "");
  const upsertMutation = useUpsertReminderConfigMutation(token ?? "");

  const config = configs?.find((c) => c.config_key === configKey);

  const handleSave = async (input: ReminderConfigWriteInput) => {
    if (!configKey) return;
    await upsertMutation.mutateAsync({ configKey, input });
  };

  if (isLoading) return <div className="rm-loading">Loading…</div>;
  if (!config) return <div className="rm-loading" style={{ color: "#dc2626" }}>Reminder not found.</div>;

  return (
    <div className="rm-detail-page">
      <div className="rm-detail-header">
        <button className="rm-back-btn" onClick={() => navigate("/dashboard/reminder")}>
          ← Reminders
        </button>
        <h1 className="rm-detail-title">{config.custom_label ?? config.config_key}</h1>
      </div>

      <div className="rm-tabs">
        <button className="rm-tab is-active">
          Capture
          <span className={`rm-tab-badge ${config.capture_enabled ? "rm-tab-badge-on" : "rm-tab-badge-off"}`}>
            {config.capture_enabled ? "on" : "off"}
          </span>
        </button>
        <button
          className="rm-tab"
          onClick={() => navigate(`/dashboard/reminder/${configKey}/campaign`)}
        >
          Campaign
          <span className={`rm-tab-badge ${config.campaign_enabled ? "rm-tab-badge-on" : "rm-tab-badge-off"}`}>
            {config.campaign_enabled ? "on" : "off"}
          </span>
        </button>
      </div>

      <CaptureSettingsForm
        config={config}
        onSave={handleSave}
        isSaving={upsertMutation.isPending}
      />
    </div>
  );
}

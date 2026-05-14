import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../../../lib/auth-context";
import { useReminderConfigsQuery, useReminderStepsQuery, useUpsertReminderConfigMutation } from "../queries";
import { CampaignSettingsForm } from "../components/CampaignSettingsForm";
import type { ReminderConfigWriteInput } from "../../../../lib/api";
import "../reminder.css";

export function CampaignPage() {
  const { configKey } = useParams<{ configKey: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const { data: configs, isLoading: configsLoading } = useReminderConfigsQuery(token ?? "");
  const { data: steps = [], isLoading: stepsLoading } = useReminderStepsQuery(token ?? "", configKey ?? "");
  const upsertMutation = useUpsertReminderConfigMutation(token ?? "");

  const config = configs?.find((c) => c.config_key === configKey);

  const handleSave = async (input: ReminderConfigWriteInput) => {
    if (!configKey) return;
    await upsertMutation.mutateAsync({ configKey, input });
  };

  if (configsLoading || stepsLoading) return <div className="rm-loading">Loading…</div>;
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
        <button
          className="rm-tab"
          onClick={() => navigate(`/dashboard/reminder/${configKey}/capture`)}
        >
          Capture
          <span className={`rm-tab-badge ${config.capture_enabled ? "rm-tab-badge-on" : "rm-tab-badge-off"}`}>
            {config.capture_enabled ? "on" : "off"}
          </span>
        </button>
        <button className="rm-tab is-active">
          Campaign
          <span className={`rm-tab-badge ${config.campaign_enabled ? "rm-tab-badge-on" : "rm-tab-badge-off"}`}>
            {config.campaign_enabled ? "on" : "off"}
          </span>
        </button>
      </div>

      <CampaignSettingsForm
        config={config}
        steps={steps}
        onSave={handleSave}
        isSaving={upsertMutation.isPending}
      />
    </div>
  );
}

import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../../../lib/auth-context";
import { useReminderConfigsQuery, useUpsertReminderConfigMutation } from "../queries";
import { CaptureSettingsForm } from "../components/CaptureSettingsForm";
import type { ReminderConfigWriteInput } from "../../../../lib/api";

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

  if (isLoading) {
    return <div style={{ padding: 24, color: "#64748b" }}>Loading...</div>;
  }

  if (!config) {
    return <div style={{ padding: 24, color: "#dc2626" }}>Reminder config not found.</div>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 680 }}>
      <div style={{ marginBottom: 20 }}>
        <button
          onClick={() => navigate("/dashboard/reminder")}
          style={{ fontSize: 12, color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}
        >
          ← Back to Reminders
        </button>
        <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 700, color: "#122033", marginTop: 8 }}>
          {config.custom_label ?? config.config_key} — Capture Settings
        </h2>
        <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
          <button
            style={{
              fontSize: 13, padding: "6px 16px", borderRadius: 6,
              border: "2px solid #2563eb", background: "#f0f4ff", color: "#2563eb",
              fontWeight: 700, cursor: "pointer", fontFamily: "inherit"
            }}
          >
            Capture
          </button>
          <button
            style={{
              fontSize: 13, padding: "6px 16px", borderRadius: 6,
              border: "1px solid #e2eaf4", background: "#fff", color: "#445068",
              cursor: "pointer", fontFamily: "inherit"
            }}
            onClick={() => navigate(`/dashboard/reminder/${configKey}/campaign`)}
          >
            Campaign
          </button>
        </div>
      </div>

      <CaptureSettingsForm
        config={config}
        onSave={handleSave}
        isSaving={upsertMutation.isPending}
      />
    </div>
  );
}

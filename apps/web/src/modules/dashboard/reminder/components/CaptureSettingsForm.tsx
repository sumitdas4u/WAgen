import { useState } from "react";
import type { ReminderConfig, ReminderConfigWriteInput } from "../../../../lib/api";

interface Props {
  config: ReminderConfig;
  onSave: (input: ReminderConfigWriteInput) => Promise<void>;
  isSaving: boolean;
}

export function CaptureSettingsForm({ config, onSave, isSaving }: Props) {
  const [templateName, setTemplateName] = useState(config.capture_template_name ?? "");
  const [templateLang, setTemplateLang] = useState(config.capture_template_lang);
  const [flowId, setFlowId] = useState(config.capture_flow_id ?? "");
  const [triggerType, setTriggerType] = useState<"create" | "update" | "both">(config.capture_trigger_type);
  const [retryIntervalDays, setRetryIntervalDays] = useState(config.retry_interval_days);
  const [retryMaxCount, setRetryMaxCount] = useState(config.retry_max_count);
  const [cooldownDays, setCooldownDays] = useState(config.cooldown_days);
  const [captureEnabled, setCaptureEnabled] = useState(config.capture_enabled);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave({
      reminderType: config.reminder_type,
      enabled: captureEnabled || config.campaign_enabled,
      captureEnabled,
      captureTemplateName: templateName || null,
      captureTemplateLang: templateLang,
      captureFlowId: flowId || null,
      captureTriggerType: triggerType,
      retryIntervalDays,
      retryMaxCount,
      cooldownDays
    });
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0",
    borderRadius: 6, fontSize: 13, boxSizing: "border-box",
    fontFamily: "inherit", color: "#122033", background: "#fff", outline: "none"
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 600, color: "#445068", marginBottom: 4, display: "block"
  };
  const sectionStyle: React.CSSProperties = {
    background: "#f8fafc", border: "1px solid #e2eaf4", borderRadius: 10, padding: 16, marginBottom: 16
  };

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ ...sectionStyle, display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="checkbox"
          id="captureEnabled"
          checked={captureEnabled}
          onChange={(e) => setCaptureEnabled(e.target.checked)}
        />
        <label htmlFor="captureEnabled" style={{ fontSize: 14, fontWeight: 600, cursor: "pointer", color: "#122033" }}>
          Enable Capture
        </label>
      </div>

      <div style={sectionStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "#122033" }}>
          Step 1 — Permission Template
        </div>
        <label style={labelStyle}>Template Name</label>
        <input
          style={inputStyle}
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          placeholder="e.g. birthday_permission_ask"
        />
        <div style={{ marginTop: 10 }}>
          <label style={labelStyle}>Language Code</label>
          <input
            style={{ ...inputStyle, width: 100 }}
            value={templateLang}
            onChange={(e) => setTemplateLang(e.target.value)}
            placeholder="en"
          />
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
          WhatsApp template that asks permission to capture date. Should have YES / Not Now buttons.
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "#122033" }}>
          Step 2 — Capture Flow
        </div>
        <label style={labelStyle}>Flow ID (UUID of the linked capture flow)</label>
        <input
          style={inputStyle}
          value={flowId}
          onChange={(e) => setFlowId(e.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        />
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
          The flow must contain a "Save to Contact Field" node that stores the date.
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "#122033" }}>
          Step 3 — Trigger
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {(["create", "update", "both"] as const).map((t) => (
            <button
              key={t}
              type="button"
              style={{
                padding: "6px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                border: triggerType === t ? "2px solid #2563eb" : "1px solid #e2eaf4",
                background: triggerType === t ? "#f0f4ff" : "#fff",
                color: triggerType === t ? "#2563eb" : "#445068",
                fontWeight: triggerType === t ? 700 : 400,
                fontFamily: "inherit"
              }}
              onClick={() => setTriggerType(t)}
            >
              {t === "create" ? "On Create" : t === "update" ? "On Update" : "Both"}
            </button>
          ))}
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "#122033" }}>
          Step 4 — Retry & Cooldown
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>Retry after (days)</label>
            <input
              type="number" min={1} max={365}
              style={inputStyle}
              value={retryIntervalDays}
              onChange={(e) => setRetryIntervalDays(Number(e.target.value))}
            />
          </div>
          <div>
            <label style={labelStyle}>Max retries</label>
            <div style={{ display: "flex", gap: 6 }}>
              {[0, 1, 2, 3].map((n) => (
                <button
                  key={n} type="button"
                  style={{
                    width: 36, height: 36, borderRadius: 6, fontSize: 13, cursor: "pointer",
                    border: retryMaxCount === n ? "2px solid #2563eb" : "1px solid #e2eaf4",
                    background: retryMaxCount === n ? "#f0f4ff" : "#fff",
                    color: retryMaxCount === n ? "#2563eb" : "#445068",
                    fontWeight: retryMaxCount === n ? 700 : 400,
                    fontFamily: "inherit"
                  }}
                  onClick={() => setRetryMaxCount(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Cooldown (days)</label>
            <input
              type="number" min={1} max={365}
              style={inputStyle}
              value={cooldownDays}
              onChange={(e) => setCooldownDays(Number(e.target.value))}
            />
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>
          Retry: no response after expiry. Cooldown: contact declined (Not Now).
        </div>
      </div>

      <button
        type="submit"
        disabled={isSaving}
        style={{
          background: "#25d366", color: "#fff", border: "none",
          borderRadius: 10, padding: "10px 24px", fontSize: 13,
          fontWeight: 700, cursor: isSaving ? "not-allowed" : "pointer",
          opacity: isSaving ? 0.7 : 1, fontFamily: "inherit"
        }}
      >
        {isSaving ? "Saving..." : "Save Capture Settings"}
      </button>
    </form>
  );
}

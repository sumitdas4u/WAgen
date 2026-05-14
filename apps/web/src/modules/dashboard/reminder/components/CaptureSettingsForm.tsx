import { useState } from "react";
import type { ReminderConfig, ReminderConfigWriteInput } from "../../../../lib/api";

interface Props {
  config: ReminderConfig;
  onSave: (input: ReminderConfigWriteInput) => Promise<void>;
  isSaving: boolean;
}

export function CaptureSettingsForm({ config, onSave, isSaving }: Props) {
  const [captureEnabled, setCaptureEnabled] = useState(config.capture_enabled);
  const [templateName, setTemplateName] = useState(config.capture_template_name ?? "");
  const [templateLang, setTemplateLang] = useState(config.capture_template_lang ?? "en");
  const [triggerType, setTriggerType] = useState<"create" | "update" | "both">(config.capture_trigger_type);
  const [retryIntervalDays, setRetryIntervalDays] = useState(config.retry_interval_days);
  const [retryMaxCount, setRetryMaxCount] = useState(config.retry_max_count);
  const [cooldownDays, setCooldownDays] = useState(config.cooldown_days);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave({
      reminderType: config.reminder_type,
      enabled: captureEnabled || config.campaign_enabled,
      captureEnabled,
      captureTemplateName: templateName || null,
      captureTemplateLang: templateLang,
      captureFlowId: null,
      captureTriggerType: triggerType,
      retryIntervalDays,
      retryMaxCount,
      cooldownDays
    });
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1rem" }}>
      <div className="rm-card">
        <div className="rm-card-head">
          <span className="rm-card-title">Enable Capture</span>
          <label className="rm-toggle">
            <input
              type="checkbox"
              checked={captureEnabled}
              onChange={(e) => setCaptureEnabled(e.target.checked)}
            />
            <span className="rm-toggle-track" />
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
              {captureEnabled ? "On" : "Off"}
            </span>
          </label>
        </div>

        <div className="rm-card-body">
          <div className="rm-field">
            <label className="rm-label">Permission Template Name</label>
            <input
              className="rm-input"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="e.g. birthday_permission_ask"
            />
            <span className="rm-label-hint">
              WhatsApp template that asks the contact for permission to capture their date.
              Should include YES / Not Now quick-reply buttons.
            </span>
          </div>

          <div className="rm-field" style={{ maxWidth: 140 }}>
            <label className="rm-label">Language</label>
            <input
              className="rm-input rm-input-sm"
              value={templateLang}
              onChange={(e) => setTemplateLang(e.target.value)}
              placeholder="en"
            />
          </div>

          <div className="rm-info-banner">
            <strong>How capture works:</strong> When the contact taps YES, their reply is matched
            as a keyword trigger in your flow → the flow runs → date is saved to their contact field.
            No flow ID is needed here — the flow is linked via the template button ID.
          </div>
        </div>
      </div>

      <div className="rm-card">
        <div className="rm-card-head">
          <span className="rm-card-title">Trigger</span>
        </div>
        <div className="rm-card-body">
          <div className="rm-field">
            <label className="rm-label">Send permission template when contact is…</label>
            <div className="rm-trigger-row">
              {(["create", "update", "both"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`rm-trigger-pill${triggerType === t ? " is-active" : ""}`}
                  onClick={() => setTriggerType(t)}
                >
                  {t === "create" ? "Created" : t === "update" ? "Updated" : "Created or Updated"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rm-card">
        <div className="rm-card-head">
          <span className="rm-card-title">Retry &amp; Cooldown</span>
        </div>
        <div className="rm-card-body">
          <div className="rm-3col">
            <div className="rm-field">
              <label className="rm-label">Retry after (days)</label>
              <input
                type="number" min={1} max={365}
                className="rm-input"
                value={retryIntervalDays}
                onChange={(e) => setRetryIntervalDays(Number(e.target.value))}
              />
              <span className="rm-label-hint">Resend if no response</span>
            </div>
            <div className="rm-field">
              <label className="rm-label">Max retries</label>
              <div className="rm-count-row">
                {[0, 1, 2, 3].map((n) => (
                  <button
                    key={n} type="button"
                    className={`rm-count-btn${retryMaxCount === n ? " is-active" : ""}`}
                    onClick={() => setRetryMaxCount(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="rm-field">
              <label className="rm-label">Cooldown (days)</label>
              <input
                type="number" min={1} max={365}
                className="rm-input"
                value={cooldownDays}
                onChange={(e) => setCooldownDays(Number(e.target.value))}
              />
              <span className="rm-label-hint">Wait after declined</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <button type="submit" disabled={isSaving} className="rm-btn rm-btn-primary">
          {isSaving ? "Saving…" : "Save Capture Settings"}
        </button>
      </div>
    </form>
  );
}

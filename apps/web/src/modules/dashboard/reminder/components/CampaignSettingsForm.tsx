import { useState } from "react";
import type { ReminderConfig, ReminderCampaignStep, ReminderConfigWriteInput, TemplateVarBinding } from "../../../../lib/api";

interface StepDraft {
  stepOrder: number;
  daysBefore: number;
  templateName: string;
  templateLang: string;
  templateVars: Record<string, TemplateVarBinding>;
}

interface Props {
  config: ReminderConfig;
  steps: ReminderCampaignStep[];
  onSave: (input: ReminderConfigWriteInput) => Promise<void>;
  isSaving: boolean;
}

const TIMEZONES = [
  "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo",
  "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles",
  "Africa/Lagos", "Australia/Sydney"
];

const LANGS = ["en", "en_US", "hi", "ar", "id", "pt_BR", "es", "fr"];

function stepFromRow(s: ReminderCampaignStep): StepDraft {
  return {
    stepOrder: s.step_order,
    daysBefore: s.days_before,
    templateName: s.template_name,
    templateLang: s.template_lang,
    templateVars: s.template_vars ?? {}
  };
}

function newStep(order: number): StepDraft {
  return { stepOrder: order, daysBefore: 0, templateName: "", templateLang: "en", templateVars: {} };
}

interface StepEditorProps {
  step: StepDraft;
  index: number;
  onChange: (updated: StepDraft) => void;
  onRemove: () => void;
  isOnly: boolean;
}

function StepEditor({ step, index, onChange, onRemove, isOnly }: StepEditorProps) {
  const [varKey, setVarKey] = useState("");

  const addVar = () => {
    const k = varKey.trim();
    if (!k || k in step.templateVars) return;
    onChange({ ...step, templateVars: { ...step.templateVars, [k]: { source: "contact", field: "" } } });
    setVarKey("");
  };

  const updateVar = (key: string, binding: TemplateVarBinding) => {
    onChange({ ...step, templateVars: { ...step.templateVars, [key]: binding } });
  };

  const removeVar = (key: string) => {
    const next = { ...step.templateVars };
    delete next[key];
    onChange({ ...step, templateVars: next });
  };

  return (
    <div className="rm-step-card">
      <div className="rm-step-head">
        <span className="rm-step-title">Step {index + 1}</span>
        {!isOnly && (
          <button type="button" className="rm-step-remove" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>

      <div className="rm-step-body">
        <div className="rm-step-fields">
          <div className="rm-field">
            <label className="rm-label">Days Before</label>
            <input
              type="number" min={0}
              className="rm-input"
              value={step.daysBefore}
              onChange={(e) => onChange({ ...step, daysBefore: parseInt(e.target.value, 10) || 0 })}
            />
            <span className="rm-label-hint">0 = day of event</span>
          </div>
          <div className="rm-field">
            <label className="rm-label">Template Name</label>
            <input
              type="text"
              className="rm-input"
              placeholder="e.g. birthday_reminder"
              value={step.templateName}
              onChange={(e) => onChange({ ...step, templateName: e.target.value })}
            />
          </div>
          <div className="rm-field">
            <label className="rm-label">Language</label>
            <select
              className="rm-select"
              value={step.templateLang}
              onChange={(e) => onChange({ ...step, templateLang: e.target.value })}
            >
              {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>

        <div>
          <div style={{ fontSize: "0.77rem", fontWeight: 700, color: "#5f6f86", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.5rem" }}>
            Template Variables
          </div>
          {Object.entries(step.templateVars).map(([key, binding]) => (
            <div key={key} className="rm-var-row">
              <div className="rm-var-key">{`{{${key}}}`}</div>
              <select
                className="rm-select rm-input-sm"
                value={binding.source}
                onChange={(e) => updateVar(key, { ...binding, source: e.target.value as "contact" | "static" })}
              >
                <option value="contact">From contact</option>
                <option value="static">Static value</option>
              </select>
              {binding.source === "contact" ? (
                <input
                  type="text"
                  className="rm-input rm-input-sm"
                  placeholder="field name (e.g. display_name)"
                  value={binding.field ?? ""}
                  onChange={(e) => updateVar(key, { source: "contact", field: e.target.value })}
                />
              ) : (
                <input
                  type="text"
                  className="rm-input rm-input-sm"
                  placeholder="static value"
                  value={binding.value ?? ""}
                  onChange={(e) => updateVar(key, { source: "static", value: e.target.value })}
                />
              )}
              <button type="button" className="rm-var-rm" onClick={() => removeVar(key)}>×</button>
            </div>
          ))}
          <div className="rm-add-var-row">
            <input
              type="text"
              className="rm-input rm-input-sm"
              style={{ width: 130 }}
              placeholder="variable name"
              value={varKey}
              onChange={(e) => setVarKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addVar())}
            />
            <button type="button" className="rm-btn rm-btn-ghost rm-btn-sm" onClick={addVar}>
              + Add Variable
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CampaignSettingsForm({ config, steps, onSave, isSaving }: Props) {
  const [campaignEnabled, setCampaignEnabled] = useState(config.campaign_enabled);
  const [sendTime, setSendTime] = useState(config.campaign_send_time.slice(0, 5));
  const [timezone, setTimezone] = useState(config.campaign_timezone);
  const [dispatchMode, setDispatchMode] = useState<"annual" | "exact_date">(config.dispatch_mode);
  const [stepDrafts, setStepDrafts] = useState<StepDraft[]>(
    steps.length > 0 ? steps.map(stepFromRow) : [newStep(1)]
  );

  const updateStep = (i: number, updated: StepDraft) => {
    setStepDrafts((prev) => prev.map((s, idx) => (idx === i ? updated : s)));
  };

  const addStep = () => setStepDrafts((prev) => [...prev, newStep(prev.length + 1)]);

  const removeStep = (i: number) => {
    setStepDrafts((prev) =>
      prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, stepOrder: idx + 1 }))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave({
      reminderType: config.reminder_type,
      enabled: config.capture_enabled || campaignEnabled,
      campaignEnabled,
      campaignSendTime: sendTime,
      campaignTimezone: timezone,
      dispatchMode,
      steps: stepDrafts.map((s, i) => ({
        stepOrder: i + 1,
        daysBefore: s.daysBefore,
        templateName: s.templateName,
        templateLang: s.templateLang,
        templateVars: s.templateVars
      }))
    });
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1rem" }}>
      <div className="rm-card">
        <div className="rm-card-head">
          <span className="rm-card-title">Enable Campaign</span>
          <label className="rm-toggle">
            <input
              type="checkbox"
              checked={campaignEnabled}
              onChange={(e) => setCampaignEnabled(e.target.checked)}
            />
            <span className="rm-toggle-track" />
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
              {campaignEnabled ? "On" : "Off"}
            </span>
          </label>
        </div>
      </div>

      <div className="rm-card">
        <div className="rm-card-head">
          <span className="rm-card-title">Dispatch Mode</span>
        </div>
        <div className="rm-card-body">
          <div className="rm-dispatch-grid">
            {([
              { value: "annual", label: "Annual (recurring)", desc: "Fires every year on same day — birthday, anniversary" },
              { value: "exact_date", label: "One-time event", desc: "Fires once on the exact stored date — deadline, event" }
            ] as const).map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`rm-dispatch-btn${dispatchMode === opt.value ? " is-active" : ""}`}
                onClick={() => setDispatchMode(opt.value)}
              >
                <div className="rm-dispatch-label">{opt.label}</div>
                <div className="rm-dispatch-desc">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rm-card">
        <div className="rm-card-head">
          <span className="rm-card-title">Send Time</span>
        </div>
        <div className="rm-card-body">
          <div className="rm-2col">
            <div className="rm-field">
              <label className="rm-label">Time</label>
              <input
                type="time"
                className="rm-input"
                value={sendTime}
                onChange={(e) => setSendTime(e.target.value)}
              />
            </div>
            <div className="rm-field">
              <label className="rm-label">Timezone</label>
              <select
                className="rm-select"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="rm-card">
        <div className="rm-card-head">
          <span className="rm-card-title">Campaign Steps</span>
          <span style={{ fontSize: "0.77rem", color: "#5f6f86" }}>
            {stepDrafts.length} step{stepDrafts.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="rm-card-body">
          <p style={{ margin: 0, fontSize: "0.82rem", color: "#5f6f86", lineHeight: 1.55 }}>
            Add one step per message — e.g. 15 days before (teaser), 3 days before (nudge), 0 days (day-of). Each step sends a different template.
          </p>
          {stepDrafts.map((step, i) => (
            <StepEditor
              key={i}
              step={step}
              index={i}
              onChange={(updated) => updateStep(i, updated)}
              onRemove={() => removeStep(i)}
              isOnly={stepDrafts.length === 1}
            />
          ))}
          <button type="button" className="rm-add-step-btn" onClick={addStep}>
            + Add Step
          </button>
        </div>
      </div>

      <div className="rm-info-banner">
        <strong>Duplicate Guard: Always Active</strong> — Each contact receives at most one message per step per year (annual) or once ever (exact date).
      </div>

      <div>
        <button type="submit" disabled={isSaving} className="rm-btn rm-btn-primary">
          {isSaving ? "Saving…" : "Save Campaign Settings"}
        </button>
      </div>
    </form>
  );
}

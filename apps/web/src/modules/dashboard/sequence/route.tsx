import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useRoutes } from "react-router-dom";
import type {
  MessageTemplate,
  SequenceCondition,
  SequenceDetail,
  SequenceEnrollment,
  SequenceListItem,
  SequenceWriteConditionInput,
  SequenceWriteInput,
  SequenceWriteStepInput
} from "../../../lib/api";
import { fetchTemplates } from "../../../lib/api";
import type { DashboardModulePrefetchContext } from "../../../shared/dashboard/module-contracts";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { useDashboardShell } from "../../../shared/dashboard/shell-context";
import {
  buildSequencesQueryOptions,
  useCreateSequenceMutation,
  usePauseSequenceMutation,
  usePublishSequenceMutation,
  useResumeSequenceMutation,
  useSequenceDetailQuery,
  useSequenceEnrollmentsQuery,
  useSequenceLogsQuery,
  useSequencesQuery,
  useUpdateSequenceMutation
} from "./queries";

type ViewMode = "grid" | "list";
type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

const DAYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const shell = { display: "flex", flexDirection: "column" as const, gap: 18 };
const card = {
  background: "#fff",
  border: "1px solid #dbe4f0",
  borderRadius: 22,
  padding: 20,
  boxShadow: "0 14px 28px rgba(15, 23, 42, 0.05)"
};
const input = {
  width: "100%",
  border: "1px solid #d7dee8",
  borderRadius: 12,
  padding: "11px 12px",
  fontSize: "0.95rem",
  color: "#0f172a",
  background: "#fff"
};
const ghostBtn = {
  border: "1px solid #d7dee8",
  borderRadius: 999,
  padding: "10px 16px",
  background: "#fff",
  color: "#334155",
  fontWeight: 600,
  cursor: "pointer"
};
const primaryBtn = {
  border: "none",
  borderRadius: 999,
  padding: "10px 18px",
  background: "#0f766e",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer"
};

function SectionHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "1.45rem", color: "#0f172a" }}>{title}</h2>
        {subtitle ? <p style={{ margin: "6px 0 0", color: "#64748b" }}>{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function StatusPill({ status }: { status: string }) {
  const tones: Record<string, { bg: string; bd: string; fg: string }> = {
    published: { bg: "#ecfdf5", bd: "#bbf7d0", fg: "#166534" },
    paused: { bg: "#fff7ed", bd: "#fed7aa", fg: "#c2410c" },
    draft: { bg: "#eff6ff", bd: "#bfdbfe", fg: "#1d4ed8" }
  };
  const tone = tones[status] ?? { bg: "#f8fafc", bd: "#dbe4f0", fg: "#334155" };
  return (
    <span style={{ display: "inline-flex", padding: "6px 10px", borderRadius: 999, background: tone.bg, border: `1px solid ${tone.bd}`, color: tone.fg, fontSize: "0.82rem", fontWeight: 700, textTransform: "capitalize" }}>
      {status}
    </span>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={card}>
      <div style={{ color: "#64748b", fontWeight: 600 }}>{label}</div>
      <div style={{ marginTop: 8, fontSize: "1.9rem", fontWeight: 800, color: "#0f172a" }}>{value}</div>
    </div>
  );
}

function buildDefaultPayload(name: string): SequenceWriteInput {
  return {
    name,
    triggerType: "create",
    channel: "whatsapp",
    baseType: "contact",
    allowOnce: true,
    requirePreviousDelivery: false,
    retryEnabled: false,
    retryWindowHours: 48,
    allowedDays: [...DAYS],
    timeMode: "any_time",
    steps: [],
    conditions: []
  };
}

function toDraft(detail: SequenceDetail): SequenceWriteInput {
  return {
    name: detail.name,
    triggerType: detail.trigger_type,
    channel: detail.channel,
    baseType: "contact",
    allowOnce: detail.allow_once,
    requirePreviousDelivery: detail.require_previous_delivery,
    retryEnabled: detail.retry_enabled,
    retryWindowHours: detail.retry_window_hours,
    allowedDays: detail.allowed_days_json,
    timeMode: detail.time_mode,
    timeWindowStart: detail.time_window_start,
    timeWindowEnd: detail.time_window_end,
    steps: detail.steps.map((step) => ({
      id: step.id,
      stepOrder: step.step_order,
      delayValue: step.delay_value,
      delayUnit: step.delay_unit,
      messageTemplateId: step.message_template_id,
      customDelivery: step.custom_delivery_json
    })),
    conditions: detail.conditions.map((condition) => ({
      id: condition.id,
      conditionType: condition.condition_type,
      field: condition.field,
      operator: condition.operator,
      value: condition.value
    }))
  };
}

function SequenceListPage({ token }: { token: string }) {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const sequences = useSequencesQuery(token).data ?? [];
  const summary = useMemo(() => ({
    active: sequences.filter((item) => item.active_count > 0).length,
    published: sequences.filter((item) => item.status === "published").length,
    paused: sequences.filter((item) => item.status === "paused").length,
    completed: sequences.reduce((sum, item) => sum + item.completed_count, 0),
    failed: sequences.reduce((sum, item) => sum + item.failed_count, 0)
  }), [sequences]);

  return (
    <section style={shell}>
      <div style={card}>
        <SectionHeader
          title="Sequence"
          subtitle="Automate timed WhatsApp follow-ups and trigger-based journeys."
          right={
            <div style={{ display: "flex", gap: 12 }}>
              <button type="button" style={ghostBtn} onClick={() => setViewMode((current) => (current === "grid" ? "list" : "grid"))}>
                {viewMode === "grid" ? "List" : "Grid"}
              </button>
              <button type="button" style={primaryBtn} onClick={() => navigate("/dashboard/sequence/new")}>Create Sequence</button>
            </div>
          }
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
        <StatCard label="Active" value={summary.active} />
        <StatCard label="Published" value={summary.published} />
        <StatCard label="Paused" value={summary.paused} />
        <StatCard label="Completed" value={summary.completed} />
        <StatCard label="Failed enrollments" value={summary.failed} />
      </div>
      {viewMode === "grid" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
          <button type="button" onClick={() => navigate("/dashboard/sequence/new")} style={{ ...card, borderStyle: "dashed", minHeight: 210, display: "grid", placeItems: "center", color: "#0f766e", fontWeight: 700, cursor: "pointer" }}>
            Create new sequence
          </button>
          {sequences.map((sequence) => <SequenceTile key={sequence.id} sequence={sequence} onOpen={() => navigate(`/dashboard/sequence/${sequence.id}`)} />)}
        </div>
      ) : (
        <div style={card}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Sequence", "Status", "Trigger", "Steps", "Enrolled", "Completed", "Created", "Action"].map((heading) => (
                  <th key={heading} style={{ textAlign: "left", paddingBottom: 12, color: "#64748b", fontSize: "0.82rem" }}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sequences.map((sequence) => (
                <tr key={sequence.id} style={{ borderTop: "1px solid #eef2f7" }}>
                  <td style={{ padding: "14px 0", fontWeight: 700 }}>{sequence.name}</td>
                  <td><StatusPill status={sequence.status} /></td>
                  <td>{sequence.trigger_type}</td>
                  <td>{sequence.steps_count}</td>
                  <td>{sequence.enrolled_count}</td>
                  <td>{sequence.completed_count}</td>
                  <td>{formatDateTime(sequence.created_at)}</td>
                  <td><button type="button" style={ghostBtn} onClick={() => navigate(`/dashboard/sequence/${sequence.id}`)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SequenceTile({ sequence, onOpen }: { sequence: SequenceListItem; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>{sequence.name}</div>
          <div style={{ marginTop: 8 }}><StatusPill status={sequence.status} /></div>
        </div>
        <div style={{ color: "#94a3b8", fontSize: "0.82rem" }}>{formatDateTime(sequence.created_at)}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12, marginTop: 18 }}>
        <Mini label="Trigger" value={sequence.trigger_type} />
        <Mini label="Steps" value={String(sequence.steps_count)} />
        <Mini label="Enrolled" value={String(sequence.enrolled_count)} />
        <Mini label="Completed" value={String(sequence.completed_count)} />
      </div>
    </button>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div><div style={{ color: "#64748b", fontSize: "0.8rem" }}>{label}</div><div style={{ marginTop: 4, fontWeight: 700 }}>{value}</div></div>;
}

function SequenceCreatePage({ token }: { token: string }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const createMutation = useCreateSequenceMutation(token);
  return (
    <section style={shell}>
      <div style={{ ...card, display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.9fr)", gap: 24 }}>
        <div style={{ display: "grid", gap: 18 }}>
          <SectionHeader title="Create Sequence" subtitle="Set up the sequence basics before adding conditions and steps." />
          <label style={{ display: "grid", gap: 8, fontWeight: 600 }}>Sequence Name *<input style={input} value={name} onChange={(event) => setName(event.target.value)} placeholder="Enter a sequence name" /></label>
          <label style={{ display: "grid", gap: 8, fontWeight: 600 }}>Sequence Based on *<input style={input} value="Contacts" readOnly /></label>
          <label style={{ display: "grid", gap: 8, fontWeight: 600 }}>Send from *<input style={input} value="WhatsApp" readOnly /></label>
          <div style={{ display: "flex", gap: 12 }}>
            <button type="button" style={ghostBtn} onClick={() => navigate("/dashboard/sequence")}>Back</button>
            <button
              type="button"
              style={primaryBtn}
              disabled={!name.trim() || createMutation.isPending}
              onClick={async () => {
                const sequence = await createMutation.mutateAsync(buildDefaultPayload(name.trim()));
                navigate(`/dashboard/sequence/${sequence.id}`);
              }}
            >
              {createMutation.isPending ? "Creating..." : "Next"}
            </button>
          </div>
        </div>
        <div style={{ ...card, background: "linear-gradient(180deg, #ecfeff 0%, #f8fafc 100%)", borderColor: "#bae6fd" }}>
          <h3 style={{ margin: 0, color: "#0f172a" }}>What is Sequence</h3>
          <p style={{ marginTop: 12, color: "#475569", lineHeight: 1.7 }}>Sequence allows you to send multiple WhatsApp templates to your customers based on certain triggers and intervals.</p>
          <ol style={{ margin: "16px 0 0", paddingLeft: 18, color: "#0f172a", lineHeight: 1.8 }}>
            <li>Create a sequence</li>
            <li>Set the condition triggers</li>
            <li>Add steps - message templates</li>
            <li>Add delays</li>
            <li>Execute</li>
          </ol>
        </div>
      </div>
    </section>
  );
}

function BuilderPage({ token }: { token: string }) {
  const navigate = useNavigate();
  const { sequenceId } = useParams<{ sequenceId: string }>();
  const detail = useSequenceDetailQuery(token, sequenceId ?? "").data;
  const enrollments = useSequenceEnrollmentsQuery(token, sequenceId ?? "").data ?? [];
  const updateMutation = useUpdateSequenceMutation(token, sequenceId ?? "");
  const publishMutation = usePublishSequenceMutation(token, sequenceId ?? "");
  const pauseMutation = usePauseSequenceMutation(token, sequenceId ?? "");
  const resumeMutation = useResumeSequenceMutation(token, sequenceId ?? "");
  const templates = useQuery({
    queryKey: dashboardQueryKeys.templates,
    queryFn: () => fetchTemplates(token).then((response) => response.templates.filter((item) => item.status === "APPROVED")),
    enabled: Boolean(token)
  }).data ?? [];
  const [draft, setDraft] = useState<SequenceWriteInput | null>(null);

  if (detail && !draft) setDraft(toDraft(detail));
  if (!detail || !draft) return <div style={card}>Loading sequence...</div>;

  const selectedEnrollment = enrollments[0] ?? null;
  const logs = useSequenceLogsQuery(token, selectedEnrollment?.id ?? "").data ?? [];

  const setConditions = (conditionType: SequenceCondition["condition_type"], next: SequenceWriteConditionInput[]) =>
    setDraft((current) => current ? { ...current, conditions: [...(current.conditions ?? []).filter((item) => item.conditionType !== conditionType), ...next] } : current);

  const saveDraft = async () => { await updateMutation.mutateAsync(draft); };

  return (
    <section style={shell}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 8, minWidth: 320 }}>
            <input style={{ ...input, border: "none", padding: 0, fontSize: "1.35rem", fontWeight: 800 }} value={draft.name} onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <StatusPill status={detail.status} />
              <span style={{ color: "#64748b" }}>Trigger: {draft.triggerType}</span>
              <span style={{ color: "#64748b" }}>Days: {(draft.allowedDays ?? []).join(", ") || "all"}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" style={ghostBtn} onClick={() => setDraft(toDraft(detail))}>Reset draft</button>
            <button type="button" style={ghostBtn} onClick={() => void saveDraft()}>{updateMutation.isPending ? "Saving..." : "Save"}</button>
            {detail.status === "published" ? <button type="button" style={ghostBtn} onClick={() => void pauseMutation.mutateAsync()}>Pause</button> : null}
            {detail.status === "paused" ? <button type="button" style={ghostBtn} onClick={() => void resumeMutation.mutateAsync()}>Resume</button> : null}
            {detail.status !== "published" ? <button type="button" style={primaryBtn} onClick={async () => { await saveDraft(); await publishMutation.mutateAsync(); navigate("/dashboard/sequence"); }}>Publish & Close</button> : null}
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(320px, 0.8fr)", gap: 18 }}>
        <div style={{ display: "grid", gap: 18 }}>
          <TriggerEditor draft={draft} setDraft={setDraft} setConditions={setConditions} />
          <DeliveryEditor draft={draft} setDraft={setDraft} />
          <StepsEditor draft={draft} setDraft={setDraft} templates={templates} />
        </div>
        <div style={card}>
          <SectionHeader title="Execution / enrollment insights" subtitle="Recent sequence outcomes and enrollment activity." />
          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            <Mini label="Enrolled" value={String(detail.metrics.enrolled)} />
            <Mini label="Active" value={String(detail.metrics.active)} />
            <Mini label="Completed" value={String(detail.metrics.completed)} />
            <Mini label="Failed" value={String(detail.metrics.failed)} />
          </div>
          <div style={{ marginTop: 20 }}>
            <strong>Recent enrollments</strong>
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {enrollments.slice(0, 4).map((enrollment) => (
                <div key={enrollment.id} style={{ padding: 12, borderRadius: 14, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <strong>{enrollment.status}</strong>
                    <span style={{ color: "#64748b", fontSize: "0.82rem" }}>{formatDateTime(enrollment.entered_at)}</span>
                  </div>
                  <div style={{ marginTop: 6, color: "#475569" }}>Step {enrollment.current_step + 1}</div>
                </div>
              ))}
              {enrollments.length === 0 ? <div style={{ color: "#94a3b8" }}>No enrollments yet.</div> : null}
            </div>
          </div>
          {selectedEnrollment ? (
            <div style={{ marginTop: 20 }}>
              <strong>Latest logs</strong>
              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                {logs.slice(0, 4).map((log) => (
                  <div key={log.id} style={{ padding: 12, borderRadius: 14, background: "#fff", border: "1px solid #e2e8f0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <StatusPill status={log.status} />
                      <span style={{ color: "#64748b", fontSize: "0.82rem" }}>{formatDateTime(log.created_at)}</span>
                    </div>
                    {log.error_message ? <div style={{ marginTop: 8, color: "#be123c" }}>{log.error_message}</div> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function TriggerEditor({
  draft,
  setDraft,
  setConditions
}: {
  draft: SequenceWriteInput;
  setDraft: Dispatch<SetStateAction<SequenceWriteInput | null>>;
  setConditions: (type: SequenceCondition["condition_type"], next: SequenceWriteConditionInput[]) => void;
}) {
  const start = (draft.conditions ?? []).filter((item) => item.conditionType === "start");
  const success = (draft.conditions ?? []).filter((item) => item.conditionType === "stop_success");
  const failure = (draft.conditions ?? []).filter((item) => item.conditionType === "stop_failure");
  return (
    <div style={card}>
      <SectionHeader title="Set trigger and conditions" />
      <div style={{ marginTop: 18, display: "grid", gap: 16 }}>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          {[
            ["create", "On create"],
            ["update", "On update"],
            ["both", "Both (create & update)"]
          ].map(([value, label]) => (
            <label key={value} style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              <input type="radio" checked={draft.triggerType === value} onChange={() => setDraft((current) => current ? { ...current, triggerType: value as SequenceWriteInput["triggerType"] } : current)} />
              {label}
            </label>
          ))}
        </div>
        <ConditionRows title="Start conditions" conditions={start} onChange={(next) => setConditions("start", next.map((item) => ({ ...item, conditionType: "start" })))} />
        <ConditionRows title="Stop conditions - Success" conditions={success} onChange={(next) => setConditions("stop_success", next.map((item) => ({ ...item, conditionType: "stop_success" })))} />
        <ConditionRows title="Stop conditions - Failure" conditions={failure} onChange={(next) => setConditions("stop_failure", next.map((item) => ({ ...item, conditionType: "stop_failure" })))} />
      </div>
    </div>
  );
}

function ConditionRows({ title, conditions, onChange }: { title: string; conditions: SequenceWriteConditionInput[]; onChange: (next: SequenceWriteConditionInput[]) => void }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <strong>{title}</strong>
        <button type="button" style={ghostBtn} onClick={() => onChange([...conditions, { conditionType: "start", field: "tags", operator: "contains", value: "" }])}>+ Add</button>
      </div>
      {conditions.map((condition, index) => (
        <div key={`${title}-${index}`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8 }}>
          <input style={input} value={condition.field} onChange={(event) => onChange(conditions.map((item, itemIndex) => itemIndex === index ? { ...item, field: event.target.value } : item))} placeholder="Field" />
          <select style={input} value={condition.operator} onChange={(event) => onChange(conditions.map((item, itemIndex) => itemIndex === index ? { ...item, operator: event.target.value as SequenceWriteConditionInput["operator"] } : item))}>
            <option value="contains">contains</option>
            <option value="eq">equals</option>
            <option value="neq">not equals</option>
            <option value="gt">greater than</option>
            <option value="lt">less than</option>
          </select>
          <input style={input} value={condition.value} onChange={(event) => onChange(conditions.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} placeholder="Value" />
          <button type="button" style={ghostBtn} onClick={() => onChange(conditions.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
        </div>
      ))}
      {conditions.length === 0 ? <div style={{ color: "#94a3b8" }}>No conditions added.</div> : null}
    </div>
  );
}

function DeliveryEditor({ draft, setDraft }: { draft: SequenceWriteInput; setDraft: Dispatch<SetStateAction<SequenceWriteInput | null>> }) {
  const toggleDay = (day: DayKey) => setDraft((current) => current ? { ...current, allowedDays: (current.allowedDays ?? []).includes(day) ? (current.allowedDays ?? []).filter((item) => item !== day) : [...(current.allowedDays ?? []), day] } : current);
  return (
    <div style={card}>
      <SectionHeader title="Set sequence delivery preference" />
      <div style={{ marginTop: 18, display: "grid", gap: 16 }}>
        <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontWeight: 700 }}>Enable Retry</span><input type="checkbox" checked={draft.retryEnabled ?? false} onChange={(event) => setDraft((current) => current ? { ...current, retryEnabled: event.target.checked } : current)} /></label>
        <div>
          <strong>Days</strong>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button type="button" style={{ ...ghostBtn, background: (draft.allowedDays ?? []).length === 7 ? "#ecfdf5" : "#fff" }} onClick={() => setDraft((current) => current ? { ...current, allowedDays: [...DAYS] } : current)}>All days</button>
            {DAYS.map((day) => <button key={day} type="button" style={{ ...ghostBtn, background: (draft.allowedDays ?? []).includes(day) ? "#ecfdf5" : "#fff" }} onClick={() => toggleDay(day)}>{day.toUpperCase()}</button>)}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 1fr", gap: 12 }}>
          <select style={input} value={draft.timeMode} onChange={(event) => setDraft((current) => current ? { ...current, timeMode: event.target.value as SequenceWriteInput["timeMode"] } : current)}>
            <option value="any_time">Any time</option>
            <option value="window">Between start/end time</option>
          </select>
          <input style={input} type="time" disabled={draft.timeMode !== "window"} value={draft.timeWindowStart ?? ""} onChange={(event) => setDraft((current) => current ? { ...current, timeWindowStart: event.target.value } : current)} />
          <input style={input} type="time" disabled={draft.timeMode !== "window"} value={draft.timeWindowEnd ?? ""} onChange={(event) => setDraft((current) => current ? { ...current, timeWindowEnd: event.target.value } : current)} />
        </div>
        <label style={{ display: "flex", gap: 10, alignItems: "center" }}><input type="checkbox" checked={draft.allowOnce ?? false} onChange={(event) => setDraft((current) => current ? { ...current, allowOnce: event.target.checked } : current)} />Allow contacts to enter this sequence only once</label>
        <label style={{ display: "flex", gap: 10, alignItems: "center" }}><input type="checkbox" checked={draft.requirePreviousDelivery ?? false} onChange={(event) => setDraft((current) => current ? { ...current, requirePreviousDelivery: event.target.checked } : current)} />Continue sequence only after message is successfully delivered</label>
      </div>
    </div>
  );
}

function StepsEditor({ draft, setDraft, templates }: { draft: SequenceWriteInput; setDraft: Dispatch<SetStateAction<SequenceWriteInput | null>>; templates: MessageTemplate[] }) {
  const steps = draft.steps ?? [];
  const updateStep = (index: number, patch: Partial<SequenceWriteStepInput>) => setDraft((current) => current ? { ...current, steps: (current.steps ?? []).map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step) } : current);
  const addStep = () => setDraft((current) => current ? { ...current, steps: [...(current.steps ?? []), { stepOrder: (current.steps ?? []).length, delayValue: 1, delayUnit: "hours", messageTemplateId: templates[0]?.id ?? "00000000-0000-0000-0000-000000000000", customDelivery: {} }] } : current);
  const removeStep = (index: number) => setDraft((current) => current ? { ...current, steps: (current.steps ?? []).filter((_, stepIndex) => stepIndex !== index).map((step, stepIndex) => ({ ...step, stepOrder: stepIndex })) } : current);
  const moveStep = (index: number, delta: -1 | 1) => setDraft((current) => {
    if (!current) return current;
    const next = [...(current.steps ?? [])];
    const target = index + delta;
    if (target < 0 || target >= next.length) return current;
    const [step] = next.splice(index, 1);
    next.splice(target, 0, step);
    return { ...current, steps: next.map((item, itemIndex) => ({ ...item, stepOrder: itemIndex })) };
  });
  const duplicate = (index: number) => setDraft((current) => current ? { ...current, steps: [...(current.steps ?? []).slice(0, index + 1), { ...(current.steps ?? [])[index], id: undefined }, ...(current.steps ?? []).slice(index + 1)].map((step, stepIndex) => ({ ...step, stepOrder: stepIndex })) } : current);
  return (
    <div style={card}>
      <SectionHeader title="Steps" subtitle="Define the delay and WhatsApp template for each follow-up." right={<button type="button" style={primaryBtn} onClick={addStep}>Add step</button>} />
      <div style={{ marginTop: 18, display: "grid", gap: 16 }}>
        {steps.map((step, index) => (
          <div key={`${step.id ?? "draft"}-${index}`} style={{ ...card, borderRadius: 18, boxShadow: "none" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div style={{ fontWeight: 800 }}>Step {index + 1}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={ghostBtn} onClick={() => moveStep(index, -1)}>Up</button>
                <button type="button" style={ghostBtn} onClick={() => moveStep(index, 1)}>Down</button>
                <button type="button" style={ghostBtn} onClick={() => duplicate(index)}>Duplicate</button>
                <button type="button" style={ghostBtn} onClick={() => removeStep(index)}>Delete</button>
              </div>
            </div>
            <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "120px 160px 1fr", gap: 12 }}>
              <input style={input} type="number" min={0} value={step.delayValue} onChange={(event) => updateStep(index, { delayValue: Number(event.target.value) })} />
              <select style={input} value={step.delayUnit} onChange={(event) => updateStep(index, { delayUnit: event.target.value as SequenceWriteStepInput["delayUnit"] })}>
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
              <div style={{ alignSelf: "center", color: "#0f766e", fontWeight: 600 }}>{index === 0 ? "From enrollment" : "From previous step"}</div>
            </div>
            <div style={{ marginTop: 12 }}>
              <select style={input} value={step.messageTemplateId} onChange={(event) => updateStep(index, { messageTemplateId: event.target.value })}>
                {templates.length === 0 ? <option value="">No approved templates</option> : null}
                {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </div>
            <label style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
              <input type="checkbox" checked={Boolean(step.customDelivery?.enabled)} onChange={(event) => updateStep(index, { customDelivery: { ...(step.customDelivery ?? {}), enabled: event.target.checked } })} />
              Set custom delivery preference
            </label>
          </div>
        ))}
        {steps.length === 0 ? <div style={{ color: "#64748b" }}>No steps yet. Add the first step to publish this sequence.</div> : null}
      </div>
    </div>
  );
}

export function Component() {
  const { token } = useDashboardShell();
  return useRoutes([
    { index: true, element: <SequenceListPage token={token} /> },
    { path: "new", element: <SequenceCreatePage token={token} /> },
    { path: ":sequenceId", element: <BuilderPage token={token} /> }
  ]);
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await queryClient.prefetchQuery(buildSequencesQueryOptions(token));
}

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useConvStore } from "../store/convStore";
import { useSetStatus, useSetPriority, useSetLabels, useLabels } from "../queries";
import {
  fetchContactByConversation,
  fetchConversationAutomation,
  fetchConversationTimeline,
  listContactFields,
  fetchAgentProfiles,
  patchAssignAgent,
  patchAiMode,
  updateContact,
  type ConversationTimelineEvent,
  type ConversationTimelineType
} from "../api";
import { useAuth } from "../../../../lib/auth-context";
import { getAvatarColor } from "./ConversationRow";

function getSavedSections(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem("iv-sidebar-sections") ?? '["conv-actions","lead-intel"]') as string[]); }
  catch { return new Set(["conv-actions", "lead-intel"]); }
}

function saveSections(open: Set<string>) {
  try { localStorage.setItem("iv-sidebar-sections", JSON.stringify([...open])); } catch { /* noop */ }
}

interface AccordionProps {
  id: string;
  title: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  wagenVariant?: "blue" | "purple";
}

function Accordion({ title, open, onToggle, children, wagenVariant }: AccordionProps) {
  return (
    <div className={`iv-acc${wagenVariant ? ` iv-wagen-${wagenVariant === "blue" ? "lead" : "flow"}` : ""}`}>
      <div className="iv-acc-head" onClick={onToggle}>
        <span>
          {title}
          {wagenVariant && (
            <span className={`iv-wagen-badge ${wagenVariant}`}>WAgen</span>
          )}
        </span>
        <span className="iv-acc-plus">{open ? "−" : "+"}</span>
      </div>
      {open && <div className="iv-acc-body">{children}</div>}
    </div>
  );
}

function formatPhone(v: string | null | undefined): string {
  if (!v) return "Unknown";
  const d = v.replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 ? `+${d}` : v;
}

function formatDateTime(v: string | null | undefined): string {
  if (!v) return "Not available";
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toLocaleString() : "Not available";
}

function formatFieldValue(fieldType: string, value: string | null | undefined): string {
  if (fieldType === "SWITCH") return value === "true" ? "Yes" : value === "false" ? "No" : "Not captured yet";
  if (fieldType === "DATE") {
    const p = value ? Date.parse(value) : NaN;
    return Number.isFinite(p) ? new Date(p).toLocaleDateString() : "Not captured yet";
  }
  return value?.trim() ? value : "Not captured yet";
}

function channelBadge(t: string) {
  if (t === "api") return "WA API";
  if (t === "qr") return "WA QR";
  return "Web";
}

function timelineIcon(type: ConversationTimelineType): string {
  switch (type) {
    case "conversation_started": return "ST";
    case "inbound_message": return "IN";
    case "human_reply": return "HU";
    case "ai_reply": return "AI";
    case "template_sent": return "TP";
    case "broadcast_sent": return "BR";
    case "sequence_started": return "SQ";
    case "sequence_event": return "SQ";
    case "flow_started": return "FL";
    case "flow_event": return "FL";
    default: return "--";
  }
}

interface FieldRowProps { label: string; value: React.ReactNode }
function FieldRow({ label, value }: FieldRowProps) {
  return (
    <div className="iv-cf-row">
      <div className="iv-cf-label">{label}</div>
      <div className="iv-cf-value">{value}</div>
    </div>
  );
}

interface Props {
  convId: string;
  onClose?: () => void;
}

export function DetailsSidebar({ convId, onClose }: Props) {
  const [openSections, setOpenSections] = useState<Set<string>>(getSavedSections);
  const [snoozeAt, setSnoozeAt] = useState("");
  const [pendingSnooze, setPendingSnooze] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  const [tagDraft, setTagDraft] = useState("");

  const { byId, labels } = useConvStore();
  const conv = byId[convId];
  const { token } = useAuth();
  useLabels();

  const { upsertConv } = useConvStore();
  const setStatus = useSetStatus();
  const setPriority = useSetPriority();
  const setLabels = useSetLabels();

  const agentProfilesQuery = useQuery({
    queryKey: ["iv2-agent-profiles"],
    queryFn: () => fetchAgentProfiles(token!),
    enabled: Boolean(token && openSections.has("conv-actions")),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false
  });

  const assignMut = useMutation({
    mutationFn: (agentProfileId: string | null) => patchAssignAgent(token!, convId, agentProfileId),
    onSuccess: (_data, agentProfileId) => upsertConv({ id: convId, assigned_agent_profile_id: agentProfileId })
  });

  const aiToggleMut = useMutation({
    mutationFn: (paused: boolean) => patchAiMode(token!, convId, paused),
    onSuccess: (_data, paused) => upsertConv({ id: convId, ai_paused: paused, manual_takeover: paused })
  });

  const contactQuery = useQuery({
    queryKey: ["iv2-contact", convId],
    queryFn: () => fetchContactByConversation(token!, convId),
    enabled: Boolean(token && convId),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false
  });

  const automationQuery = useQuery({
    queryKey: ["iv2-automation", convId],
    queryFn: () => fetchConversationAutomation(token!, convId),
    enabled: Boolean(token && convId && openSections.has("automation")),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false
  });

  const timelineQuery = useQuery({
    queryKey: ["iv2-timeline", convId],
    queryFn: () => fetchConversationTimeline(token!, convId),
    enabled: Boolean(token && convId && openSections.has("timeline")),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false
  });

  const fieldsQuery = useQuery({
    queryKey: ["iv2-contact-fields"],
    queryFn: () => listContactFields(token!),
    enabled: Boolean(token),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false
  });

  const contact = contactQuery.data?.contact ?? null;
  const automation = automationQuery.data?.automation ?? null;
  const fieldDefs = fieldsQuery.data?.fields ?? [];
  const fieldValues = contact?.custom_field_values ?? [];
  const valueMap = new Map(fieldValues.map((fv) => [fv.field_id, fv]));
  const visibleFields = fieldDefs.map((def) => {
    const fv = valueMap.get(def.id);
    return { id: def.id, label: def.label, field_type: def.field_type, value: fv?.value ?? null };
  });
  const orphans = fieldValues.filter((fv) => !fieldDefs.some((d) => d.id === fv.field_id));

  useEffect(() => {
    setPendingSnooze(false);
    setSnoozeAt("");
    setEditingTags(false);
  }, [convId]);

  useEffect(() => {
    setTagDraft((contact?.tags ?? []).join(", "));
  }, [contact?.id, contact?.tags]);

  const updateTagsMut = useMutation({
    mutationFn: (tags: string[]) => updateContact(token!, contact!.id, { tags }),
    onSuccess: async () => {
      setEditingTags(false);
      await contactQuery.refetch();
    }
  });

  const toggleSection = useCallback((id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveSections(next);
      return next;
    });
  }, []);

  if (!conv) {
    return (
      <div className="iv-sidebar" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 13 }}>
        No conversation selected
      </div>
    );
  }

  const avatarColor = getAvatarColor(conv.phone_number);
  const displayName = contact?.display_name || formatPhone(conv.phone_number);

  return (
    <div className="iv-sidebar">
      <div className="iv-mobile-panel-head">
        <span>Contact details</span>
        <button type="button" onClick={onClose} aria-label="Close details">×</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
          {/* Contact card */}
          <div className="iv-contact-card">
            <div className={`iv-avatar av-${avatarColor} av-lg`} style={{ margin: "0 auto" }}>
              {conv.phone_number.replace(/\D/g, "").slice(-2)}
            </div>
            <div className="iv-contact-name">{displayName}</div>
            <div className="iv-contact-title">
              <span className={`iv-status-pill iv-status-${conv.status ?? "open"}`}>{conv.status ?? "open"}</span>
              {" "}
              <span className={`iv-priority-pill iv-priority-${conv.priority ?? "none"}`}>{conv.priority ?? "none"}</span>
            </div>
          </div>

          {/* Contact Info */}
          <div className="iv-cf-section">
            <div className="iv-cf-section-head">
              <span>Contact Info</span>
              <span className="iv-cf-badge">{channelBadge(conv.channel_type)}</span>
            </div>

            <FieldRow label="NAME" value={
              contact?.id
                ? <Link to={`/dashboard/contacts/${contact.id}`} style={{ color: "#2563eb", textDecoration: "none", fontWeight: 700 }}>{displayName}</Link>
                : displayName
            } />
            <FieldRow label="PHONE" value={formatPhone(conv.phone_number)} />
            <FieldRow label="EMAIL" value={contact?.email ?? "Not captured yet"} />
            <FieldRow label="TYPE" value={contact?.contact_type ?? conv.lead_kind} />

            {contact?.id && (
              <div className="iv-cf-row">
                <div className="iv-cf-label">TAGS</div>
                <div className="iv-cf-value">
                  {editingTags ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <input
                        value={tagDraft}
                        onChange={(event) => setTagDraft(event.target.value)}
                        placeholder="vip, follow-up, complaint"
                        style={{ border: "1px solid #e2eaf4", borderRadius: 6, padding: "5px 7px", fontSize: 12 }}
                      />
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="iv-btn-blue"
                          style={{ fontSize: 11, padding: "3px 8px" }}
                          disabled={updateTagsMut.isPending}
                          onClick={() => updateTagsMut.mutate(
                            tagDraft.split(",").map((tag) => tag.trim()).filter(Boolean)
                          )}
                        >
                          {updateTagsMut.isPending ? "Saving..." : "Save tags"}
                        </button>
                        <button
                          className="iv-bulk-btn"
                          style={{ fontSize: 11, padding: "3px 8px" }}
                          onClick={() => {
                            setTagDraft((contact.tags ?? []).join(", "));
                            setEditingTags(false);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className="iv-tag-cloud">
                        {contact.tags.length > 0
                          ? contact.tags.map((tag) => <span key={tag} className="iv-tag">{tag}</span>)
                          : <span style={{ color: "#94a3b8" }}>No tags yet</span>}
                      </div>
                      <button className="iv-bulk-btn" style={{ fontSize: 11, padding: "3px 8px", alignSelf: "flex-start" }} onClick={() => setEditingTags(true)}>
                        Edit tags
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <FieldRow label="OWNER" value={conv.assigned_agent_profile_id ? "Assigned" : "Unassigned"} />
            <FieldRow label="LAST TOUCH" value={formatDateTime(conv.last_message_at)} />
            <FieldRow label="CONNECTED NUMBER" value={conv.channel_linked_number ?? "Workspace default"} />
            {contact?.source_type && <FieldRow label="SOURCE" value={contact.source_type} />}

            {/* Custom fields */}
            {(visibleFields.length > 0 || orphans.length > 0) && (
              <>
                <div className="iv-cf-divider">CUSTOM FIELDS</div>
                {visibleFields.map((f) => (
                  <FieldRow key={f.id} label={f.label.toUpperCase()} value={formatFieldValue(f.field_type, f.value)} />
                ))}
                {orphans.map((fv) => (
                  <FieldRow key={fv.field_id} label={(fv.field_label ?? fv.field_name).toUpperCase()} value={formatFieldValue(fv.field_type, fv.value)} />
                ))}
              </>
            )}
          </div>

          {/* Conversation Actions */}
          <Accordion id="conv-actions" title="Conversation Actions" open={openSections.has("conv-actions")} onToggle={() => toggleSection("conv-actions")}>
            <div className="iv-acc-row" style={{ flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <span className="iv-acc-key" style={{ paddingTop: 4 }}>Status</span>
                <select
                  className="iv-acc-val"
                  value={pendingSnooze ? "snoozed" : (conv.status ?? "open")}
                  style={{ border: "1px solid #e2eaf4", borderRadius: 6, padding: "2px 6px", fontSize: 12, background: "#fff" }}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "snoozed") {
                      const d = new Date(); d.setHours(d.getHours() + 1);
                      setSnoozeAt(d.toISOString().slice(0, 16));
                      setPendingSnooze(true);
                    } else {
                      setPendingSnooze(false);
                      setStatus.mutate({ convId, status: val });
                    }
                  }}
                >
                  {["open", "pending", "resolved", "snoozed"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {(pendingSnooze || conv.status === "snoozed") && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 88 }}>
                  <input
                    type="datetime-local"
                    style={{ border: "1px solid #e2eaf4", borderRadius: 6, padding: "3px 6px", fontSize: 11.5, background: "#fff", outline: "none" }}
                    value={snoozeAt || (conv.snoozed_until ? conv.snoozed_until.slice(0, 16) : "")}
                    onChange={(e) => setSnoozeAt(e.target.value)}
                  />
                  <button
                    className="iv-btn-blue"
                    style={{ fontSize: 11, padding: "3px 8px", alignSelf: "flex-start" }}
                    disabled={setStatus.isPending || !(snoozeAt || conv.snoozed_until)}
                    onClick={() => {
                      const val = snoozeAt || (conv.snoozed_until ? conv.snoozed_until.slice(0, 16) : "");
                      void setStatus.mutateAsync({ convId, status: "snoozed", snoozedUntil: new Date(val).toISOString() })
                        .then(() => setPendingSnooze(false));
                    }}
                  >
                    Confirm snooze
                  </button>
                </div>
              )}
            </div>
            <div className="iv-acc-row">
              <span className="iv-acc-key">Priority</span>
              <select
                className="iv-acc-val"
                value={conv.priority ?? "none"}
                style={{ border: "1px solid #e2eaf4", borderRadius: 6, padding: "2px 6px", fontSize: 12, background: "#fff" }}
                onChange={(e) => setPriority.mutate({ convId, priority: e.target.value })}
              >
                {["none", "low", "medium", "high", "urgent"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            {/* Assign agent */}
            <div className="iv-acc-row">
              <span className="iv-acc-key">Assigned</span>
              <select
                className="iv-acc-val"
                value={conv.assigned_agent_profile_id ?? ""}
                style={{ border: "1px solid #e2eaf4", borderRadius: 6, padding: "2px 6px", fontSize: 12, background: "#fff", flex: 1 }}
                disabled={assignMut.isPending}
                onChange={(e) => assignMut.mutate(e.target.value || null)}
              >
                <option value="">Unassigned</option>
                {(agentProfilesQuery.data?.profiles ?? []).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>

            <div className="iv-acc-row" style={{ flexDirection: "column", gap: 4 }}>
              <span className="iv-acc-key">Labels</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                {labels.map((l) => {
                  const convLabelIds = conv.label_ids ?? [];
                  const isOn = convLabelIds.includes(l.id);
                  return (
                    <div
                      key={l.id}
                      className="iv-label-chip"
                      style={{ cursor: "pointer", opacity: isOn ? 1 : 0.5, borderColor: isOn ? l.color : undefined }}
                      onClick={() => {
                        const next = isOn ? convLabelIds.filter((x) => x !== l.id) : [...convLabelIds, l.id];
                        setLabels.mutate({ convId, labelIds: next });
                      }}
                    >
                      <span className="iv-label-dot" style={{ background: l.color }} />
                      {l.name}
                    </div>
                  );
                })}
              </div>
            </div>
          </Accordion>

          {/* Lead Intelligence */}
          <Accordion id="lead-intel" title="Lead Intelligence" open={openSections.has("lead-intel")} onToggle={() => toggleSection("lead-intel")} wagenVariant="blue">
            <div className="iv-acc-row"><span className="iv-acc-key">Score</span><span className="iv-acc-val">{conv.score}</span></div>
            <div className="iv-acc-row"><span className="iv-acc-key">Stage</span><span className="iv-acc-val">{conv.stage}</span></div>
            <div className="iv-acc-row"><span className="iv-acc-key">Kind</span><span className="iv-acc-val">{conv.lead_kind}</span></div>
            <div className="iv-acc-row" style={{ alignItems: "center" }}>
              <span className="iv-acc-key">AI Reply</span>
              <div
                className={`iv-toggle ${conv.ai_paused ? "off" : "on"}${aiToggleMut.isPending ? " loading" : ""}`}
                style={{ cursor: aiToggleMut.isPending ? "default" : "pointer" }}
                onClick={() => { if (!aiToggleMut.isPending) aiToggleMut.mutate(!conv.ai_paused); }}
              >
                <div className="iv-toggle-knob" />
              </div>
            </div>
            {conv.ai_paused && <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 4 }}>⏸ AI paused — agents handle replies</div>}
            {!conv.ai_paused && <div style={{ fontSize: 11, color: "#22c55e", marginTop: 4 }}>🤖 AI active — auto-replies enabled</div>}
          </Accordion>

          <Accordion id="automation" title="Automation" open={openSections.has("automation")} onToggle={() => toggleSection("automation")} wagenVariant="purple">
            {automationQuery.isLoading ? (
              <div style={{ fontSize: 12, color: "#64748b" }}>Loading automation state...</div>
            ) : automation ? (
              <>
                <div className="iv-acc-row"><span className="iv-acc-key">Flow</span><span className="iv-acc-val">{automation.flow_name ?? automation.flow_id.slice(-8)}</span></div>
                <div className="iv-acc-row"><span className="iv-acc-key">Status</span><span className="iv-acc-val">{automation.status}</span></div>
                <div className="iv-acc-row"><span className="iv-acc-key">Current</span><span className="iv-acc-val">{automation.current_node_id?.slice(-8) ?? "Not running"}</span></div>
                {automation.waiting_for && (
                  <div className="iv-acc-row"><span className="iv-acc-key">Waiting for</span><span className="iv-acc-val">{automation.waiting_for}</span></div>
                )}
                <div className="iv-acc-row"><span className="iv-acc-key">Updated</span><span className="iv-acc-val">{formatDateTime(automation.updated_at)}</span></div>
                {automation.variables && Object.keys(automation.variables).length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div className="iv-cf-label" style={{ marginBottom: 4 }}>CAPTURED VARIABLES</div>
                    <div style={{ display: "grid", gap: 4 }}>
                      {Object.entries(automation.variables)
                        .filter(([key, value]) => !key.startsWith("__") && typeof value !== "object")
                        .slice(0, 8)
                        .map(([key, value]) => (
                          <div key={key} className="iv-acc-row">
                            <span className="iv-acc-key">{key}</span>
                            <span className="iv-acc-val">{String(value || "-").slice(0, 80)}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12, color: "#64748b" }}>No flow session has run for this conversation yet.</div>
            )}
          </Accordion>

          {/* Conversation Info */}
          <Accordion id="conv-info" title="Conversation Info" open={openSections.has("conv-info")} onToggle={() => toggleSection("conv-info")}>
            <div className="iv-acc-row"><span className="iv-acc-key">ID</span><span className="iv-acc-val" style={{ fontSize: 11, fontFamily: "monospace" }}>{convId.slice(-8)}</span></div>
            {conv.created_at && <div className="iv-acc-row"><span className="iv-acc-key">Created</span><span className="iv-acc-val">{new Date(conv.created_at).toLocaleDateString()}</span></div>}
            {conv.snoozed_until && <div className="iv-acc-row"><span className="iv-acc-key">Snoozed until</span><span className="iv-acc-val">{new Date(conv.snoozed_until).toLocaleString()}</span></div>}
          </Accordion>

          {/* Timeline */}
          <Accordion id="timeline" title="Timeline" open={openSections.has("timeline")} onToggle={() => toggleSection("timeline")}>
            <div className="iv-timeline">
              {timelineQuery.isLoading ? (
                <div className="iv-timeline-empty">Loading timeline...</div>
              ) : timelineQuery.isError ? (
                <div className="iv-timeline-empty">{(timelineQuery.error as Error).message || "Failed to load timeline"}</div>
              ) : (timelineQuery.data?.events ?? []).length === 0 ? (
                <div className="iv-timeline-empty">No timeline events yet.</div>
              ) : (
                (timelineQuery.data?.events ?? []).map((event: ConversationTimelineEvent) => (
                  <div key={event.id} className={`iv-timeline-item iv-timeline-${event.type}`}>
                    <span className="iv-timeline-icon">{timelineIcon(event.type)}</span>
                    <div className="iv-timeline-body">
                      <span className="iv-timeline-label">{event.label}</span>
                      {event.detail && <span className="iv-timeline-detail">{event.detail}</span>}
                      <span className="iv-timeline-time">{formatDateTime(event.occurred_at)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Accordion>
      </div>
    </div>
  );
}

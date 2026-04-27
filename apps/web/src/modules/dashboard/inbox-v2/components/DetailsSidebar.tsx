import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useConvStore } from "../store/convStore";
import { useSetStatus, useSetPriority, useSetLabels, useLabels } from "../queries";
import { fetchContactByConversation, listContactFields, fetchAgentProfiles, patchAssignAgent, patchAiMode, setCsatRating, sendCsatSurvey } from "../api";
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

interface FieldRowProps { label: string; value: React.ReactNode }
function FieldRow({ label, value }: FieldRowProps) {
  return (
    <div className="iv-cf-row">
      <div className="iv-cf-label">{label}</div>
      <div className="iv-cf-value">{value}</div>
    </div>
  );
}

interface Props { convId: string }

export function DetailsSidebar({ convId }: Props) {
  const [openSections, setOpenSections] = useState<Set<string>>(getSavedSections);
  const [snoozeAt, setSnoozeAt] = useState("");
  const [pendingSnooze, setPendingSnooze] = useState(false);

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
    enabled: Boolean(token),
    staleTime: 60_000
  });

  const assignMut = useMutation({
    mutationFn: (agentProfileId: string | null) => patchAssignAgent(token!, convId, agentProfileId),
    onSuccess: (_data, agentProfileId) => upsertConv({ id: convId, assigned_agent_profile_id: agentProfileId })
  });

  const aiToggleMut = useMutation({
    mutationFn: (paused: boolean) => patchAiMode(token!, convId, paused),
    onSuccess: (_data, paused) => upsertConv({ id: convId, ai_paused: paused, manual_takeover: paused })
  });

  const csatRatingMut = useMutation({
    mutationFn: (rating: number) => setCsatRating(token!, convId, rating),
    onSuccess: (_data, rating) => upsertConv({ id: convId, csat_rating: rating } as Parameters<typeof upsertConv>[0])
  });

  const csatSendMut = useMutation({
    mutationFn: () => sendCsatSurvey(token!, convId),
    onSuccess: () => upsertConv({ id: convId, csat_sent_at: new Date().toISOString() } as Parameters<typeof upsertConv>[0])
  });

  const contactQuery = useQuery({
    queryKey: ["iv2-contact", convId],
    queryFn: () => fetchContactByConversation(token!, convId),
    enabled: Boolean(token && convId),
    staleTime: 30_000
  });

  const fieldsQuery = useQuery({
    queryKey: ["iv2-contact-fields"],
    queryFn: () => listContactFields(token!),
    enabled: Boolean(token),
    staleTime: 60_000
  });

  const contact = contactQuery.data?.contact ?? null;
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
  }, [convId]);

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

            {contact?.tags && contact.tags.length > 0 && (
              <div className="iv-cf-row">
                <div className="iv-cf-label">TAGS</div>
                <div className="iv-cf-value">
                  <div className="iv-tag-cloud">
                    {contact.tags.map((tag) => (
                      <span key={tag} className="iv-tag">{tag}</span>
                    ))}
                  </div>
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

          {/* Conversation Info */}
          <Accordion id="conv-info" title="Conversation Info" open={openSections.has("conv-info")} onToggle={() => toggleSection("conv-info")}>
            <div className="iv-acc-row"><span className="iv-acc-key">ID</span><span className="iv-acc-val" style={{ fontSize: 11, fontFamily: "monospace" }}>{convId.slice(-8)}</span></div>
            {conv.created_at && <div className="iv-acc-row"><span className="iv-acc-key">Created</span><span className="iv-acc-val">{new Date(conv.created_at).toLocaleDateString()}</span></div>}
            {conv.snoozed_until && <div className="iv-acc-row"><span className="iv-acc-key">Snoozed until</span><span className="iv-acc-val">{new Date(conv.snoozed_until).toLocaleString()}</span></div>}
          </Accordion>

          {/* Timeline */}
          <Accordion id="timeline" title="Timeline" open={openSections.has("timeline")} onToggle={() => toggleSection("timeline")}>
            <div className="iv-timeline">
              {[
                conv.created_at         && { icon: "💬", label: "Conversation started",  time: conv.created_at },
                conv.last_message_at    && { icon: "📩", label: "Last message",           time: conv.last_message_at },
                conv.last_ai_reply_at   && { icon: "🤖", label: "Last AI reply",          time: conv.last_ai_reply_at },
                conv.agent_last_seen_at && { icon: "👁", label: "Agent last seen",        time: conv.agent_last_seen_at },
                conv.csat_sent_at       && { icon: "⭐", label: "CSAT survey sent",       time: conv.csat_sent_at },
              ]
                .filter(Boolean)
                .sort((a, b) => Date.parse((a as { time: string }).time) - Date.parse((b as { time: string }).time))
                .map((ev, i) => {
                  const e = ev as { icon: string; label: string; time: string };
                  return (
                    <div key={i} className="iv-timeline-item">
                      <span className="iv-timeline-icon">{e.icon}</span>
                      <div className="iv-timeline-body">
                        <span className="iv-timeline-label">{e.label}</span>
                        <span className="iv-timeline-time">{new Date(e.time).toLocaleString()}</span>
                      </div>
                    </div>
                  );
                })
              }
            </div>
          </Accordion>

          {/* CSAT */}
          <Accordion id="csat" title="CSAT" open={openSections.has("csat")} onToggle={() => toggleSection("csat")}>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Customer rating</div>
              <div style={{ display: "flex", gap: 4 }}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    disabled={csatRatingMut.isPending}
                    onClick={() => csatRatingMut.mutate(star)}
                    style={{
                      width: 32, height: 32, border: "none", borderRadius: 6, cursor: "pointer", fontSize: 18,
                      background: (conv.csat_rating ?? 0) >= star ? "#fbbf24" : "#f1f5f9",
                      opacity: csatRatingMut.isPending ? 0.6 : 1,
                      transition: "background 0.15s"
                    }}
                  >⭐</button>
                ))}
              </div>
              {conv.csat_rating && (
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                  Rated {conv.csat_rating}/5
                </div>
              )}
            </div>
            <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 8 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>
                {conv.csat_sent_at
                  ? `Survey sent ${new Date(conv.csat_sent_at).toLocaleDateString()}`
                  : "No survey sent yet"}
              </div>
              <button
                className="account-btn-secondary"
                style={{ fontSize: 11, padding: "3px 10px" }}
                disabled={csatSendMut.isPending}
                onClick={() => csatSendMut.mutate()}
              >
                {csatSendMut.isPending ? "Sending…" : "Send CSAT survey"}
              </button>
              {csatSendMut.isError && (
                <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>
                  {(csatSendMut.error as Error).message}
                </div>
              )}
            </div>
          </Accordion>
      </div>
    </div>
  );
}

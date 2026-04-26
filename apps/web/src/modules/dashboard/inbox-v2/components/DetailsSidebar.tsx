import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConvStore } from "../store/convStore";
import { useSetStatus, useSetPriority, useSetLabels, useLabels } from "../queries";
import { fetchContactByConversation, listContactFields } from "../api";
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
  const [sidebarTab, setSidebarTab] = useState<"contact" | "copilot">("contact");

  const { byId, labels } = useConvStore();
  const conv = byId[convId];
  const { token } = useAuth();
  useLabels();

  const setStatus = useSetStatus();
  const setPriority = useSetPriority();
  const setLabels = useSetLabels();

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
      {/* Tabs */}
      <div className="iv-sidebar-tabs">
        <div className={`iv-sidebar-tab${sidebarTab === "contact" ? " active" : ""}`} onClick={() => setSidebarTab("contact")}>Contact</div>
        <div className={`iv-sidebar-tab${sidebarTab === "copilot" ? " active" : ""}`} onClick={() => setSidebarTab("copilot")}>Copilot ✨</div>
      </div>

      {sidebarTab === "contact" && (
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

            <FieldRow label="NAME" value={displayName} />
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
            <div className="iv-acc-row">
              <span className="iv-acc-key">Status</span>
              <select
                className="iv-acc-val"
                value={conv.status ?? "open"}
                style={{ border: "1px solid #e2eaf4", borderRadius: 6, padding: "2px 6px", fontSize: 12, background: "#fff" }}
                onChange={(e) => setStatus.mutate({ convId, status: e.target.value })}
              >
                {["open", "pending", "resolved", "snoozed"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
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
            <div className="iv-acc-row" style={{ flexDirection: "column", gap: 4 }}>
              <span className="iv-acc-key">Labels</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                {labels.map((l) => {
                  const convLabelIds = (conv as unknown as { label_ids?: string[] }).label_ids ?? [];
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
              <div className={`iv-toggle ${conv.ai_paused ? "off" : "on"}`}>
                <div className="iv-toggle-knob" />
              </div>
            </div>
            {conv.ai_paused && <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 4 }}>⏸ AI paused</div>}
          </Accordion>

          {/* Conversation Info */}
          <Accordion id="conv-info" title="Conversation Info" open={openSections.has("conv-info")} onToggle={() => toggleSection("conv-info")}>
            <div className="iv-acc-row"><span className="iv-acc-key">ID</span><span className="iv-acc-val" style={{ fontSize: 11, fontFamily: "monospace" }}>{convId.slice(-8)}</span></div>
            {conv.created_at && <div className="iv-acc-row"><span className="iv-acc-key">Created</span><span className="iv-acc-val">{new Date(conv.created_at).toLocaleDateString()}</span></div>}
          </Accordion>

          {/* CSAT */}
          <Accordion id="csat" title="CSAT" open={openSections.has("csat")} onToggle={() => toggleSection("csat")}>
            <div style={{ fontSize: 12, color: "#94a3b8", padding: "4px 0" }}>No rating yet</div>
          </Accordion>
        </div>
      )}

      {sidebarTab === "copilot" && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 13 }}>
          Copilot coming soon
        </div>
      )}
    </div>
  );
}

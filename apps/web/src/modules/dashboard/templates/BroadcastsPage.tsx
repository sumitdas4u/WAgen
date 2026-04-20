import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelCampaignRun,
  createCampaignDraft,
  fetchCampaignMessages,
  fetchCampaigns,
  fetchSegmentContacts,
  launchCampaignDraft,
  listContactFields,
  listContactSegments,
  type Campaign,
  type CampaignTemplateVariableBinding,
  type CampaignTemplateVariables,
  type ContactField,
  type ContactRecord,
  type MessageTemplate,
  type MetaBusinessStatus
} from "../../../lib/api";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { TemplatePreviewPanel } from "./TemplatePreviewPanel";
import { useTemplatesQuery } from "./queries";

const STANDARD_CONTACT_FIELDS = [
  { value: "display_name", label: "Contact name" },
  { value: "phone_number", label: "Phone number" },
  { value: "email", label: "Email" },
  { value: "contact_type", label: "Contact type" },
  { value: "tags", label: "Tags" },
  { value: "source_type", label: "Source type" },
  { value: "source_id", label: "Source ID" },
  { value: "source_url", label: "Source URL" }
] as const;

function extractTemplatePlaceholders(template: MessageTemplate | null): string[] {
  if (!template) {
    return [];
  }
  return Array.from(
    new Set(
      [...JSON.stringify(template.components).matchAll(/\{\{[^}]+\}\}/g)]
        .map((match) => match[0])
        .sort((left, right) => left.localeCompare(right))
    )
  );
}

function resolveContactFieldValue(contact: ContactRecord | null, field: string | undefined): string {
  if (!contact || !field) {
    return "";
  }

  switch (field) {
    case "display_name":
      return contact.display_name ?? "";
    case "phone_number":
      return contact.phone_number ?? "";
    case "email":
      return contact.email ?? "";
    case "contact_type":
      return contact.contact_type ?? "";
    case "tags":
      return contact.tags.join(", ");
    case "source_type":
      return contact.source_type ?? "";
    default:
      break;
  }

  if (!field.startsWith("custom:")) {
    return "";
  }

  const customField = field.slice("custom:".length).trim().toLowerCase();
  return (
    contact.custom_field_values.find((item) => item.field_name.toLowerCase() === customField)?.value ?? ""
  );
}

function parseSampleDate(raw: string): Date | null {
  if (!raw?.trim()) return null;
  const s = raw.trim();
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(T.*)?$/.test(s)) {
    const d = new Date(s.replace(/\//g, "-"));
    if (!isNaN(d.getTime())) return d;
  }
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]), month = Number(dmy[2]), year = Number(dmy[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const d = new Date(year, month - 1, day);
      if (!isNaN(d.getTime()) && d.getDate() === day) return d;
    }
  }
  const dmmmY = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (dmmmY) {
    const d = new Date(`${dmmmY[2]} ${dmmmY[1]}, ${dmmmY[3]}`);
    if (!isNaN(d.getTime())) return d;
  }
  if (/^[A-Za-z]/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
  }
  if (/^\d{13}$/.test(s)) {
    const d = new Date(Number(s));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function computeDateOffsetPreview(offset: CampaignTemplateVariableBinding["dateOffset"], baseDateStr?: string): string {
  if (!offset) return "";
  const base = baseDateStr ? parseSampleDate(baseDateStr) : new Date();
  if (!base) return "";
  const d = new Date(base);
  const n = offset.direction === "subtract" ? -offset.value : offset.value;
  if (offset.unit === "days")   d.setDate(d.getDate() + n);
  if (offset.unit === "weeks")  d.setDate(d.getDate() + n * 7);
  if (offset.unit === "months") d.setMonth(d.getMonth() + n);
  if (offset.unit === "years")  d.setFullYear(d.getFullYear() + n);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function resolveBindingPreviewValue(
  placeholder: string,
  bindings: CampaignTemplateVariables,
  sampleContact: ContactRecord | null
): string {
  const binding = bindings[placeholder];
  if (!binding) {
    return placeholder;
  }

  if (binding.source === "now") {
    return computeDateOffsetPreview(binding.dateOffset) || placeholder;
  }

  if (binding.source === "static") {
    return binding.value?.trim() || binding.fallback?.trim() || placeholder;
  }

  const contactValue = resolveContactFieldValue(sampleContact, binding.field);
  return contactValue || binding.fallback?.trim() || placeholder;
}

function buildPreviewComponents(
  template: MessageTemplate | null,
  bindings: CampaignTemplateVariables,
  sampleContact: ContactRecord | null
) {
  if (!template) {
    return [];
  }

  return template.components.map((component) => {
    if (!component.text) {
      return component;
    }
    const resolvedText = component.text.replace(/\{\{[^}]+\}\}/g, (match) =>
      resolveBindingPreviewValue(match, bindings, sampleContact)
    );
    return {
      ...component,
      text: resolvedText
    };
  });
}

function formatCampaignStatus(status: Campaign["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatFieldLabel(field: ContactField): string {
  return `${field.label} (custom)`;
}

interface Props {
  token: string;
  metaStatus?: MetaBusinessStatus | null;
}

export function BroadcastsPage({ token, metaStatus }: Props) {
  const queryClient = useQueryClient();
  const templatesQuery = useTemplatesQuery(token);
  const campaignsQuery = useQuery({
    queryKey: dashboardQueryKeys.campaigns,
    queryFn: () => fetchCampaigns(token).then((response) => response.campaigns),
    staleTime: 15_000
  });
  const segmentsQuery = useQuery({
    queryKey: dashboardQueryKeys.contactSegments,
    queryFn: () => listContactSegments(token).then((response) => response.segments),
    staleTime: 60_000
  });
  const fieldsQuery = useQuery({
    queryKey: dashboardQueryKeys.contactFields,
    queryFn: () => listContactFields(token).then((response) => response.fields),
    staleTime: 60_000
  });

  const approvedTemplates = useMemo(
    () => (templatesQuery.data ?? []).filter((template) => template.status === "APPROVED"),
    [templatesQuery.data]
  );
  const campaigns = campaignsQuery.data ?? [];
  const segments = segmentsQuery.data ?? [];
  const fields = fieldsQuery.data ?? [];

  const [draftName, setDraftName] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedSegmentId, setSelectedSegmentId] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [bindings, setBindings] = useState<CampaignTemplateVariables>({});
  const [sampleDates, setSampleDates] = useState<Record<string, string>>({});
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedTemplate = approvedTemplates.find((template) => template.id === selectedTemplateId) ?? null;
  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;
  const placeholders = useMemo(() => extractTemplatePlaceholders(selectedTemplate), [selectedTemplate]);

  useEffect(() => {
    setBindings((current) => {
      const next: CampaignTemplateVariables = {};
      for (const placeholder of placeholders) {
        next[placeholder] = current[placeholder] ?? { source: "contact", field: "display_name", fallback: "" };
      }
      return next;
    });
  }, [placeholders]);

  useEffect(() => {
    if (!selectedCampaignId && campaigns.length > 0) {
      setSelectedCampaignId(campaigns[0]!.id);
    }
  }, [campaigns, selectedCampaignId]);

  const sampleContactsQuery = useQuery({
    queryKey: dashboardQueryKeys.segmentContacts(selectedSegmentId || "draft"),
    queryFn: () =>
      selectedSegmentId
        ? fetchSegmentContacts(token, selectedSegmentId).then((response) => response.contacts)
        : Promise.resolve([] as ContactRecord[]),
    enabled: Boolean(selectedSegmentId),
    staleTime: 15_000
  });

  const selectedCampaignMessagesQuery = useQuery({
    queryKey: dashboardQueryKeys.campaignMessages(selectedCampaignId ?? "none", "all", 0),
    queryFn: () =>
      selectedCampaignId
        ? fetchCampaignMessages(token, selectedCampaignId, { limit: 50 }).then((response) => response)
        : Promise.resolve({ messages: [], total: 0 }),
    enabled: Boolean(selectedCampaignId),
    staleTime: 10_000
  });

  const sampleContact = sampleContactsQuery.data?.[0] ?? null;
  const previewComponents = useMemo(
    () => buildPreviewComponents(selectedTemplate, bindings, sampleContact),
    [bindings, sampleContact, selectedTemplate]
  );

  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      const result = await createCampaignDraft(token, {
        name: draftName.trim(),
        templateId: selectedTemplateId || null,
        templateVariables: bindings,
        targetSegmentId: selectedSegmentId || null
      });
      return result.campaign;
    },
    onSuccess: async (campaign) => {
      setFormError(null);
      setFormMessage("Broadcast draft saved.");
      setSelectedCampaignId(campaign.id);
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.campaignsRoot });
    },
    onError: (error) => {
      setFormMessage(null);
      setFormError((error as Error).message);
    }
  });

  const launchNowMutation = useMutation({
    mutationFn: async () => {
      const created = await createCampaignDraft(token, {
        name: draftName.trim(),
        templateId: selectedTemplateId || null,
        templateVariables: bindings,
        targetSegmentId: selectedSegmentId || null
      });
      const launched = await launchCampaignDraft(token, created.campaign.id);
      return launched.campaign;
    },
    onSuccess: async (campaign) => {
      setFormError(null);
      setFormMessage("Broadcast launched.");
      setSelectedCampaignId(campaign.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.campaignsRoot }),
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.campaignMessages(campaign.id, "all", 0) })
      ]);
    },
    onError: (error) => {
      setFormMessage(null);
      setFormError((error as Error).message);
    }
  });

  const cancelMutation = useMutation({
    mutationFn: (campaignId: string) => cancelCampaignRun(token, campaignId).then((response) => response.campaign),
    onSuccess: async (campaign) => {
      setSelectedCampaignId(campaign.id);
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.campaignsRoot });
    }
  });

  const fieldOptions = useMemo(
    () => [
      ...STANDARD_CONTACT_FIELDS.map((field) => ({ value: field.value, label: field.label })),
      ...fields.map((field) => ({ value: `custom:${field.name}`, label: formatFieldLabel(field) }))
    ],
    [fields]
  );

  const isComposerValid = draftName.trim() && selectedTemplateId && selectedSegmentId;
  const launchDisabled = !isComposerValid || launchNowMutation.isPending;
  const draftDisabled = !isComposerValid || saveDraftMutation.isPending;

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)", gap: "20px" }}>
        <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "16px", padding: "20px", display: "grid", gap: "18px" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 700 }}>Template Broadcasts</h2>
            <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "14px" }}>
              Build a launch-now campaign from an approved template, map placeholders to contact data, and track each recipient send.
            </p>
          </div>

          {!metaStatus?.connected && (
            <div style={{ padding: "12px 14px", borderRadius: "10px", background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: "13px" }}>
              Connect a WhatsApp API number before launching broadcasts.
            </div>
          )}

          <div style={{ display: "grid", gap: "14px", gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <label style={{ display: "grid", gap: "6px", fontSize: "13px", color: "#374151" }}>
              <span>Broadcast name</span>
              <input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="April follow-up" style={{ border: "1px solid #d1d5db", borderRadius: "10px", padding: "10px 12px" }} />
            </label>

            <label style={{ display: "grid", gap: "6px", fontSize: "13px", color: "#374151" }}>
              <span>Approved template</span>
              <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)} style={{ border: "1px solid #d1d5db", borderRadius: "10px", padding: "10px 12px" }}>
                <option value="">Select template</option>
                {approvedTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}{template.displayPhoneNumber ? ` • ${template.displayPhoneNumber}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: "6px", fontSize: "13px", color: "#374151" }}>
              <span>Audience segment</span>
              <select value={selectedSegmentId} onChange={(event) => setSelectedSegmentId(event.target.value)} style={{ border: "1px solid #d1d5db", borderRadius: "10px", padding: "10px 12px" }}>
                <option value="">Select segment</option>
                {segments.map((segment) => (
                  <option key={segment.id} value={segment.id}>
                    {segment.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedTemplate && (
            <div style={{ display: "grid", gap: "10px" }}>
              <div style={{ padding: "14px 16px", borderRadius: "12px", background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: "13px", color: "#334155" }}>
                Sending number: <strong>{selectedTemplate.displayPhoneNumber ?? selectedTemplate.linkedNumber ?? "Workspace default"}</strong>
              </div>
              {selectedTemplate.category === "MARKETING" && (
                <div style={{ padding: "12px 14px", borderRadius: "12px", background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: "13px" }}>
                  This is a Meta marketing template. Approval only means the template format is allowed. Delivery can still be blocked per recipient based on Meta engagement policy.
                </div>
              )}
            </div>
          )}

          <div style={{ display: "grid", gap: "12px" }}>
            <div style={{ fontWeight: 700, fontSize: "14px" }}>Variable bindings</div>
            {placeholders.length === 0 ? (
              <div style={{ padding: "14px 16px", borderRadius: "12px", background: "#f8fafc", border: "1px solid #e2e8f0", color: "#64748b", fontSize: "13px" }}>
                This template has no dynamic placeholders. It can be launched as-is.
              </div>
            ) : (
              placeholders.map((placeholder) => {
                const binding = bindings[placeholder] ?? { source: "contact", field: "display_name", fallback: "" };
                return (
                  <div key={placeholder} style={{ display: "flex", flexDirection: "column", gap: "10px", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "12px 14px" }}>
                    <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "140px 160px minmax(0, 1fr) minmax(0, 1fr)", alignItems: "center" }}>
                      <strong style={{ fontSize: "13px", color: "#0f172a" }}>{placeholder}</strong>

                      <select
                        value={binding.source}
                        onChange={(event) => {
                          const src = event.target.value as "contact" | "static" | "now";
                          if (src === "now") {
                            setBindings((current) => ({ ...current, [placeholder]: { source: "now", dateOffset: { direction: "add", value: 1, unit: "days" } } }));
                          } else {
                            setBindings((current) => ({ ...current, [placeholder]: { ...binding, source: src, dateOffset: undefined } }));
                          }
                        }}
                        style={{ border: "1px solid #d1d5db", borderRadius: "10px", padding: "9px 10px" }}
                      >
                        <option value="contact">Contact field</option>
                        <option value="static">Static value</option>
                        <option value="now">📅 Today&apos;s date</option>
                      </select>

                      {binding.source === "contact" && (
                        <select
                          value={binding.field ?? "display_name"}
                          onChange={(event) => setBindings((current) => ({ ...current, [placeholder]: { ...binding, field: event.target.value } }))}
                          style={{ border: "1px solid #d1d5db", borderRadius: "10px", padding: "9px 10px" }}
                        >
                          {fieldOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      )}
                      {binding.source === "static" && (
                        <input
                          value={binding.value ?? ""}
                          onChange={(event) => setBindings((current) => ({ ...current, [placeholder]: { ...binding, value: event.target.value } }))}
                          placeholder="Static replacement"
                          style={{ border: "1px solid #d1d5db", borderRadius: "10px", padding: "9px 10px" }}
                        />
                      )}
                      {binding.source === "now" && <span />}

                      {binding.source !== "now" && (
                        <input
                          value={binding.fallback ?? ""}
                          onChange={(event) => setBindings((current) => ({ ...current, [placeholder]: { ...binding, fallback: event.target.value } }))}
                          placeholder="Fallback if empty"
                          style={{ border: "1px solid #d1d5db", borderRadius: "10px", padding: "9px 10px" }}
                        />
                      )}
                    </div>

                    {(binding.source === "now" || binding.source === "contact") && (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "12px", color: "#64748b", width: "80px" }}>
                          {binding.source === "contact" ? "Date offset" : "Offset"}
                        </span>
                        {binding.source === "contact" && (
                          <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "13px", cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={!!binding.dateOffset}
                              onChange={(e) => setBindings((c) => ({ ...c, [placeholder]: { ...binding, dateOffset: e.target.checked ? { direction: "add" as const, value: 1, unit: "days" as const } : undefined } }))}
                            />
                            Shift this date
                          </label>
                        )}
                        {(binding.source === "now" || binding.dateOffset) && (
                          <>
                            <select
                              value={binding.dateOffset?.direction ?? "add"}
                              onChange={(e) => setBindings((c) => ({ ...c, [placeholder]: { ...binding, dateOffset: { ...(binding.dateOffset ?? { value: 1, unit: "days" as const }), direction: e.target.value as "add" | "subtract" } } }))}
                              style={{ border: "1px solid #d1d5db", borderRadius: "8px", padding: "6px 8px", fontSize: "13px" }}
                            >
                              <option value="add">+ Add</option>
                              <option value="subtract">− Subtract</option>
                            </select>
                            <input
                              type="number" min={1} max={999}
                              value={binding.dateOffset?.value ?? 1}
                              onChange={(e) => setBindings((c) => ({ ...c, [placeholder]: { ...binding, dateOffset: { ...(binding.dateOffset ?? { direction: "add" as const, unit: "days" as const }), value: Math.max(1, Number(e.target.value)) } } }))}
                              style={{ width: "60px", border: "1px solid #d1d5db", borderRadius: "8px", padding: "6px 8px", fontSize: "13px" }}
                            />
                            <select
                              value={binding.dateOffset?.unit ?? "days"}
                              onChange={(e) => setBindings((c) => ({ ...c, [placeholder]: { ...binding, dateOffset: { ...(binding.dateOffset ?? { direction: "add" as const, value: 1 }), unit: e.target.value as "days" | "weeks" | "months" | "years" } } }))}
                              style={{ border: "1px solid #d1d5db", borderRadius: "8px", padding: "6px 8px", fontSize: "13px" }}
                            >
                              <option value="days">Days</option>
                              <option value="weeks">Weeks</option>
                              <option value="months">Months</option>
                              <option value="years">Years</option>
                            </select>
                            {binding.source === "now" && (
                              <span style={{ color: "#16a34a", fontSize: "13px", fontWeight: 600 }}>
                                → {computeDateOffsetPreview(binding.dateOffset)}
                              </span>
                            )}
                          </>
                        )}
                        {binding.source === "contact" && binding.dateOffset && (
                          <>
                            <input
                              placeholder="Test: DD/MM/YYYY"
                              value={sampleDates[placeholder] ?? ""}
                              onChange={(e) => setSampleDates((s) => ({ ...s, [placeholder]: e.target.value }))}
                              style={{ width: "150px", border: "1px solid #d1d5db", borderRadius: "8px", padding: "6px 8px", fontSize: "13px" }}
                            />
                            {sampleDates[placeholder] && (() => {
                              const result = computeDateOffsetPreview(binding.dateOffset, sampleDates[placeholder]);
                              return result
                                ? <span style={{ color: "#16a34a", fontSize: "13px", fontWeight: 600 }}>→ {result}</span>
                                : <span style={{ color: "#dc2626", fontSize: "12px" }}>Not a valid date — fallback used</span>;
                            })()}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button type="button" onClick={() => saveDraftMutation.mutate()} disabled={draftDisabled} style={{ padding: "10px 16px", borderRadius: "10px", border: "1px solid #d1d5db", background: "#fff", cursor: draftDisabled ? "not-allowed" : "pointer", fontWeight: 600 }}>
              {saveDraftMutation.isPending ? "Saving…" : "Save draft"}
            </button>
            <button type="button" onClick={() => launchNowMutation.mutate()} disabled={launchDisabled} style={{ padding: "10px 18px", borderRadius: "10px", border: "none", background: "#128c7e", color: "#fff", cursor: launchDisabled ? "not-allowed" : "pointer", fontWeight: 700 }}>
              {launchNowMutation.isPending ? "Launching…" : "Launch now"}
            </button>
            {formMessage && <span style={{ color: "#166534", fontSize: "13px" }}>{formMessage}</span>}
            {formError && <span style={{ color: "#b91c1c", fontSize: "13px" }}>{formError}</span>}
          </div>
        </section>

        <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "16px", padding: "20px", display: "grid", gap: "14px" }}>
          <div>
            <div style={{ fontSize: "15px", fontWeight: 700 }}>Live preview</div>
            <div style={{ marginTop: "4px", color: "#6b7280", fontSize: "13px" }}>
              {sampleContact
                ? `Previewing with ${sampleContact.display_name || sampleContact.phone_number}`
                : selectedSegmentId
                  ? "No sample contact found in this segment yet."
                  : "Choose a segment to preview with a sample contact."}
            </div>
          </div>
          {selectedTemplate ? (
            <TemplatePreviewPanel
              components={previewComponents}
              businessName={selectedTemplate.displayPhoneNumber ?? selectedTemplate.name}
            />
          ) : (
            <div style={{ minHeight: "320px", borderRadius: "14px", border: "1px dashed #cbd5e1", display: "grid", placeItems: "center", color: "#64748b", fontSize: "13px" }}>
              Select an approved template to preview the broadcast.
            </div>
          )}
        </section>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 0.9fr) minmax(0, 1.1fr)", gap: "20px" }}>
        <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "16px", padding: "20px", display: "grid", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700 }}>Campaigns</h3>
            <span style={{ color: "#64748b", fontSize: "13px" }}>{campaigns.length} total</span>
          </div>

          {campaignsQuery.isLoading ? (
            <div style={{ color: "#64748b", fontSize: "13px" }}>Loading broadcasts…</div>
          ) : campaigns.length === 0 ? (
            <div style={{ color: "#64748b", fontSize: "13px" }}>No broadcasts created yet.</div>
          ) : (
            campaigns.map((campaign) => (
              <button
                key={campaign.id}
                type="button"
                onClick={() => setSelectedCampaignId(campaign.id)}
                style={{
                  textAlign: "left",
                  background: selectedCampaignId === campaign.id ? "#f0fdf4" : "#fff",
                  border: selectedCampaignId === campaign.id ? "1px solid #86efac" : "1px solid #e5e7eb",
                  borderRadius: "14px",
                  padding: "14px",
                  cursor: "pointer",
                  display: "grid",
                  gap: "8px"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                  <strong style={{ color: "#0f172a" }}>{campaign.name}</strong>
                  <span style={{ fontSize: "12px", color: "#128c7e", fontWeight: 700 }}>{formatCampaignStatus(campaign.status)}</span>
                </div>
                <div style={{ color: "#475569", fontSize: "12px" }}>
                  Total {campaign.total_count} • Sent {campaign.sent_count} • Delivered {campaign.delivered_count} • Read {campaign.read_count} • Failed {campaign.failed_count} • Skipped {campaign.skipped_count}
                </div>
              </button>
            ))
          )}
        </section>

        <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "16px", padding: "20px", display: "grid", gap: "14px" }}>
          {!selectedCampaign ? (
            <div style={{ color: "#64748b", fontSize: "13px" }}>Select a campaign to inspect recipient delivery results.</div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>{selectedCampaign.name}</h3>
                  <div style={{ marginTop: "4px", color: "#64748b", fontSize: "13px" }}>
                    Status: {formatCampaignStatus(selectedCampaign.status)} • Started {selectedCampaign.started_at ? new Date(selectedCampaign.started_at).toLocaleString() : "Not started"}
                  </div>
                </div>
                {(selectedCampaign.status === "running" || selectedCampaign.status === "paused") && (
                  <button
                    type="button"
                    onClick={() => cancelMutation.mutate(selectedCampaign.id)}
                    disabled={cancelMutation.isPending}
                    style={{ padding: "9px 14px", borderRadius: "10px", border: "1px solid #fecaca", background: "#fff5f5", color: "#b91c1c", cursor: cancelMutation.isPending ? "not-allowed" : "pointer", fontWeight: 600 }}
                  >
                    {cancelMutation.isPending ? "Cancelling…" : "Cancel"}
                  </button>
                )}
              </div>

              <div style={{ display: "grid", gap: "8px", gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                {[
                  `Queued: ${Math.max(selectedCampaign.total_count - selectedCampaign.sent_count - selectedCampaign.failed_count - selectedCampaign.skipped_count, 0)}`,
                  `Sent: ${selectedCampaign.sent_count}`,
                  `Skipped: ${selectedCampaign.skipped_count}`,
                  `Delivered: ${selectedCampaign.delivered_count}`,
                  `Read: ${selectedCampaign.read_count}`,
                  `Failed: ${selectedCampaign.failed_count}`
                ].map((label) => (
                  <div key={label} style={{ padding: "12px 14px", borderRadius: "12px", background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: "13px", color: "#334155" }}>
                    {label}
                  </div>
                ))}
              </div>

              {selectedCampaignMessagesQuery.isLoading ? (
                <div style={{ color: "#64748b", fontSize: "13px" }}>Loading recipient statuses…</div>
              ) : (
                <div style={{ border: "1px solid #e5e7eb", borderRadius: "14px", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        {["Phone", "Status", "Sent", "Read", "Error"].map((heading) => (
                          <th key={heading} style={{ padding: "10px 12px", textAlign: "left", fontSize: "11px", textTransform: "uppercase", color: "#64748b", borderBottom: "1px solid #e5e7eb" }}>
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedCampaignMessagesQuery.data?.messages ?? []).map((message) => (
                        <tr key={message.id}>
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9", fontSize: "13px" }}>{message.phone_number}</td>
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9", fontSize: "13px" }}>{formatCampaignStatus(message.status as Campaign["status"])}</td>
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9", fontSize: "13px" }}>{message.sent_at ? new Date(message.sent_at).toLocaleString() : "—"}</td>
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9", fontSize: "13px" }}>{message.read_at ? new Date(message.read_at).toLocaleString() : "—"}</td>
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9", fontSize: "13px", color: "#b91c1c" }}>{message.error_message || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

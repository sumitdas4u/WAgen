import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  API_URL,
  cancelCampaignRun,
  createCampaignDraft,
  fetchBroadcastReport,
  fetchBroadcastRetargetPreview,
  fetchBroadcasts,
  fetchSegmentContacts,
  importBroadcastAudienceWorkbook,
  launchCampaignDraft,
  listContactFields,
  listContactSegments,
  type BroadcastReport,
  type Campaign,
  type CampaignMediaOverrides,
  type CampaignTemplateVariables,
  type ContactField,
  type ContactRecord,
  type MessageTemplate,
  type RetargetStatus,
  uploadBroadcastMedia
} from "../../../lib/api";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { TemplatePreviewPanel } from "../templates/TemplatePreviewPanel";
import { useTemplatesQuery } from "../templates/queries";

type ModuleMode = "list" | "new" | "detail" | "retarget";
type WizardStep = 1 | 2 | 3 | 4;

const STANDARD_CONTACT_FIELDS = [
  { value: "display_name", label: "Contact name" },
  { value: "phone_number", label: "Phone number" },
  { value: "email", label: "Email" },
  { value: "contact_type", label: "Contact type" },
  { value: "tags", label: "Tags" },
  { value: "order_date", label: "Order date" },
  { value: "source_type", label: "Source type" },
  { value: "source_id", label: "Source ID" },
  { value: "source_url", label: "Source URL" }
] as const;

const RETARGET_OPTIONS: Array<{ value: RetargetStatus; label: string }> = [
  { value: "sent", label: "Sent" },
  { value: "delivered", label: "Delivered" },
  { value: "read", label: "Read" },
  { value: "failed", label: "Failed" },
  { value: "skipped", label: "Not delivered" }
];

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
    case "order_date":
      return contact.order_date ?? "";
    case "source_type":
      return contact.source_type ?? "";
    case "source_id":
      return contact.source_id ?? "";
    case "source_url":
      return contact.source_url ?? "";
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

function resolveBindingPreviewValue(
  placeholder: string,
  bindings: CampaignTemplateVariables,
  sampleContact: ContactRecord | null
): string {
  const binding = bindings[placeholder];
  if (!binding) {
    return placeholder;
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
    return {
      ...component,
      text: component.text.replace(/\{\{[^}]+\}\}/g, (match) =>
        resolveBindingPreviewValue(match, bindings, sampleContact)
      )
    };
  });
}

function formatCampaignStatus(status: Campaign["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function cardStyle(selected = false): React.CSSProperties {
  return {
    border: selected ? "1px solid #60a5fa" : "1px solid #e5e7eb",
    borderRadius: "16px",
    padding: "16px",
    background: selected ? "#eff6ff" : "#fff",
    cursor: "pointer"
  };
}

function SummaryCards({ report }: { report: BroadcastReport }) {
  const items = [
    { label: "Recipients", value: report.campaign.total_count },
    { label: "Sent", value: report.buckets.sent },
    { label: "Delivered", value: report.buckets.delivered },
    { label: "Read", value: report.buckets.read },
    { label: "Failed", value: report.buckets.failed },
    { label: "Not delivered", value: report.buckets.skipped }
  ];

  return (
    <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}>
      {items.map((item) => (
        <div key={item.label} style={{ border: "1px solid #e5e7eb", borderRadius: "14px", padding: "14px", background: "#fff" }}>
          <div style={{ fontSize: "12px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>{item.label}</div>
          <div style={{ marginTop: "8px", fontSize: "28px", fontWeight: 700, color: "#0f172a" }}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function BroadcastListPage({ token }: { token: string }) {
  const navigate = useNavigate();
  const broadcastsQuery = useQuery({
    queryKey: dashboardQueryKeys.broadcasts,
    queryFn: () => fetchBroadcasts(token)
  });

  const data = broadcastsQuery.data;

  return (
    <section style={{ display: "grid", gap: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "28px", fontWeight: 700 }}>Broadcasts</h2>
          <p style={{ margin: "6px 0 0", color: "#64748b" }}>
            Manage broadcast sends, delivery performance, and retargeting from one workspace.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/dashboard/broadcast/new")}
          style={{ border: "none", background: "#2563eb", color: "#fff", borderRadius: "12px", padding: "12px 18px", fontWeight: 700, cursor: "pointer" }}
        >
          New Broadcast
        </button>
      </div>

      {data?.summary ? (
        <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}>
          {[
            ["Recipients", data.summary.recipients],
            ["Sent", data.summary.sent],
            ["Delivered", data.summary.delivered],
            ["Engaged", data.summary.engaged],
            ["Failed", data.summary.failed],
            ["Suppressed", data.summary.suppressed]
          ].map(([label, value]) => (
            <div key={String(label)} style={{ border: "1px solid #e5e7eb", borderRadius: "14px", padding: "14px", background: "#fff" }}>
              <div style={{ fontSize: "12px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
              <div style={{ marginTop: "8px", fontSize: "28px", fontWeight: 700 }}>{value}</div>
            </div>
          ))}
        </div>
      ) : null}

      <section style={{ border: "1px solid #e5e7eb", borderRadius: "18px", overflow: "hidden", background: "#fff" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {["Broadcast", "Status", "Recipients", "Sent", "Delivered", "Read", "Failed", "Created", "Actions"].map((heading) => (
                <th key={heading} style={{ padding: "12px 14px", textAlign: "left", fontSize: "11px", color: "#64748b", textTransform: "uppercase", borderBottom: "1px solid #e5e7eb" }}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.broadcasts ?? []).map((broadcast) => (
              <tr key={broadcast.id}>
                <td style={{ padding: "14px", borderBottom: "1px solid #f1f5f9" }}>
                  <div style={{ fontWeight: 700 }}>{broadcast.name}</div>
                  <div style={{ color: "#64748b", fontSize: "12px" }}>
                    {broadcast.broadcast_type === "retarget" ? "Retarget broadcast" : "Standard broadcast"}
                  </div>
                </td>
                <td style={{ padding: "14px", borderBottom: "1px solid #f1f5f9" }}>{formatCampaignStatus(broadcast.status)}</td>
                <td style={{ padding: "14px", borderBottom: "1px solid #f1f5f9" }}>{broadcast.total_count}</td>
                <td style={{ padding: "14px", borderBottom: "1px solid #f1f5f9" }}>{broadcast.sent_count}</td>
                <td style={{ padding: "14px", borderBottom: "1px solid #f1f5f9" }}>{broadcast.delivered_count}</td>
                <td style={{ padding: "14px", borderBottom: "1px solid #f1f5f9" }}>{broadcast.read_count}</td>
                <td style={{ padding: "14px", borderBottom: "1px solid #f1f5f9" }}>{broadcast.failed_count}</td>
                <td style={{ padding: "14px", borderBottom: "1px solid #f1f5f9" }}>{new Date(broadcast.created_at).toLocaleString()}</td>
                <td style={{ padding: "14px", borderBottom: "1px solid #f1f5f9" }}>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button type="button" className="ghost-btn" onClick={() => navigate(`/dashboard/broadcast/${broadcast.id}`)}>View</button>
                    <button type="button" className="ghost-btn" onClick={() => navigate(`/dashboard/broadcast/${broadcast.id}/retarget`)}>Retarget</button>
                  </div>
                </td>
              </tr>
            ))}
            {!broadcastsQuery.isLoading && (data?.broadcasts ?? []).length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: "28px", textAlign: "center", color: "#64748b" }}>
                  No broadcasts created yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </section>
  );
}

function BroadcastDetailPage({ token, campaignId }: { token: string; campaignId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reportQuery = useQuery({
    queryKey: dashboardQueryKeys.broadcastReport(campaignId, "all", 0),
    queryFn: () => fetchBroadcastReport(token, campaignId).then((response) => response.report)
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelCampaignRun(token, campaignId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.broadcasts }),
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.broadcastReport(campaignId, "all", 0) })
      ]);
    }
  });

  const report = reportQuery.data;
  if (!report) {
    return <div style={{ color: "#64748b" }}>Loading broadcast report…</div>;
  }

  return (
    <section style={{ display: "grid", gap: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "28px", fontWeight: 700 }}>{report.campaign.name}</h2>
          <p style={{ margin: "6px 0 0", color: "#64748b" }}>
            {formatCampaignStatus(report.campaign.status)} • Created {new Date(report.campaign.created_at).toLocaleString()}
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button type="button" className="ghost-btn" onClick={() => navigate(`/dashboard/broadcast/${campaignId}/retarget`)}>Retarget</button>
          {(report.campaign.status === "running" || report.campaign.status === "scheduled" || report.campaign.status === "draft") ? (
            <button type="button" className="ghost-btn" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
              {cancelMutation.isPending ? "Cancelling..." : "Cancel"}
            </button>
          ) : null}
        </div>
      </div>

      <SummaryCards report={report} />

      <section style={{ border: "1px solid #e5e7eb", borderRadius: "18px", overflow: "hidden", background: "#fff" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {["Phone", "Status", "Sent", "Delivered", "Read", "Error"].map((heading) => (
                <th key={heading} style={{ padding: "12px 14px", textAlign: "left", fontSize: "11px", color: "#64748b", textTransform: "uppercase", borderBottom: "1px solid #e5e7eb" }}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.messages.map((message) => (
              <tr key={message.id}>
                <td style={{ padding: "14px", borderBottom: "1px solid #f1f5f9" }}>{message.phone_number}</td>
                <td style={{ padding: "14px", borderBottom: "1px solid #f1f5f9" }}>{formatCampaignStatus(message.status as Campaign["status"])}</td>
                <td style={{ padding: "14px", borderBottom: "1px solid #f1f5f9" }}>{message.sent_at ? new Date(message.sent_at).toLocaleString() : "—"}</td>
                <td style={{ padding: "14px", borderBottom: "1px solid #f1f5f9" }}>{message.delivered_at ? new Date(message.delivered_at).toLocaleString() : "—"}</td>
                <td style={{ padding: "14px", borderBottom: "1px solid #f1f5f9" }}>{message.read_at ? new Date(message.read_at).toLocaleString() : "—"}</td>
                <td style={{ padding: "14px", borderBottom: "1px solid #f1f5f9", color: "#b91c1c" }}>{message.error_message || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  );
}

function WizardStepHeader({
  mode,
  step
}: {
  mode: "new" | "retarget";
  step: WizardStep;
}) {
  const labels =
    mode === "retarget"
      ? ["Retarget Audience", "Select Template", "Map Variables & Media", "Schedule"]
      : ["Select Template", "Select Audience", "Map Variables & Media", "Schedule"];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "12px" }}>
      {labels.map((label, index) => {
        const current = (index + 1) as WizardStep;
        const active = current === step;
        const complete = current < step;
        return (
          <div key={label} style={{ ...cardStyle(active), background: complete ? "#f0fdf4" : active ? "#eff6ff" : "#fff", cursor: "default" }}>
            <div style={{ fontSize: "12px", color: "#64748b" }}>Step {current}</div>
            <div style={{ marginTop: "6px", fontWeight: 700 }}>{label}</div>
          </div>
        );
      })}
    </div>
  );
}

function BroadcastWizardPage({
  token,
  mode,
  sourceCampaignId
}: {
  token: string;
  mode: "new" | "retarget";
  sourceCampaignId?: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const templatesQuery = useTemplatesQuery(token);
  const segmentsQuery = useQuery({
    queryKey: dashboardQueryKeys.contactSegments,
    queryFn: () => listContactSegments(token).then((response) => response.segments)
  });
  const fieldsQuery = useQuery({
    queryKey: dashboardQueryKeys.contactFields,
    queryFn: () => listContactFields(token).then((response) => response.fields)
  });

  const [step, setStep] = useState<WizardStep>(1);
  const [name, setName] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedSegmentId, setSelectedSegmentId] = useState("");
  const [bindings, setBindings] = useState<CampaignTemplateVariables>({});
  const [mediaOverrides, setMediaOverrides] = useState<CampaignMediaOverrides>({});
  const [scheduledAt, setScheduledAt] = useState("");
  const [uploadingAudience, setUploadingAudience] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retargetStatus, setRetargetStatus] = useState<RetargetStatus>("sent");

  const approvedTemplates = useMemo(
    () => (templatesQuery.data ?? []).filter((template) => template.status === "APPROVED"),
    [templatesQuery.data]
  );
  const selectedTemplate = approvedTemplates.find((template) => template.id === selectedTemplateId) ?? null;
  const placeholders = useMemo(() => extractTemplatePlaceholders(selectedTemplate), [selectedTemplate]);
  const fields = fieldsQuery.data ?? [];
  const segments = segmentsQuery.data ?? [];

  const selectedSegmentContactsQuery = useQuery({
    queryKey: dashboardQueryKeys.segmentContacts(selectedSegmentId || "none"),
    queryFn: () => fetchSegmentContacts(token, selectedSegmentId).then((response) => response.contacts),
    enabled: mode === "new" && Boolean(selectedSegmentId)
  });
  const retargetPreviewQuery = useQuery({
    queryKey: dashboardQueryKeys.broadcastRetargetPreview(sourceCampaignId ?? "none", retargetStatus),
    queryFn: () => fetchBroadcastRetargetPreview(token, sourceCampaignId ?? "", retargetStatus).then((response) => response.preview),
    enabled: mode === "retarget" && Boolean(sourceCampaignId)
  });

  useEffect(() => {
    setBindings((current) => {
      const next: CampaignTemplateVariables = {};
      for (const placeholder of placeholders) {
        next[placeholder] = current[placeholder] ?? { source: "contact", field: "display_name", fallback: "" };
      }
      return next;
    });
  }, [placeholders]);

  const sampleContact =
    mode === "retarget"
      ? retargetPreviewQuery.data?.recipients?.[0] ?? null
      : selectedSegmentContactsQuery.data?.[0] ?? null;

  const previewComponents = useMemo(
    () => buildPreviewComponents(selectedTemplate, bindings, sampleContact),
    [bindings, sampleContact, selectedTemplate]
  );

  const fieldOptions = useMemo(
    () => [
      ...STANDARD_CONTACT_FIELDS.map((field) => ({ value: field.value, label: field.label })),
      ...fields.map((field) => ({ value: `custom:${field.name}`, label: `${field.label} (custom)` }))
    ],
    [fields]
  );

  const headerMediaType = useMemo(() => {
    const header = selectedTemplate?.components.find((component) => component.type === "HEADER");
    return header?.format === "IMAGE" || header?.format === "VIDEO" || header?.format === "DOCUMENT"
      ? header.format
      : null;
  }, [selectedTemplate]);

  const saveMutation = useMutation({
    mutationFn: async (launchNow: boolean) => {
      const draft = await createCampaignDraft(token, {
        name: name.trim(),
        broadcastType: mode === "retarget" ? "retarget" : "standard",
        templateId: selectedTemplateId || null,
        templateVariables: bindings,
        targetSegmentId: mode === "new" ? selectedSegmentId || null : null,
        sourceCampaignId: mode === "retarget" ? sourceCampaignId ?? null : null,
        retargetStatus: mode === "retarget" ? retargetStatus : null,
        audienceSource:
          mode === "retarget"
            ? { kind: "retarget", sourceCampaignId, status: retargetStatus }
            : { kind: "segment", segmentId: selectedSegmentId },
        mediaOverrides,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null
      });

      if (!launchNow) {
        return draft.campaign;
      }

      const launched = await launchCampaignDraft(token, draft.campaign.id);
      return launched.campaign;
    },
    onSuccess: async (campaign) => {
      setError(null);
      setMessage(campaign.status === "running" ? "Broadcast launched." : "Broadcast saved.");
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.broadcasts });
      navigate(`/dashboard/broadcast/${campaign.id}`);
    },
    onError: (mutationError) => {
      setMessage(null);
      setError((mutationError as Error).message);
    }
  });

  const canContinueStep1 =
    mode === "retarget" ? Boolean(retargetPreviewQuery.data?.count) : Boolean(selectedTemplateId);
  const canContinueStep2 =
    mode === "retarget" ? Boolean(selectedTemplateId) : Boolean(selectedSegmentId);

  async function handleAudienceUpload(file: File) {
    setUploadingAudience(true);
    setError(null);
    try {
      const result = await importBroadcastAudienceWorkbook(token, file, `${name.trim() || "Broadcast"} audience`);
      setSelectedSegmentId(result.segment.id);
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.contactSegments });
      setMessage(`Imported audience and created segment "${result.segment.name}".`);
    } catch (uploadError) {
      setError((uploadError as Error).message);
    } finally {
      setUploadingAudience(false);
    }
  }

  async function handleMediaUpload(file: File) {
    setUploadingMedia(true);
    setError(null);
    try {
      const uploaded = await uploadBroadcastMedia(token, file);
      setMediaOverrides((current) => ({
        ...current,
        headerMediaUrl: `${API_URL}${uploaded.url}`
      }));
      setMessage("Media uploaded for this broadcast.");
    } catch (uploadError) {
      setError((uploadError as Error).message);
    } finally {
      setUploadingMedia(false);
    }
  }

  return (
    <section style={{ display: "grid", gap: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "28px", fontWeight: 700 }}>
            {mode === "retarget" ? "Retarget Broadcast" : "New Broadcast"}
          </h2>
          <p style={{ margin: "6px 0 0", color: "#64748b" }}>
            Select a template, choose an audience, map variables, then schedule or launch.
          </p>
        </div>
        <button type="button" className="ghost-btn" onClick={() => navigate("/dashboard/broadcast")}>Back to Broadcasts</button>
      </div>

      <WizardStepHeader mode={mode} step={step} />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) 340px", gap: "20px" }}>
        <section style={{ display: "grid", gap: "16px" }}>
          {step === 1 && mode === "new" ? (
            <TemplateSelectionStep
              templates={approvedTemplates}
              selectedTemplateId={selectedTemplateId}
              onSelect={setSelectedTemplateId}
              onContinue={() => setStep(2)}
              canContinue={canContinueStep1}
            />
          ) : null}

          {step === 1 && mode === "retarget" ? (
            <RetargetAudienceStep
              retargetStatus={retargetStatus}
              onRetargetStatusChange={setRetargetStatus}
              preview={retargetPreviewQuery.data}
              onContinue={() => setStep(2)}
              canContinue={canContinueStep1}
            />
          ) : null}

          {step === 2 && mode === "new" ? (
            <AudienceSelectionStep
              name={name}
              onNameChange={setName}
              segments={segments}
              selectedSegmentId={selectedSegmentId}
              onSelectSegment={setSelectedSegmentId}
              onUpload={handleAudienceUpload}
              uploadingAudience={uploadingAudience}
              onBack={() => setStep(1)}
              onContinue={() => setStep(3)}
              canContinue={canContinueStep2 && Boolean(name.trim())}
            />
          ) : null}

          {step === 2 && mode === "retarget" ? (
            <TemplateSelectionStep
              name={name}
              onNameChange={setName}
              templates={approvedTemplates}
              selectedTemplateId={selectedTemplateId}
              onSelect={setSelectedTemplateId}
              onBack={() => setStep(1)}
              onContinue={() => setStep(3)}
              canContinue={canContinueStep2 && Boolean(name.trim())}
            />
          ) : null}

          {step === 3 ? (
            <VariableMappingStep
              placeholders={placeholders}
              bindings={bindings}
              setBindings={setBindings}
              fieldOptions={fieldOptions}
              headerMediaType={headerMediaType}
              mediaOverrides={mediaOverrides}
              setMediaOverrides={setMediaOverrides}
              onMediaUpload={handleMediaUpload}
              uploadingMedia={uploadingMedia}
              onBack={() => setStep(2)}
              onContinue={() => setStep(4)}
            />
          ) : null}

          {step === 4 ? (
            <ScheduleStep
              scheduledAt={scheduledAt}
              onScheduledAtChange={setScheduledAt}
              onBack={() => setStep(3)}
              onSave={() => saveMutation.mutate(false)}
              onLaunch={() => saveMutation.mutate(true)}
              saving={saveMutation.isPending}
            />
          ) : null}

          {message ? <div style={{ color: "#166534" }}>{message}</div> : null}
          {error ? <div style={{ color: "#b91c1c" }}>{error}</div> : null}
        </section>

        <aside style={{ border: "1px solid #e5e7eb", borderRadius: "18px", padding: "18px", background: "#fff", display: "grid", gap: "14px", alignSelf: "start" }}>
          <div>
            <div style={{ fontWeight: 700 }}>Live Preview</div>
            <div style={{ marginTop: "4px", color: "#64748b", fontSize: "13px" }}>
              {sampleContact
                ? `Previewing with ${sampleContact.display_name || sampleContact.phone_number}`
                : "Select an audience to preview variable mappings."}
            </div>
          </div>
          {selectedTemplate ? (
            <TemplatePreviewPanel
              components={previewComponents}
              businessName={selectedTemplate.displayPhoneNumber ?? selectedTemplate.name}
            />
          ) : (
            <div style={{ minHeight: "280px", border: "1px dashed #cbd5e1", borderRadius: "14px", display: "grid", placeItems: "center", color: "#64748b", fontSize: "13px" }}>
              Choose a template to preview the broadcast.
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

export function BroadcastModulePage({
  token,
  mode
}: {
  token: string;
  mode: ModuleMode;
}) {
  const params = useParams<{ campaignId?: string }>();
  const campaignId = params.campaignId ?? "";

  if (mode === "detail" && campaignId) {
    return <BroadcastDetailPage token={token} campaignId={campaignId} />;
  }

  return <BroadcastListPage token={token} />;
}

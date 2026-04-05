import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  cancelCampaignRun,
  createCampaignDraft,
  downloadContactsTemplate,
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
  type ContactRecord,
  type MessageTemplate,
  type RetargetStatus
} from "../../../lib/api";
import { uploadBroadcastMedia as uploadBroadcastMediaToSupabase } from "../../../lib/supabase";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { useInboxPublishedFlowsQuery } from "../inbox/queries";
import { TemplatePreviewPanel } from "../templates/TemplatePreviewPanel";
import { useTemplatesQuery } from "../templates/queries";
import "./broadcast.css";

type ModuleMode = "list" | "new" | "detail" | "retarget";
type WizardStep = 1 | 2 | 3 | 4;
type BroadcastReplyMode = "ai" | "flow";

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

function shouldPollCampaign(status: Campaign["status"]): boolean {
  return status === "running" || status === "scheduled";
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function SummaryCards({ report }: { report: BroadcastReport }) {
  const items = [
    { label: "Recipients", value: report.campaign.total_count, tone: "neutral" },
    { label: "Sent", value: report.buckets.sent, tone: "blue" },
    { label: "Delivered", value: report.buckets.delivered, tone: "green" },
    { label: "Read", value: report.buckets.read, tone: "teal" },
    { label: "Failed", value: report.buckets.failed, tone: "rose" },
    { label: "Not delivered", value: report.buckets.skipped, tone: "amber" }
  ];

  return (
    <div className="broadcast-stat-grid">
      {items.map((item) => (
        <div key={item.label} className={`broadcast-stat-card tone-${item.tone}`}>
          <div className="broadcast-stat-label">{item.label}</div>
          <div className="broadcast-stat-value">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function BroadcastListPage({ token }: { token: string }) {
  const navigate = useNavigate();
  const broadcastsQuery = useQuery({
    queryKey: dashboardQueryKeys.broadcasts,
    queryFn: () => fetchBroadcasts(token),
    refetchInterval: (query) =>
      (query.state.data?.broadcasts ?? []).some((broadcast) => shouldPollCampaign(broadcast.status))
        ? 5000
        : false
  });

  const data = broadcastsQuery.data;
  const hasLiveBroadcast = (data?.broadcasts ?? []).some((broadcast) => shouldPollCampaign(broadcast.status));

  return (
    <section className="broadcast-page">
      <div className="broadcast-hero">
        <div className="broadcast-hero-copy">
          <span className="broadcast-eyebrow">Campaign control room</span>
          <h2 className="broadcast-hero-title">Broadcasts</h2>
          <p className="broadcast-hero-text">
            Manage broadcast sends, delivery performance, and retargeting from one workspace.
          </p>
          {hasLiveBroadcast ? <div className="broadcast-live-note">Live status updates are refreshing automatically.</div> : null}
        </div>
        <button
          type="button"
          onClick={() => navigate("/dashboard/broadcast/new")}
          className="broadcast-primary-btn"
        >
          New Broadcast
        </button>
      </div>

      {data?.summary ? (
        <div className="broadcast-stat-grid">
          {[
            ["Recipients", data.summary.recipients, "neutral"],
            ["Sent", data.summary.sent, "blue"],
            ["Delivered", data.summary.delivered, "green"],
            ["Engaged", data.summary.engaged, "teal"],
            ["Failed", data.summary.failed, "rose"],
            ["Suppressed", data.summary.suppressed, "amber"]
          ].map(([label, value, tone]) => (
            <div key={String(label)} className={`broadcast-stat-card tone-${String(tone)}`}>
              <div className="broadcast-stat-label">{label}</div>
              <div className="broadcast-stat-value">{value}</div>
            </div>
          ))}
        </div>
      ) : null}

      <section className="broadcast-table-shell">
        <div className="broadcast-table-header">
          <div>
            <h3 className="broadcast-section-title">All broadcasts</h3>
            <p className="broadcast-section-text">Recent runs, outcomes, and retarget actions in one clean table.</p>
          </div>
          <div className="broadcast-table-header-actions">
            <button
              type="button"
              className="broadcast-secondary-btn broadcast-refresh-btn"
              onClick={() => void broadcastsQuery.refetch()}
              disabled={broadcastsQuery.isFetching}
            >
              {broadcastsQuery.isFetching ? "Refreshing..." : "Refresh status"}
            </button>
          </div>
        </div>
        <table className="broadcast-table">
          <thead>
            <tr>
              {["Broadcast", "Status", "Recipients", "Sent", "Delivered", "Read", "Failed", "Created", "Actions"].map((heading) => (
                <th key={heading}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.broadcasts ?? []).map((broadcast) => (
              <tr key={broadcast.id}>
                <td>
                  <div className="broadcast-row-name">{broadcast.name}</div>
                  <div className="broadcast-row-meta">
                    {broadcast.broadcast_type === "retarget" ? "Retarget broadcast" : "Standard broadcast"}
                  </div>
                </td>
                <td>
                  <span className={`broadcast-status-pill status-${broadcast.status}`}>{formatCampaignStatus(broadcast.status)}</span>
                </td>
                <td>{broadcast.total_count}</td>
                <td>{broadcast.sent_count}</td>
                <td>{broadcast.delivered_count}</td>
                <td>{broadcast.read_count}</td>
                <td>{broadcast.failed_count}</td>
                <td>{formatDateTime(broadcast.created_at)}</td>
                <td>
                  <div className="broadcast-table-actions">
                    <button type="button" className="broadcast-secondary-btn" onClick={() => navigate(`/dashboard/broadcast/${broadcast.id}`)}>View</button>
                    <button type="button" className="broadcast-secondary-btn" onClick={() => navigate(`/dashboard/broadcast/${broadcast.id}/retarget`)}>Retarget</button>
                  </div>
                </td>
              </tr>
            ))}
            {!broadcastsQuery.isLoading && (data?.broadcasts ?? []).length === 0 ? (
              <tr>
                <td colSpan={9} className="broadcast-empty-state">
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
    queryFn: () => fetchBroadcastReport(token, campaignId).then((response) => response.report),
    refetchInterval: (query) =>
      query.state.data && shouldPollCampaign(query.state.data.campaign.status) ? 4000 : false
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
    return <div className="broadcast-loading">Loading broadcast report…</div>;
  }
  const isLiveUpdating = shouldPollCampaign(report.campaign.status);

  return (
    <section className="broadcast-page">
      <div className="broadcast-hero">
        <div className="broadcast-hero-copy">
          <span className="broadcast-eyebrow">Broadcast report</span>
          <h2 className="broadcast-hero-title">{report.campaign.name}</h2>
          <p className="broadcast-hero-text">
            {formatCampaignStatus(report.campaign.status)} • Created {formatDateTime(report.campaign.created_at)}
          </p>
          {isLiveUpdating ? <div className="broadcast-live-note">Status is updating in real time while this broadcast is running.</div> : null}
        </div>
        <div className="broadcast-table-actions">
          <button type="button" className="broadcast-secondary-btn" onClick={() => navigate(`/dashboard/broadcast/${campaignId}/retarget`)}>Retarget</button>
          {(report.campaign.status === "running" || report.campaign.status === "scheduled" || report.campaign.status === "draft") ? (
            <button type="button" className="broadcast-secondary-btn" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
              {cancelMutation.isPending ? "Cancelling..." : "Cancel"}
            </button>
          ) : null}
        </div>
      </div>

      <SummaryCards report={report} />

      <section className="broadcast-table-shell">
        <div className="broadcast-table-header">
          <div>
            <h3 className="broadcast-section-title">Recipient delivery log</h3>
            <p className="broadcast-section-text">Every recipient status and message failure, in a clearer audit trail.</p>
          </div>
          <div className="broadcast-table-header-actions">
            <button
              type="button"
              className="broadcast-secondary-btn broadcast-refresh-btn"
              onClick={() => void reportQuery.refetch()}
              disabled={reportQuery.isFetching}
            >
              {reportQuery.isFetching ? "Refreshing..." : "Refresh status"}
            </button>
          </div>
        </div>
        <table className="broadcast-table">
          <thead>
            <tr>
              {["Phone", "Status", "Sent", "Delivered", "Read", "Error"].map((heading) => (
                <th key={heading}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.messages.map((message) => (
              <tr key={message.id}>
                <td>{message.phone_number}</td>
                <td>
                  <span className={`broadcast-status-pill status-${String(message.status)}`}>
                    {formatCampaignStatus(message.status as Campaign["status"])}
                  </span>
                </td>
                <td>{message.sent_at ? formatDateTime(message.sent_at) : "—"}</td>
                <td>{message.delivered_at ? formatDateTime(message.delivered_at) : "—"}</td>
                <td>{message.read_at ? formatDateTime(message.read_at) : "—"}</td>
                <td className="broadcast-error-cell">{message.error_message || "—"}</td>
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
    <div className="broadcast-stepper">
      {labels.map((label, index) => {
        const current = (index + 1) as WizardStep;
        const active = current === step;
        const complete = current < step;
        return (
          <div key={label} className={`broadcast-step ${active ? "is-active" : ""} ${complete ? "is-complete" : ""}`}>
            <div className="broadcast-step-rail" />
            <div className="broadcast-step-badge">{complete ? "✓" : current}</div>
            <div className="broadcast-step-label">{label}</div>
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
  const publishedFlowsQuery = useInboxPublishedFlowsQuery(token);

  const [step, setStep] = useState<WizardStep>(1);
  const [name, setName] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedSegmentId, setSelectedSegmentId] = useState("");
  const [bindings, setBindings] = useState<CampaignTemplateVariables>({});
  const [mediaOverrides, setMediaOverrides] = useState<CampaignMediaOverrides>({});
  const [scheduledAt, setScheduledAt] = useState("");
  const [uploadingAudience, setUploadingAudience] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retargetStatus, setRetargetStatus] = useState<RetargetStatus>("sent");
  const [sendMode, setSendMode] = useState<"now" | "schedule">("now");
  const [retryEnabled, setRetryEnabled] = useState(false);
  const [retryType, setRetryType] = useState<"smart" | "manual">("smart");
  const [retryUntil, setRetryUntil] = useState("");
  const [policyEnabled, setPolicyEnabled] = useState(true);
  const [replyMode, setReplyMode] = useState<BroadcastReplyMode>("ai");
  const [replyFlowId, setReplyFlowId] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const [phoneNumberFormat, setPhoneNumberFormat] = useState<"with_country_code" | "without_country_code">("with_country_code");
  const [defaultCountryCode, setDefaultCountryCode] = useState("91");
  const [uploadStep, setUploadStep] = useState<"download" | "upload" | "preview">("download");

  const approvedTemplates = useMemo(
    () => (templatesQuery.data ?? []).filter((template) => template.status === "APPROVED"),
    [templatesQuery.data]
  );
  const selectedTemplate = approvedTemplates.find((template) => template.id === selectedTemplateId) ?? null;
  const placeholders = useMemo(() => extractTemplatePlaceholders(selectedTemplate), [selectedTemplate]);
  const fields = fieldsQuery.data ?? [];
  const segments = segmentsQuery.data ?? [];
  const publishedFlows = publishedFlowsQuery.data ?? [];

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
  const targetAudienceCount =
    mode === "retarget"
      ? retargetPreviewQuery.data?.count ?? 0
      : selectedSegmentContactsQuery.data?.length ?? 0;
  const selectedSegmentName =
    mode === "new"
      ? segments.find((segment) => segment.id === selectedSegmentId)?.name ?? "No segment selected"
      : `Retarget: ${RETARGET_OPTIONS.find((option) => option.value === retargetStatus)?.label ?? "Audience"}`;

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

  useEffect(() => {
    if (sendMode === "now") {
      setScheduledAt("");
    }
  }, [sendMode]);

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
            ? {
                kind: "retarget",
                sourceCampaignId,
                status: retargetStatus,
                replyRouting: {
                  mode: replyMode,
                  flowId: replyMode === "flow" ? replyFlowId || null : null
                }
              }
            : {
                kind: "segment",
                segmentId: selectedSegmentId,
                replyRouting: {
                  mode: replyMode,
                  flowId: replyMode === "flow" ? replyFlowId || null : null
                }
              },
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
      const result = await importBroadcastAudienceWorkbook(token, file, {
        segmentName: `${name.trim() || "Broadcast"} audience`,
        marketingOptIn,
        phoneNumberFormat,
        defaultCountryCode
      });
      setSelectedSegmentId(result.segment.id);
      setUploadedFileName(file.name);
      setUploadStep("preview");
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.contactSegments });
      setMessage(`Imported audience and created segment "${result.segment.name}".`);
    } catch (uploadError) {
      setError((uploadError as Error).message);
    } finally {
      setUploadingAudience(false);
    }
  }

  async function handleDownloadAudienceTemplate() {
    setDownloadingTemplate(true);
    setError(null);
    try {
      const result = await downloadContactsTemplate(token);
      downloadBlob(result.blob, result.filename);
    } catch (downloadError) {
      setError((downloadError as Error).message);
    } finally {
      setDownloadingTemplate(false);
    }
  }

  async function handleMediaUpload(file: File) {
    setUploadingMedia(true);
    setError(null);
    try {
      const uploaded = await uploadBroadcastMediaToSupabase(file);
      setMediaOverrides((current) => ({
        ...current,
        headerMediaUrl: uploaded.url
      }));
      setMessage("Media uploaded to Supabase for this broadcast.");
    } catch (uploadError) {
      setError((uploadError as Error).message);
    } finally {
      setUploadingMedia(false);
    }
  }

  return (
    <section className="broadcast-page">
      <div className="broadcast-hero">
        <div className="broadcast-hero-copy">
          <span className="broadcast-eyebrow">
            {mode === "retarget" ? "Bring back missed recipients" : "Design and launch"}
          </span>
          <h2 className="broadcast-hero-title">
            {mode === "retarget" ? "Retarget Broadcast" : "New Broadcast"}
          </h2>
          <p className="broadcast-hero-text">
            Select a template, choose an audience, map variables, then schedule or launch.
          </p>
        </div>
        <button type="button" className="broadcast-secondary-btn" onClick={() => navigate("/dashboard/broadcast")}>Back to Broadcasts</button>
      </div>

      <WizardStepHeader mode={mode} step={step} />

      <div className="broadcast-wizard-layout">
        <section className="broadcast-wizard-main">
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
              uploadedFileName={uploadedFileName}
              marketingOptIn={marketingOptIn}
              onMarketingOptInChange={setMarketingOptIn}
              phoneNumberFormat={phoneNumberFormat}
              onPhoneNumberFormatChange={setPhoneNumberFormat}
              defaultCountryCode={defaultCountryCode}
              onDefaultCountryCodeChange={setDefaultCountryCode}
              uploadStep={uploadStep}
              onUploadStepChange={setUploadStep}
              onDownloadTemplate={handleDownloadAudienceTemplate}
              downloadingTemplate={downloadingTemplate}
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
              name={name}
              sendMode={sendMode}
              onSendModeChange={setSendMode}
              scheduledAt={scheduledAt}
              onScheduledAtChange={setScheduledAt}
              retryEnabled={retryEnabled}
              onRetryEnabledChange={setRetryEnabled}
              retryType={retryType}
              onRetryTypeChange={setRetryType}
              retryUntil={retryUntil}
              onRetryUntilChange={setRetryUntil}
              policyEnabled={policyEnabled}
              onPolicyEnabledChange={setPolicyEnabled}
              audienceCount={targetAudienceCount}
              selectedAudienceLabel={selectedSegmentName}
              replyMode={replyMode}
              onReplyModeChange={setReplyMode}
              replyFlowId={replyFlowId}
              onReplyFlowIdChange={setReplyFlowId}
              availableFlows={publishedFlows}
              onBack={() => setStep(3)}
              onSave={() => saveMutation.mutate(false)}
              onLaunch={() => saveMutation.mutate(true)}
              saving={saveMutation.isPending}
            />
          ) : null}

          {message ? <div className="broadcast-feedback success">{message}</div> : null}
          {error ? <div className="broadcast-feedback error">{error}</div> : null}
        </section>

        <aside className="broadcast-preview-shell">
          <div>
            <div className="broadcast-preview-title">Live Preview</div>
            <div className="broadcast-preview-copy">
              {sampleContact
                ? `Previewing with ${sampleContact.display_name || sampleContact.phone_number}`
                : "Select an audience to preview variable mappings."}
            </div>
          </div>
          {selectedTemplate ? (
            <div className="broadcast-preview-panel">
              <TemplatePreviewPanel
                components={previewComponents}
                businessName={selectedTemplate.displayPhoneNumber ?? selectedTemplate.name}
              />
            </div>
          ) : (
            <div className="broadcast-preview-empty">
              Choose a template to preview the broadcast.
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function TemplateSelectionStep({
  name,
  onNameChange,
  templates,
  selectedTemplateId,
  onSelect,
  onBack,
  onContinue,
  canContinue
}: {
  name?: string;
  onNameChange?: (value: string) => void;
  templates: MessageTemplate[];
  selectedTemplateId: string;
  onSelect: (templateId: string) => void;
  onBack?: () => void;
  onContinue: () => void;
  canContinue: boolean;
}) {
  return (
    <section className="broadcast-step-section">
      <div className="broadcast-section-heading">
        <h3 className="broadcast-section-title">Select Template</h3>
        <p className="broadcast-section-text">Choose the approved WhatsApp template you want to send.</p>
      </div>
      {onNameChange ? (
        <label className="broadcast-field">
          <span className="broadcast-label">Broadcast name</span>
          <input className="broadcast-input" value={name ?? ""} onChange={(event) => onNameChange(event.target.value)} placeholder="Broadcast name" />
        </label>
      ) : null}
      <div className="broadcast-template-grid">
        {templates.map((template) => (
          <button key={template.id} type="button" onClick={() => onSelect(template.id)} className={`broadcast-template-card ${selectedTemplateId === template.id ? "is-selected" : ""}`}>
            <div className="broadcast-template-card-inner">
              <div>
                <div className="broadcast-template-name">{template.name}</div>
                <div className="broadcast-template-meta">{template.category} • {template.language}</div>
              </div>
              <TemplatePreviewPanel components={template.components} businessName={template.displayPhoneNumber ?? template.name} />
            </div>
          </button>
        ))}
      </div>
      <div className="broadcast-actions">
        {onBack ? <button type="button" className="broadcast-secondary-btn" onClick={onBack}>Back</button> : null}
        <button type="button" onClick={onContinue} disabled={!canContinue} className="broadcast-primary-btn">
          Continue
        </button>
      </div>
    </section>
  );
}

function RetargetAudienceStep({
  retargetStatus,
  onRetargetStatusChange,
  preview,
  onContinue,
  canContinue
}: {
  retargetStatus: RetargetStatus;
  onRetargetStatusChange: (status: RetargetStatus) => void;
  preview: { recipients: ContactRecord[]; count: number; status: RetargetStatus } | undefined;
  onContinue: () => void;
  canContinue: boolean;
}) {
  return (
    <section className="broadcast-step-section">
      <div className="broadcast-section-heading">
        <h3 className="broadcast-section-title">Select Retarget Audience</h3>
        <p className="broadcast-section-text">Choose one outcome bucket from the previous run and preview the matched recipients.</p>
      </div>
      <div className="broadcast-retarget-grid">
        {RETARGET_OPTIONS.map((option) => (
          <button key={option.value} type="button" onClick={() => onRetargetStatusChange(option.value)} className={`broadcast-retarget-card ${retargetStatus === option.value ? "is-selected" : ""}`}>
            <div className="broadcast-retarget-label">{option.label}</div>
            <div className="broadcast-retarget-value">
              {preview?.status === option.value ? preview.count : "—"}
            </div>
          </button>
        ))}
      </div>
      <section className="broadcast-table-shell compact">
        <table className="broadcast-table">
          <thead>
            <tr>
              {["Recipient", "Phone"].map((heading) => (
                <th key={heading}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(preview?.recipients ?? []).slice(0, 50).map((contact) => (
              <tr key={contact.id}>
                <td>{contact.display_name || "Unknown"}</td>
                <td>{contact.phone_number}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="broadcast-actions">
        <button type="button" onClick={onContinue} disabled={!canContinue} className="broadcast-primary-btn">
          Continue
        </button>
      </div>
    </section>
  );
}

function AudienceSelectionStep({
  name,
  onNameChange,
  segments,
  selectedSegmentId,
  onSelectSegment,
  onUpload,
  uploadingAudience,
  uploadedFileName,
  marketingOptIn,
  onMarketingOptInChange,
  phoneNumberFormat,
  onPhoneNumberFormatChange,
  defaultCountryCode,
  onDefaultCountryCodeChange,
  uploadStep,
  onUploadStepChange,
  onDownloadTemplate,
  downloadingTemplate,
  onBack,
  onContinue,
  canContinue
}: {
  name: string;
  onNameChange: (value: string) => void;
  segments: Array<{ id: string; name: string; created_at: string }>;
  selectedSegmentId: string;
  onSelectSegment: (segmentId: string) => void;
  onUpload: (file: File) => Promise<void>;
  uploadingAudience: boolean;
  uploadedFileName: string;
  marketingOptIn: boolean;
  onMarketingOptInChange: (value: boolean) => void;
  phoneNumberFormat: "with_country_code" | "without_country_code";
  onPhoneNumberFormatChange: (value: "with_country_code" | "without_country_code") => void;
  defaultCountryCode: string;
  onDefaultCountryCodeChange: (value: string) => void;
  uploadStep: "download" | "upload" | "preview";
  onUploadStepChange: (value: "download" | "upload" | "preview") => void;
  onDownloadTemplate: () => Promise<void>;
  downloadingTemplate: boolean;
  onBack: () => void;
  onContinue: () => void;
  canContinue: boolean;
}) {
  return (
    <section className="broadcast-step-section">
      <div className="broadcast-section-heading">
        <h3 className="broadcast-section-title">Select Audience</h3>
        <p className="broadcast-section-text">Import a fresh audience from Excel or pick a reusable segment.</p>
      </div>
      <label className="broadcast-field">
        <span className="broadcast-label">Broadcast name</span>
        <input className="broadcast-input" value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="April promotion" />
      </label>
      <section className="broadcast-surface-card">
        <div className="broadcast-card-title">Upload contacts from Excel</div>
        <div className="broadcast-muted-copy">
          Download the sample first, then upload a prepared workbook so we can read the required fields, create a segment, and use it for this campaign.
        </div>
        <div className={`broadcast-upload-stage ${uploadStep !== "download" ? "is-open" : ""}`}>
          <button type="button" className="broadcast-upload-stage-head" onClick={() => onUploadStepChange("download")}>
            <span className="broadcast-upload-stage-marker is-complete">✓</span>
            <span>Download sample file</span>
            <small>Optional</small>
          </button>
          <div className="broadcast-upload-stage-body">
            <p className="broadcast-muted-copy">
              Use the sample workbook to prepare columns before uploading. Required columns are read exactly from the file.
            </p>
            <div className="broadcast-upload-actions">
              <button type="button" className="broadcast-secondary-btn" onClick={() => void onDownloadTemplate()} disabled={downloadingTemplate}>
                {downloadingTemplate ? "Downloading..." : "Download sample file"}
              </button>
              <button type="button" className="broadcast-primary-btn" onClick={() => onUploadStepChange("upload")}>
                I've downloaded
              </button>
            </div>
          </div>
        </div>

        <div className={`broadcast-upload-stage ${uploadStep === "upload" || uploadStep === "preview" ? "is-open" : ""}`}>
          <button type="button" className="broadcast-upload-stage-head" onClick={() => onUploadStepChange("upload")}>
            <span className={`broadcast-upload-stage-marker ${uploadedFileName ? "is-complete" : ""}`}>{uploadedFileName ? "✓" : "2"}</span>
            <span>Upload data file</span>
          </button>
          <div className="broadcast-upload-stage-body">
            <p className="broadcast-muted-copy">
              Please ensure you have updated the workbook with the necessary information before uploading.
            </p>
            <label className="broadcast-dropzone">
              <span className="broadcast-dropzone-title">Drag & drop your file here</span>
              <span className="broadcast-dropzone-field">{uploadedFileName || "Please upload a file"}</span>
              <span className="broadcast-dropzone-hint">Accepted file type: XLSX</span>
              <input
                type="file"
                accept=".xlsx"
                disabled={uploadingAudience}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void onUpload(file);
                  }
                }}
              />
            </label>
            <div className="broadcast-form-grid two-up">
              <label className="broadcast-field">
                <span className="broadcast-label">Marketing opt-in</span>
                <select className="broadcast-input" value={marketingOptIn ? "yes" : "no"} onChange={(event) => onMarketingOptInChange(event.target.value === "yes")}>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label className="broadcast-field">
                <span className="broadcast-label">Phone number format</span>
                <select className="broadcast-input" value={phoneNumberFormat} onChange={(event) => onPhoneNumberFormatChange(event.target.value as "with_country_code" | "without_country_code")}>
                  <option value="with_country_code">With country code</option>
                  <option value="without_country_code">Without country code</option>
                </select>
              </label>
              {phoneNumberFormat === "without_country_code" ? (
                <label className="broadcast-field">
                  <span className="broadcast-label">Default country code</span>
                  <input className="broadcast-input" value={defaultCountryCode} onChange={(event) => onDefaultCountryCodeChange(event.target.value.replace(/\D/g, ""))} placeholder="91" />
                </label>
              ) : null}
            </div>
          </div>
        </div>

        <div className={`broadcast-upload-stage ${uploadStep === "preview" ? "is-open" : ""}`}>
          <button type="button" className="broadcast-upload-stage-head" onClick={() => onUploadStepChange("preview")}>
            <span className={`broadcast-upload-stage-marker ${selectedSegmentId ? "is-complete" : ""}`}>{selectedSegmentId ? "✓" : "3"}</span>
            <span>Preview your target audience</span>
          </button>
          <div className="broadcast-upload-stage-body">
            <p className="broadcast-muted-copy">
              {selectedSegmentId
                ? "Your uploaded contacts have been converted into a reusable segment and are ready for this broadcast."
                : "Upload a workbook to create a segment and preview the audience state here."}
            </p>
          </div>
        </div>
      </section>
      <section className="broadcast-surface-card">
        <div className="broadcast-card-title">Pick existing segment</div>
        {segments.map((segment) => (
          <button key={segment.id} type="button" onClick={() => onSelectSegment(segment.id)} className={`broadcast-segment-card ${selectedSegmentId === segment.id ? "is-selected" : ""}`}>
            <div className="broadcast-segment-name">{segment.name}</div>
            <div className="broadcast-row-meta">Created {new Date(segment.created_at).toLocaleDateString()}</div>
            <span className="broadcast-segment-check">{selectedSegmentId === segment.id ? "Selected" : "Select"}</span>
          </button>
        ))}
      </section>
      <div className="broadcast-actions">
        <button type="button" className="broadcast-secondary-btn" onClick={onBack}>Back</button>
        <button type="button" onClick={onContinue} disabled={!canContinue} className="broadcast-primary-btn">
          Continue
        </button>
      </div>
    </section>
  );
}

function VariableMappingStep({
  placeholders,
  bindings,
  setBindings,
  fieldOptions,
  headerMediaType,
  mediaOverrides,
  setMediaOverrides,
  onMediaUpload,
  uploadingMedia,
  onBack,
  onContinue
}: {
  placeholders: string[];
  bindings: CampaignTemplateVariables;
  setBindings: Dispatch<SetStateAction<CampaignTemplateVariables>>;
  fieldOptions: Array<{ value: string; label: string }>;
  headerMediaType: "IMAGE" | "VIDEO" | "DOCUMENT" | null;
  mediaOverrides: CampaignMediaOverrides;
  setMediaOverrides: Dispatch<SetStateAction<CampaignMediaOverrides>>;
  onMediaUpload: (file: File) => Promise<void>;
  uploadingMedia: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <section className="broadcast-step-section">
      <div className="broadcast-section-heading">
        <h3 className="broadcast-section-title">Map Variables & Media</h3>
        <p className="broadcast-section-text">Connect template placeholders to contact fields or static values, then attach media if needed.</p>
      </div>
      {placeholders.length === 0 ? (
        <div className="broadcast-note-card">
          This template does not have dynamic variables.
        </div>
      ) : (
        placeholders.map((placeholder) => {
          const binding = bindings[placeholder] ?? { source: "contact" as const, field: "display_name", fallback: "" };
          return (
            <div key={placeholder} className="broadcast-binding-card">
              <strong className="broadcast-binding-token">{placeholder}</strong>
              <select className="broadcast-input" value={binding.source} onChange={(event) => setBindings((current) => ({ ...current, [placeholder]: { ...binding, source: event.target.value as "contact" | "static" } }))}>
                <option value="contact">Contact field</option>
                <option value="static">Static value</option>
              </select>
              {binding.source === "contact" ? (
                <select className="broadcast-input" value={binding.field ?? "display_name"} onChange={(event) => setBindings((current) => ({ ...current, [placeholder]: { ...binding, field: event.target.value } }))}>
                  {fieldOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : (
                <input className="broadcast-input" value={binding.value ?? ""} onChange={(event) => setBindings((current) => ({ ...current, [placeholder]: { ...binding, value: event.target.value } }))} placeholder="Static replacement" />
              )}
              <input className="broadcast-input" value={binding.fallback ?? ""} onChange={(event) => setBindings((current) => ({ ...current, [placeholder]: { ...binding, fallback: event.target.value } }))} placeholder="Fallback if empty" />
            </div>
          );
        })
      )}
      {headerMediaType ? (
        <section className="broadcast-surface-card">
          <div className="broadcast-card-title">Media</div>
          <div className="broadcast-muted-copy">
            This template uses a {headerMediaType.toLowerCase()} header. Upload a file or provide a public media URL for this broadcast.
          </div>
          <label className="broadcast-upload-btn slim">
            {uploadingMedia ? "Uploading..." : `Upload ${headerMediaType.toLowerCase()}`}
            <input type="file" disabled={uploadingMedia} onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void onMediaUpload(file);
              }
            }} />
          </label>
          <input className="broadcast-input" value={mediaOverrides.headerMediaUrl ?? ""} onChange={(event) => setMediaOverrides((current) => ({ ...current, headerMediaUrl: event.target.value }))} placeholder="https://example.com/media.jpg" />
        </section>
      ) : null}
      <div className="broadcast-actions">
        <button type="button" className="broadcast-secondary-btn" onClick={onBack}>Back</button>
        <button type="button" onClick={onContinue} className="broadcast-primary-btn">
          Continue
        </button>
      </div>
    </section>
  );
}

function ScheduleStep({
  name,
  sendMode,
  onSendModeChange,
  scheduledAt,
  onScheduledAtChange,
  retryEnabled,
  onRetryEnabledChange,
  retryType,
  onRetryTypeChange,
  retryUntil,
  onRetryUntilChange,
  policyEnabled,
  onPolicyEnabledChange,
  audienceCount,
  selectedAudienceLabel,
  replyMode,
  onReplyModeChange,
  replyFlowId,
  onReplyFlowIdChange,
  availableFlows,
  onBack,
  onSave,
  onLaunch,
  saving
}: {
  name: string;
  sendMode: "now" | "schedule";
  onSendModeChange: (value: "now" | "schedule") => void;
  scheduledAt: string;
  onScheduledAtChange: (value: string) => void;
  retryEnabled: boolean;
  onRetryEnabledChange: (value: boolean) => void;
  retryType: "smart" | "manual";
  onRetryTypeChange: (value: "smart" | "manual") => void;
  retryUntil: string;
  onRetryUntilChange: (value: string) => void;
  policyEnabled: boolean;
  onPolicyEnabledChange: (value: boolean) => void;
  audienceCount: number;
  selectedAudienceLabel: string;
  replyMode: BroadcastReplyMode;
  onReplyModeChange: (value: BroadcastReplyMode) => void;
  replyFlowId: string;
  onReplyFlowIdChange: (value: string) => void;
  availableFlows: Array<{ id: string; name: string }>;
  onBack: () => void;
  onSave: () => void;
  onLaunch: () => void;
  saving: boolean;
}) {
  const replyConfigValid = replyMode !== "flow" || Boolean(replyFlowId);

  return (
    <section className="broadcast-step-section">
      <div className="broadcast-section-heading">
        <h3 className="broadcast-section-title">Schedule Broadcast</h3>
        <p className="broadcast-section-text">Review the final send settings, timing, retry behavior, and audience rules before launch.</p>
      </div>

      <section className="broadcast-surface-card">
        <div className="broadcast-card-title">Broadcast details</div>
        <div className="broadcast-form-grid">
          <label className="broadcast-field">
            <span className="broadcast-label">Broadcast name</span>
            <input className="broadcast-input" value={name} readOnly />
          </label>
          <label className="broadcast-field">
            <span className="broadcast-label">Send broadcast</span>
            <select className="broadcast-input" value={sendMode} onChange={(event) => onSendModeChange(event.target.value as "now" | "schedule")}>
              <option value="now">Send immediately</option>
              <option value="schedule">Schedule for later</option>
            </select>
          </label>
          {sendMode === "schedule" ? (
            <label className="broadcast-field broadcast-form-span">
              <span className="broadcast-label">Schedule date and time</span>
              <input className="broadcast-input" type="datetime-local" value={scheduledAt} onChange={(event) => onScheduledAtChange(event.target.value)} />
            </label>
          ) : null}
        </div>
      </section>

      <section className="broadcast-surface-card">
        <div className="broadcast-card-row">
          <div className="broadcast-card-title">Retry Mode</div>
          <label className="broadcast-switch">
            <input type="checkbox" checked={retryEnabled} onChange={(event) => onRetryEnabledChange(event.target.checked)} />
            <span />
          </label>
        </div>
        <div className={`broadcast-retry-grid ${retryEnabled ? "" : "is-disabled"}`}>
          <div className="broadcast-radio-row">
            <label className="broadcast-radio-card">
              <input type="radio" checked={retryType === "smart"} onChange={() => onRetryTypeChange("smart")} />
              <span>Smart retry</span>
              <em>Recommended</em>
            </label>
            <label className="broadcast-radio-card">
              <input type="radio" checked={retryType === "manual"} onChange={() => onRetryTypeChange("manual")} />
              <span>Manual retry</span>
            </label>
          </div>
          <label className="broadcast-field">
            <span className="broadcast-label">Retry until</span>
            <input className="broadcast-input" type="datetime-local" value={retryUntil} onChange={(event) => onRetryUntilChange(event.target.value)} disabled={!retryEnabled} />
          </label>
        </div>
      </section>

      <section className="broadcast-surface-card">
        <div className="broadcast-card-title">Target audience</div>
        <div className="broadcast-audience-summary">
          <div className="broadcast-audience-row">
            <span>Total contacts</span>
            <strong>{audienceCount}</strong>
          </div>
          <div className="broadcast-audience-row">
            <span>Selected audience</span>
            <strong>{selectedAudienceLabel}</strong>
          </div>
        </div>
        <div className="broadcast-policy-row">
          <div>
            <div className="broadcast-policy-title">Follow WhatsApp Business Policy</div>
            <div className="broadcast-muted-copy">
              We'll only message contacts who have opted in for marketing messages.
            </div>
          </div>
          <label className="broadcast-switch">
            <input type="checkbox" checked={policyEnabled} onChange={(event) => onPolicyEnabledChange(event.target.checked)} />
            <span />
          </label>
        </div>
      </section>

      <section className="broadcast-surface-card">
        <div className="broadcast-card-row">
          <div className="broadcast-card-title">Broadcast reply settings</div>
          <span className="broadcast-optional-badge">Optional</span>
        </div>
        <div className="broadcast-muted-copy">
          Set how replies to your broadcast messages are managed when contacts interact with them.
        </div>
        <div className="broadcast-form-grid two-up">
          <label className="broadcast-field">
            <span className="broadcast-label">Assign conversations to</span>
            <select className="broadcast-input" value={replyMode} onChange={(event) => onReplyModeChange(event.target.value as BroadcastReplyMode)}>
              <option value="ai">AI</option>
              <option value="flow">Flow</option>
            </select>
          </label>
          <label className="broadcast-field">
            <span className="broadcast-label">Target</span>
            <select
              className="broadcast-input"
              value={replyFlowId}
              onChange={(event) => onReplyFlowIdChange(event.target.value)}
              disabled={replyMode !== "flow"}
            >
              <option value="">
                {replyMode === "flow" ? "--Select flow--" : "AI handles replies automatically"}
              </option>
              {availableFlows.map((flow) => (
                <option key={flow.id} value={flow.id}>
                  {flow.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {replyMode === "flow" && availableFlows.length === 0 ? (
          <div className="broadcast-muted-copy">
            No published flows are available yet. Publish a flow first to route broadcast replies into it.
          </div>
        ) : null}
      </section>

      <div className="broadcast-actions">
        <button type="button" className="broadcast-secondary-btn" onClick={onBack}>Back</button>
        <button type="button" className="broadcast-secondary-btn" onClick={onSave} disabled={saving || !replyConfigValid}>
          {saving ? "Saving..." : sendMode === "schedule" ? "Save Scheduled Broadcast" : "Save Broadcast"}
        </button>
        <button type="button" onClick={onLaunch} disabled={saving || !replyConfigValid} className="broadcast-primary-btn">
          {saving ? "Launching..." : sendMode === "schedule" ? "Save & Launch" : "Launch Now"}
        </button>
      </div>
    </section>
  );
}

export function BroadcastModulePage({ token, mode }: { token: string; mode: ModuleMode }) {
  const { campaignId } = useParams<{ campaignId: string }>();

  if (mode === "list") {
    return <BroadcastListPage token={token} />;
  }
  if (mode === "detail" && campaignId) {
    return <BroadcastDetailPage token={token} campaignId={campaignId} />;
  }
  if (mode === "retarget" && campaignId) {
    return <BroadcastWizardPage token={token} mode="retarget" sourceCampaignId={campaignId} />;
  }
  return <BroadcastWizardPage token={token} mode="new" />;
}

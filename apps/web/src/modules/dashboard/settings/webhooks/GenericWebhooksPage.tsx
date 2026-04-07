import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  createGenericWebhookIntegration,
  createGenericWebhookWorkflow,
  deleteGenericWebhookIntegration,
  deleteGenericWebhookWorkflow,
  fetchGenericWebhookIntegrations,
  fetchGenericWebhookLogs,
  fetchGenericWebhookWorkflows,
  fetchPublishedFlows,
  fetchTemplates,
  fetchWhatsAppStatus,
  listContactFields,
  rotateGenericWebhookSecret,
  updateGenericWebhookIntegration,
  updateGenericWebhookWorkflow,
  type GenericWebhookChannelMode,
  type GenericWebhookCondition,
  type GenericWebhookContactAction,
  type GenericWebhookContactPaths,
  type GenericWebhookDelayUnit,
  type GenericWebhookQrFlowAction,
  type GenericWebhookTemplateAction,
  type MessageTemplate,
  type PublishedFlowSummary
} from "../../../../lib/api";
import { dashboardQueryKeys } from "../../../../shared/dashboard/query-keys";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";

type ActiveTab = "overview" | "configuration" | "workflows" | "logs";

function extractPlaceholders(template: MessageTemplate | null): string[] {
  if (!template) return [];
  return Array.from(new Set([...JSON.stringify(template.components).matchAll(/\{\{[^}]+\}\}/g)].map((match) => match[0])));
}

function emptyCondition(): GenericWebhookCondition {
  return { comparator: "", operator: "is_not_empty", value: "" };
}

function toTagArray(value: string): string[] {
  return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)));
}

function tagsToString(tags?: string[]): string {
  return (tags ?? []).join(", ");
}


export function GenericWebhooksPage() {
  const { token } = useDashboardShell();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [selectedIntegrationId, setSelectedIntegrationId] = useState("");
  const [newIntegrationName, setNewIntegrationName] = useState("");
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [channelMode, setChannelMode] = useState<GenericWebhookChannelMode>("api");
  const [matchMode, setMatchMode] = useState<"all" | "any">("all");
  const [defaultCountryCode, setDefaultCountryCode] = useState("");
  const [delayValue, setDelayValue] = useState("");
  const [delayUnit, setDelayUnit] = useState<GenericWebhookDelayUnit>("minutes");
  const [conditions, setConditions] = useState<GenericWebhookCondition[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [recipientNamePath, setRecipientNamePath] = useState("");
  const [recipientPhonePath, setRecipientPhonePath] = useState("");
  const [qrFlowId, setQrFlowId] = useState("");
  const [qrRecipientNamePath, setQrRecipientNamePath] = useState("");
  const [qrRecipientPhonePath, setQrRecipientPhonePath] = useState("");
  const [contactDisplayNamePath, setContactDisplayNamePath] = useState("");
  const [contactPhonePath, setContactPhonePath] = useState("");
  const [contactEmailPath, setContactEmailPath] = useState("");
  const [tagOperation, setTagOperation] = useState<"append" | "replace" | "add_if_empty">("append");
  const [tagsText, setTagsText] = useState("");
  const [fieldMappings, setFieldMappings] = useState<Array<{ contactFieldName: string; payloadPath: string }>>([]);
  const [variableMappings, setVariableMappings] = useState<Record<string, string>>({});
  const [fallbackValues, setFallbackValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const integrationsQuery = useQuery({
    queryKey: dashboardQueryKeys.webhookIntegrations,
    queryFn: () => fetchGenericWebhookIntegrations(token).then((response) => response.integrations),
    enabled: Boolean(token)
  });

  const integration = useMemo(
    () => (integrationsQuery.data ?? []).find((item) => item.id === selectedIntegrationId) ?? null,
    [integrationsQuery.data, selectedIntegrationId]
  );

  useEffect(() => {
    if (!selectedIntegrationId && (integrationsQuery.data?.length ?? 0) > 0) {
      setSelectedIntegrationId(integrationsQuery.data![0].id);
      return;
    }
    if (selectedIntegrationId && integrationsQuery.data && !integrationsQuery.data.some((item) => item.id === selectedIntegrationId)) {
      setSelectedIntegrationId(integrationsQuery.data[0]?.id ?? "");
    }
  }, [integrationsQuery.data, selectedIntegrationId]);

  const workflowsQuery = useQuery({
    queryKey: dashboardQueryKeys.webhookWorkflows(selectedIntegrationId || "none"),
    queryFn: () => fetchGenericWebhookWorkflows(token, selectedIntegrationId).then((response) => response.workflows),
    enabled: Boolean(token && selectedIntegrationId)
  });
  const logsQuery = useQuery({
    queryKey: dashboardQueryKeys.webhookLogs(selectedIntegrationId || "none"),
    queryFn: () => fetchGenericWebhookLogs(token, selectedIntegrationId).then((response) => response.logs),
    enabled: Boolean(token && selectedIntegrationId)
  });
  const templatesQuery = useQuery({
    queryKey: dashboardQueryKeys.templates,
    queryFn: () => fetchTemplates(token).then((response) => response.templates),
    enabled: Boolean(token)
  });
  const fieldsQuery = useQuery({
    queryKey: dashboardQueryKeys.contactFields,
    queryFn: () => listContactFields(token).then((response) => response.fields),
    enabled: Boolean(token)
  });
  const publishedFlowsQuery = useQuery({
    queryKey: [...dashboardQueryKeys.webhooksRoot, "published-flows"],
    queryFn: () => fetchPublishedFlows(token),
    enabled: Boolean(token)
  });
  const qrStatusQuery = useQuery({
    queryKey: [...dashboardQueryKeys.settingsRoot, "qr-status"],
    queryFn: () => fetchWhatsAppStatus(token),
    enabled: Boolean(token)
  });

  const integrations = integrationsQuery.data ?? [];
  const workflows = workflowsQuery.data ?? [];
  const logs = logsQuery.data ?? [];
  const publishedQrFlows = useMemo(
    () => (publishedFlowsQuery.data ?? []).filter((flow: PublishedFlowSummary) => flow.channel === "qr"),
    [publishedFlowsQuery.data]
  );
  const qrStatus = qrStatusQuery.data ?? null;
  const qrConnected = qrStatus?.status === "connected";
  const approvedTemplates = useMemo(
    () => (templatesQuery.data ?? []).filter((template) => template.status === "APPROVED"),
    [templatesQuery.data]
  );
  const sampleKeys = useMemo(
    () => Object.keys(integration?.lastPayloadFlatJson ?? {}).sort((left, right) => left.localeCompare(right)),
    [integration?.lastPayloadFlatJson]
  );
  const selectedTemplate = approvedTemplates.find((template) => template.id === templateId) ?? null;
  const templatePlaceholders = useMemo(() => extractPlaceholders(selectedTemplate), [selectedTemplate]);
  const endpointUrl = integration ? `${window.location.origin}${integration.endpointUrlPath}/incoming` : "";

  useEffect(() => {
    const data = workflowsQuery.data;
    if (!data || data.length === 0 || editingWorkflowId) return;
    const workflow = data[0];
    setEditingWorkflowId(workflow.id);
    setEnabled(workflow.enabled);
    setChannelMode(workflow.channelMode);
    setMatchMode(workflow.matchMode);
    setDefaultCountryCode(workflow.defaultCountryCode ?? "");
    setDelayValue(workflow.delayValue ? String(workflow.delayValue) : "");
    setDelayUnit(workflow.delayUnit ?? "minutes");
    setConditions(workflow.conditions);
    setTemplateId(workflow.templateAction?.templateId ?? "");
    setRecipientNamePath(workflow.templateAction?.recipientNamePath ?? "");
    setRecipientPhonePath(workflow.templateAction?.recipientPhonePath ?? "");
    setQrFlowId(workflow.qrFlowAction?.flowId ?? "");
    setQrRecipientNamePath(workflow.qrFlowAction?.recipientNamePath ?? "");
    setQrRecipientPhonePath(workflow.qrFlowAction?.recipientPhonePath ?? "");
    setContactDisplayNamePath(workflow.contactAction.contactPaths?.displayNamePath ?? "");
    setContactPhonePath(
      workflow.contactAction.contactPaths?.phoneNumberPath ??
      workflow.templateAction?.recipientPhonePath ??
      workflow.qrFlowAction?.recipientPhonePath ??
      ""
    );
    setContactEmailPath(workflow.contactAction.contactPaths?.emailPath ?? "");
    setTagOperation(workflow.contactAction.tagOperation ?? "append");
    setTagsText(tagsToString(workflow.contactAction.tags));
    setFieldMappings(workflow.contactAction.fieldMappings ?? []);
    setVariableMappings(
      Object.fromEntries(Object.entries(workflow.templateAction?.variableMappings ?? {}).map(([key, binding]) => [key, binding.path]))
    );
    setFallbackValues(workflow.templateAction?.fallbackValues ?? {});
  }, [workflowsQuery.data]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.webhooksRoot }),
      queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.templatesRoot }),
      queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.contactFieldsRoot })
    ]);
  };

  const createIntegrationMutation = useMutation({
    mutationFn: () => createGenericWebhookIntegration(token, { name: newIntegrationName.trim() }).then((response) => response.integration),
    onSuccess: async (created) => {
      await invalidate();
      setSelectedIntegrationId(created.id);
      setNewIntegrationName("");
      setMessage("Webhook created.");
      setError(null);
    },
    onError: (mutationError) => setError((mutationError as Error).message)
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsedDelayValue = Number(delayValue);
      const normalizedDelayValue =
        delayValue.trim() && Number.isInteger(parsedDelayValue) && parsedDelayValue > 0
          ? parsedDelayValue
          : null;
      const contactPaths: GenericWebhookContactPaths = {
        displayNamePath: contactDisplayNamePath || undefined,
        phoneNumberPath: contactPhonePath || undefined,
        emailPath: contactEmailPath || undefined
      };
      const contactAction: GenericWebhookContactAction = {
        contactPaths,
        tagOperation,
        tags: toTagArray(tagsText),
        fieldMappings: fieldMappings.filter((mapping) => mapping.contactFieldName && mapping.payloadPath)
      };
      const templateAction: GenericWebhookTemplateAction | null = channelMode === "api"
        ? {
            templateId,
            recipientNamePath,
            recipientPhonePath,
            variableMappings: Object.fromEntries(
              Object.entries(variableMappings)
                .filter(([, path]) => path.trim())
                .map(([key, path]) => [key, { source: "payload" as const, path }])
            ),
            fallbackValues: Object.fromEntries(
              Object.entries(fallbackValues).filter(([, value]) => value.trim())
            )
          }
        : null;
      const qrFlowAction: GenericWebhookQrFlowAction | null = channelMode === "qr"
        ? {
            flowId: qrFlowId,
            recipientPhonePath: qrRecipientPhonePath,
            recipientNamePath: qrRecipientNamePath || undefined
          }
        : null;
      const payload = {
        name: integration!.name,
        enabled,
        channelMode,
        matchMode,
        defaultCountryCode: defaultCountryCode.trim() || null,
        delayValue: normalizedDelayValue,
        delayUnit: normalizedDelayValue ? delayUnit : null,
        conditions: conditions.filter((condition) => condition.comparator),
        contactAction,
        ...(templateAction ? { templateAction } : {}),
        ...(qrFlowAction ? { qrFlowAction } : {})
      };
      if (editingWorkflowId) {
        return updateGenericWebhookWorkflow(token, selectedIntegrationId, editingWorkflowId, payload).then((response) => response.workflow);
      }
      return createGenericWebhookWorkflow(token, selectedIntegrationId, payload).then((response) => response.workflow);
    },
    onSuccess: async () => {
      await invalidate();
      resetForm();
      setMessage(editingWorkflowId ? "Workflow updated." : "Workflow created.");
      setError(null);
      setActiveTab("workflows");
    },
    onError: (mutationError) => {
      setError((mutationError as Error).message);
      setMessage(null);
    }
  });

  const toggleIntegrationMutation = useMutation({
    mutationFn: (nextEnabled: boolean) => updateGenericWebhookIntegration(token, selectedIntegrationId, { enabled: nextEnabled }),
    onSuccess: async () => {
      await invalidate();
    }
  });

  const rotateSecretMutation = useMutation({
    mutationFn: () => rotateGenericWebhookSecret(token, selectedIntegrationId),
    onSuccess: async () => {
      await invalidate();
      setMessage("Webhook secret rotated.");
      setError(null);
    },
    onError: (mutationError) => setError((mutationError as Error).message)
  });

  const deleteIntegrationMutation = useMutation({
    mutationFn: () => deleteGenericWebhookIntegration(token, selectedIntegrationId),
    onSuccess: async () => {
      await invalidate();
      resetForm();
      setMessage("Webhook deleted.");
      setError(null);
    },
    onError: (mutationError) => setError((mutationError as Error).message)
  });

  const deleteMutation = useMutation({
    mutationFn: (workflowId: string) => deleteGenericWebhookWorkflow(token, selectedIntegrationId, workflowId),
    onSuccess: async () => {
      await invalidate();
      resetForm();
      setMessage("Workflow deleted.");
    }
  });


  function resetForm() {
    setEditingWorkflowId(null);
    setEnabled(true);
    setChannelMode("api");
    setMatchMode("all");
    setDefaultCountryCode("");
    setDelayValue("");
    setDelayUnit("minutes");
    setConditions([]);
    setTemplateId("");
    setRecipientNamePath("");
    setRecipientPhonePath("");
    setQrFlowId("");
    setQrRecipientNamePath("");
    setQrRecipientPhonePath("");
    setContactDisplayNamePath("");
    setContactPhonePath("");
    setContactEmailPath("");
    setTagOperation("append");
    setTagsText("");
    setFieldMappings([]);
    setVariableMappings({});
    setFallbackValues({});
  }

  return (
    <section className="finance-shell">
      <article className="channel-setup-panel">
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <h3>Generic Webhooks</h3>
            <p>Create separate webhook integrations for forms, CRMs, checkout events, and any other external system.</p>
          </div>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", gap: "1rem", alignItems: "start", marginBottom: "1rem" }}>
          <aside style={{ padding: "1rem", border: "1px solid #e5e7eb", borderRadius: 12, display: "grid", gap: "0.75rem" }}>
            <div style={{ fontWeight: 700 }}>Webhook Integrations</div>
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {integrations.length === 0 && <p style={{ margin: 0, color: "#6b7280" }}>No webhooks yet.</p>}
              {integrations.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={selectedIntegrationId === item.id ? "primary-btn" : "ghost-btn"}
                  style={{ display: "flex", justifyContent: "space-between", width: "100%" }}
                  onClick={() => {
                    setSelectedIntegrationId(item.id);
                    resetForm();
                  }}
                >
                  <span>{item.name}</span>
                  <span style={{ opacity: 0.7 }}>{item.enabled ? "On" : "Off"}</span>
                </button>
              ))}
            </div>
            <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
              <label>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>New webhook</div>
                <input value={newIntegrationName} onChange={(event) => setNewIntegrationName(event.target.value)} placeholder="Website forms" />
              </label>
              <button
                type="button"
                className="primary-btn"
                onClick={() => createIntegrationMutation.mutate()}
                disabled={createIntegrationMutation.isPending || !newIntegrationName.trim()}
              >
                {createIntegrationMutation.isPending ? "Creating..." : "Create Webhook"}
              </button>
            </div>
          </aside>

          <div>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          {(["overview", "configuration", "workflows", "logs"] as ActiveTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              className={activeTab === tab ? "primary-btn" : "ghost-btn"}
              onClick={() => setActiveTab(tab)}
            >
              {tab[0].toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {message && <p style={{ color: "#166534", marginBottom: "0.75rem" }}>{message}</p>}
        {error && <p style={{ color: "#dc2626", marginBottom: "0.75rem" }}>{error}</p>}

        {!integration && (
          <div style={{ padding: "1rem", border: "1px solid #e5e7eb", borderRadius: 12 }}>
            <p style={{ margin: 0, color: "#6b7280" }}>Create a webhook integration to configure its endpoint, workflows, and logs.</p>
          </div>
        )}

        {integration && activeTab === "overview" && (
          <div style={{ display: "grid", gap: "1rem" }}>
            <div style={{ padding: "1rem", border: "1px solid #e5e7eb", borderRadius: 12 }}>
              <h4 style={{ marginBottom: "0.5rem" }}>What this does</h4>
              <p style={{ margin: 0, color: "#4b5563" }}>
                External systems can POST JSON to your WAGen webhook. WAGen captures the payload, evaluates your saved workflow conditions,
                updates contact tags and fields, then either sends an API WhatsApp template or starts a QR flow for the mapped recipient.
              </p>
            </div>
            <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <MetricCard label="Endpoint" value={integration?.webhookKey ?? "Loading..."} />
              <MetricCard label="Workflows" value={String(workflows.length)} />
              <MetricCard label="Last Capture" value={integration?.lastReceivedAt ? new Date(integration.lastReceivedAt).toLocaleString() : "No payload yet"} />
              <MetricCard label="Logs" value={String(logs.length)} />
            </div>
          </div>
        )}

        {integration && activeTab === "configuration" && (
          <div style={{ display: "grid", gap: "1rem" }}>
            <div style={{ padding: "1rem", border: "1px solid #e5e7eb", borderRadius: 12 }}>
              <div style={{ display: "grid", gap: "0.75rem" }}>
                <label>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Webhook URL</div>
                  <input value={endpointUrl} readOnly />
                </label>
                <label>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Secret token</div>
                  <input value={integration?.secretToken ?? ""} readOnly />
                </label>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button type="button" className="ghost-btn" onClick={() => navigator.clipboard.writeText(endpointUrl)}>Copy URL</button>
                  <button type="button" className="ghost-btn" onClick={() => navigator.clipboard.writeText(integration.secretToken)}>Copy Secret</button>
                  <button type="button" className="primary-btn" onClick={() => rotateSecretMutation.mutate()} disabled={rotateSecretMutation.isPending}>
                    {rotateSecretMutation.isPending ? "Rotating..." : "Rotate Secret"}
                  </button>
                  <button
                    type="button"
                    className={integration.enabled ? "primary-btn" : "ghost-btn"}
                    onClick={() => toggleIntegrationMutation.mutate(!integration.enabled)}
                  >
                    {integration.enabled ? "Connected" : "Disabled"}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    style={{ color: "#dc2626" }}
                    onClick={() => deleteIntegrationMutation.mutate()}
                    disabled={deleteIntegrationMutation.isPending}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
            <div style={{ padding: "1rem", border: "1px solid #e5e7eb", borderRadius: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
                <h4 style={{ margin: 0 }}>Latest Captured Payload Fields</h4>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => integrationsQuery.refetch()}
                  disabled={integrationsQuery.isFetching}
                >
                  {integrationsQuery.isFetching ? "Refreshing..." : "Refresh Payload Fields"}
                </button>
              </div>
              {sampleKeys.length === 0 ? (
                <p style={{ margin: 0, color: "#6b7280" }}>No payload captured yet. Send a JSON POST to the webhook URL to populate comparator and mapping options.</p>
              ) : (
                <div style={{ maxHeight: 360, overflow: "auto", border: "1px solid #f3f4f6", borderRadius: 8 }}>
                  <table className="contact-fields-table">
                    <thead>
                      <tr>
                        <th>Path</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sampleKeys.map((key) => (
                        <tr key={key}>
                          <td style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>{key}</td>
                          <td>{integration?.lastPayloadFlatJson[key] ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {integration && activeTab === "workflows" && (
          <div style={{ display: "grid", gap: "1rem" }}>
            <div style={{ padding: "1rem", border: "1px solid #e5e7eb", borderRadius: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
                <h4 style={{ margin: 0 }}>Workflow for {integration.name}</h4>
              </div>

              <div style={{ display: "grid", gap: "1rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem" }}>
                  <label>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Action channel</div>
                    <select value={channelMode} onChange={(event) => setChannelMode(event.target.value as GenericWebhookChannelMode)}>
                      <option value="api">API Template</option>
                      <option value="qr">QR Flow</option>
                    </select>
                  </label>
                  <label>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Matches</div>
                    <select value={matchMode} onChange={(event) => setMatchMode(event.target.value as "all" | "any")}>
                      <option value="all">ALL</option>
                      <option value="any">ANY</option>
                    </select>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", paddingTop: "1.8rem" }}>
                    <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
                    Enable workflow
                  </label>
                </div>

                <label>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Default country code for local numbers</div>
                  <input
                    value={defaultCountryCode}
                    onChange={(event) => setDefaultCountryCode(event.target.value)}
                    placeholder="+91"
                  />
                  <div style={{ marginTop: 6, color: "#6b7280", fontSize: "0.9rem" }}>
                    Local numbers like <code>9804735837</code> become <code>919804735837</code>. Numbers already sent as <code>+919804735837</code> stay unchanged.
                  </div>
                </label>

                <div>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Delay</div>
                  <div style={{ display: "grid", gridTemplateColumns: "180px 180px", gap: "1rem", alignItems: "end" }}>
                    <label>
                      <div style={{ marginBottom: 6 }}>Delay value</div>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={delayValue}
                        onChange={(event) => setDelayValue(event.target.value)}
                        placeholder="0"
                      />
                    </label>
                    <label>
                      <div style={{ marginBottom: 6 }}>Delay unit</div>
                      <select value={delayUnit} onChange={(event) => setDelayUnit(event.target.value as GenericWebhookDelayUnit)}>
                        <option value="minutes">Minutes</option>
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                      </select>
                    </label>
                  </div>
                  <div style={{ marginTop: 6, color: "#6b7280", fontSize: "0.9rem" }}>
                    Leave blank or use <code>0</code> to send immediately. Examples: <code>30 minutes</code>, <code>2 hours</code>, <code>1 day</code>.
                  </div>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontWeight: 600 }}>Conditions</div>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => setConditions((current) => current.length >= 3 ? current : [...current, emptyCondition()])}
                    >
                      Add condition
                    </button>
                  </div>
                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    {conditions.length === 0 && <p style={{ color: "#6b7280", margin: 0 }}>No conditions added. This workflow will run for every webhook hit.</p>}
                    {conditions.map((condition, index) => (
                      <div key={`${condition.comparator}-${index}`} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: "0.5rem", alignItems: "end" }}>
                        <label>
                          <div style={{ fontSize: "0.85rem", marginBottom: 4 }}>Comparator</div>
                          <select value={condition.comparator} onChange={(event) => setConditions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, comparator: event.target.value } : item))}>
                            <option value="">Select path</option>
                            {sampleKeys.map((key) => <option key={key} value={key}>{key}</option>)}
                          </select>
                        </label>
                        <label>
                          <div style={{ fontSize: "0.85rem", marginBottom: 4 }}>Operator</div>
                          <select value={condition.operator} onChange={(event) => setConditions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, operator: event.target.value as GenericWebhookCondition["operator"] } : item))}>
                            <option value="is_not_empty">Is Not Empty</option>
                            <option value="is_empty">Is Empty</option>
                            <option value="equals">Equals</option>
                            <option value="not_equals">Not Equals</option>
                          </select>
                        </label>
                        <label>
                          <div style={{ fontSize: "0.85rem", marginBottom: 4 }}>Value</div>
                          <input
                            value={condition.value ?? ""}
                            onChange={(event) => setConditions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))}
                            disabled={condition.operator === "is_not_empty" || condition.operator === "is_empty"}
                            placeholder="Expected value"
                          />
                        </label>
                        <button type="button" className="ghost-btn" onClick={() => setConditions((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
                      </div>
                    ))}
                  </div>
                </div>

                {channelMode === "api" ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
                    <label>
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>Approved template</div>
                      <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                        <option value="">Select template</option>
                        {approvedTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                      </select>
                    </label>
                    <label>
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>Recipient name path</div>
                      <select value={recipientNamePath} onChange={(event) => setRecipientNamePath(event.target.value)}>
                        <option value="">Select path</option>
                        {sampleKeys.map((key) => <option key={key} value={key}>{key}</option>)}
                      </select>
                    </label>
                    <label>
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>Recipient phone path</div>
                      <select value={recipientPhonePath} onChange={(event) => setRecipientPhonePath(event.target.value)}>
                        <option value="">Select path</option>
                        {sampleKeys.map((key) => <option key={key} value={key}>{key}</option>)}
                      </select>
                    </label>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: "1rem" }}>
                    <div style={{ padding: "0.85rem", border: "1px solid #e5e7eb", borderRadius: 12, background: "#f8fafc", color: "#334155" }}>
                      QR status: <strong>{qrConnected ? `Connected as ${qrStatus?.phoneNumber ?? "active session"}` : "Not connected"}</strong>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
                      <label>
                        <div style={{ fontWeight: 600, marginBottom: 6 }}>Published QR flow</div>
                        <select value={qrFlowId} onChange={(event) => setQrFlowId(event.target.value)}>
                          <option value="">Select flow</option>
                          {publishedQrFlows.map((flow) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
                        </select>
                      </label>
                      <label>
                        <div style={{ fontWeight: 600, marginBottom: 6 }}>Recipient phone path</div>
                        <select value={qrRecipientPhonePath} onChange={(event) => setQrRecipientPhonePath(event.target.value)}>
                          <option value="">Select path</option>
                          {sampleKeys.map((key) => <option key={key} value={key}>{key}</option>)}
                        </select>
                      </label>
                      <label>
                        <div style={{ fontWeight: 600, marginBottom: 6 }}>Recipient name path</div>
                        <select value={qrRecipientNamePath} onChange={(event) => setQrRecipientNamePath(event.target.value)}>
                          <option value="">Optional</option>
                          {sampleKeys.map((key) => <option key={key} value={key}>{key}</option>)}
                        </select>
                      </label>
                    </div>
                  </div>
                )}

                <div>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Contact mapping</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
                    <label>
                      <div style={{ marginBottom: 6 }}>Contact name path</div>
                      <select value={contactDisplayNamePath} onChange={(event) => setContactDisplayNamePath(event.target.value)}>
                        <option value="">Use recipient name path</option>
                        {sampleKeys.map((key) => <option key={key} value={key}>{key}</option>)}
                      </select>
                    </label>
                    <label>
                      <div style={{ marginBottom: 6 }}>Contact phone path</div>
                      <select value={contactPhonePath} onChange={(event) => setContactPhonePath(event.target.value)}>
                        <option value="">Use recipient phone path</option>
                        {sampleKeys.map((key) => <option key={key} value={key}>{key}</option>)}
                      </select>
                    </label>
                    <label>
                      <div style={{ marginBottom: 6 }}>Contact email path</div>
                      <select value={contactEmailPath} onChange={(event) => setContactEmailPath(event.target.value)}>
                        <option value="">No email mapping</option>
                        {sampleKeys.map((key) => <option key={key} value={key}>{key}</option>)}
                      </select>
                    </label>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: "1rem" }}>
                  <label>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Contact tags</div>
                    <input value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder="vip, website-lead" />
                  </label>
                  <label>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Tag operation</div>
                    <select value={tagOperation} onChange={(event) => setTagOperation(event.target.value as "append" | "replace" | "add_if_empty")}>
                      <option value="append">Append</option>
                      <option value="replace">Replace</option>
                      <option value="add_if_empty">Add If Empty</option>
                    </select>
                  </label>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontWeight: 600 }}>Contact field mappings</div>
                    <button type="button" className="ghost-btn" onClick={() => setFieldMappings((current) => [...current, { contactFieldName: "", payloadPath: "" }])}>Add field mapping</button>
                  </div>
                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    {fieldMappings.map((mapping, index) => (
                      <div key={`${mapping.contactFieldName}-${index}`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "0.5rem", alignItems: "end" }}>
                        <label>
                          <div style={{ fontSize: "0.85rem", marginBottom: 4 }}>Contact field</div>
                          <select value={mapping.contactFieldName} onChange={(event) => setFieldMappings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, contactFieldName: event.target.value } : item))}>
                            <option value="">Select field</option>
                            {(fieldsQuery.data ?? []).map((field) => <option key={field.id} value={field.name}>{field.label}</option>)}
                          </select>
                        </label>
                        <label>
                          <div style={{ fontSize: "0.85rem", marginBottom: 4 }}>Payload path</div>
                          <select value={mapping.payloadPath} onChange={(event) => setFieldMappings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, payloadPath: event.target.value } : item))}>
                            <option value="">Select path</option>
                            {sampleKeys.map((key) => <option key={key} value={key}>{key}</option>)}
                          </select>
                        </label>
                        <button type="button" className="ghost-btn" onClick={() => setFieldMappings((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
                      </div>
                    ))}
                  </div>
                </div>

                {channelMode === "api" && (
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>Template variable mappings</div>
                    <div style={{ display: "grid", gap: "0.75rem" }}>
                      {templatePlaceholders.length === 0 && <p style={{ color: "#6b7280", margin: 0 }}>Selected template has no variables.</p>}
                      {templatePlaceholders.map((placeholder) => (
                        <div key={placeholder} style={{ display: "grid", gridTemplateColumns: "180px 1fr 1fr", gap: "0.5rem", alignItems: "end" }}>
                          <div style={{ fontFamily: "monospace", fontSize: "0.9rem", paddingBottom: 10 }}>{placeholder}</div>
                          <label>
                            <div style={{ fontSize: "0.85rem", marginBottom: 4 }}>Payload path</div>
                            <select value={variableMappings[placeholder] ?? ""} onChange={(event) => setVariableMappings((current) => ({ ...current, [placeholder]: event.target.value }))}>
                              <option value="">Select path</option>
                              {sampleKeys.map((key) => <option key={key} value={key}>{key}</option>)}
                            </select>
                          </label>
                          <label>
                            <div style={{ fontSize: "0.85rem", marginBottom: 4 }}>Fallback</div>
                            <input value={fallbackValues[placeholder] ?? ""} onChange={(event) => setFallbackValues((current) => ({ ...current, [placeholder]: event.target.value }))} placeholder="Optional fallback" />
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => saveMutation.mutate()}
                    disabled={
                      saveMutation.isPending ||
                      (channelMode === "api" && (!templateId || !recipientNamePath || !recipientPhonePath)) ||
                      (channelMode === "qr" && (!qrFlowId || !qrRecipientPhonePath))
                    }
                  >
                    {saveMutation.isPending ? "Saving..." : "Save Workflow"}
                  </button>
                  {editingWorkflowId && (
                    <button
                      type="button"
                      className="ghost-btn"
                      style={{ color: "#dc2626" }}
                      onClick={() => deleteMutation.mutate(editingWorkflowId)}
                      disabled={deleteMutation.isPending}
                    >
                      {deleteMutation.isPending ? "Deleting..." : "Delete Workflow"}
                    </button>
                  )}
                </div>
              </div>
            </div>

          </div>
        )}

        {integration && activeTab === "logs" && (
          <div style={{ padding: "1rem", border: "1px solid #e5e7eb", borderRadius: 12 }}>
            <h4 style={{ marginBottom: "0.75rem" }}>Webhook Logs</h4>
            {logs.length === 0 ? (
              <p style={{ color: "#6b7280", margin: 0 }}>No logs yet.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="contact-fields-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Status</th>
                      <th>Phone</th>
                      <th>Name</th>
                      <th>Workflow</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id}>
                        <td>{new Date(log.createdAt).toLocaleString()}</td>
                        <td>{log.status}</td>
                        <td>{log.customerPhone ?? "—"}</td>
                        <td>{log.customerName ?? "—"}</td>
                        <td>{log.workflowId ?? "No match"}</td>
                        <td>{log.errorMessage ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
          </div>
        </div>
      </article>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "1rem", border: "1px solid #e5e7eb", borderRadius: 12 }}>
      <div style={{ color: "#6b7280", fontSize: "0.9rem", marginBottom: 6 }}>{label}</div>
      <div style={{ fontWeight: 700, color: "#111827" }}>{value}</div>
    </div>
  );
}

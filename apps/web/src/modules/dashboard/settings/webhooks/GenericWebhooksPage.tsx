import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  createGenericWebhookWorkflow,
  deleteGenericWebhookWorkflow,
  fetchGenericWebhookIntegration,
  fetchGenericWebhookLogs,
  fetchGenericWebhookWorkflows,
  fetchTemplates,
  listContactFields,
  rotateGenericWebhookSecret,
  updateGenericWebhookIntegration,
  updateGenericWebhookWorkflow,
  type GenericWebhookCondition,
  type GenericWebhookContactAction,
  type GenericWebhookTemplateAction,
  type GenericWebhookWorkflow,
  type MessageTemplate
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
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [matchMode, setMatchMode] = useState<"all" | "any">("all");
  const [conditions, setConditions] = useState<GenericWebhookCondition[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [recipientNamePath, setRecipientNamePath] = useState("");
  const [recipientPhonePath, setRecipientPhonePath] = useState("");
  const [tagOperation, setTagOperation] = useState<"append" | "replace" | "add_if_empty">("append");
  const [tagsText, setTagsText] = useState("");
  const [fieldMappings, setFieldMappings] = useState<Array<{ contactFieldName: string; payloadPath: string }>>([]);
  const [variableMappings, setVariableMappings] = useState<Record<string, string>>({});
  const [fallbackValues, setFallbackValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const integrationQuery = useQuery({
    queryKey: dashboardQueryKeys.webhookIntegration,
    queryFn: () => fetchGenericWebhookIntegration(token).then((response) => response.integration),
    enabled: Boolean(token)
  });
  const workflowsQuery = useQuery({
    queryKey: dashboardQueryKeys.webhookWorkflows,
    queryFn: () => fetchGenericWebhookWorkflows(token).then((response) => response.workflows),
    enabled: Boolean(token)
  });
  const logsQuery = useQuery({
    queryKey: dashboardQueryKeys.webhookLogs,
    queryFn: () => fetchGenericWebhookLogs(token).then((response) => response.logs),
    enabled: Boolean(token)
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

  const integration = integrationQuery.data;
  const workflows = workflowsQuery.data ?? [];
  const logs = logsQuery.data ?? [];
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
  const endpointUrl = integration ? `${window.location.origin}${integration.endpointUrlPath}` : "";

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.webhooksRoot }),
      queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.templatesRoot }),
      queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.contactFieldsRoot })
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const contactAction: GenericWebhookContactAction = {
        tagOperation,
        tags: toTagArray(tagsText),
        fieldMappings: fieldMappings.filter((mapping) => mapping.contactFieldName && mapping.payloadPath)
      };
      const templateAction: GenericWebhookTemplateAction = {
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
      };
      const payload = {
        name,
        enabled,
        matchMode,
        conditions: conditions.filter((condition) => condition.comparator),
        contactAction,
        templateAction
      };
      if (editingWorkflowId) {
        return updateGenericWebhookWorkflow(token, editingWorkflowId, payload).then((response) => response.workflow);
      }
      return createGenericWebhookWorkflow(token, payload).then((response) => response.workflow);
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
    mutationFn: (nextEnabled: boolean) => updateGenericWebhookIntegration(token, { enabled: nextEnabled }),
    onSuccess: async () => {
      await invalidate();
    }
  });

  const rotateSecretMutation = useMutation({
    mutationFn: () => rotateGenericWebhookSecret(token),
    onSuccess: async () => {
      await invalidate();
      setMessage("Webhook secret rotated.");
      setError(null);
    },
    onError: (mutationError) => setError((mutationError as Error).message)
  });

  const deleteMutation = useMutation({
    mutationFn: (workflowId: string) => deleteGenericWebhookWorkflow(token, workflowId),
    onSuccess: async () => {
      await invalidate();
      resetForm();
      setMessage("Workflow deleted.");
    }
  });

  const toggleWorkflowMutation = useMutation({
    mutationFn: ({ workflowId, nextEnabled }: { workflowId: string; nextEnabled: boolean }) =>
      updateGenericWebhookWorkflow(token, workflowId, { enabled: nextEnabled }),
    onSuccess: async () => {
      await invalidate();
    }
  });

  function resetForm() {
    setEditingWorkflowId(null);
    setName("");
    setEnabled(true);
    setMatchMode("all");
    setConditions([]);
    setTemplateId("");
    setRecipientNamePath("");
    setRecipientPhonePath("");
    setTagOperation("append");
    setTagsText("");
    setFieldMappings([]);
    setVariableMappings({});
    setFallbackValues({});
  }

  function startEditing(workflow: GenericWebhookWorkflow) {
    setEditingWorkflowId(workflow.id);
    setName(workflow.name);
    setEnabled(workflow.enabled);
    setMatchMode(workflow.matchMode);
    setConditions(workflow.conditions);
    setTemplateId(workflow.templateAction.templateId);
    setRecipientNamePath(workflow.templateAction.recipientNamePath);
    setRecipientPhonePath(workflow.templateAction.recipientPhonePath);
    setTagOperation(workflow.contactAction.tagOperation ?? "append");
    setTagsText(tagsToString(workflow.contactAction.tags));
    setFieldMappings(workflow.contactAction.fieldMappings ?? []);
    setVariableMappings(
      Object.fromEntries(Object.entries(workflow.templateAction.variableMappings ?? {}).map(([key, binding]) => [key, binding.path]))
    );
    setFallbackValues(workflow.templateAction.fallbackValues ?? {});
    setActiveTab("workflows");
  }

  return (
    <section className="finance-shell">
      <article className="channel-setup-panel">
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <h3>Generic Webhooks</h3>
            <p>Capture JSON payloads from external apps, update contacts, tag them, and send approved WhatsApp templates.</p>
          </div>
          {integration && (
            <button
              type="button"
              className={integration.enabled ? "primary-btn" : "ghost-btn"}
              onClick={() => toggleIntegrationMutation.mutate(!integration.enabled)}
            >
              {integration.enabled ? "Connected" : "Disabled"}
            </button>
          )}
        </header>

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

        {activeTab === "overview" && (
          <div style={{ display: "grid", gap: "1rem" }}>
            <div style={{ padding: "1rem", border: "1px solid #e5e7eb", borderRadius: 12 }}>
              <h4 style={{ marginBottom: "0.5rem" }}>What this does</h4>
              <p style={{ margin: 0, color: "#4b5563" }}>
                External systems can POST JSON to your WAGen webhook. WAGen captures the payload, evaluates your saved workflow conditions,
                updates contact tags and fields, then sends a WhatsApp template to the mapped recipient.
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

        {activeTab === "configuration" && (
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
                  <button type="button" className="ghost-btn" onClick={() => navigator.clipboard.writeText(integration?.secretToken ?? "")}>Copy Secret</button>
                  <button type="button" className="primary-btn" onClick={() => rotateSecretMutation.mutate()} disabled={rotateSecretMutation.isPending}>
                    {rotateSecretMutation.isPending ? "Rotating..." : "Rotate Secret"}
                  </button>
                </div>
              </div>
            </div>
            <div style={{ padding: "1rem", border: "1px solid #e5e7eb", borderRadius: 12 }}>
              <h4 style={{ marginBottom: "0.75rem" }}>Latest Captured Payload Fields</h4>
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

        {activeTab === "workflows" && (
          <div style={{ display: "grid", gap: "1rem" }}>
            <div style={{ padding: "1rem", border: "1px solid #e5e7eb", borderRadius: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
                <h4 style={{ margin: 0 }}>{editingWorkflowId ? "Edit Workflow" : "Create Workflow"}</h4>
                {editingWorkflowId && <button type="button" className="ghost-btn" onClick={resetForm}>Cancel Edit</button>}
              </div>

              <div style={{ display: "grid", gap: "1rem" }}>
                <label>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Workflow name</div>
                  <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Website lead follow-up" />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem" }}>
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

                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending || !name.trim() || !templateId || !recipientNamePath || !recipientPhonePath}
                  >
                    {saveMutation.isPending ? "Saving..." : editingWorkflowId ? "Update Workflow" : "Create Workflow"}
                  </button>
                  <button type="button" className="ghost-btn" onClick={resetForm}>Reset</button>
                </div>
              </div>
            </div>

            <div style={{ padding: "1rem", border: "1px solid #e5e7eb", borderRadius: 12 }}>
              <h4 style={{ marginBottom: "0.75rem" }}>Saved Workflows</h4>
              {workflows.length === 0 ? (
                <p style={{ color: "#6b7280", margin: 0 }}>No workflows yet.</p>
              ) : (
                <div style={{ display: "grid", gap: "0.75rem" }}>
                  {workflows.map((workflow) => (
                    <div key={workflow.id} style={{ border: "1px solid #f3f4f6", borderRadius: 10, padding: "0.9rem", display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{workflow.name}</div>
                        <div style={{ color: "#6b7280", fontSize: "0.92rem" }}>
                          {workflow.enabled ? "Enabled" : "Disabled"} · {workflow.matchMode.toUpperCase()} · {workflow.conditions.length} condition(s)
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        <button type="button" className="ghost-btn" onClick={() => startEditing(workflow)}>Edit</button>
                        <button type="button" className="ghost-btn" onClick={() => toggleWorkflowMutation.mutate({ workflowId: workflow.id, nextEnabled: !workflow.enabled })}>
                          {workflow.enabled ? "Disable" : "Enable"}
                        </button>
                        <button type="button" className="ghost-btn" style={{ color: "#dc2626" }} onClick={() => deleteMutation.mutate(workflow.id)}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "logs" && (
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

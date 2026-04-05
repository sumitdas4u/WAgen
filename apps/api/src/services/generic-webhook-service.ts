import { randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";
import { listContactFields } from "./contact-fields-service.js";
import { getOrCreateConversation } from "./conversation-service.js";
import { upsertWebhookContact } from "./contacts-service.js";
import { deliverConversationTemplateMessage } from "./message-delivery-service.js";
import { getMessageTemplate } from "./template-service.js";

type JsonRecord = Record<string, unknown>;

export type GenericWebhookConditionOperator = "is_not_empty" | "is_empty" | "equals" | "not_equals";
export type GenericWebhookMatchMode = "all" | "any";
export type GenericWebhookTagOperation = "append" | "replace" | "add_if_empty";
export type GenericWebhookLogStatus = "completed" | "skipped" | "failed";

export interface GenericWebhookCondition {
  comparator: string;
  operator: GenericWebhookConditionOperator;
  value?: string;
}

export interface GenericWebhookContactAction {
  tagOperation?: GenericWebhookTagOperation;
  tags?: string[];
  fieldMappings?: Array<{ contactFieldName: string; payloadPath: string }>;
}

export interface GenericWebhookTemplateAction {
  templateId: string;
  recipientNamePath: string;
  recipientPhonePath: string;
  variableMappings: Record<string, { source: "payload"; path: string }>;
  fallbackValues?: Record<string, string>;
}

export interface GenericWebhookIntegration {
  id: string;
  userId: string;
  name: string;
  webhookKey: string;
  secretToken: string;
  enabled: boolean;
  endpointUrlPath: string;
  lastPayloadJson: JsonRecord;
  lastPayloadFlatJson: Record<string, string>;
  lastReceivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenericWebhookWorkflow {
  id: string;
  userId: string;
  integrationId: string;
  name: string;
  enabled: boolean;
  matchMode: GenericWebhookMatchMode;
  conditions: GenericWebhookCondition[];
  contactAction: GenericWebhookContactAction;
  templateAction: GenericWebhookTemplateAction;
  createdAt: string;
  updatedAt: string;
}

export interface GenericWebhookLog {
  id: string;
  requestId: string;
  workflowId: string | null;
  status: GenericWebhookLogStatus;
  customerName: string | null;
  customerPhone: string | null;
  contactId: string | null;
  templateId: string | null;
  providerMessageId: string | null;
  errorMessage: string | null;
  payloadJson: JsonRecord;
  resultJson: JsonRecord;
  createdAt: string;
}

interface GenericWebhookIntegrationRow {
  id: string;
  user_id: string;
  name: string;
  webhook_key: string;
  secret_token: string;
  enabled: boolean;
  last_payload_json: JsonRecord;
  last_payload_flat_json: Record<string, string>;
  last_received_at: string | null;
  created_at: string;
  updated_at: string;
}

interface GenericWebhookWorkflowRow {
  id: string;
  user_id: string;
  integration_id: string;
  name: string;
  enabled: boolean;
  match_mode: GenericWebhookMatchMode;
  conditions_json: GenericWebhookCondition[];
  contact_action_json: GenericWebhookContactAction;
  template_action_json: GenericWebhookTemplateAction;
  created_at: string;
  updated_at: string;
}

interface GenericWebhookLogRow {
  id: string;
  request_id: string;
  workflow_id: string | null;
  status: GenericWebhookLogStatus;
  customer_name: string | null;
  customer_phone: string | null;
  contact_id: string | null;
  template_id: string | null;
  provider_message_id: string | null;
  error_message: string | null;
  payload_json: JsonRecord;
  result_json: JsonRecord;
  created_at: string;
}

function buildWebhookKey(): string {
  return `wh_${randomBytes(8).toString("hex")}`;
}

function buildWebhookSecret(): string {
  return randomBytes(18).toString("hex");
}

function trimToNull(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function normalizePhoneNumber(value: string | null): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    return null;
  }
  return digits;
}

function flattenPayload(input: unknown, prefix = ""): Record<string, string> {
  const flat: Record<string, string> = {};
  if (input === null || input === undefined) {
    if (prefix) flat[prefix] = "";
    return flat;
  }
  if (Array.isArray(input)) {
    if (prefix) flat[prefix] = JSON.stringify(input);
    input.forEach((item, index) => {
      const nextPrefix = prefix ? `${prefix}[${index}]` : `[${index}]`;
      Object.assign(flat, flattenPayload(item, nextPrefix));
    });
    return flat;
  }
  if (typeof input === "object") {
    const entries = Object.entries(input as JsonRecord);
    if (prefix && entries.length === 0) flat[prefix] = "{}";
    for (const [key, value] of entries) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      Object.assign(flat, flattenPayload(value, nextPrefix));
    }
    return flat;
  }
  if (prefix) flat[prefix] = String(input);
  return flat;
}

function getPayloadValue(flatPayload: Record<string, string>, path: string): string | null {
  return trimToNull(flatPayload[path.trim()] ?? null);
}

function mapIntegration(row: GenericWebhookIntegrationRow): GenericWebhookIntegration {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    webhookKey: row.webhook_key,
    secretToken: row.secret_token,
    enabled: row.enabled,
    endpointUrlPath: `/api/integrations/webhooks/${row.webhook_key}`,
    lastPayloadJson: row.last_payload_json ?? {},
    lastPayloadFlatJson: row.last_payload_flat_json ?? {},
    lastReceivedAt: row.last_received_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapWorkflow(row: GenericWebhookWorkflowRow): GenericWebhookWorkflow {
  return {
    id: row.id,
    userId: row.user_id,
    integrationId: row.integration_id,
    name: row.name,
    enabled: row.enabled,
    matchMode: row.match_mode,
    conditions: Array.isArray(row.conditions_json) ? row.conditions_json : [],
    contactAction: row.contact_action_json ?? {},
    templateAction: row.template_action_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapLog(row: GenericWebhookLogRow): GenericWebhookLog {
  return {
    id: row.id,
    requestId: row.request_id,
    workflowId: row.workflow_id,
    status: row.status,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    contactId: row.contact_id,
    templateId: row.template_id,
    providerMessageId: row.provider_message_id,
    errorMessage: row.error_message,
    payloadJson: row.payload_json ?? {},
    resultJson: row.result_json ?? {},
    createdAt: row.created_at
  };
}

async function getIntegrationByWebhookKey(webhookKey: string): Promise<GenericWebhookIntegration | null> {
  const result = await pool.query<GenericWebhookIntegrationRow>(
    `SELECT * FROM generic_webhook_integrations WHERE webhook_key = $1 LIMIT 1`,
    [webhookKey]
  );
  return result.rows[0] ? mapIntegration(result.rows[0]) : null;
}

async function getUserDisplayName(userId: string): Promise<string> {
  const result = await pool.query<{ name: string | null; email: string }>(
    `SELECT name, email FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  const row = result.rows[0];
  return row?.name?.trim() || row?.email.split("@")[0] || "Agent";
}

function validateWorkflowPayload(input: {
  name?: string;
  conditions?: GenericWebhookCondition[];
  templateAction?: GenericWebhookTemplateAction;
}): void {
  if (input.name !== undefined && !input.name.trim()) {
    throw new Error("Workflow name is required.");
  }
  if ((input.conditions?.length ?? 0) > 3) {
    throw new Error("A maximum of 3 conditions is allowed.");
  }
  if (input.templateAction) {
    if (!input.templateAction.recipientNamePath.trim() || !input.templateAction.recipientPhonePath.trim()) {
      throw new Error("Recipient name and phone mappings are required.");
    }
  }
}

function conditionMatches(condition: GenericWebhookCondition, flatPayload: Record<string, string>): boolean {
  const currentValue = getPayloadValue(flatPayload, condition.comparator);
  const expected = trimToNull(condition.value);
  switch (condition.operator) {
    case "is_not_empty":
      return Boolean(currentValue);
    case "is_empty":
      return !currentValue;
    case "equals":
      return currentValue === expected;
    case "not_equals":
      return currentValue !== expected;
    default:
      return false;
  }
}

function workflowMatches(workflow: GenericWebhookWorkflow, flatPayload: Record<string, string>): boolean {
  if (workflow.conditions.length === 0) return true;
  const results = workflow.conditions.map((condition) => conditionMatches(condition, flatPayload));
  return workflow.matchMode === "any" ? results.some(Boolean) : results.every(Boolean);
}

function applyTagOperation(existingTags: string[], incomingTags: string[], operation?: GenericWebhookTagOperation): string[] {
  const normalizedIncoming = Array.from(new Set(incomingTags.map((tag) => tag.trim()).filter(Boolean)));
  if (normalizedIncoming.length === 0) return existingTags;
  if (operation === "replace") return normalizedIncoming;
  if (operation === "add_if_empty") return existingTags.length === 0 ? normalizedIncoming : existingTags;
  return Array.from(new Set([...existingTags, ...normalizedIncoming]));
}

async function recordGenericWebhookLog(input: {
  userId: string;
  integrationId: string;
  workflowId?: string | null;
  requestId: string;
  status: GenericWebhookLogStatus;
  customerName?: string | null;
  customerPhone?: string | null;
  contactId?: string | null;
  templateId?: string | null;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  payloadJson: JsonRecord;
  resultJson?: JsonRecord;
}): Promise<void> {
  await pool.query(
    `INSERT INTO generic_webhook_logs (
       user_id, integration_id, workflow_id, request_id, status, customer_name, customer_phone, contact_id, template_id, provider_message_id, error_message, payload_json, result_json
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)`,
    [
      input.userId,
      input.integrationId,
      input.workflowId ?? null,
      input.requestId,
      input.status,
      input.customerName ?? null,
      input.customerPhone ?? null,
      input.contactId ?? null,
      input.templateId ?? null,
      input.providerMessageId ?? null,
      input.errorMessage ?? null,
      JSON.stringify(input.payloadJson ?? {}),
      JSON.stringify(input.resultJson ?? {})
    ]
  );
}

async function updateIntegrationCapture(integrationId: string, payload: JsonRecord, flatPayload: Record<string, string>): Promise<void> {
  await pool.query(
    `UPDATE generic_webhook_integrations
     SET last_payload_json = $2::jsonb,
         last_payload_flat_json = $3::jsonb,
         last_received_at = NOW()
     WHERE id = $1`,
    [integrationId, JSON.stringify(payload), JSON.stringify(flatPayload)]
  );
}

export async function listGenericWebhookIntegrations(userId: string): Promise<GenericWebhookIntegration[]> {
  const result = await pool.query<GenericWebhookIntegrationRow>(
    `SELECT *
     FROM generic_webhook_integrations
     WHERE user_id = $1
     ORDER BY updated_at DESC, created_at DESC`,
    [userId]
  );
  return result.rows.map(mapIntegration);
}

export async function getGenericWebhookIntegration(userId: string, integrationId: string): Promise<GenericWebhookIntegration | null> {
  const result = await pool.query<GenericWebhookIntegrationRow>(
    `SELECT *
     FROM generic_webhook_integrations
     WHERE id = $1
       AND user_id = $2
     LIMIT 1`,
    [integrationId, userId]
  );
  return result.rows[0] ? mapIntegration(result.rows[0]) : null;
}

export async function createGenericWebhookIntegration(
  userId: string,
  input: { name: string }
): Promise<GenericWebhookIntegration> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Webhook name is required.");
  }
  const result = await pool.query<GenericWebhookIntegrationRow>(
    `INSERT INTO generic_webhook_integrations (user_id, name, webhook_key, secret_token)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userId, name, buildWebhookKey(), buildWebhookSecret()]
  );
  return mapIntegration(result.rows[0]!);
}

export async function updateGenericWebhookIntegration(
  userId: string,
  integrationId: string,
  patch: { name?: string; enabled?: boolean }
): Promise<GenericWebhookIntegration | null> {
  const result = await pool.query<GenericWebhookIntegrationRow>(
    `UPDATE generic_webhook_integrations
     SET name = COALESCE($3, name),
         enabled = COALESCE($4, enabled)
     WHERE id = $1
       AND user_id = $2
     RETURNING *`,
    [integrationId, userId, patch.name?.trim() || null, patch.enabled ?? null]
  );
  return result.rows[0] ? mapIntegration(result.rows[0]) : null;
}

export async function rotateGenericWebhookSecret(userId: string, integrationId: string): Promise<GenericWebhookIntegration | null> {
  const result = await pool.query<GenericWebhookIntegrationRow>(
    `UPDATE generic_webhook_integrations
     SET secret_token = $3
     WHERE id = $1
       AND user_id = $2
     RETURNING *`,
    [integrationId, userId, buildWebhookSecret()]
  );
  return result.rows[0] ? mapIntegration(result.rows[0]) : null;
}

export async function deleteGenericWebhookIntegration(userId: string, integrationId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM generic_webhook_integrations
     WHERE id = $1
       AND user_id = $2`,
    [integrationId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listGenericWebhookWorkflows(userId: string, integrationId: string): Promise<GenericWebhookWorkflow[]> {
  const result = await pool.query<GenericWebhookWorkflowRow>(
    `SELECT *
     FROM generic_webhook_workflows
     WHERE user_id = $1
       AND integration_id = $2
     ORDER BY sort_order ASC, created_at ASC`,
    [userId, integrationId]
  );
  return result.rows.map(mapWorkflow);
}

export async function createGenericWebhookWorkflow(
  userId: string,
  integrationId: string,
  input: {
    name: string;
    enabled?: boolean;
    matchMode: GenericWebhookMatchMode;
    conditions: GenericWebhookCondition[];
    contactAction?: GenericWebhookContactAction;
    templateAction: GenericWebhookTemplateAction;
  }
): Promise<GenericWebhookWorkflow> {
  validateWorkflowPayload(input);
  const integration = await getGenericWebhookIntegration(userId, integrationId);
  if (!integration) {
    throw new Error("Webhook integration not found.");
  }
  await getMessageTemplate(userId, input.templateAction.templateId);
  const sortOrderResult = await pool.query<{ max: number | null }>(
    `SELECT MAX(sort_order) AS max FROM generic_webhook_workflows WHERE integration_id = $1`,
    [integration.id]
  );
  const nextSortOrder = (sortOrderResult.rows[0]?.max ?? -1) + 1;
  const result = await pool.query<GenericWebhookWorkflowRow>(
    `INSERT INTO generic_webhook_workflows (
       user_id, integration_id, name, enabled, match_mode, conditions_json, contact_action_json, template_action_json, sort_order
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9)
     RETURNING *`,
    [
      userId,
      integration.id,
      input.name.trim(),
      input.enabled ?? true,
      input.matchMode,
      JSON.stringify(input.conditions ?? []),
      JSON.stringify(input.contactAction ?? {}),
      JSON.stringify(input.templateAction),
      nextSortOrder
    ]
  );
  return mapWorkflow(result.rows[0]!);
}

export async function updateGenericWebhookWorkflow(
  userId: string,
  integrationId: string,
  workflowId: string,
  patch: Partial<{
    name: string;
    enabled: boolean;
    matchMode: GenericWebhookMatchMode;
    conditions: GenericWebhookCondition[];
    contactAction: GenericWebhookContactAction;
    templateAction: GenericWebhookTemplateAction;
  }>
): Promise<GenericWebhookWorkflow | null> {
  validateWorkflowPayload(patch);
  const currentResult = await pool.query<GenericWebhookWorkflowRow>(
    `SELECT *
     FROM generic_webhook_workflows
     WHERE id = $1
       AND user_id = $2
       AND integration_id = $3
     LIMIT 1`,
    [workflowId, userId, integrationId]
  );
  if (!currentResult.rows[0]) return null;
  if (patch.templateAction?.templateId) {
    await getMessageTemplate(userId, patch.templateAction.templateId);
  }
  const result = await pool.query<GenericWebhookWorkflowRow>(
    `UPDATE generic_webhook_workflows
     SET name = COALESCE($4, name),
         enabled = COALESCE($5, enabled),
         match_mode = COALESCE($6, match_mode),
         conditions_json = COALESCE($7::jsonb, conditions_json),
         contact_action_json = COALESCE($8::jsonb, contact_action_json),
         template_action_json = COALESCE($9::jsonb, template_action_json)
     WHERE id = $1
       AND user_id = $2
       AND integration_id = $3
     RETURNING *`,
    [
      workflowId,
      userId,
      integrationId,
      patch.name?.trim() || null,
      patch.enabled ?? null,
      patch.matchMode ?? null,
      patch.conditions ? JSON.stringify(patch.conditions) : null,
      patch.contactAction ? JSON.stringify(patch.contactAction) : null,
      patch.templateAction ? JSON.stringify(patch.templateAction) : null
    ]
  );
  return result.rows[0] ? mapWorkflow(result.rows[0]) : null;
}

export async function deleteGenericWebhookWorkflow(userId: string, integrationId: string, workflowId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM generic_webhook_workflows
     WHERE id = $1
       AND user_id = $2
       AND integration_id = $3`,
    [workflowId, userId, integrationId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listGenericWebhookLogs(userId: string, integrationId: string): Promise<GenericWebhookLog[]> {
  const result = await pool.query<GenericWebhookLogRow>(
    `SELECT id, request_id, workflow_id, status, customer_name, customer_phone, contact_id, template_id, provider_message_id, error_message, payload_json, result_json, created_at
     FROM generic_webhook_logs
     WHERE user_id = $1
       AND integration_id = $2
     ORDER BY created_at DESC
     LIMIT 100`,
    [userId, integrationId]
  );
  return result.rows.map(mapLog);
}

export async function handleIncomingGenericWebhook(input: {
  webhookKey: string;
  secretToken: string | null;
  requestId: string;
  payload: JsonRecord;
}): Promise<{ matchedWorkflows: number; completedWorkflows: number; failedWorkflows: number }> {
  const integration = await getIntegrationByWebhookKey(input.webhookKey);
  if (!integration) {
    throw new Error("Webhook integration not found.");
  }
  if (!integration.enabled) {
    throw new Error("Webhook integration is disabled.");
  }
  if (!input.secretToken || input.secretToken !== integration.secretToken) {
    throw new Error("Unauthorized webhook secret.");
  }

  const flatPayload = flattenPayload(input.payload);
  await updateIntegrationCapture(integration.id, input.payload, flatPayload);

  const workflows = (await listGenericWebhookWorkflows(integration.userId, integration.id)).filter((workflow) => workflow.enabled);
  let matchedWorkflows = 0;
  let completedWorkflows = 0;
  let failedWorkflows = 0;

  for (const workflow of workflows) {
    if (!workflowMatches(workflow, flatPayload)) continue;
    matchedWorkflows += 1;

    const recipientName = getPayloadValue(flatPayload, workflow.templateAction.recipientNamePath);
    const rawPhone = getPayloadValue(flatPayload, workflow.templateAction.recipientPhonePath);
    const recipientPhone = normalizePhoneNumber(rawPhone);

    if (!recipientPhone) {
      await recordGenericWebhookLog({
        userId: integration.userId,
        integrationId: integration.id,
        workflowId: workflow.id,
        requestId: input.requestId,
        status: "skipped",
        customerName: recipientName,
        customerPhone: rawPhone,
        templateId: workflow.templateAction.templateId,
        errorMessage: "Recipient phone mapping did not resolve to a valid phone number.",
        payloadJson: input.payload
      });
      continue;
    }

    try {
      const template = await getMessageTemplate(integration.userId, workflow.templateAction.templateId);
      const fields = await listContactFields(integration.userId);
      const customFields: Record<string, string> = {};
      for (const mapping of workflow.contactAction.fieldMappings ?? []) {
        if (!fields.some((field) => field.name === mapping.contactFieldName)) continue;
        const mappedValue = getPayloadValue(flatPayload, mapping.payloadPath);
        if (mappedValue) customFields[mapping.contactFieldName] = mappedValue;
      }

      const currentTagsResult = await pool.query<{ tags: string[] }>(
        `SELECT tags FROM contacts WHERE user_id = $1 AND phone_number = $2 LIMIT 1`,
        [integration.userId, recipientPhone]
      );
      const tags = applyTagOperation(
        currentTagsResult.rows[0]?.tags ?? [],
        workflow.contactAction.tags ?? [],
        workflow.contactAction.tagOperation
      );

      const contact = await upsertWebhookContact({
        userId: integration.userId,
        displayName: recipientName,
        phoneNumber: recipientPhone,
        tags,
        customFields,
        sourceId: input.requestId,
        sourceUrl: integration.endpointUrlPath
      });

      const variableValues: Record<string, string> = {};
      for (const [key, binding] of Object.entries(workflow.templateAction.variableMappings ?? {})) {
        const value = getPayloadValue(flatPayload, binding.path) ?? trimToNull(workflow.templateAction.fallbackValues?.[key]);
        if (value) variableValues[key] = value;
      }

      const conversation = await getOrCreateConversation(integration.userId, recipientPhone, {
        channelType: "api",
        channelLinkedNumber: template.linkedNumber ?? null
      });

      const delivery = await deliverConversationTemplateMessage({
        userId: integration.userId,
        conversationId: conversation.id,
        templateId: template.id,
        variableValues,
        senderName: await getUserDisplayName(integration.userId)
      });

      completedWorkflows += 1;
      await recordGenericWebhookLog({
        userId: integration.userId,
        integrationId: integration.id,
        workflowId: workflow.id,
        requestId: input.requestId,
        status: "completed",
        customerName: recipientName,
        customerPhone: recipientPhone,
        contactId: contact.id,
        templateId: template.id,
        providerMessageId: delivery.messageId,
        payloadJson: input.payload,
        resultJson: {
          workflowName: workflow.name,
          integrationName: integration.name,
          contactId: contact.id,
          conversationId: conversation.id,
          variableKeys: Object.keys(variableValues)
        }
      });
    } catch (error) {
      failedWorkflows += 1;
      await recordGenericWebhookLog({
        userId: integration.userId,
        integrationId: integration.id,
        workflowId: workflow.id,
        requestId: input.requestId,
        status: "failed",
        customerName: recipientName,
        customerPhone: recipientPhone,
        templateId: workflow.templateAction.templateId,
        errorMessage: (error as Error).message,
        payloadJson: input.payload,
        resultJson: { workflowName: workflow.name, integrationName: integration.name }
      });
    }
  }

  if (matchedWorkflows === 0) {
    await recordGenericWebhookLog({
      userId: integration.userId,
      integrationId: integration.id,
      requestId: input.requestId,
      status: "skipped",
      errorMessage: "No enabled workflow matched this payload.",
      payloadJson: input.payload,
      resultJson: { integrationName: integration.name }
    });
  }

  return { matchedWorkflows, completedWorkflows, failedWorkflows };
}

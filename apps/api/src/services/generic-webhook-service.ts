import { randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";
import { queueApiConversationSend } from "./api-outbound-router-service.js";
import { sendConversationFlowMessage } from "./channel-outbound-service.js";
import { listContactFields } from "./contact-fields-service.js";
import { getOrCreateConversation } from "./conversation-service.js";
import { upsertWebhookContact } from "./contacts-service.js";
import { startFlowForConversation } from "./flow-engine-service.js";
import { getFlow } from "./flow-service.js";
import { queueGenericWebhookOutboundMessage } from "./outbound-message-service.js";
import { getMessageTemplate } from "./template-service.js";
import { whatsappSessionManager } from "./whatsapp-session-manager.js";
import { applyDateOffset, parseDateString, type DateOffset } from "../utils/date-offset.js";

type JsonRecord = Record<string, unknown>;

export type GenericWebhookConditionOperator = "is_not_empty" | "is_empty" | "equals" | "not_equals";
export type GenericWebhookMatchMode = "all" | "any";
export type GenericWebhookChannelMode = "api" | "qr";
export type GenericWebhookDelayUnit = "minutes" | "hours" | "days";
export type GenericWebhookTagOperation = "append" | "replace" | "add_if_empty";
export type GenericWebhookLogStatus = "queued" | "completed" | "skipped" | "failed";

export interface GenericWebhookCondition {
  comparator: string;
  operator: GenericWebhookConditionOperator;
  value?: string;
}

export interface GenericWebhookContactAction {
  contactPaths?: {
    displayNamePath?: string;
    phoneNumberPath?: string;
    emailPath?: string;
  };
  tagOperation?: GenericWebhookTagOperation;
  tags?: string[];
  fieldMappings?: Array<{ contactFieldName: string; payloadPath: string }>;
}

type PersistedGenericWebhookContactAction = GenericWebhookContactAction & {
  _defaultCountryCode?: string;
  _delayValue?: number;
  _delayUnit?: GenericWebhookDelayUnit;
};

export interface GenericWebhookTemplateAction {
  templateId: string;
  recipientNamePath: string;
  recipientPhonePath: string;
  variableMappings: Record<string, { source: "payload"; path: string; dateOffset?: DateOffset } | { source: "contact"; field: string; dateOffset?: DateOffset } | { source: "static"; value: string; dateOffset?: DateOffset } | { source: "now"; dateOffset: DateOffset }>;
  fallbackValues?: Record<string, string>;
}

export interface GenericWebhookQrFlowAction {
  flowId: string;
  recipientPhonePath: string;
  recipientNamePath?: string;
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
  channelMode: GenericWebhookChannelMode;
  matchMode: GenericWebhookMatchMode;
  defaultCountryCode?: string;
  delayValue?: number;
  delayUnit?: GenericWebhookDelayUnit;
  conditions: GenericWebhookCondition[];
  contactAction: GenericWebhookContactAction;
  templateAction: GenericWebhookTemplateAction | null;
  qrFlowAction: GenericWebhookQrFlowAction | null;
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
  channel_mode: GenericWebhookChannelMode;
  match_mode: GenericWebhookMatchMode;
  conditions_json: GenericWebhookCondition[];
  contact_action_json: GenericWebhookContactAction;
  template_action_json: GenericWebhookTemplateAction;
  qr_flow_action_json: GenericWebhookQrFlowAction;
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

interface PreparedGenericWebhookExecution {
  userId: string;
  requestId: string;
  integrationId: string;
  integrationName: string;
  workflowId: string;
  workflowName: string;
  channelMode: GenericWebhookChannelMode;
  payloadJson: JsonRecord;
  recipientName: string | null;
  recipientPhone: string;
  contactName: string | null;
  contactPhone: string;
  contactEmail: string | null;
  contactId: string;
  templateId: string | null;
  flowId: string | null;
  variableValues: Record<string, string>;
  scheduledAt: string | null;
  delayValue: number;
  delayUnit: GenericWebhookDelayUnit | null;
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

function normalizeCountryCode(value: string | null | undefined): string | null {
  const trimmed = trimToNull(value);
  if (!trimmed || !/^\+\d{1,15}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function normalizeDelayValue(value: number | null | undefined): number {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) {
    return 0;
  }
  return value!;
}

function normalizeDelayUnit(value: string | null | undefined): GenericWebhookDelayUnit | null {
  if (value === "minutes" || value === "hours" || value === "days") {
    return value;
  }
  return null;
}

function normalizeWebhookPhoneNumber(value: string | null, defaultCountryCode?: string): string | null {
  const trimmed = trimToNull(value);
  if (!trimmed) {
    return null;
  }
  const resolvedValue = trimmed.startsWith("+") || !defaultCountryCode ? trimmed : `${defaultCountryCode}${trimmed}`;
  return normalizePhoneNumber(resolvedValue);
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

function resolveContactField(contact: import("../types/models.js").Contact, field: string): string | null {
  switch (field) {
    case "display_name": return trimToNull(contact.display_name);
    case "phone_number": return trimToNull(contact.phone_number);
    case "email": return trimToNull(contact.email);
    case "tags": return trimToNull(contact.tags.join(", "));
    case "contact_type": return trimToNull(contact.contact_type);
    case "source_type": return trimToNull(contact.source_type);
    case "source_id": return trimToNull(contact.source_id);
    case "source_url": return trimToNull(contact.source_url);
    default: {
      if (!field.startsWith("custom:")) return null;
      const name = field.slice("custom:".length).trim().toLowerCase();
      return trimToNull(contact.custom_field_values.find((v) => v.field_name.toLowerCase() === name)?.value ?? null);
    }
  }
}

function calculateScheduledAt(delayValue: number, delayUnit: GenericWebhookDelayUnit | null, now = new Date()): string | null {
  const normalizedDelayValue = normalizeDelayValue(delayValue);
  if (normalizedDelayValue === 0 || !delayUnit) {
    return null;
  }
  const multiplier =
    delayUnit === "minutes" ? 60_000 :
    delayUnit === "hours" ? 60 * 60_000 :
    24 * 60 * 60_000;
  return new Date(now.getTime() + normalizedDelayValue * multiplier).toISOString();
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
  const persistedContactAction = (row.contact_action_json ?? {}) as PersistedGenericWebhookContactAction;
  const defaultCountryCode =
    normalizeCountryCode(persistedContactAction._defaultCountryCode) ??
    null;
  const delayValue = normalizeDelayValue(persistedContactAction._delayValue);
  const delayUnit = normalizeDelayUnit(persistedContactAction._delayUnit);
  const {
    _defaultCountryCode: _ignoredDefaultCountryCode,
    _delayValue: _ignoredDelayValue,
    _delayUnit: _ignoredDelayUnit,
    ...contactAction
  } = persistedContactAction;

  return {
    id: row.id,
    userId: row.user_id,
    integrationId: row.integration_id,
    name: row.name,
    enabled: row.enabled,
    channelMode: row.channel_mode ?? "api",
    matchMode: row.match_mode,
    defaultCountryCode: defaultCountryCode ?? undefined,
    delayValue: delayValue > 0 ? delayValue : undefined,
    delayUnit: delayValue > 0 ? delayUnit ?? undefined : undefined,
    conditions: Array.isArray(row.conditions_json) ? row.conditions_json : [],
    contactAction,
    templateAction: row.channel_mode === "api" ? row.template_action_json ?? null : null,
    qrFlowAction: row.channel_mode === "qr" ? row.qr_flow_action_json ?? null : null,
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
  channelMode?: GenericWebhookChannelMode;
  defaultCountryCode?: string | null;
  delayValue?: number | null;
  delayUnit?: GenericWebhookDelayUnit | null;
  conditions?: GenericWebhookCondition[];
  templateAction?: GenericWebhookTemplateAction | null;
  qrFlowAction?: GenericWebhookQrFlowAction | null;
}): void {
  if (input.name !== undefined && !input.name.trim()) {
    throw new Error("Workflow name is required.");
  }
  if ((input.conditions?.length ?? 0) > 3) {
    throw new Error("A maximum of 3 conditions is allowed.");
  }
  if (input.channelMode && input.channelMode !== "api" && input.channelMode !== "qr") {
    throw new Error("Channel mode must be either api or qr.");
  }
  if (input.channelMode === "api" && !input.templateAction) {
    throw new Error("Template action is required for API webhook workflows.");
  }
  if (input.channelMode === "qr" && !input.qrFlowAction) {
    throw new Error("QR flow action is required for QR webhook workflows.");
  }
  if (input.templateAction) {
    if (!input.templateAction.recipientNamePath.trim() || !input.templateAction.recipientPhonePath.trim()) {
      throw new Error("Recipient name and phone mappings are required.");
    }
  }
  if (input.qrFlowAction && !input.qrFlowAction.recipientPhonePath.trim()) {
    throw new Error("Recipient phone mapping is required for QR webhook workflows.");
  }
  if (input.defaultCountryCode !== undefined && input.defaultCountryCode !== null && !normalizeCountryCode(input.defaultCountryCode)) {
    throw new Error("Default country code must start with + and contain digits only.");
  }
  if (input.delayValue !== undefined && input.delayValue !== null) {
    if (!Number.isInteger(input.delayValue) || input.delayValue < 0) {
      throw new Error("Delay value must be an integer greater than or equal to 0.");
    }
    if (input.delayValue > 0 && !normalizeDelayUnit(input.delayUnit ?? undefined)) {
      throw new Error("Delay unit is required when delay value is greater than 0.");
    }
  }
  if (input.delayUnit !== undefined && input.delayUnit !== null && !normalizeDelayUnit(input.delayUnit)) {
    throw new Error("Delay unit must be minutes, hours, or days.");
  }
}

async function validateQrFlowAction(userId: string, qrFlowAction: GenericWebhookQrFlowAction | null | undefined): Promise<void> {
  if (!qrFlowAction) {
    return;
  }

  const flow = await getFlow(userId, qrFlowAction.flowId);
  if (!flow) {
    throw new Error("Selected QR flow was not found.");
  }
  if (!flow.published) {
    throw new Error("Selected QR flow must be published.");
  }
  if (flow.channel !== "qr") {
    throw new Error("Selected flow must use the QR channel.");
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

function buildPersistedContactAction(input: {
  contactAction?: GenericWebhookContactAction;
  defaultCountryCode?: string | null;
  delayValue?: number | null;
  delayUnit?: GenericWebhookDelayUnit | null;
}): PersistedGenericWebhookContactAction {
  const defaultCountryCode = normalizeCountryCode(input.defaultCountryCode ?? undefined);
  const delayValue = normalizeDelayValue(input.delayValue);
  const delayUnit = normalizeDelayUnit(input.delayUnit ?? undefined);

  return {
    ...(input.contactAction ?? {}),
    ...(defaultCountryCode ? { _defaultCountryCode: defaultCountryCode } : {}),
    ...(delayValue > 0 && delayUnit ? { _delayValue: delayValue, _delayUnit: delayUnit } : {})
  };
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
}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO generic_webhook_logs (
       user_id, integration_id, workflow_id, request_id, status, customer_name, customer_phone, contact_id, template_id, provider_message_id, error_message, payload_json, result_json
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)
     RETURNING id`,
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
  return result.rows[0]!.id;
}

async function updateGenericWebhookLog(input: {
  logId: string;
  status?: GenericWebhookLogStatus;
  contactId?: string | null;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  resultJson?: JsonRecord;
}): Promise<void> {
  await pool.query(
    `UPDATE generic_webhook_logs
     SET status = COALESCE($2, status),
         contact_id = COALESCE($3, contact_id),
         provider_message_id = COALESCE($4, provider_message_id),
         error_message = $5,
         result_json = COALESCE($6::jsonb, result_json)
     WHERE id = $1`,
    [
      input.logId,
      input.status ?? null,
      input.contactId ?? null,
      input.providerMessageId ?? null,
      input.errorMessage ?? null,
      input.resultJson ? JSON.stringify(input.resultJson) : null
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
    channelMode: GenericWebhookChannelMode;
    matchMode: GenericWebhookMatchMode;
    defaultCountryCode?: string | null;
    delayValue?: number | null;
    delayUnit?: GenericWebhookDelayUnit | null;
    conditions: GenericWebhookCondition[];
    contactAction?: GenericWebhookContactAction;
    templateAction?: GenericWebhookTemplateAction | null;
    qrFlowAction?: GenericWebhookQrFlowAction | null;
  }
): Promise<GenericWebhookWorkflow> {
  validateWorkflowPayload(input);
  const integration = await getGenericWebhookIntegration(userId, integrationId);
  if (!integration) {
    throw new Error("Webhook integration not found.");
  }
  if (input.channelMode === "api" && input.templateAction?.templateId) {
    await getMessageTemplate(userId, input.templateAction.templateId);
  }
  if (input.channelMode === "qr") {
    await validateQrFlowAction(userId, input.qrFlowAction);
  }
  const sortOrderResult = await pool.query<{ max: number | null }>(
    `SELECT MAX(sort_order) AS max FROM generic_webhook_workflows WHERE integration_id = $1`,
    [integration.id]
  );
  const nextSortOrder = (sortOrderResult.rows[0]?.max ?? -1) + 1;
  const result = await pool.query<GenericWebhookWorkflowRow>(
    `INSERT INTO generic_webhook_workflows (
       user_id, integration_id, name, enabled, channel_mode, match_mode, conditions_json, contact_action_json, template_action_json, qr_flow_action_json, sort_order
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11)
     RETURNING *`,
    [
      userId,
      integration.id,
      input.name.trim(),
      input.enabled ?? true,
      input.channelMode,
      input.matchMode,
      JSON.stringify(input.conditions ?? []),
      JSON.stringify(buildPersistedContactAction(input)),
      JSON.stringify(input.templateAction ?? {}),
      JSON.stringify(input.qrFlowAction ?? {}),
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
    channelMode: GenericWebhookChannelMode;
    matchMode: GenericWebhookMatchMode;
    defaultCountryCode: string | null;
    delayValue: number | null;
    delayUnit: GenericWebhookDelayUnit | null;
    conditions: GenericWebhookCondition[];
    contactAction: GenericWebhookContactAction;
    templateAction: GenericWebhookTemplateAction | null;
    qrFlowAction: GenericWebhookQrFlowAction | null;
  }>
): Promise<GenericWebhookWorkflow | null> {
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

  const currentWorkflow = mapWorkflow(currentResult.rows[0]);
  const nextChannelMode = patch.channelMode ?? currentWorkflow.channelMode;
  const nextTemplateAction =
    patch.templateAction !== undefined ? patch.templateAction : currentWorkflow.templateAction;
  const nextQrFlowAction =
    patch.qrFlowAction !== undefined ? patch.qrFlowAction : currentWorkflow.qrFlowAction;

  const nextDefaultCountryCode =
    patch.defaultCountryCode !== undefined ? patch.defaultCountryCode : currentWorkflow.defaultCountryCode;
  const nextDelayValue =
    patch.delayValue !== undefined ? patch.delayValue : currentWorkflow.delayValue;
  const nextDelayUnit =
    patch.delayUnit !== undefined ? patch.delayUnit : currentWorkflow.delayUnit;

  validateWorkflowPayload({
    name: patch.name,
    channelMode: nextChannelMode,
    defaultCountryCode: nextDefaultCountryCode,
    delayValue: nextDelayValue,
    delayUnit: nextDelayUnit,
    conditions: patch.conditions,
    templateAction: nextTemplateAction,
    qrFlowAction: nextQrFlowAction
  });

  if (nextChannelMode === "api" && nextTemplateAction?.templateId) {
    await getMessageTemplate(userId, nextTemplateAction.templateId);
  }
  if (nextChannelMode === "qr") {
    await validateQrFlowAction(userId, nextQrFlowAction);
  }
  const result = await pool.query<GenericWebhookWorkflowRow>(
    `UPDATE generic_webhook_workflows
     SET name = COALESCE($4, name),
         enabled = COALESCE($5, enabled),
         channel_mode = COALESCE($6, channel_mode),
         match_mode = COALESCE($7, match_mode),
         conditions_json = COALESCE($8::jsonb, conditions_json),
         contact_action_json = COALESCE($9::jsonb, contact_action_json),
         template_action_json = COALESCE($10::jsonb, template_action_json),
         qr_flow_action_json = COALESCE($11::jsonb, qr_flow_action_json)
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
      patch.channelMode ?? null,
      patch.matchMode ?? null,
      patch.conditions ? JSON.stringify(patch.conditions) : null,
      patch.contactAction || patch.defaultCountryCode !== undefined || patch.delayValue !== undefined || patch.delayUnit !== undefined
        ? JSON.stringify(buildPersistedContactAction({
            contactAction: patch.contactAction ?? currentWorkflow.contactAction,
            defaultCountryCode: nextDefaultCountryCode,
            delayValue: nextDelayValue,
            delayUnit: nextDelayUnit
          }))
        : null,
      patch.templateAction !== undefined ? JSON.stringify(patch.templateAction ?? {}) : null,
      patch.qrFlowAction !== undefined ? JSON.stringify(patch.qrFlowAction ?? {}) : null
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

async function executePreparedGenericWebhookExecution(input: PreparedGenericWebhookExecution): Promise<{
  providerMessageId: string | null;
  resultJson: JsonRecord;
}> {
  if (input.channelMode === "api") {
    if (!input.templateId) {
      throw new Error("Template action is missing.");
    }

    const template = await getMessageTemplate(input.userId, input.templateId);
    const apiConversation = await getOrCreateConversation(input.userId, input.recipientPhone, {
      channelType: "api",
      channelLinkedNumber: template.linkedNumber ?? null
    });

    await queueApiConversationSend({
      userId: input.userId,
      conversationId: apiConversation.id,
      source: "manual",
      templateId: input.templateId,
      variableValues: input.variableValues,
      senderName: await getUserDisplayName(input.userId)
    });

    return {
      providerMessageId: null,
      resultJson: {
        workflowName: input.workflowName,
        integrationName: input.integrationName,
        channelMode: input.channelMode,
        contactId: input.contactId,
        conversationId: apiConversation.id,
        variableKeys: Object.keys(input.variableValues)
      }
    };
  }

  if (!input.flowId) {
    throw new Error("QR flow action is missing.");
  }

  const qrStatus = await whatsappSessionManager.getStatus(input.userId, { restoreRuntime: false });
  const linkedNumber = normalizePhoneNumber(qrStatus.phoneNumber);
  if (qrStatus.status !== "connected" || !linkedNumber) {
    throw new Error("WhatsApp QR session is not connected.");
  }

  const qrConversation = await getOrCreateConversation(input.userId, input.recipientPhone, {
    channelType: "qr",
    channelLinkedNumber: linkedNumber
  });

  const session = await startFlowForConversation({
    userId: input.userId,
    flowId: input.flowId,
    conversationId: qrConversation.id,
    sendReply: async (payload) => {
      await sendConversationFlowMessage({
        userId: input.userId,
        conversationId: qrConversation.id,
        payload
      });
    }
  });

  const selectedFlow = await getFlow(input.userId, input.flowId);
  return {
    providerMessageId: null,
    resultJson: {
      workflowName: input.workflowName,
      integrationName: input.integrationName,
      channelMode: input.channelMode,
      contactId: input.contactId,
      conversationId: qrConversation.id,
      flowId: input.flowId,
      flowName: selectedFlow?.name ?? null,
      sessionId: session.id
    }
  };
}

export async function executeQueuedGenericWebhookLog(logId: string): Promise<void> {
  const result = await pool.query<{
    id: string;
    user_id: string;
    payload_json: JsonRecord;
    variable_values_json: Record<string, string>;
  }>(
    `SELECT id, user_id, payload_json, variable_values_json
     FROM outbound_messages
     WHERE generic_webhook_log_id = $1
     LIMIT 1`,
    [logId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Queued generic webhook execution not found.");
  }

  const prepared = row.payload_json as unknown as PreparedGenericWebhookExecution;

  try {
    const executionResult = await executePreparedGenericWebhookExecution({
      ...prepared,
      variableValues: row.variable_values_json ?? prepared.variableValues ?? {}
    });
    await updateGenericWebhookLog({
      logId,
      status: "completed",
      contactId: prepared.contactId || null,
      providerMessageId: executionResult.providerMessageId,
      errorMessage: null,
      resultJson: executionResult.resultJson
    });
  } catch (error) {
    await updateGenericWebhookLog({
      logId,
      status: "failed",
      contactId: prepared.contactId || null,
      errorMessage: (error as Error).message,
      resultJson: {
        workflowName: prepared.workflowName,
        integrationName: prepared.integrationName,
        channelMode: prepared.channelMode,
        flowId: prepared.flowId
      }
    });
    throw error;
  }
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
  const fields = await listContactFields(integration.userId);

  for (const workflow of workflows) {
    if (!workflowMatches(workflow, flatPayload)) continue;
    matchedWorkflows += 1;

    const recipientName =
      workflow.channelMode === "api"
        ? getPayloadValue(flatPayload, workflow.templateAction?.recipientNamePath ?? "")
        : getPayloadValue(flatPayload, workflow.qrFlowAction?.recipientNamePath ?? "");
    const rawPhone =
      workflow.channelMode === "api"
        ? getPayloadValue(flatPayload, workflow.templateAction?.recipientPhonePath ?? "")
        : getPayloadValue(flatPayload, workflow.qrFlowAction?.recipientPhonePath ?? "");
    const contactName =
      (workflow.contactAction.contactPaths?.displayNamePath
        ? getPayloadValue(flatPayload, workflow.contactAction.contactPaths.displayNamePath)
        : null) ?? recipientName;
    const contactEmail = workflow.contactAction.contactPaths?.emailPath
      ? getPayloadValue(flatPayload, workflow.contactAction.contactPaths.emailPath)
      : null;
    const rawContactPhone =
      (workflow.contactAction.contactPaths?.phoneNumberPath
        ? getPayloadValue(flatPayload, workflow.contactAction.contactPaths.phoneNumberPath)
        : null) ?? rawPhone;
    const recipientPhone = normalizeWebhookPhoneNumber(rawPhone, workflow.defaultCountryCode);
    const contactPhone = normalizeWebhookPhoneNumber(rawContactPhone, workflow.defaultCountryCode);

    if (!recipientPhone || !contactPhone) {
      await recordGenericWebhookLog({
        userId: integration.userId,
        integrationId: integration.id,
        workflowId: workflow.id,
        requestId: input.requestId,
        status: "skipped",
        customerName: contactName,
        customerPhone: rawContactPhone,
        templateId: workflow.templateAction?.templateId ?? null,
        errorMessage: !recipientPhone
          ? "Recipient phone mapping did not resolve to a valid phone number."
          : "Contact phone mapping did not resolve to a valid phone number.",
        payloadJson: input.payload
      });
      continue;
    }

    let queuedLogId: string | null = null;
    try {
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
        displayName: contactName,
        phoneNumber: contactPhone,
        email: contactEmail,
        tags,
        customFields,
        sourceId: input.requestId,
        sourceUrl: integration.endpointUrlPath
      });

      const variableValues: Record<string, string> = {};
      if (workflow.channelMode === "api") {
        const templateAction = workflow.templateAction;
        if (!templateAction) {
          throw new Error("Template action is missing.");
        }
        for (const [key, binding] of Object.entries(templateAction.variableMappings ?? {})) {
          let resolved: string | null = null;
          if (binding.source === "now" && binding.dateOffset) {
            resolved = applyDateOffset(new Date(), binding.dateOffset);
          } else if (binding.source === "payload") {
            resolved = getPayloadValue(flatPayload, binding.path);
            if (binding.dateOffset && resolved) {
              const parsed = parseDateString(resolved);
              if (parsed) resolved = applyDateOffset(parsed, binding.dateOffset);
            }
          } else if (binding.source === "contact") {
            resolved = resolveContactField(contact, binding.field);
            if (binding.dateOffset && resolved) {
              const parsed = parseDateString(resolved);
              if (parsed) resolved = applyDateOffset(parsed, binding.dateOffset);
            }
          } else if (binding.source === "static") {
            resolved = trimToNull(binding.value);
            if (binding.dateOffset && resolved) {
              const parsed = parseDateString(resolved);
              if (parsed) resolved = applyDateOffset(parsed, binding.dateOffset);
            }
          }
          const value = resolved ?? trimToNull(templateAction.fallbackValues?.[key]);
          if (value) variableValues[key] = value;
        }
      }

      const preparedExecution: PreparedGenericWebhookExecution = {
        userId: integration.userId,
        requestId: input.requestId,
        integrationId: integration.id,
        integrationName: integration.name,
        workflowId: workflow.id,
        workflowName: workflow.name,
        channelMode: workflow.channelMode,
        payloadJson: input.payload,
        recipientName,
        recipientPhone,
        contactName,
        contactPhone,
        contactEmail,
        contactId: contact.id,
        templateId: workflow.templateAction?.templateId ?? null,
        flowId: workflow.qrFlowAction?.flowId ?? null,
        variableValues,
        scheduledAt: calculateScheduledAt(workflow.delayValue ?? 0, workflow.delayUnit ?? null),
        delayValue: workflow.delayValue ?? 0,
        delayUnit: workflow.delayUnit ?? null
      };

      queuedLogId = await recordGenericWebhookLog({
        userId: integration.userId,
        integrationId: integration.id,
        workflowId: workflow.id,
        requestId: input.requestId,
        status: "queued",
        customerName: recipientName ?? contactName,
        customerPhone: recipientPhone,
        contactId: contact.id,
        templateId: preparedExecution.templateId,
        payloadJson: input.payload,
        resultJson: {
          workflowName: workflow.name,
          integrationName: integration.name,
          channelMode: workflow.channelMode,
          contactId: contact.id,
          delayValue: preparedExecution.delayValue,
          delayUnit: preparedExecution.delayUnit,
          scheduledAt: preparedExecution.scheduledAt
        }
      });
      await queueGenericWebhookOutboundMessage({
        userId: integration.userId,
        logId: queuedLogId,
        scheduledAt: preparedExecution.scheduledAt,
        groupingKey: `webhook:${recipientPhone}`,
        payloadJson: preparedExecution as unknown as Record<string, unknown>,
        variableValues: preparedExecution.variableValues
      });
    } catch (error) {
      failedWorkflows += 1;
      const errorMessage = (error as Error).message;
      const resultJson = {
        workflowName: workflow.name,
        integrationName: integration.name,
        channelMode: workflow.channelMode,
        flowId: workflow.qrFlowAction?.flowId ?? null
      };
      if (queuedLogId) {
        await updateGenericWebhookLog({
          logId: queuedLogId,
          status: "failed",
          contactId: null,
          errorMessage,
          resultJson
        });
      } else {
        await recordGenericWebhookLog({
          userId: integration.userId,
          integrationId: integration.id,
          workflowId: workflow.id,
          requestId: input.requestId,
          status: "failed",
          customerName: recipientName,
          customerPhone: recipientPhone,
          templateId: workflow.templateAction?.templateId ?? null,
          errorMessage,
          payloadJson: input.payload,
          resultJson
        });
      }
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

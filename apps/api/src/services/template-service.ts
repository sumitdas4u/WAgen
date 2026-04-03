import { pool } from "../db/pool.js";
import { openAIService } from "./openai-service.js";
import {
  decryptToken,
  graphDelete,
  graphGet,
  graphPost,
  graphPostMedia,
  sendMetaTemplateDirect,
  type GraphListResponse
} from "./meta-whatsapp-service.js";
import type { FlowButtonOption, FlowMessagePayload } from "./outbound-message-types.js";

export type TemplateStatus = "PENDING" | "APPROVED" | "REJECTED" | "PAUSED" | "DISABLED";
export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";
export type TemplateStyle = "normal" | "poetic" | "exciting" | "funny";

export interface TemplateComponentButton {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE" | "FLOW";
  text: string;
  url?: string;
  phone_number?: string;
  example?: string[];
}

export interface TemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION";
  text?: string;
  buttons?: TemplateComponentButton[];
  example?: Record<string, unknown>;
}

export interface CreateTemplatePayload {
  connectionId: string;
  name: string;
  category: TemplateCategory;
  language: string;
  components: TemplateComponent[];
}

export interface GenerateTemplatePayload {
  prompt: string;
  style: TemplateStyle;
}

export interface GeneratedTemplate {
  suggestedName: string;
  suggestedCategory: TemplateCategory;
  components: TemplateComponent[];
}

export interface MessageTemplate {
  id: string;
  userId: string;
  connectionId: string;
  templateId: string | null;
  name: string;
  category: TemplateCategory;
  language: string;
  status: TemplateStatus;
  qualityScore: string | null;
  components: TemplateComponent[];
  metaRejectionReason: string | null;
  linkedNumber: string | null;
  displayPhoneNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MessageTemplateRow {
  id: string;
  user_id: string;
  connection_id: string;
  template_id: string | null;
  name: string;
  category: string;
  language: string;
  status: string;
  quality_score: string | null;
  components_json: TemplateComponent[];
  meta_rejection_reason: string | null;
  linked_number: string | null;
  display_phone_number: string | null;
  created_at: string;
  updated_at: string;
}

interface ConnectionRow {
  id: string;
  waba_id: string;
  phone_number_id: string;
  access_token_encrypted: string;
  display_phone_number: string | null;
  linked_number: string | null;
}

type TemplateMediaFormat = Extract<NonNullable<TemplateComponent["format"]>, "IMAGE" | "VIDEO" | "DOCUMENT">;

export interface TemplateDispatchResult {
  messageId: string | null;
  template: MessageTemplate;
  connection: {
    id: string;
    phoneNumberId: string;
    linkedNumber: string | null;
    displayPhoneNumber: string | null;
  };
  resolvedVariables: Record<string, string>;
  messagePayload: Extract<FlowMessagePayload, { type: "template" }>;
  summaryText: string;
}

export interface ResolvedTemplatePayload {
  components: Array<Record<string, unknown>>;
  resolvedVariables: Record<string, string>;
  messagePayload: Extract<FlowMessagePayload, { type: "template" }>;
  summaryText: string;
}

const PLACEHOLDER_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g;

const STYLE_INSTRUCTIONS: Record<TemplateStyle, string> = {
  normal: "Write in a clear, professional, and friendly tone.",
  poetic: "Write in a warm, poetic, and heartfelt tone with flowing language.",
  exciting: "Write in an energetic, exciting tone using emojis and exclamation marks to build enthusiasm.",
  funny: "Write in a light-hearted, witty, and humorous tone with a friendly joke or pun."
};

function mapTemplate(row: MessageTemplateRow): MessageTemplate {
  return {
    id: row.id,
    userId: row.user_id,
    connectionId: row.connection_id,
    templateId: row.template_id,
    name: row.name,
    category: row.category as TemplateCategory,
    language: row.language,
    status: row.status as TemplateStatus,
    qualityScore: row.quality_score,
    components: row.components_json,
    metaRejectionReason: row.meta_rejection_reason,
    linkedNumber: normalizePhoneDigits(row.linked_number),
    displayPhoneNumber: row.display_phone_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizePhoneDigits(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    return null;
  }
  return digits;
}

function normalizePlaceholderKey(raw: string): string {
  const inner = raw.replace(/^\{\{\s*|\s*\}\}$/g, "").trim();
  return `{{${inner}}}`;
}

function normalizeManualVariableValues(values: Record<string, string>): {
  placeholders: Record<string, string>;
  specials: Record<string, string>;
} {
  const placeholders: Record<string, string> = {};
  const specials: Record<string, string> = {};

  for (const [key, value] of Object.entries(values)) {
    const trimmed = value.trim();
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      continue;
    }

    if (/^\{\{.*\}\}$/.test(normalizedKey) || /^\d+$/.test(normalizedKey)) {
      placeholders[normalizePlaceholderKey(normalizedKey)] = trimmed;
      continue;
    }

    specials[normalizedKey.toLowerCase()] = trimmed;
  }

  return { placeholders, specials };
}

function extractPlaceholders(text: string | null | undefined): string[] {
  if (!text) {
    return [];
  }

  const placeholders: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    placeholders.push(normalizePlaceholderKey(match[0]));
  }
  return Array.from(new Set(placeholders));
}

function fillTemplateText(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER_PATTERN, (match) => values[normalizePlaceholderKey(match)] ?? match);
}

function resolvePlaceholderValue(
  placeholder: string,
  variables: Record<string, string>,
  missing: Set<string>
): string {
  const normalized = normalizePlaceholderKey(placeholder);
  const value = variables[normalized]?.trim();
  if (!value) {
    missing.add(normalized);
    return "";
  }
  return value;
}

function resolveTextParameters(
  text: string,
  variables: Record<string, string>,
  resolvedValues: Record<string, string>,
  missing: Set<string>
): Array<{ type: "text"; text: string }> {
  return extractPlaceholders(text).map((placeholder) => {
    const value = resolvePlaceholderValue(placeholder, variables, missing);
    if (value) {
      resolvedValues[normalizePlaceholderKey(placeholder)] = value;
    }
    return { type: "text", text: value };
  });
}

function getSpecialValue(
  specials: Record<string, string>,
  names: string[]
): string | null {
  for (const name of names) {
    const value = specials[name.toLowerCase()]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function resolveHeaderMediaId(
  component: TemplateComponent,
  specials: Record<string, string>,
  missing: Set<string>
): string {
  const format = component.format as TemplateMediaFormat | undefined;
  if (!format) {
    missing.add("headerMediaId");
    return "";
  }

  const mediaType = format.toLowerCase();
  const explicit =
    getSpecialValue(specials, [
      "headerMediaId",
      "header_media_id",
      `${mediaType}HeaderMediaId`,
      `${mediaType}_header_media_id`,
      `${mediaType}Id`,
      `${mediaType}_id`
    ]) ??
    ((component.example as { header_handle?: string[] } | undefined)?.header_handle?.[0] ?? null);

  if (!explicit?.trim()) {
    missing.add("headerMediaId");
    return "";
  }

  return explicit.trim();
}

function resolveHeaderPreviewUrl(component: TemplateComponent, specials: Record<string, string>): string | undefined {
  const explicit = getSpecialValue(specials, [
    "headerMediaPreviewUrl",
    "header_media_preview_url",
    "headerPreviewUrl",
    "header_preview_url"
  ]);
  if (explicit) {
    return explicit;
  }

  const example = component.example as { header_handle?: string[]; header_url?: string[] } | undefined;
  const candidate = example?.header_url?.[0] ?? example?.header_handle?.[0] ?? null;
  if (candidate && /^https?:\/\//i.test(candidate)) {
    return candidate;
  }
  return undefined;
}

function resolveCouponCode(
  button: TemplateComponentButton,
  variables: Record<string, string>,
  resolvedValues: Record<string, string>,
  missing: Set<string>
): string | null {
  const exampleValue = button.example?.[0]?.trim() ?? "";
  if (!exampleValue) {
    return null;
  }

  const placeholders = extractPlaceholders(exampleValue);
  if (placeholders.length === 0) {
    return exampleValue;
  }

  const [firstPlaceholder] = placeholders;
  if (!firstPlaceholder) {
    return null;
  }

  const value = resolvePlaceholderValue(firstPlaceholder, variables, missing);
  if (value) {
    resolvedValues[normalizePlaceholderKey(firstPlaceholder)] = value;
  }
  return value;
}

export function resolveTemplatePayload(
  template: MessageTemplate,
  variableValues: Record<string, string>
): ResolvedTemplatePayload {
  const { placeholders, specials } = normalizeManualVariableValues(variableValues);
  const resolvedVariables: Record<string, string> = {};
  const missing = new Set<string>();
  const sendComponents: Array<Record<string, unknown>> = [];
  const buttons: FlowButtonOption[] = [];

  let previewText = "";
  let headerText: string | undefined;
  let footerText: string | undefined;
  let headerMediaType: "image" | "video" | "document" | undefined;
  let headerMediaUrl: string | undefined;

  for (const component of template.components) {
    if (component.type === "HEADER") {
      if (component.format === "TEXT" && component.text) {
        const parameters = resolveTextParameters(component.text, placeholders, resolvedVariables, missing);
        if (parameters.length > 0) {
          sendComponents.push({ type: "header", parameters });
        }
        headerText = fillTemplateText(component.text, placeholders);
        continue;
      }

      if (component.format === "IMAGE" || component.format === "VIDEO" || component.format === "DOCUMENT") {
        const mediaId = resolveHeaderMediaId(component, specials, missing);
        const mediaType = component.format.toLowerCase() as "image" | "video" | "document";
        headerMediaType = mediaType;
        headerMediaUrl = resolveHeaderPreviewUrl(component, specials);

        if (mediaId) {
          sendComponents.push({
            type: "header",
            parameters: [
              {
                type: mediaType,
                [mediaType]: {
                  id: mediaId
                }
              }
            ]
          });
        }
      }
      continue;
    }

    if (component.type === "BODY" && component.text) {
      const parameters = resolveTextParameters(component.text, placeholders, resolvedVariables, missing);
      if (parameters.length > 0) {
        sendComponents.push({ type: "body", parameters });
      }
      previewText = fillTemplateText(component.text, placeholders);
      continue;
    }

    if (component.type === "FOOTER" && component.text) {
      footerText = fillTemplateText(component.text, placeholders);
      continue;
    }

    if (component.type !== "BUTTONS") {
      continue;
    }

    (component.buttons ?? []).forEach((button, index) => {
      buttons.push({
        id: `template-button-${index}`,
        label: button.text || `Button ${index + 1}`
      });

      if (button.type === "URL" && button.url) {
        const parameters = resolveTextParameters(button.url, placeholders, resolvedVariables, missing);
        if (parameters.length > 0) {
          sendComponents.push({
            type: "button",
            sub_type: "url",
            index: String(index),
            parameters
          });
        }
        return;
      }

      if (button.type === "COPY_CODE") {
        const couponCode = resolveCouponCode(button, placeholders, resolvedVariables, missing);
        if (couponCode) {
          sendComponents.push({
            type: "button",
            sub_type: "coupon_code",
            index: String(index),
            parameters: [
              {
                type: "coupon_code",
                coupon_code: couponCode
              }
            ]
          });
        }
      }
    });
  }

  if (missing.size > 0) {
    const missingLabels = Array.from(missing).sort();
    throw new Error(`Missing required template variables: ${missingLabels.join(", ")}`);
  }

  const messagePayload: Extract<FlowMessagePayload, { type: "template" }> = {
    type: "template",
    templateName: template.name,
    language: template.language,
    previewText,
    ...(headerText ? { headerText } : {}),
    ...(footerText ? { footerText } : {}),
    ...(buttons.length > 0 ? { buttons } : {}),
    ...(headerMediaType ? { headerMediaType } : {}),
    ...(headerMediaUrl ? { headerMediaUrl } : {})
  };

  const summaryText = previewText || headerText || `[Template: ${template.name}]`;

  return {
    components: sendComponents,
    resolvedVariables,
    messagePayload,
    summaryText
  };
}

async function getConnectionForUser(userId: string, connectionId: string): Promise<ConnectionRow> {
  const result = await pool.query<ConnectionRow>(
    `SELECT id, waba_id, phone_number_id, access_token_encrypted, display_phone_number, linked_number
     FROM whatsapp_business_connections
     WHERE user_id = $1
       AND id = $2
       AND status = 'connected'
     LIMIT 1`,
    [userId, connectionId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Meta connection not found or not active.");
  }
  return row;
}

export async function getMessageTemplate(userId: string, templateId: string): Promise<MessageTemplate> {
  const result = await pool.query<MessageTemplateRow>(
    `SELECT mt.id,
            mt.user_id,
            mt.connection_id,
            mt.template_id,
            mt.name,
            mt.category,
            mt.language,
            mt.status,
            mt.quality_score,
            mt.components_json,
            mt.meta_rejection_reason,
            wbc.linked_number,
            wbc.display_phone_number,
            mt.created_at::text,
            mt.updated_at::text
     FROM message_templates mt
     JOIN whatsapp_business_connections wbc ON wbc.id = mt.connection_id
     WHERE mt.id = $1
       AND mt.user_id = $2
     LIMIT 1`,
    [templateId, userId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Template not found.");
  }
  return mapTemplate(row);
}

export async function listTemplates(
  userId: string,
  options?: { connectionId?: string; status?: TemplateStatus }
): Promise<MessageTemplate[]> {
  const params: unknown[] = [userId];
  let where = "WHERE mt.user_id = $1";

  if (options?.connectionId) {
    params.push(options.connectionId);
    where += ` AND mt.connection_id = $${params.length}`;
  }
  if (options?.status) {
    params.push(options.status);
    where += ` AND mt.status = $${params.length}`;
  }

  const result = await pool.query<MessageTemplateRow>(
    `SELECT mt.id,
            mt.user_id,
            mt.connection_id,
            mt.template_id,
            mt.name,
            mt.category,
            mt.language,
            mt.status,
            mt.quality_score,
            mt.components_json,
            mt.meta_rejection_reason,
            wbc.linked_number,
            wbc.display_phone_number,
            mt.created_at::text,
            mt.updated_at::text
     FROM message_templates mt
     JOIN whatsapp_business_connections wbc ON wbc.id = mt.connection_id
     ${where}
     ORDER BY mt.created_at DESC
     LIMIT 200`,
    params
  );
  return result.rows.map(mapTemplate);
}

export async function createTemplate(
  userId: string,
  payload: CreateTemplatePayload
): Promise<MessageTemplate> {
  const conn = await getConnectionForUser(userId, payload.connectionId);
  const accessToken = decryptToken(conn.access_token_encrypted);

  interface MetaCreateResponse {
    id: string;
    status: string;
    category: string;
  }

  const metaResponse = await graphPost<MetaCreateResponse>(
    `/${conn.waba_id}/message_templates`,
    accessToken,
    {
      name: payload.name,
      language: payload.language,
      category: payload.category,
      components: payload.components
    }
  );

  const result = await pool.query<{ id: string }>(
    `INSERT INTO message_templates
       (user_id, connection_id, template_id, name, category, language, status, components_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING id`,
    [
      userId,
      payload.connectionId,
      metaResponse.id ?? null,
      payload.name,
      (metaResponse.category ?? payload.category).toUpperCase(),
      payload.language,
      (metaResponse.status ?? "PENDING").toUpperCase(),
      JSON.stringify(payload.components)
    ]
  );

  return getMessageTemplate(userId, result.rows[0]!.id);
}

export async function syncAllTemplates(userId: string): Promise<MessageTemplate[]> {
  const connResult = await pool.query<{ connection_id: string }>(
    `SELECT DISTINCT connection_id FROM message_templates WHERE user_id = $1`,
    [userId]
  );

  interface MetaListItem {
    id: string;
    name: string;
    status: string;
    quality_score?: { score?: string };
    rejected_reason?: string;
  }

  for (const { connection_id } of connResult.rows) {
    let conn: ConnectionRow;
    try {
      conn = await getConnectionForUser(userId, connection_id);
    } catch {
      continue;
    }

    const accessToken = decryptToken(conn.access_token_encrypted);

    let metaTemplates: MetaListItem[] = [];
    try {
      const response = await graphGet<GraphListResponse<MetaListItem>>(
        `/${conn.waba_id}/message_templates`,
        accessToken,
        { fields: "id,name,status,quality_score,rejected_reason", limit: 250 }
      );
      metaTemplates = response.data ?? [];
    } catch (error) {
      console.warn(`[Templates] sync failed connection=${connection_id}: ${(error as Error).message}`);
      continue;
    }

    for (const template of metaTemplates) {
      await pool.query(
        `UPDATE message_templates
         SET status = $1,
             quality_score = $2,
             meta_rejection_reason = $3,
             updated_at = NOW()
         WHERE connection_id = $4
           AND template_id = $5
           AND status <> 'DISABLED'`,
        [
          template.status.toUpperCase(),
          template.quality_score?.score ?? null,
          template.rejected_reason ?? null,
          connection_id,
          template.id
        ]
      );
    }
  }

  return listTemplates(userId);
}

export async function deleteTemplate(userId: string, localId: string): Promise<boolean> {
  const rowResult = await pool.query<MessageTemplateRow & { access_token_encrypted: string; waba_id: string }>(
    `SELECT mt.*,
            wbc.access_token_encrypted,
            wbc.waba_id,
            wbc.linked_number,
            wbc.display_phone_number
     FROM message_templates mt
     JOIN whatsapp_business_connections wbc ON wbc.id = mt.connection_id
     WHERE mt.id = $1
       AND mt.user_id = $2
     LIMIT 1`,
    [localId, userId]
  );

  const row = rowResult.rows[0];
  if (!row) {
    return false;
  }

  if (row.template_id) {
    try {
      const accessToken = decryptToken(row.access_token_encrypted);
      await graphDelete(`/${row.template_id}`, accessToken, { hsm_id: row.template_id });
    } catch (error) {
      console.warn(`[Templates] Meta delete failed templateId=${row.template_id}: ${(error as Error).message}`);
    }
  }

  await pool.query(`DELETE FROM message_templates WHERE id = $1 AND user_id = $2`, [localId, userId]);
  return true;
}

export async function applyTemplateWebhookUpdate(event: {
  message_template_id: number | string;
  event: string;
  reason?: string;
}): Promise<void> {
  const metaTemplateId = String(event.message_template_id);
  const newStatus = (event.event ?? "").toUpperCase();

  await pool.query(
    `UPDATE message_templates
     SET status = $1,
         meta_rejection_reason = COALESCE($2, meta_rejection_reason),
         updated_at = NOW()
     WHERE template_id = $3`,
    [newStatus, event.reason ?? null, metaTemplateId]
  );

  console.info(`[TemplateWebhook] status update templateId=${metaTemplateId} status=${newStatus}`);
}

export async function generateTemplateWithAI(
  _userId: string,
  payload: GenerateTemplatePayload
): Promise<GeneratedTemplate> {
  const styleInstruction = STYLE_INSTRUCTIONS[payload.style];

  const systemPrompt = `You are a WhatsApp Business template expert. Return ONLY a valid JSON object with no extra text, markdown, or explanation.

Required shape:
{
  "suggestedName": "<snake_case_name>",
  "suggestedCategory": "MARKETING" | "UTILITY" | "AUTHENTICATION",
  "components": [
    { "type": "HEADER", "format": "TEXT", "text": "..." },
    { "type": "BODY", "text": "..." },
    { "type": "FOOTER", "text": "..." },
    { "type": "BUTTONS", "buttons": [{ "type": "QUICK_REPLY" | "URL" | "PHONE_NUMBER", "text": "...", "url"?: "...", "phone_number"?: "..." }] }
  ]
}

Rules:
- HEADER and FOOTER are optional. BODY is required.
- BODY text max 1024 characters.
- FOOTER text max 60 characters.
- Max 3 buttons total.
- Use {{1}}, {{2}} for dynamic variables in BODY and HEADER text.
- suggestedName must be lowercase with only letters, numbers, and underscores.
- Style: ${styleInstruction}`;

  const userPrompt = `Create a WhatsApp message template for: ${payload.prompt}`;

  const raw = await openAIService.generateJson(systemPrompt, userPrompt);

  const suggestedName =
    typeof raw.suggestedName === "string"
      ? raw.suggestedName.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 60)
      : "ai_template";

  const suggestedCategory =
    raw.suggestedCategory === "UTILITY" || raw.suggestedCategory === "AUTHENTICATION"
      ? (raw.suggestedCategory as TemplateCategory)
      : "MARKETING";

  const components = Array.isArray(raw.components)
    ? (raw.components as TemplateComponent[])
    : [];

  return { suggestedName, suggestedCategory, components };
}

export async function uploadTemplateMedia(
  userId: string,
  connectionId: string,
  fileBuffer: Buffer,
  mimeType: string
): Promise<{ handle: string }> {
  const conn = await getConnectionForUser(userId, connectionId);
  const accessToken = decryptToken(conn.access_token_encrypted);
  const result = await graphPostMedia(conn.phone_number_id, accessToken, fileBuffer, mimeType);
  return { handle: result.id };
}

export async function dispatchTemplateMessage(
  userId: string,
  payload: {
    templateId: string;
    to: string;
    variableValues: Record<string, string>;
    expectedLinkedNumber?: string | null;
  }
): Promise<TemplateDispatchResult> {
  const template = await getMessageTemplate(userId, payload.templateId);
  if (template.status !== "APPROVED") {
    throw new Error("Only approved templates can be sent.");
  }

  const to = normalizePhoneDigits(payload.to);
  if (!to) {
    throw new Error("Phone number must contain 8-15 digits.");
  }

  const connection = await getConnectionForUser(userId, template.connectionId);
  const connectionLinkedNumber =
    normalizePhoneDigits(connection.linked_number) ??
    normalizePhoneDigits(connection.display_phone_number);
  const expectedLinkedNumber = normalizePhoneDigits(payload.expectedLinkedNumber);

  if (expectedLinkedNumber && connectionLinkedNumber && expectedLinkedNumber !== connectionLinkedNumber) {
    throw new Error("Template does not belong to this conversation's connected number.");
  }

  const builtPayload = resolveTemplatePayload(template, payload.variableValues);
  const sent = await sendMetaTemplateDirect({
    userId,
    to,
    phoneNumberId: connection.phone_number_id,
    templateName: template.name,
    language: template.language,
    components: builtPayload.components
  });

  return {
    messageId: sent.messageId,
    template,
    connection: {
      id: connection.id,
      phoneNumberId: connection.phone_number_id,
      linkedNumber: connectionLinkedNumber,
      displayPhoneNumber: connection.display_phone_number
    },
    resolvedVariables: builtPayload.resolvedVariables,
    messagePayload: builtPayload.messagePayload,
    summaryText: builtPayload.summaryText
  };
}

export async function sendTestTemplate(
  userId: string,
  payload: { templateId: string; to: string; variableValues: Record<string, string> }
): Promise<{ messageId: string | null }> {
  const result = await dispatchTemplateMessage(userId, payload);
  return { messageId: result.messageId };
}

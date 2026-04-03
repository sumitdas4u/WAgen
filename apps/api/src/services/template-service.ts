import { pool } from "../db/pool.js";
import { openAIService } from "./openai-service.js";
import {
  decryptToken,
  graphDelete,
  graphGet,
  graphPost,
  graphPostMedia,
  type GraphListResponse
} from "./meta-whatsapp-service.js";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  createdAt: string;
  updatedAt: string;
}

// ─── Internal DB row type ─────────────────────────────────────────────────────

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
  created_at: string;
  updated_at: string;
}

interface ConnectionRow {
  id: string;
  waba_id: string;
  phone_number_id: string;
  access_token_encrypted: string;
  display_phone_number: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getConnectionForUser(userId: string, connectionId: string): Promise<ConnectionRow> {
  const result = await pool.query<ConnectionRow>(
    `SELECT id, waba_id, phone_number_id, access_token_encrypted, display_phone_number
     FROM whatsapp_business_connections
     WHERE user_id = $1 AND id = $2 AND status = 'connected'
     LIMIT 1`,
    [userId, connectionId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Meta connection not found or not active.");
  }
  return row;
}

const STYLE_INSTRUCTIONS: Record<TemplateStyle, string> = {
  normal: "Write in a clear, professional, and friendly tone.",
  poetic: "Write in a warm, poetic, and heartfelt tone with flowing language.",
  exciting: "Write in an energetic, exciting tone using emojis and exclamation marks to build enthusiasm.",
  funny: "Write in a light-hearted, witty, and humorous tone with a friendly joke or pun."
};

// ─── Service functions ────────────────────────────────────────────────────────

export async function listTemplates(
  userId: string,
  options?: { connectionId?: string; status?: TemplateStatus }
): Promise<MessageTemplate[]> {
  const params: unknown[] = [userId];
  let where = "WHERE user_id = $1";

  if (options?.connectionId) {
    params.push(options.connectionId);
    where += ` AND connection_id = $${params.length}`;
  }
  if (options?.status) {
    params.push(options.status);
    where += ` AND status = $${params.length}`;
  }

  const result = await pool.query<MessageTemplateRow>(
    `SELECT id, user_id, connection_id, template_id, name, category, language,
            status, quality_score, components_json, meta_rejection_reason,
            created_at::text, updated_at::text
     FROM message_templates
     ${where}
     ORDER BY created_at DESC
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

  const result = await pool.query<MessageTemplateRow>(
    `INSERT INTO message_templates
       (user_id, connection_id, template_id, name, category, language, status, components_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING id, user_id, connection_id, template_id, name, category, language,
               status, quality_score, components_json, meta_rejection_reason,
               created_at::text, updated_at::text`,
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

  return mapTemplate(result.rows[0]!);
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
    } catch (err) {
      console.warn(`[Templates] sync failed connection=${connection_id}: ${(err as Error).message}`);
      continue;
    }

    for (const t of metaTemplates) {
      await pool.query(
        `UPDATE message_templates
         SET status = $1, quality_score = $2, meta_rejection_reason = $3, updated_at = NOW()
         WHERE connection_id = $4 AND template_id = $5 AND status <> 'DISABLED'`,
        [
          t.status.toUpperCase(),
          t.quality_score?.score ?? null,
          t.rejected_reason ?? null,
          connection_id,
          t.id
        ]
      );
    }
  }

  return listTemplates(userId);
}

export async function deleteTemplate(userId: string, localId: string): Promise<boolean> {
  const rowResult = await pool.query<MessageTemplateRow & { access_token_encrypted: string; waba_id: string }>(
    `SELECT mt.*, wbc.access_token_encrypted, wbc.waba_id
     FROM message_templates mt
     JOIN whatsapp_business_connections wbc ON wbc.id = mt.connection_id
     WHERE mt.id = $1 AND mt.user_id = $2
     LIMIT 1`,
    [localId, userId]
  );

  const row = rowResult.rows[0];
  if (!row) return false;

  if (row.template_id) {
    try {
      const accessToken = decryptToken(row.access_token_encrypted);
      await graphDelete(`/${row.template_id}`, accessToken, { hsm_id: row.template_id });
    } catch (err) {
      console.warn(`[Templates] Meta delete failed templateId=${row.template_id}: ${(err as Error).message}`);
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

// ─── Test-send ────────────────────────────────────────────────────────────────

function buildSendComponents(
  components: TemplateComponent[],
  variableValues: Record<string, string>
): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];

  for (const comp of components) {
    if (comp.type === "HEADER") {
      const handle =
        (comp.example as { header_handle?: string[] } | undefined)?.header_handle?.[0];
      if (comp.format === "IMAGE" && handle) {
        result.push({ type: "header", parameters: [{ type: "image", image: { id: handle } }] });
      } else if (comp.format === "VIDEO" && handle) {
        result.push({ type: "header", parameters: [{ type: "video", video: { id: handle } }] });
      } else if (comp.format === "DOCUMENT" && handle) {
        result.push({ type: "header", parameters: [{ type: "document", document: { id: handle } }] });
      }
      // TEXT headers are static — no parameters needed
    } else if (comp.type === "BODY" && comp.text) {
      const uniqueVars = [...new Set([...comp.text.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[0]))];
      if (uniqueVars.length > 0) {
        result.push({
          type: "body",
          parameters: uniqueVars.map((v) => ({
            type: "text",
            text: variableValues[v] || v.replace(/\{\{|\}\}/g, "")
          }))
        });
      }
    } else if (comp.type === "BUTTONS") {
      (comp.buttons ?? []).forEach((btn, idx) => {
        if (btn.type === "COPY_CODE" && btn.example?.[0]) {
          result.push({
            type: "button",
            sub_type: "coupon_code",
            index: String(idx),
            parameters: [{ type: "coupon_code", coupon_code: btn.example[0] }]
          });
        }
      });
    }
  }

  return result;
}

export async function sendTestTemplate(
  userId: string,
  payload: { templateId: string; to: string; variableValues: Record<string, string> }
): Promise<{ messageId: string | null }> {
  const rows = await pool.query<MessageTemplateRow>(
    `SELECT id, user_id, connection_id, template_id, name, category, language,
            status, quality_score, components_json, meta_rejection_reason,
            created_at::text, updated_at::text
     FROM message_templates WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [payload.templateId, userId]
  );
  const row = rows.rows[0];
  if (!row) throw new Error("Template not found.");

  const template = mapTemplate(row);

  const digits = payload.to.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    throw new Error("Phone number must contain 8–15 digits.");
  }

  const conn = await getConnectionForUser(userId, template.connectionId);
  const accessToken = decryptToken(conn.access_token_encrypted);
  const sendComponents = buildSendComponents(template.components, payload.variableValues);

  const response = await graphPost<{ messages?: Array<{ id?: string }> }>(
    `/${conn.phone_number_id}/messages`,
    accessToken,
    {
      messaging_product: "whatsapp",
      to: digits,
      type: "template",
      template: {
        name: template.name,
        language: { code: template.language },
        ...(sendComponents.length > 0 ? { components: sendComponents } : {})
      }
    }
  );

  return { messageId: response.messages?.[0]?.id ?? null };
}

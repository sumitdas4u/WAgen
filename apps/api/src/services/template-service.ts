import { pool } from "../db/pool.js";
import { openAIService } from "./openai-service.js";
import {
  decryptToken,
  graphDelete,
  graphGet,
  graphPost,
  graphStartUploadSession,
  graphUploadFileHandle,
  sendMetaTemplateDirect,
  type GraphListResponse
} from "./meta-whatsapp-service.js";
import { env } from "../config/env.js";
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
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;
const TEMPLATE_HEADER_SAMPLE_MIME_TYPES: Record<TemplateMediaFormat, ReadonlySet<string>> = {
  IMAGE: new Set(["image/jpeg", "image/png"]),
  VIDEO: new Set(["video/mp4"]),
  DOCUMENT: new Set(["application/pdf"])
};
const TEMPLATE_HEADER_SAMPLE_HELP: Record<TemplateMediaFormat, string> = {
  IMAGE: "JPG or PNG",
  VIDEO: "MP4",
  DOCUMENT: "PDF"
};

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

function isPositiveIntegerToken(value: string): boolean {
  return /^[1-9]\d*$/.test(value.trim());
}

function listPlaceholders(text: string | null | undefined): string[] {
  if (!text) {
    return [];
  }
  return [...text.matchAll(PLACEHOLDER_PATTERN)].map((match) => normalizePlaceholderKey(match[0]));
}

function validateSequentialNumericPlaceholders(placeholders: string[]): string[] {
  const numericValues = placeholders
    .map((placeholder) => placeholder.replace(/^\{\{|\}\}$/g, "").trim())
    .filter((value) => isPositiveIntegerToken(value))
    .map((value) => Number(value))
    .sort((left, right) => left - right);

  const errors: string[] = [];
  for (let index = 0; index < numericValues.length; index += 1) {
    const expected = index + 1;
    if (numericValues[index] !== expected) {
      errors.push(`Template variables must be numbered sequentially as {{1}}, {{2}}, {{3}} with no gaps. Missing {{${expected}}}.`);
      break;
    }
  }
  return errors;
}

function validateCreateTemplatePayload(payload: CreateTemplatePayload): void {
  if (payload.category === "AUTHENTICATION") {
    throw new Error(
      "Authentication templates need Meta's dedicated authentication-template format and are not supported in this builder yet."
    );
  }

  const errors: string[] = [];
  const placeholders: string[] = [];
  let hasBody = false;

  for (const component of payload.components) {
    if (component.type === "HEADER") {
      if (component.format === "LOCATION") {
        errors.push("Location headers are not supported in this template builder yet.");
      }
      if (component.format === "TEXT" && component.text) {
        placeholders.push(...listPlaceholders(component.text));
      }
      if ((component.format === "IMAGE" || component.format === "VIDEO" || component.format === "DOCUMENT") && !component.example) {
        errors.push(`Header ${component.format.toLowerCase()} templates need a sample file before submission.`);
      }
      continue;
    }

    if (component.type === "BODY" && component.text) {
      hasBody = true;
      placeholders.push(...listPlaceholders(component.text));
      continue;
    }

    if (component.type === "FOOTER" && component.text) {
      if (/[\r\n]/.test(component.text)) {
        errors.push("Footer text must stay on a single line.");
      }
      if (listPlaceholders(component.text).length > 0) {
        errors.push("Footer text cannot contain template variables. Move dynamic values into the body instead.");
      }
      if (EMOJI_PATTERN.test(component.text)) {
        errors.push("Footer text cannot contain emojis. Remove the emoji from the footer and try again.");
      }
      continue;
    }

    if (component.type !== "BUTTONS") {
      continue;
    }

    for (const [index, button] of (component.buttons ?? []).entries()) {
      if (!button.text.trim()) {
        errors.push(`Button ${index + 1} is missing its label.`);
      }
      if (button.type === "URL") {
        if (!button.url?.trim()) {
          errors.push(`URL button ${index + 1} needs a destination URL.`);
        }
        if (button.url) {
          placeholders.push(...listPlaceholders(button.url));
        }
      }
      if (button.type === "PHONE_NUMBER" && !button.phone_number?.trim()) {
        errors.push(`Phone button ${index + 1} needs a phone number.`);
      }
      if (button.type === "PHONE_NUMBER" && button.phone_number?.trim()) {
        const phoneError = validateTemplatePhoneNumber(button.phone_number);
        if (phoneError) {
          errors.push(`Phone button ${index + 1}: ${phoneError}`);
        }
      }
    }
  }

  if (!hasBody) {
    errors.push("Template body text is required.");
  }

  const invalidPlaceholders = placeholders.filter((placeholder) => {
    const token = placeholder.replace(/^\{\{|\}\}$/g, "").trim();
    return !isPositiveIntegerToken(token);
  });
  if (invalidPlaceholders.length > 0) {
    errors.push(
      `Use numbered variables like {{1}}, {{2}}, {{3}}. Invalid variable(s): ${Array.from(new Set(invalidPlaceholders)).join(", ")}.`
    );
  }

  errors.push(...validateSequentialNumericPlaceholders(Array.from(new Set(placeholders))));

  if (errors.length > 0) {
    throw new Error(errors[0]!);
  }
}

function trimExampleString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => trimExampleString(item))
    .filter((item): item is string => Boolean(item));
}

function normalizeBodyExampleRows(example: Record<string, unknown> | undefined): string[][] {
  const raw = example?.body_text;
  if (!Array.isArray(raw)) {
    return [];
  }

  if (raw.every((item) => typeof item === "string")) {
    const row = normalizeStringList(raw);
    return row.length > 0 ? [row] : [];
  }

  return raw
    .filter((item): item is unknown[] => Array.isArray(item))
    .map((item) => normalizeStringList(item))
    .filter((row) => row.length > 0);
}

function normalizeHeaderTextExample(example: Record<string, unknown> | undefined): string[] {
  return normalizeStringList(example?.header_text);
}

function normalizeHeaderHandleExample(example: Record<string, unknown> | undefined): string[] {
  return normalizeStringList(example?.header_handle);
}

function normalizeButtonExampleValues(button: TemplateComponentButton): string[] {
  return normalizeStringList(button.example);
}

function normalizeTemplatePhoneNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return `+${trimmed.replace(/\D/g, "")}`;
}

function validateTemplatePhoneNumber(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Please fill the phone number for this phone button.";
  }
  if (!trimmed.startsWith("+")) {
    return "Phone buttons must use international format with country code, for example +919804735837.";
  }
  const normalized = normalizeTemplatePhoneNumber(trimmed);
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    return "Phone buttons must use a valid international number with 8 to 15 digits, for example +919804735837.";
  }
  return null;
}

function decodeTemplateHandleSegment(value: string): string | null {
  if (!/^[A-Za-z0-9+/=]+$/.test(value)) {
    return null;
  }
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8").trim();
    return decoded && /^[\x20-\x7E]+$/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function inspectTemplateHeaderHandle(handle: string): {
  isUrl: boolean;
  mimeType: string | null;
} {
  const trimmed = handle.trim();
  if (!trimmed) {
    return { isUrl: false, mimeType: null };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return { isUrl: true, mimeType: null };
  }

  const segments = trimmed.split(":");
  if (segments.length < 3) {
    return { isUrl: false, mimeType: null };
  }

  return {
    isUrl: false,
    mimeType: decodeTemplateHandleSegment(segments[2] ?? "")
  };
}

function buildTemplateExampleValue(
  placeholder: string,
  provided: string | null | undefined
): string {
  return provided?.trim() || placeholder.replace(/^\{\{|\}\}$/g, "").trim();
}

function normalizeCreateTemplateComponents(components: TemplateComponent[]): TemplateComponent[] {
  const normalized: TemplateComponent[] = [];
  const errors: string[] = [];
  const quickReplyButtons: TemplateComponentButton[] = [];
  const ctaButtons: TemplateComponentButton[] = [];
  const couponButtons: TemplateComponentButton[] = [];
  let hasBody = false;

  for (const component of components) {
    if (component.type === "HEADER") {
      const format = component.format;
      if (!format) {
        errors.push("Header format is required when a header is included.");
        continue;
      }

      if (format === "LOCATION") {
        errors.push("Location headers are not supported in this template builder yet.");
        continue;
      }

      if (format === "TEXT") {
        const text = component.text?.trim() ?? "";
        if (!text) {
          errors.push("Header text is empty.");
          continue;
        }

        const placeholders = listPlaceholders(text);
        if (placeholders.length === 0) {
          normalized.push({ type: "HEADER", format: "TEXT", text });
          continue;
        }

        const examples = normalizeHeaderTextExample(component.example).slice(0, placeholders.length);
        if (examples.length !== placeholders.length) {
          errors.push("Header text variables need sample values for Meta review.");
          continue;
        }

        normalized.push({
          type: "HEADER",
          format: "TEXT",
          text,
          example: {
            header_text: placeholders.map((placeholder, index) =>
              buildTemplateExampleValue(placeholder, examples[index] ?? null)
            )
          }
        });
        continue;
      }

      if (format === "IMAGE" || format === "VIDEO" || format === "DOCUMENT") {
        const handles = normalizeHeaderHandleExample(component.example);
        if (handles.length === 0) {
          errors.push(`Header ${format.toLowerCase()} templates need a sample file handle before submission.`);
          continue;
        }

        const handle = handles[0]!;
        const handleInfo = inspectTemplateHeaderHandle(handle);
        if (handleInfo.isUrl) {
          errors.push(
            `Header ${format.toLowerCase()} templates must use the Meta sample handle returned by Upload Sample Media. Public URLs are not accepted here.`
          );
          continue;
        }

        const allowedMimeTypes = TEMPLATE_HEADER_SAMPLE_MIME_TYPES[format];
        if (handleInfo.mimeType && !allowedMimeTypes.has(handleInfo.mimeType)) {
          errors.push(
            `Header ${format.toLowerCase()} templates currently support ${TEMPLATE_HEADER_SAMPLE_HELP[format]} sample files only. Upload a fresh ${TEMPLATE_HEADER_SAMPLE_HELP[format]} file and try again.`
          );
          continue;
        }

        normalized.push({
          type: "HEADER",
          format,
          example: {
            header_handle: [handle]
          }
        });
        continue;
      }
    }

    if (component.type === "BODY") {
      const text = component.text?.trim() ?? "";
      if (!text) {
        errors.push("Template body text is required.");
        continue;
      }

      hasBody = true;
      const placeholders = listPlaceholders(text);
      if (placeholders.length === 0) {
        normalized.push({ type: "BODY", text });
        continue;
      }

      const rows = normalizeBodyExampleRows(component.example);
      const firstRow = rows[0] ?? [];
      if (firstRow.length !== placeholders.length) {
        errors.push("Body variables need sample values for Meta review.");
        continue;
      }

      normalized.push({
        type: "BODY",
        text,
        example: {
          body_text: [
            placeholders.map((placeholder, index) =>
              buildTemplateExampleValue(placeholder, firstRow[index] ?? null)
            )
          ]
        }
      });
      continue;
    }

    if (component.type === "FOOTER") {
      const text = component.text?.trim() ?? "";
      if (!text) {
        continue;
      }
      normalized.push({ type: "FOOTER", text });
      continue;
    }

    if (component.type !== "BUTTONS") {
      continue;
    }

    for (const [index, button] of (component.buttons ?? []).entries()) {
      const text = button.text.trim();
      if (!text) {
        errors.push(`Button ${index + 1} is missing its label.`);
        continue;
      }

      if (button.type === "FLOW") {
        errors.push("Flow buttons are not supported in this template builder yet.");
        continue;
      }

      if (button.type === "QUICK_REPLY") {
        quickReplyButtons.push({ type: "QUICK_REPLY", text });
        continue;
      }

      if (button.type === "URL") {
        const url = button.url?.trim() ?? "";
        if (!url) {
          errors.push(`URL button ${index + 1} needs a destination URL.`);
          continue;
        }

        const placeholders = listPlaceholders(url);
        if (placeholders.length > 1) {
          errors.push(`URL button ${index + 1} can only use one variable in its URL.`);
          continue;
        }
        if (placeholders.length === 1 && !url.endsWith(placeholders[0]!)) {
          errors.push(`Dynamic URL button ${index + 1} must place its variable at the end of the URL.`);
          continue;
        }

        const normalizedButton: TemplateComponentButton = {
          type: "URL",
          text,
          url
        };

        if (placeholders.length === 1) {
          const examples = normalizeButtonExampleValues(button);
          if (examples.length === 0) {
            errors.push(`URL button ${index + 1} needs a sample value for its dynamic URL variable.`);
            continue;
          }
          normalizedButton.example = [
            buildTemplateExampleValue(placeholders[0]!, examples[0] ?? null)
          ];
        }

        ctaButtons.push(normalizedButton);
        continue;
      }

      if (button.type === "PHONE_NUMBER") {
        const rawPhone = button.phone_number ?? "";
        const phoneError = validateTemplatePhoneNumber(rawPhone);
        if (phoneError) {
          errors.push(`Phone button ${index + 1}: ${phoneError}`);
          continue;
        }
        const phone = normalizeTemplatePhoneNumber(rawPhone);

        ctaButtons.push({
          type: "PHONE_NUMBER",
          text,
          phone_number: phone
        });
        continue;
      }

      if (button.type === "COPY_CODE") {
        const examples = normalizeButtonExampleValues(button);
        if (examples.length === 0) {
          errors.push(`Coupon code button ${index + 1} needs a sample coupon code.`);
          continue;
        }

        couponButtons.push({
          type: "COPY_CODE",
          text,
          example: [examples[0]!]
        });
      }
    }
  }

  if (!hasBody) {
    errors.push("Template body text is required.");
  }
  if (quickReplyButtons.length > 3) {
    errors.push("Quick reply templates can include at most 3 quick reply buttons.");
  }
  if (ctaButtons.filter((button) => button.type === "URL").length > 2) {
    errors.push("Templates can include at most 2 URL buttons.");
  }
  if (ctaButtons.filter((button) => button.type === "PHONE_NUMBER").length > 1) {
    errors.push("Templates can include at most 1 phone button.");
  }
  if (couponButtons.length > 1) {
    errors.push("Templates can include at most 1 coupon code button.");
  }

  const combinedButtons = [...quickReplyButtons, ...ctaButtons, ...couponButtons];
  if (combinedButtons.length > 0) {
    normalized.push({
      type: "BUTTONS",
      buttons: combinedButtons
    });
  }

  if (errors.length > 0) {
    throw new Error(errors[0]!);
  }

  return normalized;
}

function improveTemplateCreateErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "Failed to create template.");
  const buttonFieldMatch = message.match(/components\[(\d+)\]\['buttons'\]\[(\d+)\]\['([^']+)'\]/i);
  if (buttonFieldMatch) {
    const buttonIndex = Number(buttonFieldMatch[2]) + 1;
    const field = buttonFieldMatch[3]?.toLowerCase();
    if (field === "phone_number") {
      return `Phone button ${buttonIndex} must use a valid international number with country code, for example +919804735837.`;
    }
    if (field === "url") {
      return `URL button ${buttonIndex} has an invalid URL. Use a full URL that starts with https:// and keep any variable at the end.`;
    }
    if (field === "text") {
      return `Button ${buttonIndex} has invalid text. Keep button labels short and fill every required field before submitting.`;
    }
  }
  const componentFieldMatch = message.match(/components\[(\d+)\]\['([^']+)'\]/i);
  if (componentFieldMatch) {
    const field = componentFieldMatch[2]?.toLowerCase();
    if (field === "text") {
      return "One of the template text fields is invalid. Review the header, body, and footer text and try again.";
    }
    if (field === "example") {
      return "Meta rejected the sample example data for this template. Fill every variable example and re-upload media samples from WAgen before submitting.";
    }
  }
  if (/\bsubcode=2388273\b/i.test(message)) {
    return `${message} Meta rejected the media sample reference. Upload the sample file in WAgen and use the returned Meta header handle; public URLs are not accepted for template media headers.`;
  }
  if (/\bsubcode=2388084\b/i.test(message)) {
    return `${message} Meta rejected the uploaded media sample for this header type. Use JPG or PNG for image headers, MP4 for video headers, and PDF for document headers.`;
  }
  if (/\bcode=192\b/i.test(message) && /phone number/i.test(message)) {
    return "Meta rejected the phone button number. Use a full international number with country code, for example +919804735837.";
  }
  if (!/\bcode=131009\b/i.test(message) && !/\bcode=100\b/i.test(message)) {
    return message;
  }

  return `${message} Meta rejected this template structure. Common causes are using a media ID instead of a template sample handle, missing header/body example values for variables, or missing example values for a dynamic URL or coupon-code button.`;
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
  validateCreateTemplatePayload(payload);
  const normalizedComponents = normalizeCreateTemplateComponents(payload.components);

  const conn = await getConnectionForUser(userId, payload.connectionId);
  const accessToken = decryptToken(conn.access_token_encrypted);

  interface MetaCreateResponse {
    id: string;
    status: string;
    category: string;
  }

  let metaResponse: MetaCreateResponse;
  try {
    metaResponse = await graphPost<MetaCreateResponse>(
      `/${conn.waba_id}/message_templates`,
      accessToken,
      {
        name: payload.name,
        language: payload.language,
        category: payload.category,
        components: normalizedComponents
      }
    );
  } catch (error) {
    throw new Error(improveTemplateCreateErrorMessage(error));
  }

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
      JSON.stringify(normalizedComponents)
    ]
  );

  return getMessageTemplate(userId, result.rows[0]!.id);
}

export async function syncAllTemplates(userId: string): Promise<MessageTemplate[]> {
  const connResult = await pool.query<{ connection_id: string }>(
    `SELECT id AS connection_id
     FROM whatsapp_business_connections
     WHERE user_id = $1
       AND status = 'connected'`,
    [userId]
  );

  interface MetaListItem {
    id: string;
    name: string;
    language?: string;
    category?: string;
    status: string;
    components?: TemplateComponent[];
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
        { fields: "id,name,language,category,status,components,quality_score,rejected_reason", limit: 250 }
      );
      metaTemplates = response.data ?? [];
    } catch (error) {
      console.warn(`[Templates] sync failed connection=${connection_id}: ${(error as Error).message}`);
      continue;
    }

    for (const template of metaTemplates) {
      await pool.query(
        `INSERT INTO message_templates
           (user_id, connection_id, template_id, name, category, language, status, quality_score, components_json, meta_rejection_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
         ON CONFLICT (connection_id, name, language)
           WHERE status <> 'DISABLED'
         DO UPDATE SET
           template_id = EXCLUDED.template_id,
           category = EXCLUDED.category,
           status = EXCLUDED.status,
           quality_score = EXCLUDED.quality_score,
           components_json = CASE
             WHEN jsonb_typeof(EXCLUDED.components_json) = 'array' AND jsonb_array_length(EXCLUDED.components_json) > 0
               THEN EXCLUDED.components_json
             ELSE message_templates.components_json
           END,
           meta_rejection_reason = EXCLUDED.meta_rejection_reason,
           updated_at = NOW()`,
        [
          userId,
          connection_id,
          template.id,
          template.name,
          (template.category ?? "MARKETING").toUpperCase(),
          template.language ?? "en_US",
          template.status.toUpperCase(),
          template.quality_score?.score ?? null,
          JSON.stringify(Array.isArray(template.components) ? template.components : []),
          template.rejected_reason ?? null
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
  mimeType: string,
  fileName?: string | null
): Promise<{ handle: string }> {
  if (!env.META_APP_ID?.trim()) {
    throw new Error("Meta app configuration is missing. Set META_APP_ID before uploading template media.");
  }
  const conn = await getConnectionForUser(userId, connectionId);
  const accessToken = decryptToken(conn.access_token_encrypted);
  const resolvedExtension = mimeType.split("/")[1] ?? "bin";
  const uploadSession = await graphStartUploadSession(env.META_APP_ID.trim(), accessToken, {
    fileName: fileName?.trim() || `template-sample.${resolvedExtension}`,
    fileLength: fileBuffer.byteLength,
    fileType: mimeType
  });
  const result = await graphUploadFileHandle(uploadSession.id, accessToken, fileBuffer, mimeType);
  return { handle: result.h };
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

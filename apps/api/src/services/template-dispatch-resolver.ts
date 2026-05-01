import type { FlowButtonOption, FlowMessagePayload } from "./outbound-message-types.js";
import type { MessageTemplate, TemplateComponent, TemplateComponentButton } from "./template-service.js";

export interface ResolvedTemplatePayload {
  components: Array<Record<string, unknown>>;
  resolvedVariables: Record<string, string>;
  messagePayload: Extract<FlowMessagePayload, { type: "template" }>;
  summaryText: string;
}

type TemplateMediaFormat = Extract<NonNullable<TemplateComponent["format"]>, "IMAGE" | "VIDEO" | "DOCUMENT">;

const PLACEHOLDER_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g;

function normalizePlaceholderKey(raw: string): string {
  const match = raw.match(/\{\{\s*([^}]+?)\s*\}\}/);
  const source = match?.[1] ?? raw;
  return source.trim().toLowerCase();
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

function getSpecialValue(specials: Record<string, string>, names: string[]): string | null {
  for (const name of names) {
    const value = specials[name.toLowerCase()]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function resolveHeaderMediaReference(
  component: TemplateComponent,
  specials: Record<string, string>,
  defaultMediaUrl?: string | null
): { kind: "id" | "link"; value: string } | null {
  const format = component.format as TemplateMediaFormat | undefined;
  if (!format) {
    return null;
  }

  const mediaType = format.toLowerCase();
  const explicitId = getSpecialValue(specials, [
    "headerMediaId",
    "header_media_id",
    `${mediaType}HeaderMediaId`,
    `${mediaType}_header_media_id`,
    `${mediaType}Id`,
    `${mediaType}_id`
  ]);
  const explicitUrl = getSpecialValue(specials, [
    "headerMediaUrl",
    "header_media_url",
    `${mediaType}HeaderMediaUrl`,
    `${mediaType}_header_media_url`,
    `${mediaType}Url`,
    `${mediaType}_url`,
    "headerMediaPreviewUrl",
    "header_media_preview_url",
    "headerPreviewUrl",
    "header_preview_url"
  ]);
  const example = component.example as { header_handle?: string[]; header_url?: string[] } | undefined;
  // example.header_handle is a Meta template submission handle (e.g. "2:base64:base64"),
  // valid only for template creation review — NOT a usable media reference for sending messages.
  // Fall back to: explicit override → template default → example header_url (never the handle).
  const fallback = explicitId ?? explicitUrl ?? defaultMediaUrl ?? example?.header_url?.[0] ?? null;

  // No URL/ID found — return null without marking as missing.
  // Meta already stores the approved image for static image headers; omitting the header
  // component from the send request causes Meta to use it automatically.
  if (!fallback?.trim()) {
    return null;
  }

  const trimmed = fallback.trim();
  return /^https?:\/\//i.test(trimmed)
    ? { kind: "link", value: trimmed }
    : { kind: "id", value: trimmed };
}

function resolveHeaderPreviewUrl(component: TemplateComponent, specials: Record<string, string>): string | undefined {
  const explicit = getSpecialValue(specials, [
    "headerMediaUrl",
    "header_media_url",
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
        const mediaReference = resolveHeaderMediaReference(component, specials, template.headerMediaUrl);
        const mediaType = component.format.toLowerCase() as "image" | "video" | "document";
        headerMediaType = mediaType;
        headerMediaUrl = resolveHeaderPreviewUrl(component, specials) ?? template.headerMediaUrl ?? undefined;

        if (!headerMediaUrl && mediaReference?.kind === "link") {
          headerMediaUrl = mediaReference.value;
        }

        if (mediaReference) {
          sendComponents.push({
            type: "header",
            parameters: [
              {
                type: mediaType,
                [mediaType]: {
                  [mediaReference.kind]: mediaReference.value
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
    resolvedVariables: {
      ...resolvedVariables,
      ...specials,
      ...(headerMediaUrl ? { headerMediaUrl } : {})
    },
    messagePayload,
    summaryText
  };
}

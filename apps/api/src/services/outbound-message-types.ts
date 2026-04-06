export interface FlowButtonOption {
  id: string;
  label: string;
}

export interface FlowListRow {
  id: string;
  title: string;
  description?: string;
}

export interface FlowListSection {
  title: string;
  rows: FlowListRow[];
}

export type FlowDeliveryChannel = "web" | "baileys" | "api_whatsapp";
export type FlowRendererMessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "file"
  | "buttons"
  | "list"
  | "template"
  | "location"
  | "contact"
  | "poll"
  | "unsupported";

export type FlowMessagePayload =
  | { type: "text"; text: string }
  | {
      type: "media";
      mediaType: "image" | "video" | "document" | "audio";
      url: string;
      caption?: string;
    }
  | { type: "text_buttons"; text: string; footer?: string; buttons: FlowButtonOption[] }
  | {
      type: "media_buttons";
      mediaType: "image" | "video" | "document";
      url: string;
      caption?: string;
      buttons: FlowButtonOption[];
    }
  | { type: "list"; text: string; buttonLabel: string; sections: FlowListSection[] }
  | {
      type: "template";
      templateName: string;
      language: string;
      previewText?: string;
      headerText?: string;
      footerText?: string;
      headerMediaType?: "image" | "video" | "document";
      headerMediaUrl?: string;
      buttons?: FlowButtonOption[];
      components?: Array<Record<string, unknown>>;
    }
  | { type: "product"; catalogId: string; productId: string; bodyText?: string }
  | {
      type: "product_list";
      catalogId: string;
      bodyText?: string;
      sections: Array<{ title: string; productIds: string[] }>;
    }
  | {
      type: "location_share";
      latitude: number;
      longitude: number;
      name?: string;
      address?: string;
    }
  | {
      type: "contact_share";
      name: string;
      phone: string;
      org?: string;
    }
  | {
      type: "poll";
      question: string;
      options: string[];
      allowMultiple?: boolean;
    };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateButtons(buttons: FlowButtonOption[], payloadType: string): void {
  if (!Array.isArray(buttons) || buttons.length === 0) {
    throw new Error(`${payloadType} requires at least one button.`);
  }
  for (const button of buttons) {
    if (!isNonEmptyString(button.id) || !isNonEmptyString(button.label)) {
      throw new Error(`${payloadType} buttons require id and label.`);
    }
  }
}

function validateListSections(sections: FlowListSection[]): void {
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error("list requires at least one section.");
  }

  let hasRows = false;
  for (const section of sections) {
    if (!Array.isArray(section.rows) || section.rows.length === 0) {
      continue;
    }
    for (const row of section.rows) {
      if (!isNonEmptyString(row.id) || !isNonEmptyString(row.title)) {
        throw new Error("list rows require id and title.");
      }
      hasRows = true;
    }
  }

  if (!hasRows) {
    throw new Error("list requires at least one row.");
  }
}

function validateProductSections(
  sections: Array<{ title: string; productIds: string[] }>
): void {
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error("product_list requires at least one section.");
  }

  let hasProducts = false;
  for (const section of sections) {
    if (!Array.isArray(section.productIds) || section.productIds.length === 0) {
      continue;
    }
    for (const productId of section.productIds) {
      if (!isNonEmptyString(productId)) {
        throw new Error("product_list productIds must be non-empty.");
      }
      hasProducts = true;
    }
  }

  if (!hasProducts) {
    throw new Error("product_list requires at least one product id.");
  }
}

export function validateFlowMessagePayload(payload: FlowMessagePayload): FlowMessagePayload {
  if (!payload || typeof payload !== "object" || !isNonEmptyString(payload.type)) {
    throw new Error("Message payload type is required.");
  }

  switch (payload.type) {
    case "text":
      if (!isNonEmptyString(payload.text)) {
        throw new Error("text payload requires text.");
      }
      return payload;

    case "media":
      if (!isNonEmptyString(payload.url)) {
        throw new Error("media payload requires url.");
      }
      return payload;

    case "text_buttons":
      if (!isNonEmptyString(payload.text)) {
        throw new Error("text_buttons requires text.");
      }
      validateButtons(payload.buttons, payload.type);
      return payload;

    case "media_buttons":
      if (!isNonEmptyString(payload.url)) {
        throw new Error("media_buttons requires url.");
      }
      validateButtons(payload.buttons, payload.type);
      return payload;

    case "list":
      if (!isNonEmptyString(payload.text)) {
        throw new Error("list requires text.");
      }
      if (!isNonEmptyString(payload.buttonLabel)) {
        throw new Error("list requires buttonLabel.");
      }
      validateListSections(payload.sections);
      return payload;

    case "template":
      if (!isNonEmptyString(payload.templateName)) {
        throw new Error("template requires templateName.");
      }
      if (!isNonEmptyString(payload.language)) {
        throw new Error("template requires language.");
      }
      return payload;

    case "product":
      if (!isNonEmptyString(payload.catalogId) || !isNonEmptyString(payload.productId)) {
        throw new Error("product requires catalogId and productId.");
      }
      return payload;

    case "product_list":
      if (!isNonEmptyString(payload.catalogId)) {
        throw new Error("product_list requires catalogId.");
      }
      validateProductSections(payload.sections);
      return payload;

    case "location_share":
      if (!Number.isFinite(payload.latitude) || !Number.isFinite(payload.longitude)) {
        throw new Error("location_share requires valid latitude and longitude.");
      }
      return payload;

    case "contact_share":
      if (!isNonEmptyString(payload.name) || !isNonEmptyString(payload.phone)) {
        throw new Error("contact_share requires name and phone.");
      }
      return payload;

    case "poll":
      if (!isNonEmptyString(payload.question)) {
        throw new Error("poll requires question.");
      }
      if (!Array.isArray(payload.options) || payload.options.filter(isNonEmptyString).length < 2) {
        throw new Error("poll requires at least two options.");
      }
      return payload;
  }
}

export function deriveRendererMessageType(payload: FlowMessagePayload): FlowRendererMessageType {
  switch (payload.type) {
    case "text":
      return "text";
    case "media":
      if (payload.mediaType === "image") return "image";
      if (payload.mediaType === "video") return "video";
      if (payload.mediaType === "audio") return "audio";
      return "file";
    case "text_buttons":
    case "media_buttons":
      return "buttons";
    case "list":
    case "product_list":
      return "list";
    case "template":
    case "product":
      return "template";
    case "location_share":
      return "location";
    case "contact_share":
      return "contact";
    case "poll":
      return "poll";
    default:
      return "unsupported";
  }
}

export function getPayloadMediaUrl(payload: FlowMessagePayload): string | null {
  switch (payload.type) {
    case "media":
    case "media_buttons":
      return payload.url;
    case "template":
      return payload.headerMediaUrl ?? null;
    default:
      return null;
  }
}

export function adaptPayloadForChannel(
  payload: FlowMessagePayload,
  channel: FlowDeliveryChannel
): FlowMessagePayload {
  const validated = validateFlowMessagePayload(payload);

  if (channel === "web") {
    return {
      type: "text",
      text: summarizeFlowMessage(validated)
    };
  }

  return validated;
}

function cleanLine(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function summarizeButtons(buttons: FlowButtonOption[]): string {
  return buttons
    .map((button, index) => {
      const label = cleanLine(button.label) || `Option ${index + 1}`;
      return `${index + 1}. ${label}`;
    })
    .join("\n");
}

function summarizeListSections(sections: FlowListSection[]): string {
  let optionIndex = 0;
  let body = "";

  for (const section of sections) {
    const title = cleanLine(section.title);
    if (title) {
      body += `${body ? "\n" : ""}${title}\n`;
    }
    for (const row of section.rows) {
      optionIndex += 1;
      const titleText = cleanLine(row.title) || `Option ${optionIndex}`;
      const description = cleanLine(row.description);
      body += `${optionIndex}. ${titleText}${description ? ` - ${description}` : ""}\n`;
    }
  }

  return body.trim();
}

export function summarizeFlowMessage(payload: FlowMessagePayload): string {
  switch (payload.type) {
    case "text":
      return cleanLine(payload.text);

    case "media": {
      const tag = payload.mediaType.toUpperCase();
      const caption = cleanLine(payload.caption);
      return [`[${tag}]`, caption].filter(Boolean).join("\n\n").trim();
    }

    case "text_buttons": {
      const body = cleanLine(payload.text);
      const buttons = summarizeButtons(payload.buttons);
      const footer = cleanLine(payload.footer);
      return [body, buttons, footer].filter(Boolean).join("\n\n").trim();
    }

    case "media_buttons": {
      const tag = payload.mediaType.toUpperCase();
      const caption = cleanLine(payload.caption);
      const buttons = summarizeButtons(payload.buttons);
      return [`[${tag}]`, caption, buttons].filter(Boolean).join("\n\n").trim();
    }

    case "list": {
      const body = cleanLine(payload.text);
      const sections = summarizeListSections(payload.sections);
      return [body, sections].filter(Boolean).join("\n\n").trim();
    }

    case "template":
      return cleanLine(payload.previewText) || cleanLine(payload.headerText) || `[Template: ${cleanLine(payload.templateName)}]`;

    case "product":
      return cleanLine(payload.bodyText) || `[Product: ${cleanLine(payload.productId)}]`;

    case "product_list":
      return cleanLine(payload.bodyText) || "[Product list]";

    case "location_share": {
      const parts = ["[LOCATION]"];
      if (payload.name) parts.push(cleanLine(payload.name));
      if (payload.address) parts.push(cleanLine(payload.address));
      parts.push(`${payload.latitude}, ${payload.longitude}`);
      return parts.filter(Boolean).join("\n");
    }

    case "contact_share": {
      const parts = [`[CONTACT] ${cleanLine(payload.name)}`];
      if (payload.org) parts.push(cleanLine(payload.org));
      parts.push(cleanLine(payload.phone));
      return parts.filter(Boolean).join("\n");
    }

    case "poll": {
      const opts = payload.options
        .map((opt, i) => `${i + 1}. ${cleanLine(opt)}`)
        .join("\n");
      return `[POLL] ${cleanLine(payload.question)}\n${opts}`;
    }

    default:
      return "";
  }
}

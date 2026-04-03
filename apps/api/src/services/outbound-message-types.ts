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

/**
 * Universal Chat Message Rendering System
 *
 * Architecture:
 *   ConversationMessage (DB row)
 *     → normalizeMessage() → UniversalMessage
 *       → renderMessage() → MessageRendererRegistry[type]
 *         → <UI Component />
 *
 * To add a new message type:
 *   1. Add the type string to UniversalMessageType
 *   2. Create the UI component
 *   3. Register it in MessageRendererRegistry
 *   4. (Backend) payloadToMessageType() maps to that type
 */

import type { ConversationMessage } from "../../../lib/api";
import { API_URL } from "../../../lib/api";

// ─── Universal Message Types ──────────────────────────────────────────────────

export type UniversalMessageType =
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

export type UniversalMessageSenderType = "user" | "ai" | "agent";

export interface UniversalMessage {
  id: string;
  direction: "incoming" | "outgoing";
  sender_type: UniversalMessageSenderType;
  type: UniversalMessageType;
  content: {
    text?: string;
    media_url?: string;
    file_name?: string;
    buttons?: { id: string; label: string }[];
    list?: {
      title: string;
      button_label?: string;
      items: { id: string; label: string; description?: string }[];
    };
    template?: {
      name?: string;
      image?: string;
      headerText?: string;
      text: string;
      footerText?: string;
      buttons?: { id: string; label: string }[];
    };
    location?: {
      latitude: number;
      longitude: number;
      name?: string;
      address?: string;
    };
    contact?: {
      name: string;
      phone: string;
      org?: string;
    };
    poll?: {
      question: string;
      options: string[];
    };
  };
  sender_name?: string | null;
  is_ai: boolean;
  total_tokens?: number | null;
  created_at: string;
}

// ─── Normalizer ───────────────────────────────────────────────────────────────

/**
 * Detect message type from the text summary when no structured content is available.
 * This handles inbound messages and legacy outbound records.
 */
function detectTypeFromText(text: string, mediaUrl: string | null, storedType: string): UniversalMessageType {
  if (storedType && storedType !== "text") {
    return storedType as UniversalMessageType;
  }

  // Extension-based URL detection (skip for extension-less URLs like /api/media/uuid).
  if (mediaUrl) {
    const urlPath = mediaUrl.split("?")[0].toLowerCase();
    if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/.test(urlPath)) return "image";
    if (/\.(mp4|mov|avi|webm|mkv)(\?|$)/.test(urlPath)) return "video";
    if (/\.(mp3|ogg|wav|m4a|aac|opus)(\?|$)/.test(urlPath)) return "audio";
    if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|csv|txt)(\?|$)/.test(urlPath)) return "file";
    // Extension-less URL — continue to text-pattern detection below.
    // If no text pattern matches, we'll fall back to "file" at the end.
  }

  const t = text?.trim() ?? "";
  if (t.startsWith("[IMAGE]") || t.startsWith("[Extracted image text]:") || t === "[Image received]" || t === "[Image received with no readable text]" || t === "[Image received; text extraction unavailable]") return "image";
  if (t.startsWith("[VIDEO]") || t === "[Video received]") return "video";
  if (t.startsWith("[AUDIO]") || t === "[Audio message received]") return "audio";
  if (t.startsWith("[DOCUMENT]") || t.startsWith("[Extracted document text]:") || t.startsWith("[Document received") || t.startsWith("[PDF received")) return "file";
  if (t.startsWith("[LOCATION]")) return "location";
  if (t.startsWith("[CONTACT]")) return "contact";
  if (t.startsWith("[POLL]")) return "poll";
  if (t.startsWith("[Template:")) return "template";

  // Detect summarized list / buttons format produced by summarizeFlowMessage.
  // text_buttons → "title\n\n1. Btn\n2. Btn"  (numbered item starts immediately)
  // list         → "title\n\nSectionHeader\n1. Item" (non-numbered line precedes items)
  if (t.includes("\n\n")) {
    const afterTitle = t.slice(t.indexOf("\n\n") + 2).trimStart();
    const lines = afterTitle.split("\n").filter((l) => l.trim());
    const hasNumberedItems = lines.some((l) => /^\d+\./.test(l.trim()));
    if (hasNumberedItems) {
      const firstLine = lines[0] ?? "";
      return /^\d+\./.test(firstLine.trim()) ? "buttons" : "list";
    }
  }

  // Extension-less media URL with no text pattern match — generic file/attachment.
  if (mediaUrl) return "file";

  return "text";
}

/**
 * Build content from the structured JSONB payload (preferred path).
 */
function contentFromPayload(
  payload: Record<string, unknown>,
  mediaUrl: string | null
): UniversalMessage["content"] {
  const type = payload.type as string;

  switch (type) {
    case "text":
      return { text: payload.text as string };

    case "media":
      return {
        media_url: (payload.url as string) ?? mediaUrl ?? undefined,
        text: payload.caption as string | undefined
      };

    case "text_buttons": {
      const buttons = (payload.buttons as { id: string; label: string }[]) ?? [];
      return { text: payload.text as string, buttons };
    }

    case "media_buttons": {
      const buttons = (payload.buttons as { id: string; label: string }[]) ?? [];
      return {
        media_url: payload.url as string,
        text: payload.caption as string | undefined,
        buttons
      };
    }

    case "list": {
      const sections = (payload.sections as Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>) ?? [];
      const items: UniversalMessage["content"]["list"] = {
        title: payload.text as string,
        button_label: payload.buttonLabel as string | undefined,
        items: sections.flatMap((s) =>
          s.rows.map((r) => ({ id: r.id, label: r.title, description: r.description }))
        )
      };
      return { list: items };
    }

    case "template":
      return {
        template: {
          name: payload.templateName as string,
          image: payload.headerMediaUrl as string | undefined,
          headerText: payload.headerText as string | undefined,
          text: (payload.previewText as string) || `📋 Template: ${payload.templateName as string}`,
          footerText: payload.footerText as string | undefined,
          buttons: (payload.buttons as { id: string; label: string }[]) ?? []
        }
      };

    case "product":
      return {
        template: {
          text: (payload.bodyText as string) || `Product: ${payload.productId as string}`,
          buttons: [{ id: "view", label: "View Product" }]
        }
      };

    case "product_list": {
      const sections = (payload.sections as Array<{ title: string; productIds: string[] }>) ?? [];
      return {
        list: {
          title: (payload.bodyText as string) || "Products",
          items: sections.flatMap((s) =>
            s.productIds.map((pid) => ({ id: pid, label: pid }))
          )
        }
      };
    }

    case "location_share":
      return {
        location: {
          latitude: payload.latitude as number,
          longitude: payload.longitude as number,
          name: payload.name as string | undefined,
          address: payload.address as string | undefined
        }
      };

    case "contact_share":
      return {
        contact: {
          name: payload.name as string,
          phone: payload.phone as string,
          org: payload.org as string | undefined
        }
      };

    case "poll":
      return {
        poll: {
          question: payload.question as string,
          options: (payload.options as string[]) ?? []
        }
      };

    default:
      return { text: "[Unsupported message type]" };
  }
}

/**
 * Build content from plain text fallback (inbound messages, legacy outbound).
 */
function contentFromText(
  text: string,
  mediaUrl: string | null,
  type: UniversalMessageType
): UniversalMessage["content"] {
  const resolvedMediaUrl = mediaUrl
    ? (mediaUrl.startsWith("/") ? `${API_URL}${mediaUrl}` : mediaUrl)
    : undefined;

  switch (type) {
    case "image":
    case "video":
    case "audio":
    case "file": {
      let caption: string | undefined;
      if (text.startsWith("[Extracted image text]:")) {
        caption = text.slice("[Extracted image text]:".length).trim() || undefined;
      } else if (
        text === "[Image received]" ||
        text === "[Video received]" ||
        text === "[Audio message received]" ||
        text === "[Image received with no readable text]" ||
        text === "[Image received; text extraction unavailable]"
      ) {
        caption = undefined;
      } else {
        // e.g. "[IMAGE]\ncaption text"
        const lines = text.replace(/^\[(IMAGE|VIDEO|AUDIO|DOCUMENT)\]\n?/, "").trim();
        caption = lines || undefined;
      }
      return { media_url: resolvedMediaUrl, text: caption };
    }

    case "location": {
      const lines = text.replace(/^\[LOCATION\]\n?/, "").split("\n");
      const lastLine = lines[lines.length - 1] ?? "";
      const coordMatch = lastLine.match(/([-\d.]+),\s*([-\d.]+)/);
      return {
        location: {
          latitude: coordMatch ? parseFloat(coordMatch[1]) : 0,
          longitude: coordMatch ? parseFloat(coordMatch[2]) : 0,
          name: lines[0] !== lastLine ? lines[0] : undefined,
          address: lines.length > 2 ? lines[1] : undefined
        }
      };
    }

    case "contact": {
      const lines = text.replace(/^\[CONTACT\]\s?/, "").split("\n");
      return {
        contact: {
          name: lines[0]?.replace(/^\[CONTACT\]\s?/, "") ?? "Unknown",
          phone: lines[lines.length - 1] ?? "",
          org: lines.length > 2 ? lines[1] : undefined
        }
      };
    }

    case "poll": {
      const lines = text.replace(/^\[POLL\]\s?/, "").split("\n");
      const question = lines[0] ?? "";
      const options = lines.slice(1).map((l) => l.replace(/^\d+\.\s?/, "").trim()).filter(Boolean);
      return { poll: { question, options } };
    }

    case "template": {
      const name = text.match(/\[Template:\s?([^\]]+)\]/)?.[1] ?? "";
      return { template: { name, text: name ? `📋 Template: ${name}` : text, buttons: [] } };
    }

    case "buttons": {
      // Detect numbered button list: "body\n\n1. A\n2. B"
      const parts = text.split(/\n\n+/);
      const body = parts[0] ?? "";
      const btnLines = parts.slice(1).join("\n").split("\n").filter((l) => /^\d+\./.test(l.trim()));
      const buttons = btnLines.map((l, i) => ({
        id: String(i),
        label: l.replace(/^\d+\.\s?/, "").trim()
      }));
      return { text: body, buttons };
    }

    case "list": {
      const parts = text.split(/\n\n+/);
      const title = parts[0] ?? "";
      const bodyLines = parts.slice(1).join("\n").split("\n").filter((l) => l.trim());
      // Lines before the first numbered item are treated as section/button label
      const firstNumberedIdx = bodyLines.findIndex((l) => /^\d+\./.test(l.trim()));
      const buttonLabel = firstNumberedIdx > 0 ? bodyLines.slice(0, firstNumberedIdx).join(" ").trim() : undefined;
      const itemLines = firstNumberedIdx >= 0 ? bodyLines.slice(firstNumberedIdx) : bodyLines;
      const numberedItems = itemLines.filter((l) => /^\d+\./.test(l.trim()));
      const items = numberedItems.map((l, i) => {
        const withoutNumber = l.replace(/^\d+\.\s?/, "").trim();
        const dashIdx = withoutNumber.indexOf(" - ");
        const label = dashIdx >= 0 ? withoutNumber.slice(0, dashIdx) : withoutNumber;
        const description = dashIdx >= 0 ? withoutNumber.slice(dashIdx + 3) : undefined;
        return { id: String(i), label, description };
      });
      return { list: { title, button_label: buttonLabel, items } };
    }

    default:
      return { text, media_url: resolvedMediaUrl };
  }
}

/**
 * Main normalization function: ConversationMessage → UniversalMessage
 */
export function normalizeMessage(msg: ConversationMessage): UniversalMessage {
  const direction = msg.direction === "inbound" ? "incoming" : "outgoing";
  const isAi = Boolean(msg.ai_model) && msg.direction === "outbound";
  const senderType: UniversalMessageSenderType =
    msg.direction === "inbound" ? "user" : isAi ? "ai" : "agent";

  const storedType = msg.message_type ?? "text";
  const type = detectTypeFromText(msg.message_text, msg.media_url, storedType);

  let content: UniversalMessage["content"];
  if (msg.message_content && typeof msg.message_content === "object" && msg.message_content.type) {
    // Structured payload available — use it (preferred)
    content = contentFromPayload(msg.message_content as Record<string, unknown>, msg.media_url);
  } else {
    // Text-only fallback (inbound or legacy)
    content = contentFromText(msg.message_text, msg.media_url, type);
  }

  return {
    id: msg.id,
    direction,
    sender_type: senderType,
    type,
    content,
    sender_name: msg.sender_name,
    is_ai: isAi,
    total_tokens: msg.total_tokens,
    created_at: msg.created_at
  };
}

// ─── Individual Message Components ───────────────────────────────────────────

function TextMessage({ msg }: { msg: UniversalMessage }): JSX.Element {
  const text = msg.content.text ?? "";
  const URL_RE = /(https?:\/\/[^\s<>"]+)/g;
  const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i;

  // Render with URL detection
  const lines = text.split("\n");
  const nodes: JSX.Element[] = [];

  lines.forEach((line, li) => {
    const parts: (string | JSX.Element)[] = [];
    let last = 0;
    let match: RegExpExecArray | null;
    URL_RE.lastIndex = 0;
    while ((match = URL_RE.exec(line)) !== null) {
      if (match.index > last) parts.push(line.slice(last, match.index));
      const url = match[0];
      if (IMAGE_EXT.test(url)) {
        parts.push(<img key={`img-${li}-${match.index}`} className="msg-inline-image" src={url} alt="Image" loading="lazy" />);
      } else {
        parts.push(<a key={`a-${li}-${match.index}`} className="msg-link" href={url} target="_blank" rel="noopener noreferrer">{url}</a>);
      }
      last = match.index + match[0].length;
    }
    if (last < line.length) parts.push(line.slice(last));
    nodes.push(<span key={li} className="msg-line">{parts}</span>);
    if (li < lines.length - 1) nodes.push(<br key={`br-${li}`} />);
  });

  return <div className="msg-text">{nodes}</div>;
}

function ImageMessage({ msg }: { msg: UniversalMessage }): JSX.Element {
  const { media_url, text } = msg.content;
  if (!media_url) {
    return (
      <div className="msg-media-placeholder">
        <span className="msg-media-icon">📷</span>
        <span>{text || "Image"}</span>
      </div>
    );
  }
  return (
    <div className="msg-image-wrap">
      <a href={media_url} target="_blank" rel="noopener noreferrer">
        <img className="msg-image" src={media_url} alt={text || "Image"} loading="lazy" />
      </a>
      {text && <p className="msg-caption">{text}</p>}
    </div>
  );
}

function VideoMessage({ msg }: { msg: UniversalMessage }): JSX.Element {
  const { media_url, text } = msg.content;
  if (!media_url) {
    return (
      <div className="msg-media-placeholder">
        <span className="msg-media-icon">🎬</span>
        <span>{text || "Video"}</span>
      </div>
    );
  }
  return (
    <div className="msg-video-wrap">
      <video className="msg-video" controls preload="metadata">
        <source src={media_url} />
        Your browser does not support video.
      </video>
      {text && <p className="msg-caption">{text}</p>}
    </div>
  );
}

function AudioMessage({ msg }: { msg: UniversalMessage }): JSX.Element {
  const { media_url, text } = msg.content;
  if (!media_url) {
    return (
      <div className="msg-media-placeholder">
        <span className="msg-media-icon">🎵</span>
        <span>{text || "Audio"}</span>
      </div>
    );
  }
  return (
    <div className="msg-audio-wrap">
      <audio className="msg-audio" controls preload="metadata" src={media_url} />
      {text && <p className="msg-caption">{text}</p>}
    </div>
  );
}

function FileMessage({ msg }: { msg: UniversalMessage }): JSX.Element {
  const { media_url, file_name, text } = msg.content;
  const label = file_name || text || media_url?.split("/").pop() || "Download file";
  return (
    <div className="msg-file-wrap">
      <span className="msg-file-icon">📄</span>
      {media_url ? (
        <a className="msg-file-link" href={media_url} target="_blank" rel="noopener noreferrer" download>
          {label}
        </a>
      ) : (
        <span className="msg-file-link msg-file-unavailable">{label}</span>
      )}
    </div>
  );
}

function ButtonsMessage({ msg }: { msg: UniversalMessage }): JSX.Element {
  const { text, buttons = [], media_url } = msg.content;

  return (
    <div className="msg-buttons-wrap">
      {media_url && (
        <a href={media_url} target="_blank" rel="noopener noreferrer" className="msg-bleed-image-link">
          <img className="msg-bleed-image" src={media_url} alt="Media" loading="lazy" />
        </a>
      )}
      {text && <p className="msg-buttons-body">{text}</p>}
      {buttons.length > 0 && (
        <div className="msg-action-rows">
          {buttons.map((btn) => (
            <div key={btn.id} className="msg-action-row">
              <span className="msg-action-row-icon">↩</span>
              <span className="msg-action-row-label">{btn.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ListMessage({ msg }: { msg: UniversalMessage }): JSX.Element {
  const list = msg.content.list;
  if (!list) return <div className="msg-text">{msg.content.text ?? ""}</div>;

  return (
    <div className="msg-list-wrap">
      {list.title && <p className="msg-list-title">{list.title}</p>}
      {list.items.length > 0 && (
        <div className="msg-action-rows">
          {list.items.map((item) => (
            <div key={item.id} className="msg-action-row msg-action-row--list">
              <span className="msg-action-row-label">{item.label}</span>
              {item.description && <span className="msg-action-row-desc">{item.description}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateMessage({ msg }: { msg: UniversalMessage }): JSX.Element {
  const tmpl = msg.content.template;
  if (!tmpl) return <div className="msg-text">{msg.content.text ?? ""}</div>;

  return (
    <div className="msg-template-wrap">
      {tmpl.image && (
        <a href={tmpl.image} target="_blank" rel="noopener noreferrer" className="msg-bleed-image-link">
          <img className="msg-bleed-image" src={tmpl.image} alt="Template header" loading="lazy" />
        </a>
      )}
      {tmpl.headerText && <p className="msg-template-body"><strong>{tmpl.headerText}</strong></p>}
      {tmpl.text && <p className="msg-template-body">{tmpl.text}</p>}
      {tmpl.footerText && <p className="msg-caption">{tmpl.footerText}</p>}
      {tmpl.buttons && tmpl.buttons.length > 0 && (
        <div className="msg-action-rows">
          {tmpl.buttons.map((btn) => (
            <div key={btn.id} className="msg-action-row">
              <span className="msg-action-row-icon">↩</span>
              <span className="msg-action-row-label">{btn.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LocationMessage({ msg }: { msg: UniversalMessage }): JSX.Element {
  const loc = msg.content.location;
  if (!loc) return <div className="msg-text">[Location]</div>;

  const mapsUrl = `https://maps.google.com/?q=${loc.latitude},${loc.longitude}`;
  return (
    <div className="msg-location-wrap">
      <div className="msg-location-icon">📍</div>
      <div className="msg-location-info">
        {loc.name && <strong className="msg-location-name">{loc.name}</strong>}
        {loc.address && <span className="msg-location-address">{loc.address}</span>}
        <span className="msg-location-coords">{loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}</span>
      </div>
      <a className="msg-location-link" href={mapsUrl} target="_blank" rel="noopener noreferrer">
        View on map →
      </a>
    </div>
  );
}

function ContactMessage({ msg }: { msg: UniversalMessage }): JSX.Element {
  const contact = msg.content.contact;
  if (!contact) return <div className="msg-text">[Contact]</div>;

  return (
    <div className="msg-contact-wrap">
      <div className="msg-contact-avatar">{contact.name.charAt(0).toUpperCase()}</div>
      <div className="msg-contact-info">
        <strong className="msg-contact-name">{contact.name}</strong>
        {contact.org && <span className="msg-contact-org">{contact.org}</span>}
        <span className="msg-contact-phone">{contact.phone}</span>
      </div>
    </div>
  );
}

function PollMessage({ msg }: { msg: UniversalMessage }): JSX.Element {
  const poll = msg.content.poll;
  if (!poll) return <div className="msg-text">[Poll]</div>;

  return (
    <div className="msg-poll-wrap">
      <div className="msg-poll-icon">📊</div>
      <p className="msg-poll-question">{poll.question}</p>
      <div className="msg-poll-options">
        {poll.options.map((opt, i) => (
          <div key={i} className="msg-poll-option">
            <span className="msg-poll-option-label">{opt}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function UnsupportedMessage({ msg }: { msg: UniversalMessage }): JSX.Element {
  return (
    <div className="msg-unsupported">
      <span>⚠</span>
      <span>Unsupported message type: {msg.type}</span>
    </div>
  );
}

// ─── Renderer Registry ────────────────────────────────────────────────────────

type MessageComponent = (props: { msg: UniversalMessage }) => JSX.Element;

const MessageRendererRegistry: Record<string, MessageComponent> = {
  text: TextMessage,
  image: ImageMessage,
  video: VideoMessage,
  audio: AudioMessage,
  file: FileMessage,
  buttons: ButtonsMessage,
  list: ListMessage,
  template: TemplateMessage,
  location: LocationMessage,
  contact: ContactMessage,
  poll: PollMessage,
  unsupported: UnsupportedMessage
};

// ─── Main render function ─────────────────────────────────────────────────────

export function renderMessage(msg: UniversalMessage): JSX.Element {
  const Component = MessageRendererRegistry[msg.type] ?? UnsupportedMessage;
  return <Component msg={msg} />;
}

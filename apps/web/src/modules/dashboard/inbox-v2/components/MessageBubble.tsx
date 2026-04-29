import type { ReactNode } from "react";
import { useState } from "react";
import { format } from "date-fns";
import type { ConversationMessage } from "../store/convStore";
import { getNameAvatarColor, getNameInitials } from "./ConversationRow";
import { API_URL } from "../../../../lib/api";

const META_ERROR_SOLUTIONS: Record<string, string> = {
  "131026": "The contact may not have WhatsApp or has blocked your number.",
  "131047": "You can only send free-form messages within 24h of their last message. Use a template instead.",
  "131049": "Meta flagged this as spam/quality signal. Improve template quality and reduce frequency.",
  "131051": "Template not found or not approved in Meta Business Manager.",
  "131052": "Template was paused by Meta due to low quality.",
  "131053": "Media URL expired. Re-upload or use a permanent URL.",
  "131056": "Too many messages sent to this contact. Wait before sending again.",
  "131057": "Contact has not opted in to receive messages from your business.",
  "130429": "Rate limit hit. Slow down message sending or upgrade your tier.",
  "131031": "Business account locked. Check Meta Business Manager for violations.",
  "131000": "Message undeliverable — generic Meta failure.",
  "131008": "Required template parameter missing.",
  "131009": "Parameter value invalid for template.",
};

interface Props {
  message: ConversationMessage;
  isFirst: boolean;
  showAvatar: boolean;
  convPhone: string;
  contactName?: string | null;
  onRetry?: (msgId: string) => void;
  onReply?: (msg: ConversationMessage) => void;
  quotedMessage?: ConversationMessage | null;
}

// ─── Delivery status ──────────────────────────────────────────────────────────

function renderDelivery(status: string, retryCount: number, onRetry?: () => void) {
  if (status === "pending") return <span className="iv-delivery pending">⏳</span>;
  if (status === "sent") return <span className="iv-delivery sent">✓</span>;
  if (status === "delivered") return <span className="iv-delivery delivered">✓✓</span>;
  if (status === "read") return <span className="iv-delivery read">✓✓</span>;
  if (status === "failed") {
    const disabled = retryCount >= 3;
    return (
      <>
        <span className="iv-delivery failed">✗</span>
        <span
          className={`iv-retry-link${disabled ? " disabled" : ""}`}
          onClick={disabled ? undefined : onRetry}
          title={disabled ? "Contact support" : "Retry"}
        >
          · {disabled ? "Contact support" : "Retry"}
        </span>
      </>
    );
  }
  return null;
}

function formatTime(ts: string) {
  try { return format(new Date(ts), "HH:mm"); } catch { return ""; }
}

// ─── Text formatting (WhatsApp-style) ─────────────────────────────────────────

const URL_RE = /(https?:\/\/[^\s<>"]+)/g;
const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i;
const WA_FORMAT_RE = /```([\s\S]+?)```|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;

function resolveMediaUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return url.startsWith("/") ? `${API_URL}${url}` : url;
}

function renderInlineSegment(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  WA_FORMAT_RE.lastIndex = 0;
  while ((match = WA_FORMAT_RE.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const [full, mono, bold, italic, strike] = match;
    const key = `${keyPrefix}-${match.index}`;
    if (mono !== undefined) nodes.push(<code key={key} style={{ background: "rgba(0,0,0,0.1)", borderRadius: 3, padding: "0 3px", fontSize: "0.9em", fontFamily: "monospace" }}>{mono}</code>);
    else if (bold !== undefined) nodes.push(<strong key={key}>{bold}</strong>);
    else if (italic !== undefined) nodes.push(<em key={key}>{italic}</em>);
    else if (strike !== undefined) nodes.push(<span key={key} style={{ textDecoration: "line-through" }}>{strike}</span>);
    else nodes.push(full);
    lastIndex = match.index + full.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function renderFormattedText(text: string | null | undefined, keyPrefix = "fmt"): ReactNode[] {
  const lines = (text ?? "").split("\n");
  const nodes: ReactNode[] = [];
  lines.forEach((line, li) => {
    const parts: ReactNode[] = [];
    let last = 0;
    let match: RegExpExecArray | null;
    URL_RE.lastIndex = 0;
    while ((match = URL_RE.exec(line)) !== null) {
      if (match.index > last) parts.push(...renderInlineSegment(line.slice(last, match.index), `${keyPrefix}-${li}-${match.index}-t`));
      const url = match[0];
      const safeUrl = (() => { try { const p = new URL(url); return (p.protocol === "https:" || p.protocol === "http:") ? p.href : ""; } catch { return ""; } })();
      if (IMAGE_EXT.test(url)) {
        parts.push(<img key={`img-${li}-${match.index}`} src={safeUrl} alt="" loading="lazy" style={{ maxWidth: 200, borderRadius: 6, display: "block", margin: "4px 0" }} />);
      } else {
        parts.push(<a key={`a-${li}-${match.index}`} href={safeUrl} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecorationColor: "rgba(255,255,255,0.5)" }}>{url}</a>);
      }
      last = match.index + match[0].length;
    }
    if (last < line.length) parts.push(...renderInlineSegment(line.slice(last), `${keyPrefix}-${li}-tail`));
    nodes.push(<span key={li} style={{ display: "contents" }}>{parts}</span>);
    if (li < lines.length - 1) nodes.push(<br key={`br-${li}`} />);
  });
  return nodes;
}

// ─── Content renderers ────────────────────────────────────────────────────────

function renderLegacyContent(msg: ConversationMessage): ReactNode {
  const type = msg.content_type ?? "text";
  const payload = msg.payload_json as Record<string, unknown> | null;
  const text = msg.message_text ?? "";
  const mediaUrl = resolveMediaUrl(payload?.url as string | undefined);

  switch (type) {
    case "image":
    case "sticker": {
      const url = mediaUrl ?? (text.startsWith("http") ? text : undefined);
      const caption = (payload?.caption as string) ?? undefined;
      if (!url) {
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, opacity: 0.8 }}>
            <span>📷</span><span>{caption || "Image"}</span>
          </div>
        );
      }
      return (
        <div>
          <a href={url} target="_blank" rel="noopener noreferrer">
            <img src={url} alt={caption || "Image"} loading="lazy"
              style={{ maxWidth: 220, maxHeight: 280, borderRadius: 8, display: "block", cursor: "pointer" }} />
          </a>
          {caption && <p style={{ margin: "4px 0 0", fontSize: 13 }}>{renderFormattedText(caption, `cap-${msg.id}`)}</p>}
        </div>
      );
    }

    case "audio":
      return (
        <audio controls src={mediaUrl} style={{ maxWidth: 220, display: "block" }} />
      );

    case "video": {
      const caption = (payload?.caption as string) ?? undefined;
      return (
        <div>
          <video controls src={mediaUrl} style={{ maxWidth: 260, borderRadius: 8, display: "block" }} />
          {caption && <p style={{ margin: "4px 0 0", fontSize: 13 }}>{renderFormattedText(caption, `vcap-${msg.id}`)}</p>}
        </div>
      );
    }

    case "document": {
      const filename = (payload?.filename as string) ?? (payload?.file_name as string) ?? "Document";
      return (
        <a href={mediaUrl} target="_blank" rel="noopener noreferrer"
          style={{ display: "flex", alignItems: "center", gap: 6, color: "inherit", textDecoration: "none", fontSize: 13 }}>
          <span style={{ fontSize: 18 }}>📄</span>
          <span style={{ textDecoration: "underline" }}>{filename}</span>
        </a>
      );
    }

    case "location": {
      const lat = (payload?.latitude as number) ?? 0;
      const lng = (payload?.longitude as number) ?? 0;
      const name = (payload?.name as string) ?? (text.replace(/^\[LOCATION\]\n?/, "").split("\n")[0]) ?? "";
      const address = (payload?.address as string) ?? undefined;
      return (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
          <span>📍</span>
          <div>
            {name && <strong style={{ display: "block" }}>{name}</strong>}
            {address && <span style={{ fontSize: 12, opacity: 0.7, display: "block" }}>{address}</span>}
            <a href={`https://maps.google.com/?q=${lat},${lng}`} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 12, color: "inherit", opacity: 0.85 }}>View on map →</a>
          </div>
        </div>
      );
    }

    case "contacts": {
      const contacts = (payload?.contacts as Array<{
        name?: { formatted_name?: string };
        phones?: Array<{ phone?: string }>;
      }>) ?? [];
      if (contacts.length > 0) {
        return (
          <div>
            {contacts.map((c, i) => {
              const name = c.name?.formatted_name ?? "Unknown";
              const phone = c.phones?.[0]?.phone ?? "";
              return (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0" }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(0,0,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                    {name[0]?.toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>{phone}</div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      }
      return <span style={{ fontSize: 13 }}>👤 {text.replace(/^\[CONTACT\]\s?/, "")}</span>;
    }

    case "interactive": {
      const iType = (payload?.type as string) ?? "";
      if (iType === "list" || iType === "list_reply") {
        const title = (payload?.body as { text?: string })?.text ?? text;
        const sections = (payload?.action as { sections?: Array<{ title?: string; rows?: Array<{ id: string; title: string; description?: string }> }> })?.sections ?? [];
        const items = sections.flatMap((s) => s.rows ?? []);
        return (
          <div style={{ fontSize: 13 }}>
            {title && <p style={{ margin: "0 0 8px" }}>{renderFormattedText(title, `int-${msg.id}`)}</p>}
            {items.map((item) => (
              <div key={item.id} style={{ padding: "5px 8px", background: "rgba(0,0,0,0.07)", borderRadius: 6, marginBottom: 4 }}>
                <div style={{ fontWeight: 600 }}>{item.title}</div>
                {item.description && <div style={{ fontSize: 11, opacity: 0.7 }}>{item.description}</div>}
              </div>
            ))}
          </div>
        );
      }
      // button / button_reply
      const bodyText = (payload?.body as { text?: string })?.text ?? text;
      const buttons = (payload?.action as { buttons?: Array<{ reply?: { id: string; title: string } }> })?.buttons ?? [];
      return (
        <div style={{ fontSize: 13 }}>
          {bodyText && <p style={{ margin: "0 0 8px" }}>{renderFormattedText(bodyText, `int-btn-${msg.id}`)}</p>}
          {buttons.map((b, i) => (
            <div key={b.reply?.id ?? i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", border: "1px solid rgba(0,0,0,0.18)", borderRadius: 16, marginBottom: 4, fontSize: 12 }}>
              <span>↩</span><span>{b.reply?.title}</span>
            </div>
          ))}
        </div>
      );
    }

    case "template": {
      const name = (payload?.name as string) ?? "";
      const components = (payload?.components as Array<{ type: string; text?: string }>) ?? [];
      const bodyComp = components.find((c) => c.type === "body");
      const headerComp = components.find((c) => c.type === "header");
      const footerComp = components.find((c) => c.type === "footer");
      const btnComps = components.filter((c) => c.type === "button");
      const bodyText = bodyComp?.text ?? (payload?.body as { text?: string })?.text ?? text;
      const headerText = headerComp?.text ?? (payload?.header as { text?: string })?.text ?? (name ? `📋 ${name}` : "");
      return (
        <div style={{ fontSize: 13 }}>
          {headerText && <p style={{ margin: "0 0 4px", fontWeight: 700 }}>{headerText}</p>}
          {bodyText && <p style={{ margin: "0 0 4px" }}>{renderFormattedText(bodyText, `tmpl-${msg.id}`)}</p>}
          {footerComp?.text && <p style={{ margin: "0 0 4px", fontSize: 11, opacity: 0.6 }}>{footerComp.text}</p>}
          {btnComps.map((b, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", border: "1px solid rgba(0,0,0,0.18)", borderRadius: 16, marginBottom: 4, fontSize: 12 }}>
              <span>↩</span><span>{b.text}</span>
            </div>
          ))}
          {!bodyText && !headerText && name && <span style={{ opacity: 0.6 }}>📋 {name}</span>}
        </div>
      );
    }

    case "activity":
      return null;

    default: {
      // Outbound WAgen payloads: text_buttons, list, poll, product_list
      const pType = payload?.type as string | undefined;

      if (pType === "text_buttons" || pType === "media_buttons") {
        const buttons = (payload?.buttons as Array<{ id: string; label: string }>) ?? [];
        const bodyText = (payload?.text as string) ?? (payload?.caption as string) ?? text;
        const imgUrl = resolveMediaUrl(payload?.url as string | undefined);
        return (
          <div style={{ fontSize: 13 }}>
            {imgUrl && (
              <a href={imgUrl} target="_blank" rel="noopener noreferrer">
                <img src={imgUrl} alt="" loading="lazy" style={{ maxWidth: 220, borderRadius: 8, display: "block", marginBottom: 6 }} />
              </a>
            )}
            {bodyText && <p style={{ margin: "0 0 8px" }}>{renderFormattedText(bodyText, `btn-${msg.id}`)}</p>}
            {buttons.map((b) => (
              <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", border: "1px solid rgba(0,0,0,0.18)", borderRadius: 16, marginBottom: 4, fontSize: 12 }}>
                <span>↩</span><span>{b.label}</span>
              </div>
            ))}
          </div>
        );
      }

      if (pType === "list" || pType === "product_list") {
        const title = (payload?.text as string) ?? (payload?.bodyText as string) ?? text;
        const sections = (payload?.sections as Array<{ title?: string; rows?: Array<{ id: string; title: string; description?: string }> }>) ?? [];
        const items = sections.flatMap((s) => s.rows ?? []);
        return (
          <div style={{ fontSize: 13 }}>
            {title && <p style={{ margin: "0 0 8px" }}>{renderFormattedText(title, `list-${msg.id}`)}</p>}
            {items.map((item) => (
              <div key={item.id} style={{ padding: "5px 8px", background: "rgba(0,0,0,0.07)", borderRadius: 6, marginBottom: 4 }}>
                <div style={{ fontWeight: 600 }}>{item.title}</div>
                {item.description && <div style={{ fontSize: 11, opacity: 0.7 }}>{item.description}</div>}
              </div>
            ))}
          </div>
        );
      }

      if (pType === "poll") {
        const question = (payload?.question as string) ?? text;
        const options = (payload?.options as string[]) ?? [];
        return (
          <div style={{ fontSize: 13 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
              <span>📊</span><strong>{question}</strong>
            </div>
            {options.map((opt, i) => (
              <div key={i} style={{ padding: "5px 10px", background: "rgba(0,0,0,0.07)", borderRadius: 16, marginBottom: 4 }}>{opt}</div>
            ))}
          </div>
        );
      }

      return <span style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{renderFormattedText(text, `txt-${msg.id}`)}</span>;
    }
  }
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

type BubbleMessageType =
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

type BubbleMediaType = "image" | "video" | "audio" | "document" | "file";

interface BubbleButton {
  id: string;
  label: string;
}

interface BubbleListItem {
  id: string;
  label: string;
  description?: string;
}

interface BubbleContent {
  text?: string;
  mediaUrl?: string;
  mediaType?: BubbleMediaType;
  fileName?: string;
  buttons?: BubbleButton[];
  list?: {
    title?: string;
    buttonLabel?: string;
    items: BubbleListItem[];
  };
  template?: {
    name?: string;
    headerText?: string;
    text?: string;
    footerText?: string;
    mediaUrl?: string;
    mediaType?: BubbleMediaType;
    buttons?: BubbleButton[];
  };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  contacts?: Array<{
    name: string;
    phone?: string;
    org?: string;
  }>;
  poll?: {
    question: string;
    options: string[];
  };
}

interface BubbleMessage {
  type: BubbleMessageType;
  content: BubbleContent;
}

interface MessageSourceBadge {
  label: string;
  className: string;
}

const MEDIA_EXT_RE = /\.(jpg|jpeg|png|gif|webp|bmp|svg|mp4|mov|avi|webm|mkv|mp3|ogg|wav|m4a|aac|opus|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|csv|txt)(\?.*)?$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function getNestedText(value: unknown): string | undefined {
  if (typeof value === "string") return stringValue(value);
  const record = recordValue(value);
  return record ? firstString(record.text, record.body, record.title) : undefined;
}

function getStructuredPayload(msg: ConversationMessage): Record<string, unknown> | null {
  const messageContent = isRecord(msg.message_content) && Object.keys(msg.message_content).length > 0 ? msg.message_content : null;
  const payloadJson = isRecord(msg.payload_json) && Object.keys(msg.payload_json).length > 0 ? msg.payload_json : null;
  if (messageContent?.type) return messageContent;
  if (payloadJson?.type) return payloadJson;
  if (messageContent) return messageContent;
  if (payloadJson) return payloadJson;
  return null;
}

function normalizeStoredType(msg: ConversationMessage): string {
  return (msg.message_type ?? msg.content_type ?? "text").toLowerCase();
}

function resolvePayloadMediaUrl(payload: Record<string, unknown> | null, fallback?: string | null): string | undefined {
  const url = firstString(
    payload?.url,
    payload?.media_url,
    payload?.mediaUrl,
    payload?.link,
    payload?.headerMediaUrl,
    payload?.header_media_url,
    fallback
  );
  return resolveMediaUrl(url);
}

function mediaTypeFromUrl(url: string | null | undefined): BubbleMediaType | undefined {
  if (!url) return undefined;
  const path = url.split("?")[0].toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/.test(path)) return "image";
  if (/\.(mp4|mov|avi|webm|mkv)$/.test(path)) return "video";
  if (/\.(mp3|ogg|wav|m4a|aac|opus)$/.test(path)) return "audio";
  if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|csv|txt)$/.test(path)) return "document";
  return undefined;
}

function mediaTypeFromMime(mimeType: string | undefined): BubbleMediaType | undefined {
  if (!mimeType) return undefined;
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.includes("pdf") || mime.startsWith("application/") || mime.startsWith("text/")) return "document";
  return undefined;
}

function mediaTypeFromPayload(payload: Record<string, unknown> | null, mediaUrl?: string): BubbleMediaType | undefined {
  const explicit = firstString(payload?.mediaType, payload?.media_type, payload?.kind, payload?.format, payload?.mimeType, payload?.mime_type);
  const lower = explicit?.toLowerCase();
  if (lower === "image" || lower === "video" || lower === "audio") return lower;
  if (lower === "document" || lower === "file") return lower;
  return mediaTypeFromMime(explicit) ?? mediaTypeFromUrl(mediaUrl);
}

function normalizeButtons(value: unknown): BubbleButton[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index) => {
    const item = recordValue(raw);
    if (!item) return [];
    const reply = recordValue(item.reply);
    const label = firstString(item.label, item.title, item.text, item.name, reply?.title);
    if (!label) return [];
    return [{
      id: firstString(item.id, item.key, reply?.id) ?? String(index),
      label
    }];
  });
}

function normalizeActionButtons(payload: Record<string, unknown>): BubbleButton[] {
  const action = recordValue(payload.action);
  return [
    ...normalizeButtons(payload.buttons),
    ...normalizeButtons(action?.buttons)
  ];
}

function normalizeListItemsFromSections(sections: unknown): BubbleListItem[] {
  if (!Array.isArray(sections)) return [];
  return sections.flatMap((section, sectionIndex) => {
    const s = recordValue(section);
    if (!s) return [];
    const rows = Array.isArray(s.rows) ? s.rows : [];
    const productIds = Array.isArray(s.productIds) ? s.productIds : [];
    return [
      ...rows.flatMap((row, rowIndex) => {
        const r = recordValue(row);
        const label = firstString(r?.title, r?.label, r?.name);
        if (!r || !label) return [];
        return [{
          id: firstString(r.id, r.key) ?? `${sectionIndex}-${rowIndex}`,
          label,
          description: firstString(r.description)
        }];
      }),
      ...productIds.flatMap((pid) => {
        const label = stringValue(pid);
        return label ? [{ id: label, label, description: undefined }] : [];
      })
    ];
  });
}

function findComponent(components: unknown, type: string): Record<string, unknown> | undefined {
  if (!Array.isArray(components)) return undefined;
  return components
    .map(recordValue)
    .find((component) => firstString(component?.type)?.toLowerCase() === type.toLowerCase());
}

function templateButtonsFromComponents(components: unknown): BubbleButton[] {
  if (!Array.isArray(components)) return [];
  return components.flatMap((component, componentIndex) => {
    const c = recordValue(component);
    const type = firstString(c?.type)?.toLowerCase();
    if (!c) return [];
    if (type === "buttons") return normalizeButtons(c.buttons);
    if (type === "button") {
      const label = firstString(c.text, c.label, c.title);
      return label ? [{ id: firstString(c.id) ?? String(componentIndex), label }] : [];
    }
    return [];
  });
}

function payloadTypeToBubbleType(payload: Record<string, unknown>, storedType: string): BubbleMessageType {
  const type = firstString(payload.type, storedType)?.toLowerCase() ?? "text";
  switch (type) {
    case "text":
      return "text";
    case "media": {
      const mediaType = mediaTypeFromPayload(payload, resolvePayloadMediaUrl(payload));
      if (mediaType === "image") return "image";
      if (mediaType === "video") return "video";
      if (mediaType === "audio") return "audio";
      return "file";
    }
    case "image":
    case "sticker":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "document":
    case "file":
      return "file";
    case "text_buttons":
    case "media_buttons":
    case "buttons":
    case "button":
    case "button_reply":
      return "buttons";
    case "interactive": {
      const actionType = firstString(payload.interactive_type, recordValue(payload.interactive)?.type, payload.kind)?.toLowerCase();
      return actionType?.includes("list") ? "list" : "buttons";
    }
    case "list":
    case "list_reply":
    case "product_list":
      return "list";
    case "template":
    case "product":
      return "template";
    case "location":
    case "location_share":
      return "location";
    case "contact":
    case "contacts":
    case "contact_share":
      return "contact";
    case "poll":
      return "poll";
    default:
      return "unsupported";
  }
}

function storedTypeToBubbleType(storedType: string, payload: Record<string, unknown> | null): BubbleMessageType | null {
  switch (storedType) {
    case "image":
    case "sticker":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "document":
    case "file":
      return "file";
    case "contacts":
    case "contact":
      return "contact";
    case "location":
      return "location";
    case "interactive": {
      const actionType = firstString(payload?.type, payload?.interactive_type, recordValue(payload?.interactive)?.type)?.toLowerCase();
      return actionType?.includes("list") ? "list" : "buttons";
    }
    case "template":
      return "template";
    case "activity":
    case "text":
      return "text";
    default:
      return null;
  }
}

function detectTypeFromText(text: string, mediaUrl: string | undefined, storedType: string, payload: Record<string, unknown> | null): BubbleMessageType {
  if (payload?.type) {
    const fromPayload = payloadTypeToBubbleType(payload, storedType);
    if (fromPayload !== "unsupported") return fromPayload;
  }

  const fromStored = storedTypeToBubbleType(storedType, payload);
  if (fromStored && fromStored !== "text") return fromStored;

  if (mediaUrl) {
    const mediaType = mediaTypeFromUrl(mediaUrl);
    if (mediaType === "image") return "image";
    if (mediaType === "video") return "video";
    if (mediaType === "audio") return "audio";
    if (mediaType === "document") return "file";
  }

  const trimmed = text.trim();
  if (trimmed.startsWith("[IMAGE]") || trimmed.startsWith("[Extracted image text]:") || trimmed === "[Image received]" || trimmed === "[Image received with no readable text]" || trimmed === "[Image received; text extraction unavailable]") return "image";
  if (trimmed.startsWith("[VIDEO]") || trimmed === "[Video received]") return "video";
  if (trimmed.startsWith("[AUDIO]") || trimmed === "[Audio message received]") return "audio";
  if (trimmed.startsWith("[DOCUMENT]") || trimmed.startsWith("[Extracted document text]:") || trimmed.startsWith("[Document received") || trimmed.startsWith("[PDF received")) return "file";
  if (trimmed.startsWith("[LOCATION]")) return "location";
  if (trimmed.startsWith("[CONTACT]")) return "contact";
  if (trimmed.startsWith("[POLL]")) return "poll";
  if (trimmed.startsWith("[Template:")) return "template";

  if (trimmed.includes("\n\n")) {
    const afterTitle = trimmed.slice(trimmed.indexOf("\n\n") + 2).trimStart();
    const lines = afterTitle.split("\n").filter((line) => line.trim());
    const hasNumberedItems = lines.some((line) => /^\d+\./.test(line.trim()));
    if (hasNumberedItems) {
      const firstLine = lines[0] ?? "";
      return /^\d+\./.test(firstLine.trim()) ? "buttons" : "list";
    }
  }

  const directUrl = trimmed.startsWith("http") && MEDIA_EXT_RE.test(trimmed) ? trimmed : undefined;
  const directType = mediaTypeFromUrl(directUrl);
  if (directType === "image") return "image";
  if (directType === "video") return "video";
  if (directType === "audio") return "audio";
  if (directType === "document") return "file";

  if (mediaUrl) return "file";
  return "text";
}

function normalizeContacts(payload: Record<string, unknown>): BubbleContent["contacts"] {
  if (Array.isArray(payload.contacts)) {
    return payload.contacts.flatMap((raw) => {
      const contact = recordValue(raw);
      if (!contact) return [];
      const nameRecord = recordValue(contact.name);
      const phones = Array.isArray(contact.phones) ? contact.phones : [];
      const firstPhone = recordValue(phones[0]);
      return [{
        name: firstString(nameRecord?.formatted_name, nameRecord?.first_name, contact.name) ?? "Unknown",
        phone: firstString(firstPhone?.phone, firstPhone?.wa_id, contact.phone),
        org: firstString(contact.org)
      }];
    });
  }
  return [{
    name: firstString(payload.name) ?? "Unknown",
    phone: firstString(payload.phone),
    org: firstString(payload.org)
  }];
}

function templateContentFromPayload(payload: Record<string, unknown>, text: string, mediaUrl?: string): BubbleContent {
  const components = payload.components;
  const bodyComp = findComponent(components, "body");
  const headerComp = findComponent(components, "header");
  const footerComp = findComponent(components, "footer");
  const name = firstString(payload.templateName, payload.template_name, payload.name);
  const headerText = firstString(payload.headerText, payload.header_text, getNestedText(payload.header), headerComp?.text);
  const bodyText = firstString(payload.previewText, payload.bodyText, payload.body_text, getNestedText(payload.body), bodyComp?.text, text);
  const footerText = firstString(payload.footerText, payload.footer_text, footerComp?.text);
  const headerMedia = resolvePayloadMediaUrl(payload, mediaUrl);
  const headerMediaType = mediaTypeFromPayload(payload, headerMedia) ?? mediaTypeFromUrl(headerMedia);
  const buttons = [
    ...normalizeButtons(payload.buttons),
    ...templateButtonsFromComponents(components)
  ];

  return {
    template: {
      name,
      headerText,
      text: bodyText || (name ? `Template: ${name}` : undefined),
      footerText,
      mediaUrl: headerMedia,
      mediaType: headerMediaType,
      buttons
    }
  };
}

function contentFromPayload(payload: Record<string, unknown>, mediaUrl: string | undefined, text: string, storedType: string): BubbleContent {
  const type = firstString(payload.type, storedType)?.toLowerCase() ?? "text";
  const payloadMediaUrl = resolvePayloadMediaUrl(payload, mediaUrl);
  const mediaType = mediaTypeFromPayload(payload, payloadMediaUrl);

  switch (type) {
    case "text":
      return { text: firstString(payload.text, text) ?? "" };
    case "media":
    case "image":
    case "sticker":
    case "video":
    case "audio":
    case "document":
    case "file":
      return {
        mediaUrl: payloadMediaUrl,
        mediaType: mediaType ?? (type === "sticker" ? "image" : type === "image" || type === "video" || type === "audio" ? type : "document"),
        fileName: firstString(payload.filename, payload.file_name, payload.name),
        text: firstString(payload.caption, payload.text)
      };
    case "text_buttons":
      return {
        text: firstString(payload.text, payload.bodyText, getNestedText(payload.body), text),
        buttons: normalizeButtons(payload.buttons)
      };
    case "media_buttons":
      return {
        mediaUrl: payloadMediaUrl,
        mediaType: mediaType ?? "image",
        text: firstString(payload.caption, payload.text, payload.bodyText, text),
        buttons: normalizeButtons(payload.buttons)
      };
    case "interactive":
    case "button":
    case "button_reply":
      return {
        text: firstString(getNestedText(payload.body), payload.text, text),
        buttons: normalizeActionButtons(payload)
      };
    case "list":
    case "list_reply": {
      const action = recordValue(payload.action);
      return {
        list: {
          title: firstString(payload.text, payload.bodyText, getNestedText(payload.body), text),
          buttonLabel: firstString(payload.buttonLabel, payload.button_label, action?.button),
          items: normalizeListItemsFromSections(payload.sections ?? action?.sections)
        }
      };
    }
    case "product_list":
      return {
        list: {
          title: firstString(payload.bodyText, payload.text, text) ?? "Products",
          items: normalizeListItemsFromSections(payload.sections)
        }
      };
    case "template":
      return templateContentFromPayload(payload, text, mediaUrl);
    case "product":
      return {
        template: {
          text: firstString(payload.bodyText, payload.text) ?? `Product: ${firstString(payload.productId) ?? "Product"}`,
          buttons: [{ id: "view", label: "View Product" }]
        }
      };
    case "location":
    case "location_share":
      return {
        location: {
          latitude: numberValue(payload.latitude) ?? numberValue(payload.lat) ?? 0,
          longitude: numberValue(payload.longitude) ?? numberValue(payload.lng) ?? 0,
          name: firstString(payload.name),
          address: firstString(payload.address)
        }
      };
    case "contacts":
    case "contact":
    case "contact_share":
      return { contacts: normalizeContacts(payload) };
    case "poll":
      return {
        poll: {
          question: firstString(payload.question, text) ?? "",
          options: Array.isArray(payload.options) ? payload.options.map(String).filter(Boolean) : []
        }
      };
    default:
      return { text, mediaUrl: payloadMediaUrl, mediaType };
  }
}

function contentFromText(text: string, mediaUrl: string | undefined, type: BubbleMessageType, payload: Record<string, unknown> | null): BubbleContent {
  if (payload && type === "template") return templateContentFromPayload(payload, text, mediaUrl);

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
        const cleaned = text.replace(/^\[(IMAGE|VIDEO|AUDIO|DOCUMENT)\]\n?/, "").trim();
        caption = cleaned && cleaned !== mediaUrl ? cleaned : undefined;
      }
      const directUrl = text.trim().startsWith("http") ? text.trim() : undefined;
      return {
        mediaUrl: mediaUrl ?? resolveMediaUrl(directUrl),
        mediaType: type === "file" ? "document" : type,
        fileName: type === "file" ? firstString(text.match(/\[Document received:\s?([^\]]+)\]/)?.[1]) : undefined,
        text: caption
      };
    }
    case "location": {
      const lines = text.replace(/^\[LOCATION\]\n?/, "").split("\n").filter(Boolean);
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
      const lines = text.replace(/^\[CONTACT\]\s?/, "").split("\n").filter(Boolean);
      return { contacts: [{ name: lines[0] ?? "Unknown", phone: lines[lines.length - 1] }] };
    }
    case "poll": {
      const lines = text.replace(/^\[POLL\]\s?/, "").split("\n").filter(Boolean);
      return {
        poll: {
          question: lines[0] ?? "",
          options: lines.slice(1).map((line) => line.replace(/^\d+\.\s?/, "").trim()).filter(Boolean)
        }
      };
    }
    case "template": {
      const name = text.match(/\[Template:\s?([^\]]+)\]/)?.[1];
      return { template: { name, text: name ? `Template: ${name}` : text, buttons: [] } };
    }
    case "buttons": {
      const parts = text.split(/\n\n+/);
      const body = parts[0] ?? "";
      const buttons = parts.slice(1).join("\n").split("\n")
        .filter((line) => /^\d+\./.test(line.trim()))
        .map((line, index) => ({ id: String(index), label: line.replace(/^\d+\.\s?/, "").trim() }))
        .filter((button) => button.label);
      return { text: body, buttons };
    }
    case "list": {
      const parts = text.split(/\n\n+/);
      const title = parts[0] ?? "";
      const bodyLines = parts.slice(1).join("\n").split("\n").filter((line) => line.trim());
      const firstNumberedIdx = bodyLines.findIndex((line) => /^\d+\./.test(line.trim()));
      const buttonLabel = firstNumberedIdx > 0 ? bodyLines.slice(0, firstNumberedIdx).join(" ").trim() : undefined;
      const itemLines = firstNumberedIdx >= 0 ? bodyLines.slice(firstNumberedIdx) : bodyLines;
      const items = itemLines
        .filter((line) => /^\d+\./.test(line.trim()))
        .map((line, index) => {
          const withoutNumber = line.replace(/^\d+\.\s?/, "").trim();
          const dashIdx = withoutNumber.indexOf(" - ");
          return {
            id: String(index),
            label: dashIdx >= 0 ? withoutNumber.slice(0, dashIdx) : withoutNumber,
            description: dashIdx >= 0 ? withoutNumber.slice(dashIdx + 3) : undefined
          };
        });
      return { list: { title, buttonLabel, items } };
    }
    default:
      return { text, mediaUrl };
  }
}

function normalizeBubbleMessage(msg: ConversationMessage): BubbleMessage {
  const payload = getStructuredPayload(msg);
  const storedType = normalizeStoredType(msg);
  const text = msg.message_text ?? "";
  const mediaUrl = resolvePayloadMediaUrl(payload, msg.media_url) ?? resolveMediaUrl(text.trim().startsWith("http") ? text.trim() : undefined);
  const type = detectTypeFromText(text, mediaUrl, storedType, payload);
  const content = payload && payload.type
    ? contentFromPayload(payload, mediaUrl, text, storedType)
    : contentFromText(text, mediaUrl, type, payload);
  return { type, content };
}

function renderMediaPreview(content: BubbleContent, label = "Media"): ReactNode {
  const { mediaUrl, mediaType, text, fileName } = content;
  if (!mediaUrl) {
    return <div className="iv-msg-media-placeholder"><span className="iv-msg-media-kind">{label}</span><span>{text || label}</span></div>;
  }
  if (mediaType === "image") {
    return (
      <a className="iv-msg-media-link" href={mediaUrl} target="_blank" rel="noopener noreferrer">
        <img className="iv-msg-media-img" src={mediaUrl} alt={text || label} loading="lazy" />
      </a>
    );
  }
  if (mediaType === "video") {
    return (
      <video className="iv-msg-media-video" controls preload="metadata">
        <source src={mediaUrl} />
      </video>
    );
  }
  if (mediaType === "audio") {
    return <audio className="iv-msg-audio" controls preload="metadata" src={mediaUrl} />;
  }
  const name = fileName || mediaUrl.split("/").pop() || "Download file";
  return (
    <a className="iv-msg-file-card" href={mediaUrl} target="_blank" rel="noopener noreferrer" download>
      <span className="iv-msg-file-icon">FILE</span>
      <span className="iv-msg-file-name">{name}</span>
    </a>
  );
}

function renderButtons(buttons: BubbleButton[] | undefined): ReactNode {
  if (!buttons?.length) return null;
  return (
    <div className="iv-msg-action-rows">
      {buttons.map((button) => (
        <div key={button.id} className="iv-msg-action-row">
          <span className="iv-msg-action-icon">&gt;</span>
          <span className="iv-msg-action-label">{button.label}</span>
        </div>
      ))}
    </div>
  );
}

function renderContent(msg: ConversationMessage): ReactNode {
  const normalized = normalizeBubbleMessage(msg);
  const { type, content } = normalized;

  switch (type) {
    case "image":
    case "video":
    case "audio":
    case "file":
      return (
        <div className="iv-msg-rich">
          {renderMediaPreview(content, type === "file" ? "Document" : type)}
          {content.text && <p className="iv-msg-caption">{renderFormattedText(content.text, `media-${msg.id}`)}</p>}
        </div>
      );
    case "buttons":
      return (
        <div className="iv-msg-rich">
          {content.mediaUrl && renderMediaPreview(content)}
          {content.text && <p className="iv-msg-body">{renderFormattedText(content.text, `btn-${msg.id}`)}</p>}
          {renderButtons(content.buttons)}
        </div>
      );
    case "list": {
      const list = content.list;
      return (
        <div className="iv-msg-rich">
          {list?.title && <p className="iv-msg-body">{renderFormattedText(list.title, `list-${msg.id}`)}</p>}
          {list?.buttonLabel && <div className="iv-msg-list-label">{list.buttonLabel}</div>}
          {list?.items.length ? (
            <div className="iv-msg-action-rows">
              {list.items.map((item) => (
                <div key={item.id} className="iv-msg-action-row iv-msg-list-row">
                  <span className="iv-msg-action-label">{item.label}</span>
                  {item.description && <span className="iv-msg-action-desc">{item.description}</span>}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      );
    }
    case "template": {
      const template = content.template;
      return (
        <div className="iv-msg-rich iv-msg-template">
          {template?.mediaUrl && renderMediaPreview({ mediaUrl: template.mediaUrl, mediaType: template.mediaType, text: template.headerText }, "Template media")}
          {template?.name && <div className="iv-msg-template-name">{template.name}</div>}
          {template?.headerText && <p className="iv-msg-heading">{renderFormattedText(template.headerText, `tmpl-head-${msg.id}`)}</p>}
          {template?.text && <p className="iv-msg-body">{renderFormattedText(template.text, `tmpl-body-${msg.id}`)}</p>}
          {template?.footerText && <p className="iv-msg-caption muted">{renderFormattedText(template.footerText, `tmpl-foot-${msg.id}`)}</p>}
          {renderButtons(template?.buttons)}
        </div>
      );
    }
    case "location": {
      const location = content.location;
      const mapsUrl = `https://maps.google.com/?q=${location?.latitude ?? 0},${location?.longitude ?? 0}`;
      return (
        <div className="iv-msg-card iv-msg-location">
          <div className="iv-msg-card-icon">PIN</div>
          <div className="iv-msg-card-main">
            {location?.name && <strong>{location.name}</strong>}
            {location?.address && <span>{location.address}</span>}
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer">View on map</a>
          </div>
        </div>
      );
    }
    case "contact":
      return (
        <div className="iv-msg-rich">
          {(content.contacts ?? [{ name: content.text ?? "Contact" }]).map((contact, index) => (
            <div key={`${contact.name}-${index}`} className="iv-msg-card iv-msg-contact">
              <div className="iv-msg-contact-avatar">{contact.name.charAt(0).toUpperCase()}</div>
              <div className="iv-msg-card-main">
                <strong>{contact.name}</strong>
                {contact.org && <span>{contact.org}</span>}
                {contact.phone && <span>{contact.phone}</span>}
              </div>
            </div>
          ))}
        </div>
      );
    case "poll":
      return (
        <div className="iv-msg-rich iv-msg-poll">
          <p className="iv-msg-heading">{content.poll?.question || "Poll"}</p>
          <div className="iv-msg-action-rows">
            {(content.poll?.options ?? []).map((option, index) => (
              <div key={index} className="iv-msg-action-row">
                <span className="iv-msg-action-label">{option}</span>
              </div>
            ))}
          </div>
        </div>
      );
    case "unsupported":
      return renderLegacyContent(msg);
    default:
      return <span className="iv-msg-text">{renderFormattedText(content.text ?? msg.message_text ?? "", `txt-${msg.id}`)}</span>;
  }
}

function getMessageSourceBadge(msg: ConversationMessage, normalizedType: BubbleMessageType): MessageSourceBadge | null {
  if (msg.direction !== "outbound" || msg.is_private) return null;

  const sourceType = msg.source_type?.toLowerCase() ?? "";
  if (msg.ai_model) return { label: "AI", className: "iv-badge-ai" };
  if (sourceType === "broadcast") return { label: "Broadcast", className: "iv-badge-broadcast" };
  if (sourceType === "sequence") return { label: "Sequence", className: "iv-badge-sequence" };
  if (sourceType === "api") return { label: "API", className: "iv-badge-api" };
  if (sourceType === "system") return { label: "System", className: "iv-badge-system" };
  if (normalizedType === "template") return { label: "Template", className: "iv-badge-template" };
  if (sourceType === "bot") return { label: "Flow", className: "iv-badge-flow" };

  const payload = getStructuredPayload(msg);
  const payloadType = firstString(payload?.type)?.toLowerCase();
  const isLegacyFlowPayload = Boolean(payloadType) && !msg.sender_name && !msg.echo_id;
  if (isLegacyFlowPayload) return { label: "Flow", className: "iv-badge-flow" };

  if (msg.sender_name || msg.echo_id || sourceType === "manual") {
    return { label: "Human", className: "iv-badge-human" };
  }

  return null;
}

export function MessageBubble({ message, isFirst, showAvatar, convPhone, contactName, onRetry, onReply, quotedMessage }: Props) {
  const [copied, setCopied] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const isOutbound = message.direction === "outbound";
  const isPrivate = message.is_private;
  const isActivity = message.content_type === "activity";
  const avatarColor = getNameAvatarColor(contactName, convPhone);
  const avatarInitials = getNameInitials(contactName, convPhone);

  const normalizedMessageType = normalizeBubbleMessage(message).type;
  const sourceBadge = getMessageSourceBadge(message, normalizedMessageType);
  const isAi = sourceBadge?.label === "AI";
  const isFlow = sourceBadge?.label === "Flow";
  const isManual = sourceBadge?.label === "Human";
  const isFailed = message.delivery_status === "failed";

  function handleCopy() {
    void navigator.clipboard.writeText(message.message_text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (isActivity) {
    return (
      <div className="iv-activity-pill">
        <span>{message.message_text}</span>
      </div>
    );
  }

  const bubbleClass = [
    "iv-bubble",
    isPrivate ? "private" : isOutbound ? "outbound" : "inbound",
    isAi ? "iv-bubble-ai" : "",
    isFlow ? "iv-bubble-flow" : "",
    isFailed ? "iv-bubble-failed" : "",
    isFirst ? "iv-bubble-group-first" : ""
  ].filter(Boolean).join(" ");

  return (
    <div className={`iv-msg-row${isOutbound ? " outbound" : ""}`}>
      {!isOutbound && (
        showAvatar
          ? <div className={`iv-msg-avatar-sm iv-avatar av-${avatarColor}`} style={{ fontSize: 8 }}>
              {avatarInitials}
            </div>
          : <div className="iv-msg-avatar-space" />
      )}

      <div className={bubbleClass} style={{ position: "relative" }}>
        {isPrivate && (
          <div className="iv-bubble-private-label">🔒 Private Note</div>
        )}
        {quotedMessage && (
          <div className="iv-reply-quote">
            {renderFormattedText((quotedMessage.message_text ?? "").slice(0, 120), `quote-${message.id}`)}
          </div>
        )}

        {renderContent(message)}

        {/* Meta row: badges + sender + time + delivery + actions */}
        <div className="iv-bubble-meta">
          {sourceBadge && <span className={`iv-badge ${sourceBadge.className}`}>{sourceBadge.label}</span>}
          {isManual && message.sender_name && (
            <span className="iv-bubble-sender">{message.sender_name}</span>
          )}
          {isFirst && <span className="iv-bubble-time">{formatTime(message.created_at)}</span>}
          {isOutbound && renderDelivery(message.delivery_status, message.retry_count, () => onRetry?.(message.id))}
          {onReply && (
            <button className="iv-reply-btn" title="Reply" onClick={() => onReply(message)}>
              ↩
            </button>
          )}
          <button className="iv-copy-btn" title={copied ? "Copied!" : "Copy"} onClick={handleCopy}>
            {copied ? "✓" : "⎘"}
          </button>
          {isOutbound && (
            <button
              className={`iv-info-btn${isFailed ? " iv-info-btn-error" : ""}`}
              title={isFailed ? "Delivery failed — click for details" : "Message info"}
              onClick={() => setShowInfo((v) => !v)}
            >
              ⓘ
            </button>
          )}
        </div>

        {/* Inline error hint (always visible on failed) */}
        {isFailed && (
          <div className="iv-bubble-error-hint">
            <span className="iv-bubble-error-hint-icon">⚠</span>
            <span className="iv-bubble-error-hint-text">
              {message.error_code ? `Error ${message.error_code}: ` : ""}
              {message.error_message ?? "Message delivery failed"}
            </span>
          </div>
        )}

        {/* Info popover (toggle) */}
        {showInfo && (
          <div className="iv-info-popover">
            {message.error_code && (
              <div className="iv-info-row"><strong>Error {message.error_code}</strong></div>
            )}
            {message.error_message && (
              <div className="iv-info-row iv-info-errmsg">{message.error_message}</div>
            )}
            {message.error_code && META_ERROR_SOLUTIONS[message.error_code] && (
              <div className="iv-info-row iv-info-fix">
                <strong>Fix:</strong> {META_ERROR_SOLUTIONS[message.error_code]}
              </div>
            )}
            {!message.error_code && (
              <div className="iv-info-row">Status: {message.delivery_status}</div>
            )}
            <div className="iv-info-row iv-info-ts">
              {new Date(message.created_at).toLocaleString()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

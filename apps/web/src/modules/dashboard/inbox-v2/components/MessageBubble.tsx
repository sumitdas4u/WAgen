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

function renderFormattedText(text: string | null | undefined, keyPrefix = "fmt"): ReactNode[] {
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

function renderContent(msg: ConversationMessage): ReactNode {
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

export function MessageBubble({ message, isFirst, showAvatar, convPhone, contactName, onRetry, onReply, quotedMessage }: Props) {
  const [copied, setCopied] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const isOutbound = message.direction === "outbound";
  const isPrivate = message.is_private;
  const isActivity = message.content_type === "activity";
  const avatarColor = getNameAvatarColor(contactName, convPhone);
  const avatarInitials = getNameInitials(contactName, convPhone);

  const isAi = isOutbound && Boolean(message.ai_model);
  const isManual = isOutbound && !isAi && Boolean(message.sender_name);
  const isFlow = isOutbound && !isAi && !isManual;
  const isTemplate = message.content_type === "template" ||
    Boolean((message.payload_json as Record<string, unknown> | null)?.templateName) ||
    (message.payload_json as Record<string, unknown> | null)?.type === "template";
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
          {isAi && <span className="iv-badge iv-badge-ai">AI</span>}
          {isFlow && <span className="iv-badge iv-badge-flow">Flow</span>}
          {isTemplate && <span className="iv-badge iv-badge-template">Template</span>}
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

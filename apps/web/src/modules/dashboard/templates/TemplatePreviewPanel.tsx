import type { TemplateComponent } from "../../../lib/api";

function safeMediaUrl(url: string | null): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:" && parsed.protocol !== "blob:") {
      return "";
    }
    return parsed.href;
  } catch {
    return "";
  }
}

function highlightVariables(text: string): React.ReactNode {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return parts.map((part, i) =>
    /^\{\{[^}]+\}\}$/.test(part) ? (
      <span
        key={i}
        style={{
          background: "rgba(37,211,102,0.15)",
          color: "#128c7e",
          borderRadius: "3px",
          padding: "0 3px",
          fontWeight: 600,
          fontSize: "inherit"
        }}
      >
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function renderButton(btn: { type: string; text: string }) {
  const icon =
    btn.type === "URL"
      ? "↗"
      : btn.type === "PHONE_NUMBER"
        ? "📞"
        : btn.type === "COPY_CODE"
          ? "📋"
          : null;
  return (
    <div
      key={btn.text}
      style={{
        padding: "10px 14px",
        borderTop: "1px solid rgba(0,0,0,0.08)",
        color: "#128c7e",
        fontWeight: 600,
        fontSize: "13px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        cursor: "default"
      }}
    >
      {icon && <span>{icon}</span>}
      {btn.text}
    </div>
  );
}

interface Props {
  components: TemplateComponent[];
  businessName?: string;
  headerMediaType?: TemplateComponent["format"];
  headerMediaUrl?: string;
  headerImageUrl?: string;
}

function getHeaderMediaPreview(
  format: TemplateComponent["format"] | undefined,
  url: string | null
): React.ReactNode {
  if (format === "IMAGE") {
    return url ? (
      <img
        src={safeMediaUrl(url)}
        alt="Header"
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    ) : (
      <span style={{ fontSize: "13px", color: "#666" }}>Image header</span>
    );
  }

  if (format === "VIDEO") {
    return url ? (
      <video
        src={safeMediaUrl(url)}
        controls
        muted
        playsInline
        style={{ width: "100%", height: "100%", objectFit: "cover", background: "#101828" }}
      />
    ) : (
      <span style={{ fontSize: "13px", color: "#666" }}>Video header</span>
    );
  }

  if (format === "DOCUMENT") {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          padding: "12px",
          textAlign: "center"
        }}
      >
        <span style={{ fontSize: "28px", lineHeight: 1 }}>📄</span>
        <span style={{ fontSize: "13px", color: "#475467", fontWeight: 600 }}>Document header</span>
        {url ? (
          <a
            href={safeMediaUrl(url)}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#128c7e", fontSize: "12px", wordBreak: "break-all" }}
          >
            Open uploaded file
          </a>
        ) : (
          <span style={{ fontSize: "12px", color: "#666" }}>No document uploaded yet</span>
        )}
      </div>
    );
  }

  if (format === "LOCATION") {
    return <span style={{ fontSize: "13px", color: "#666" }}>Location header</span>;
  }

  return null;
}

export function TemplatePreviewPanel({
  components,
  businessName = "Your Business",
  headerMediaType,
  headerMediaUrl,
  headerImageUrl
}: Props) {
  const header = components.find((c) => c.type === "HEADER");
  const body = components.find((c) => c.type === "BODY");
  const footer = components.find((c) => c.type === "FOOTER");
  const buttonsComp = components.find((c) => c.type === "BUTTONS");
  const example = header?.example as { header_handle?: string[]; header_url?: string[] } | undefined;
  const exampleMediaUrl =
    example?.header_url?.[0] ||
    (example?.header_handle?.[0] && /^https?:\/\//i.test(example.header_handle[0]) ? example.header_handle[0] : "") ||
    "";

  const resolvedHeaderFormat = headerMediaType ?? header?.format;
  const resolvedMediaUrl =
    headerMediaUrl ||
    headerImageUrl ||
    exampleMediaUrl ||
    null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "16px",
        background: "#f0f0f0",
        borderRadius: "12px",
        minHeight: "400px"
      }}
    >
      {/* Phone header bar */}
      <div
        style={{
          width: "100%",
          maxWidth: "320px",
          background: "#075e54",
          borderRadius: "12px 12px 0 0",
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          color: "#fff"
        }}
      >
        <div
          style={{
            width: "34px",
            height: "34px",
            borderRadius: "50%",
            background: "#25d366",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: "14px",
            flexShrink: 0
          }}
        >
          {businessName.charAt(0).toUpperCase()}
        </div>
        <div style={{ fontSize: "14px", fontWeight: 600 }}>{businessName}</div>
        <div style={{ marginLeft: "auto", opacity: 0.8, fontSize: "11px" }}>✓</div>
      </div>

      {/* Chat area */}
      <div
        style={{
          width: "100%",
          maxWidth: "320px",
          background: "#e5ddd5",
          padding: "12px 10px",
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23c8c3b8' fill-opacity='0.3'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
          minHeight: "200px",
          flex: 1
        }}
      >
        {/* Message bubble */}
        <div
          style={{
            background: "#fff",
            borderRadius: "0 8px 8px 8px",
            maxWidth: "90%",
            boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
            overflow: "hidden"
          }}
        >
          {/* Header */}
          {header && header.format === "TEXT" && header.text && (
            <div
              style={{
                padding: "10px 12px 6px",
                fontWeight: 700,
                fontSize: "14px",
                color: "#111"
              }}
            >
              {highlightVariables(header.text)}
            </div>
          )}
          {header && header.format === "IMAGE" && (
            <div
              style={{
                height: "140px",
                overflow: "hidden",
                background: "#d0d0d0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              {getHeaderMediaPreview(resolvedHeaderFormat, resolvedMediaUrl)}
            </div>
          )}
          {header && header.format === "VIDEO" && (
            <div
              style={{
                background: "#ccc",
                height: "160px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#666",
                fontSize: "13px",
                gap: "6px"
              }}
            >
              {getHeaderMediaPreview(resolvedHeaderFormat, resolvedMediaUrl)}
            </div>
          )}
          {header && header.format === "DOCUMENT" && (
            <div
              style={{
                background: "#ccc",
                minHeight: "96px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#666",
                fontSize: "13px",
                gap: "6px"
              }}
            >
              {getHeaderMediaPreview(resolvedHeaderFormat, resolvedMediaUrl)}
            </div>
          )}
          {header && header.format === "LOCATION" && (
            <div
              style={{
                background: "#ccc",
                height: "100px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#666",
                fontSize: "13px",
                gap: "6px"
              }}
            >
              {getHeaderMediaPreview(resolvedHeaderFormat, resolvedMediaUrl)}
            </div>
          )}

          {/* Body */}
          {body?.text && (
            <div
              style={{
                padding: "8px 12px",
                fontSize: "13px",
                lineHeight: "1.5",
                color: "#303030",
                whiteSpace: "pre-wrap"
              }}
            >
              {highlightVariables(body.text)}
            </div>
          )}

          {/* Footer */}
          {footer?.text && (
            <div
              style={{
                padding: "2px 12px 10px",
                fontSize: "11px",
                color: "#888"
              }}
            >
              {footer.text}
            </div>
          )}

          {/* Timestamp placeholder */}
          {!buttonsComp && (
            <div
              style={{
                padding: "0 12px 6px",
                fontSize: "10px",
                color: "#aaa",
                textAlign: "right"
              }}
            >
              12:00 ✓✓
            </div>
          )}

          {/* Buttons */}
          {buttonsComp?.buttons && buttonsComp.buttons.length > 0 && (
            <div style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
              {buttonsComp.buttons.map((btn) => renderButton(btn))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom input bar */}
      <div
        style={{
          width: "100%",
          maxWidth: "320px",
          background: "#f0f0f0",
          borderRadius: "0 0 12px 12px",
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          borderTop: "1px solid #ddd"
        }}
      >
        <div
          style={{
            flex: 1,
            background: "#fff",
            borderRadius: "20px",
            padding: "6px 12px",
            fontSize: "12px",
            color: "#aaa"
          }}
        >
          Message
        </div>
        <div style={{ fontSize: "18px" }}>🎙️</div>
      </div>
    </div>
  );
}

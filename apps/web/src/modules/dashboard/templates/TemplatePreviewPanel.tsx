import type { TemplateComponent } from "../../../lib/api";

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
}

export function TemplatePreviewPanel({ components, businessName = "Your Business" }: Props) {
  const header = components.find((c) => c.type === "HEADER");
  const body = components.find((c) => c.type === "BODY");
  const footer = components.find((c) => c.type === "FOOTER");
  const buttonsComp = components.find((c) => c.type === "BUTTONS");

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
          {header && header.format !== "TEXT" && header.format && (
            <div
              style={{
                background: "#ccc",
                height: "120px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#666",
                fontSize: "13px",
                gap: "6px"
              }}
            >
              {header.format === "IMAGE" && "🖼️ Image"}
              {header.format === "VIDEO" && "🎬 Video"}
              {header.format === "DOCUMENT" && "📄 Document"}
              {header.format === "LOCATION" && "📍 Location"}
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

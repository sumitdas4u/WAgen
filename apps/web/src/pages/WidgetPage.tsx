import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchWhatsAppStatus } from "../lib/api";
import { useAuth } from "../lib/auth-context";

type WidgetPosition = "RIGHT" | "LEFT";

interface WidgetFormState {
  siteName: string;
  siteTag: string;
  welcomeMessage: string;
  prefillMessage: string;
  buttonLabel: string;
  brandColor: string;
  widgetPosition: WidgetPosition;
  widgetPositionMarginX: number;
  widgetPositionMarginY: number;
}

const DEFAULT_WIDGET_STATE: WidgetFormState = {
  siteName: "Your Website",
  siteTag: "Usually reply in 4 minutes",
  welcomeMessage: "Hi there, how can we help you?",
  prefillMessage: "Hello, I need help",
  buttonLabel: "Chat on WhatsApp",
  brandColor: "#25D366",
  widgetPosition: "RIGHT",
  widgetPositionMarginX: 12,
  widgetPositionMarginY: 12
};

function escapeScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n");
}

function normalizeWaId(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

function buildWidgetScript(config: WidgetFormState, waId: string): string {
  return `<script>
  (function (w, d) {
    var cfg = {
      waId: "${escapeScriptString(waId)}",
      siteName: "${escapeScriptString(config.siteName)}",
      siteTag: "${escapeScriptString(config.siteTag)}",
      welcomeMessage: "${escapeScriptString(config.welcomeMessage)}",
      prefillMessage: "${escapeScriptString(config.prefillMessage)}",
      buttonLabel: "${escapeScriptString(config.buttonLabel)}",
      brandColor: "${escapeScriptString(config.brandColor)}",
      widgetPosition: "${config.widgetPosition}",
      widgetPositionMarginX: ${Math.max(0, config.widgetPositionMarginX)},
      widgetPositionMarginY: ${Math.max(0, config.widgetPositionMarginY)}
    };

    if (!cfg.waId) return;
    if (d.getElementById("typo-wa-widget-root")) return;

    var style = d.createElement("style");
    style.textContent =
      "#typo-wa-widget-root{position:fixed;z-index:2147483647;bottom:" + cfg.widgetPositionMarginY + "px;" +
      (cfg.widgetPosition === "RIGHT" ? "right:" : "left:") + cfg.widgetPositionMarginX + "px;font-family:Arial,sans-serif}" +
      ".typo-wa-fab{width:56px;height:56px;border-radius:999px;border:0;cursor:pointer;background:" + cfg.brandColor + ";color:#fff;font-size:26px;box-shadow:0 10px 24px rgba(0,0,0,.2)}" +
      ".typo-wa-panel{width:300px;max-width:calc(100vw - 28px);border:1px solid #d4dbe7;border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 14px 36px rgba(0,0,0,.2);margin-bottom:10px;display:none}" +
      ".typo-wa-panel.open{display:block}" +
      ".typo-wa-head{background:" + cfg.brandColor + ";color:#fff;padding:12px}" +
      ".typo-wa-head strong{display:block;font-size:16px}" +
      ".typo-wa-head small{display:block;font-size:12px;opacity:.95}" +
      ".typo-wa-body{padding:12px;background:#ece8e3}" +
      ".typo-wa-bubble{background:#fff;border-radius:10px;padding:10px;font-size:14px;line-height:1.35}" +
      ".typo-wa-row{display:flex;gap:8px;margin-top:10px}" +
      ".typo-wa-input{flex:1;border:1px solid #ccd4e2;border-radius:9px;padding:10px;font-size:14px}" +
      ".typo-wa-send{border:0;border-radius:9px;padding:10px 12px;background:#1a2b48;color:#fff;font-weight:700;cursor:pointer}";
    d.head.appendChild(style);

    var root = d.createElement("div");
    root.id = "typo-wa-widget-root";
    root.innerHTML =
      "<div class='typo-wa-panel' id='typo-wa-panel'>" +
      "<div class='typo-wa-head'><strong>" + cfg.siteName + "</strong><small>" + cfg.siteTag + "</small></div>" +
      "<div class='typo-wa-body'>" +
      "<div class='typo-wa-bubble'>" + cfg.welcomeMessage + "</div>" +
      "<div class='typo-wa-row'>" +
      "<input id='typo-wa-input' class='typo-wa-input' placeholder='Type your message'/>" +
      "<button id='typo-wa-send' class='typo-wa-send'>" + cfg.buttonLabel + "</button>" +
      "</div></div></div>" +
      "<button id='typo-wa-fab' class='typo-wa-fab' aria-label='Open WhatsApp chat'>W</button>";
    d.body.appendChild(root);

    var panel = d.getElementById("typo-wa-panel");
    var fab = d.getElementById("typo-wa-fab");
    var input = d.getElementById("typo-wa-input");
    var send = d.getElementById("typo-wa-send");

    var openChat = function () {
      var text = (input && input.value ? input.value : cfg.prefillMessage) || cfg.prefillMessage;
      var url = "https://wa.me/" + cfg.waId + "?text=" + encodeURIComponent(text);
      w.open(url, "_blank");
    };

    if (fab) {
      fab.addEventListener("click", function () {
        if (!panel) return;
        panel.classList.toggle("open");
      });
    }

    if (send) {
      send.addEventListener("click", openChat);
    }

    if (input) {
      input.value = cfg.prefillMessage;
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          openChat();
        }
      });
    }
  })(window, document);
</script>`;
}

export function WidgetPage() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [form, setForm] = useState<WidgetFormState>(DEFAULT_WIDGET_STATE);
  const [connectedWaId, setConnectedWaId] = useState("");
  const [whatsAppStatus, setWhatsAppStatus] = useState("unknown");
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    if (!token) {
      return;
    }
    void fetchWhatsAppStatus(token)
      .then((response) => {
        setWhatsAppStatus(response.status || "unknown");
        setConnectedWaId(normalizeWaId(response.phoneNumber));
      })
      .catch(() => {
        setWhatsAppStatus("disconnected");
        setConnectedWaId("");
      });
  }, [token]);

  const canGenerate = Boolean(connectedWaId) && isConfirmed;
  const scriptSnippet = useMemo(() => buildWidgetScript(form, connectedWaId), [form, connectedWaId]);

  const setField = <K extends keyof WidgetFormState>(field: K, value: WidgetFormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(scriptSnippet);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  };

  return (
    <main className="widget-builder-page">
      <header className="widget-builder-topbar">
        <div>
          <h1>Website WhatsApp Widget</h1>
          <p>Copy this code to your website so customers can start WhatsApp chat from your SaaS bot number.</p>
        </div>
        <div className="widget-builder-top-actions">
          <button type="button" className="ghost-btn" onClick={() => navigate("/dashboard")}>
            Back to Dashboard
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={!canGenerate}
            onClick={() => {
              setCopyStatus("idle");
              setShowCodeModal(true);
            }}
          >
            Generate Integration Code
          </button>
        </div>
      </header>

      <section className="widget-builder-layout">
        <section className="widget-builder-form-col">
          <article className="widget-form-card">
            <h2>WhatsApp Connection</h2>
            <div className="widget-form-grid">
              <label>
                Connected WhatsApp Number
                <input value={connectedWaId ? `+${connectedWaId}` : "Not connected"} readOnly />
              </label>
              <p className="tiny-note">
                Status: <strong>{whatsAppStatus}</strong>. {connectedWaId ? "This number will be used in widget code." : "Scan WhatsApp QR first."}
              </p>
            </div>
          </article>

          <article className="widget-form-card">
            <h2>Widget Content</h2>
            <div className="widget-form-grid">
              <label>
                Business Name
                <input value={form.siteName} onChange={(event) => setField("siteName", event.target.value)} />
              </label>
              <label>
                Tag Line
                <input value={form.siteTag} onChange={(event) => setField("siteTag", event.target.value)} />
              </label>
              <label>
                Welcome Message
                <input
                  value={form.welcomeMessage}
                  onChange={(event) => setField("welcomeMessage", event.target.value)}
                />
              </label>
              <label>
                Default Typed Message
                <input
                  value={form.prefillMessage}
                  onChange={(event) => setField("prefillMessage", event.target.value)}
                />
              </label>
              <label>
                Button Label
                <input value={form.buttonLabel} onChange={(event) => setField("buttonLabel", event.target.value)} />
              </label>
              <label>
                Brand Color
                <div className="widget-color-row">
                  <input
                    type="color"
                    value={form.brandColor}
                    onChange={(event) => setField("brandColor", event.target.value)}
                  />
                  <input value={form.brandColor} onChange={(event) => setField("brandColor", event.target.value)} />
                </div>
              </label>
              <fieldset className="widget-radio-group">
                <legend>Widget Position</legend>
                <label>
                  <input
                    type="radio"
                    checked={form.widgetPosition === "LEFT"}
                    onChange={() => setField("widgetPosition", "LEFT")}
                  />
                  Bottom Left
                </label>
                <label>
                  <input
                    type="radio"
                    checked={form.widgetPosition === "RIGHT"}
                    onChange={() => setField("widgetPosition", "RIGHT")}
                  />
                  Bottom Right
                </label>
              </fieldset>
            </div>

            <label className="widget-confirm-row">
              <input
                type="checkbox"
                checked={isConfirmed}
                onChange={(event) => setIsConfirmed(event.target.checked)}
              />
              I confirm this is the final widget setup for my website.
            </label>
          </article>
        </section>

        <aside className="widget-preview-col">
          <h2>Live Preview</h2>
          <div className="widget-preview-card">
            <header style={{ background: form.brandColor }}>
              <div>
                <strong>{form.siteName}</strong>
                <small>{form.siteTag}</small>
              </div>
            </header>
            <div className="widget-preview-body">
              <p className="widget-preview-bubble">{form.welcomeMessage}</p>
              <div className="widget-option-row">
                <input value={form.prefillMessage} readOnly />
                <button type="button" className="primary-btn">
                  {form.buttonLabel}
                </button>
              </div>
            </div>
          </div>

          <div
            className={form.widgetPosition === "RIGHT" ? "widget-floating-button right" : "widget-floating-button left"}
            style={{
              right: form.widgetPosition === "RIGHT" ? `${form.widgetPositionMarginX}px` : "auto",
              left: form.widgetPosition === "LEFT" ? `${form.widgetPositionMarginX}px` : "auto",
              bottom: `${form.widgetPositionMarginY}px`
            }}
          >
            <span>W</span>
          </div>
        </aside>
      </section>

      {showCodeModal && (
        <div className="widget-code-modal-backdrop" onClick={() => setShowCodeModal(false)}>
          <article className="widget-code-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <h3>Website Widget Integration Code</h3>
              <button type="button" onClick={() => setShowCodeModal(false)}>
                X
              </button>
            </header>
            <pre>
              <code>{scriptSnippet}</code>
            </pre>
            <div className="widget-code-modal-actions">
              <button type="button" className="primary-btn" onClick={() => void handleCopy()}>
                Copy Code
              </button>
              {copyStatus === "copied" && <small className="info-text">Code copied to clipboard.</small>}
              {copyStatus === "error" && (
                <small className="error-text">Copy failed. You can still copy manually.</small>
              )}
            </div>
          </article>
        </div>
      )}
    </main>
  );
}

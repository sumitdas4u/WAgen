import { useState } from "react";
import type {
  GeneratedTemplate,
  MessageTemplate,
  TemplateCategory,
  TemplateComponent,
  TemplateComponentButton
} from "../../../lib/api";
import type { MetaBusinessStatus } from "../../../lib/api";
import { AIGeneratorPanel } from "./AIGeneratorPanel";
import { MediaUploader } from "./MediaUploader";
import { TemplatePreviewPanel } from "./TemplatePreviewPanel";
import { useCreateTemplateMutation } from "./queries";

const LANGUAGES = [
  { value: "en_US", label: "English (US)" },
  { value: "en_GB", label: "English (UK)" },
  { value: "hi", label: "Hindi" },
  { value: "es", label: "Spanish" },
  { value: "pt_BR", label: "Portuguese (BR)" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "id", label: "Indonesian" },
  { value: "ar", label: "Arabic" },
  { value: "ja", label: "Japanese" }
];

const CATEGORIES: Array<{ value: TemplateCategory; label: string; desc: string }> = [
  { value: "MARKETING", label: "Marketing", desc: "Promotions, offers, announcements" },
  { value: "UTILITY", label: "Utility", desc: "Order updates, confirmations, alerts" },
  { value: "AUTHENTICATION", label: "Authentication", desc: "OTPs and verification codes" }
];

const BUTTON_TYPES = [
  { type: "QUICK_REPLY", label: "↩ Custom replies", section: "Quick reply buttons" },
  { type: "URL", label: "↗ URL", note: "2 buttons maximum", section: "Call to action buttons" },
  { type: "PHONE_NUMBER", label: "📞 Phone", note: "1 button maximum", section: "Call to action buttons" },
  { type: "COPY_CODE", label: "📋 Coupon code", note: "1 button maximum", section: "Call to action buttons" }
] as const;

function detectVariables(text: string): string[] {
  const matches = [...text.matchAll(/\{\{([^}]+)\}\}/g)];
  return [...new Set(matches.map((m) => m[0]))];
}

function buildComponents(
  name_: string,
  headerFormat: string,
  headerText: string,
  headerHandle: string,
  bodyText: string,
  footerText: string,
  buttons: Array<{ type: string; text: string; url?: string; phone?: string; coupon?: string }>,
  variableMapping: Record<string, string>
): TemplateComponent[] {
  const components: TemplateComponent[] = [];

  if (headerFormat !== "NONE") {
    const headerComp: TemplateComponent = {
      type: "HEADER",
      format: headerFormat as TemplateComponent["format"]
    };
    if (headerFormat === "TEXT" && headerText.trim()) {
      headerComp.text = headerText.trim();
    }
    if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat) && headerHandle) {
      headerComp.example = { header_handle: [headerHandle] };
    }
    components.push(headerComp);
  }

  if (bodyText.trim()) {
    const bodyComp: TemplateComponent = { type: "BODY", text: bodyText.trim() };
    const vars = detectVariables(bodyText);
    if (vars.length > 0) {
      const exampleValues = vars.map((v) => variableMapping[v] || v.replace(/\{\{|\}\}/g, ""));
      bodyComp.example = { body_text: [exampleValues] };
    }
    components.push(bodyComp);
  }

  if (footerText.trim()) {
    components.push({ type: "FOOTER", text: footerText.trim() });
  }

  if (buttons.length > 0) {
    const btns: TemplateComponentButton[] = buttons.map((b) => {
      const btn: TemplateComponentButton = { type: b.type as TemplateComponentButton["type"], text: b.text };
      if (b.url) btn.url = b.url;
      if (b.phone) btn.phone_number = b.phone;
      if (b.coupon) btn.example = [b.coupon];
      return btn;
    });
    components.push({ type: "BUTTONS", buttons: btns });
  }

  return components;
}

interface Props {
  token: string;
  metaStatus?: MetaBusinessStatus | null;
  onBack: () => void;
  onCreated: (template: MessageTemplate) => void;
}

export function TemplateCreatePage({ token, metaStatus, onBack, onCreated }: Props) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<TemplateCategory>("MARKETING");
  const [language, setLanguage] = useState("en_US");
  const [headerFormat, setHeaderFormat] = useState("NONE");
  const [headerText, setHeaderText] = useState("");
  const [headerHandle, setHeaderHandle] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [buttons, setButtons] = useState<Array<{ type: string; text: string; url?: string; phone?: string; coupon?: string }>>([]);
  const [variableMapping, setVariableMapping] = useState<Record<string, string>>({});
  const [showButtonMenu, setShowButtonMenu] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [nameError, setNameError] = useState("");

  const createMutation = useCreateTemplateMutation(token);
  const connectionId = metaStatus?.connection?.id ?? "";

  const detectedVars = detectVariables(bodyText);

  const previewComponents = buildComponents(
    name, headerFormat, headerText, headerHandle,
    bodyText, footerText, buttons, variableMapping
  );

  const connectionName = metaStatus?.connection?.displayPhoneNumber ?? metaStatus?.connection?.linkedNumber ?? "Connected";

  function applyGenerated(gen: GeneratedTemplate) {
    setName(gen.suggestedName);
    setCategory(gen.suggestedCategory);
    const header = gen.components.find((c) => c.type === "HEADER");
    const body = gen.components.find((c) => c.type === "BODY");
    const footer = gen.components.find((c) => c.type === "FOOTER");
    const buttonsComp = gen.components.find((c) => c.type === "BUTTONS");

    if (header) {
      setHeaderFormat(header.format ?? "TEXT");
      setHeaderText(header.text ?? "");
    } else {
      setHeaderFormat("NONE");
    }
    setBodyText(body?.text ?? "");
    setFooterText(footer?.text ?? "");
    setButtons(
      (buttonsComp?.buttons ?? []).map((b) => ({
        type: b.type,
        text: b.text,
        url: b.url,
        phone: b.phone_number
      }))
    );
    setShowAI(false);
  }

  function handleNameChange(val: string) {
    const cleaned = val.toLowerCase().replace(/\s/g, "_");
    setName(cleaned);
    if (cleaned && !/^[a-z0-9_]+$/.test(cleaned)) {
      setNameError("Only lowercase letters, numbers, and underscores allowed.");
    } else {
      setNameError("");
    }
  }

  function addButton(type: string) {
    setButtons((prev) => [...prev, { type, text: "" }]);
    setShowButtonMenu(false);
  }

  function removeButton(idx: number) {
    setButtons((prev) => prev.filter((_, i) => i !== idx));
  }

  function countByType(type: string) {
    return buttons.filter((b) => b.type === type).length;
  }

  function canAddButtonType(type: string) {
    if (type === "QUICK_REPLY") return buttons.filter((b) => b.type === "QUICK_REPLY").length < 3;
    if (type === "URL") return countByType("URL") < 2;
    return countByType(type) < 1;
  }

  async function handleSubmit() {
    if (!connectionId) return;
    const components = buildComponents(
      name, headerFormat, headerText, headerHandle,
      bodyText, footerText, buttons, variableMapping
    );
    try {
      const template = await createMutation.mutateAsync({
        connectionId,
        name: name.trim(),
        category,
        language,
        components
      });
      onCreated(template);
    } catch {
      // error displayed via mutation state
    }
  }

  const isValid =
    name.trim().length > 0 &&
    !nameError &&
    bodyText.trim().length > 0 &&
    connectionId.length > 0 &&
    !createMutation.isPending;

  return (
    <div style={{ display: "flex", gap: "24px", minHeight: "80vh", position: "relative" }}>
      {/* Left: form */}
      <div style={{ flex: "1 1 60%", minWidth: 0, display: "flex", flexDirection: "column", gap: "16px" }}>

        {/* Top fields */}
        <div>
          <label style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: "13px", marginBottom: "6px" }}>
            Template name <span style={{ color: "#dc2626" }}>*</span>
            <span style={{ color: "#aaa", fontWeight: 400 }}>{name.length}/60</span>
          </label>
          <input
            value={name}
            onChange={(e) => handleNameChange(e.target.value.slice(0, 60))}
            placeholder="welcome_template, orderconfirmation"
            style={{
              width: "100%",
              borderRadius: "8px",
              border: `1.5px solid ${nameError ? "#dc2626" : "#e0e0e0"}`,
              padding: "10px 12px",
              fontSize: "14px",
              boxSizing: "border-box"
            }}
          />
          {nameError && <div style={{ color: "#dc2626", fontSize: "12px", marginTop: "4px" }}>{nameError}</div>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
          <div>
            <label style={{ display: "block", fontWeight: 600, fontSize: "13px", marginBottom: "6px" }}>
              Category <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as TemplateCategory)}
              style={{ width: "100%", borderRadius: "8px", border: "1.5px solid #e0e0e0", padding: "10px 12px", fontSize: "14px" }}
            >
              <option value="" disabled>Select Category</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontWeight: 600, fontSize: "13px", marginBottom: "6px" }}>
              Channel <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <div style={{
              borderRadius: "8px",
              border: "1.5px solid #e0e0e0",
              padding: "10px 12px",
              fontSize: "14px",
              background: "#f9f9f9",
              color: connectionId ? "#111" : "#aaa",
              display: "flex",
              alignItems: "center",
              gap: "6px"
            }}>
              <span style={{ color: "#25d366" }}>●</span>
              {connectionId ? connectionName : "No Meta connection"}
            </div>
          </div>
          <div>
            <label style={{ display: "block", fontWeight: 600, fontSize: "13px", marginBottom: "6px" }}>
              Language <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              style={{ width: "100%", borderRadius: "8px", border: "1.5px solid #e0e0e0", padding: "10px 12px", fontSize: "14px" }}
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Header card */}
        <div style={{ border: "1.5px solid #e0e0e0", borderRadius: "12px", padding: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
            <span style={{ fontWeight: 700, fontSize: "15px" }}>Message header</span>
            <span style={{ fontSize: "11px", background: "#f3f4f6", padding: "2px 8px", borderRadius: "999px", color: "#666" }}>Optional</span>
          </div>
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            {["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT", "LOCATION"].map((fmt) => (
              <label key={fmt} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "14px" }}>
                <input
                  type="radio"
                  name="headerFormat"
                  value={fmt}
                  checked={headerFormat === fmt}
                  onChange={() => { setHeaderFormat(fmt); setHeaderText(""); setHeaderHandle(""); }}
                  style={{ accentColor: "#25d366" }}
                />
                {fmt.charAt(0) + fmt.slice(1).toLowerCase()}
              </label>
            ))}
          </div>
          {headerFormat === "TEXT" && (
            <input
              value={headerText}
              onChange={(e) => setHeaderText(e.target.value.slice(0, 60))}
              placeholder="Header text (max 60 chars)"
              maxLength={60}
              style={{
                marginTop: "12px",
                width: "100%",
                borderRadius: "8px",
                border: "1.5px solid #e0e0e0",
                padding: "10px 12px",
                fontSize: "14px",
                boxSizing: "border-box"
              }}
            />
          )}
          {["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat) && (
            <div style={{ marginTop: "12px" }}>
              <MediaUploader
                mediaType={headerFormat as "IMAGE" | "VIDEO" | "DOCUMENT"}
                onUploaded={(url) => setHeaderHandle(url)}
              />
            </div>
          )}
        </div>

        {/* Body card */}
        <div style={{ border: "1.5px solid #e0e0e0", borderRadius: "12px", padding: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
            <span style={{ fontWeight: 700, fontSize: "15px" }}>Message body</span>
            <span style={{ fontSize: "11px", background: "#dc262622", color: "#dc2626", padding: "2px 8px", borderRadius: "999px" }}>Required</span>
          </div>
          <div style={{ position: "relative" }}>
            <textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value.slice(0, 1024))}
              placeholder="Hi {{Name}}!&#10;&#10;Write your message here. Use {{VariableName}} for dynamic content."
              rows={6}
              style={{
                width: "100%",
                borderRadius: "8px",
                border: "1.5px solid #e0e0e0",
                padding: "10px 12px",
                fontSize: "14px",
                boxSizing: "border-box",
                fontFamily: "inherit",
                resize: "vertical"
              }}
            />
            <div style={{ textAlign: "right", fontSize: "11px", color: "#aaa", marginTop: "2px" }}>
              {bodyText.length}/1024
            </div>
          </div>

          {/* Toolbar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px" }}>
            <button
              type="button"
              onClick={() => {
                const next = detectedVars.length + 1;
                setBodyText((t) => t + `{{var${next}}}`);
              }}
              style={{
                padding: "6px 14px",
                borderRadius: "999px",
                border: "1.5px solid #25d366",
                color: "#25d366",
                background: "transparent",
                fontWeight: 600,
                fontSize: "13px",
                cursor: "pointer"
              }}
            >
              Add variables
            </button>
            <div style={{ display: "flex", gap: "10px", color: "#666", fontSize: "14px" }}>
              <button type="button" onClick={() => setBodyText((t) => t + "*bold*")} style={{ background: "none", border: "none", fontWeight: 700, cursor: "pointer", color: "#555" }}>B</button>
              <button type="button" onClick={() => setBodyText((t) => t + "_italic_")} style={{ background: "none", border: "none", fontStyle: "italic", cursor: "pointer", color: "#555" }}>I</button>
              <button type="button" onClick={() => setBodyText((t) => t + "~strikethrough~")} style={{ background: "none", border: "none", textDecoration: "line-through", cursor: "pointer", color: "#555" }}>S</button>
            </div>
          </div>

          {/* Variable mapping rows */}
          {detectedVars.length > 0 && (
            <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#666" }}>Variable examples (shown to Meta for review):</div>
              {detectedVars.map((v) => (
                <div key={v} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <code style={{ background: "#f3f4f6", padding: "3px 8px", borderRadius: "4px", fontSize: "12px", color: "#128c7e" }}>{v}</code>
                  <span style={{ color: "#aaa", fontSize: "13px" }}>→</span>
                  <input
                    value={variableMapping[v] ?? ""}
                    onChange={(e) => setVariableMapping((m) => ({ ...m, [v]: e.target.value }))}
                    placeholder={`Example for ${v}`}
                    style={{ flex: 1, borderRadius: "6px", border: "1.5px solid #e0e0e0", padding: "5px 10px", fontSize: "13px" }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer card */}
        <div style={{ border: "1.5px solid #e0e0e0", borderRadius: "12px", padding: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontWeight: 700, fontSize: "15px" }}>Footer</span>
              <span style={{ fontSize: "11px", background: "#f3f4f6", padding: "2px 8px", borderRadius: "999px", color: "#666" }}>Optional</span>
            </div>
            <span style={{ fontSize: "11px", color: "#aaa" }}>{footerText.length}/60</span>
          </div>
          <input
            value={footerText}
            onChange={(e) => setFooterText(e.target.value.slice(0, 60))}
            placeholder="You can use this space to add a tagline, a way to unsubscribe, etc.,"
            style={{
              width: "100%",
              borderRadius: "8px",
              border: "1.5px solid #e0e0e0",
              padding: "10px 12px",
              fontSize: "14px",
              boxSizing: "border-box"
            }}
          />
        </div>

        {/* Buttons card */}
        <div style={{ border: "1.5px solid #e0e0e0", borderRadius: "12px", padding: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <span style={{ fontWeight: 700, fontSize: "15px" }}>Buttons</span>
            <span style={{ fontSize: "11px", background: "#f3f4f6", padding: "2px 8px", borderRadius: "999px", color: "#666" }}>Optional</span>
          </div>
          <p style={{ margin: "0 0 4px", fontSize: "13px", color: "#444" }}>
            Create buttons that let customers respond to your message or take action.
          </p>
          <p style={{ margin: "0 0 12px", fontSize: "13px", color: "#888", fontStyle: "italic" }}>
            If you add more than three buttons, they will appear in a list.
          </p>

          {buttons.map((btn, idx) => (
            <div key={idx} style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
              <div style={{ width: "20px", fontSize: "14px" }}>
                {btn.type === "URL" ? "↗" : btn.type === "PHONE_NUMBER" ? "📞" : btn.type === "COPY_CODE" ? "📋" : "↩"}
              </div>
              <input
                value={btn.text}
                onChange={(e) => setButtons((prev) => prev.map((b, i) => i === idx ? { ...b, text: e.target.value } : b))}
                placeholder="Button text"
                maxLength={25}
                style={{ flex: 1, borderRadius: "6px", border: "1.5px solid #e0e0e0", padding: "7px 10px", fontSize: "13px" }}
              />
              {btn.type === "URL" && (
                <input
                  value={btn.url ?? ""}
                  onChange={(e) => setButtons((prev) => prev.map((b, i) => i === idx ? { ...b, url: e.target.value } : b))}
                  placeholder="https://..."
                  style={{ flex: 1, borderRadius: "6px", border: "1.5px solid #e0e0e0", padding: "7px 10px", fontSize: "13px" }}
                />
              )}
              {btn.type === "PHONE_NUMBER" && (
                <input
                  value={btn.phone ?? ""}
                  onChange={(e) => setButtons((prev) => prev.map((b, i) => i === idx ? { ...b, phone: e.target.value } : b))}
                  placeholder="+1234567890"
                  style={{ flex: 1, borderRadius: "6px", border: "1.5px solid #e0e0e0", padding: "7px 10px", fontSize: "13px" }}
                />
              )}
              <button
                type="button"
                onClick={() => removeButton(idx)}
                style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: "16px", padding: "0 4px" }}
              >
                ×
              </button>
            </div>
          ))}

          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setShowButtonMenu((v) => !v)}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "8px",
                border: "1.5px solid #d1d5db",
                background: "#f9fafb",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px"
              }}
            >
              + Add a button ▾
            </button>
            {showButtonMenu && (
              <div style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                right: 0,
                background: "#fff",
                border: "1.5px solid #e0e0e0",
                borderRadius: "10px",
                boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
                zIndex: 20,
                overflow: "hidden"
              }}>
                <div style={{ padding: "8px 12px", fontSize: "11px", fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Quick reply buttons
                </div>
                {["QUICK_REPLY"].map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => canAddButtonType(type) && addButton(type)}
                    disabled={!canAddButtonType(type)}
                    style={{
                      display: "flex", alignItems: "center", gap: "10px", width: "100%",
                      padding: "10px 16px", background: "none", border: "none", cursor: canAddButtonType(type) ? "pointer" : "not-allowed",
                      opacity: canAddButtonType(type) ? 1 : 0.4, fontSize: "14px"
                    }}
                  >
                    <span>↩</span> Custom replies
                  </button>
                ))}
                <div style={{ borderTop: "1px solid #f0f0f0", padding: "8px 12px", fontSize: "11px", fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Call to action buttons
                </div>
                {BUTTON_TYPES.filter((bt) => bt.section === "Call to action buttons").map((bt) => (
                  <button
                    key={bt.type}
                    type="button"
                    onClick={() => canAddButtonType(bt.type) && addButton(bt.type)}
                    disabled={!canAddButtonType(bt.type)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
                      padding: "10px 16px", background: "none", border: "none", cursor: canAddButtonType(bt.type) ? "pointer" : "not-allowed",
                      opacity: canAddButtonType(bt.type) ? 1 : 0.4
                    }}
                  >
                    <span style={{ fontSize: "14px" }}>{bt.label}</span>
                    <span style={{ fontSize: "11px", color: "#aaa" }}>{bt.note}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Error */}
        {createMutation.isError && (
          <div style={{ padding: "12px", borderRadius: "8px", background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", fontSize: "13px" }}>
            {(createMutation.error as Error).message}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: "10px", paddingTop: "8px" }}>
          <button
            type="button"
            onClick={onBack}
            style={{ padding: "10px 20px", borderRadius: "8px", border: "1.5px solid #e0e0e0", background: "#fff", cursor: "pointer", fontSize: "14px" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => setShowAI(true)}
            style={{ padding: "10px 20px", borderRadius: "8px", border: "1.5px solid #25d366", background: "#f0fdf4", color: "#166534", cursor: "pointer", fontWeight: 600, fontSize: "14px" }}
          >
            Generate with AI ✨
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid}
            style={{
              marginLeft: "auto",
              padding: "10px 24px",
              borderRadius: "8px",
              background: isValid ? "#25d366" : "#ccc",
              color: "#fff",
              border: "none",
              fontWeight: 700,
              fontSize: "14px",
              cursor: isValid ? "pointer" : "not-allowed"
            }}
          >
            {createMutation.isPending ? "Submitting..." : "Submit Template"}
          </button>
        </div>
      </div>

      {/* Right: preview */}
      <div style={{ flex: "0 0 320px", position: "sticky", top: "24px", height: "fit-content" }}>
        {showAI ? (
          <div style={{ border: "1.5px solid #e0e0e0", borderRadius: "12px", position: "relative", overflow: "hidden", minHeight: "500px" }}>
            <AIGeneratorPanel
              token={token}
              onClose={() => setShowAI(false)}
              onUse={applyGenerated}
            />
          </div>
        ) : (
          <TemplatePreviewPanel components={previewComponents} businessName={connectionName} />
        )}
      </div>
    </div>
  );
}

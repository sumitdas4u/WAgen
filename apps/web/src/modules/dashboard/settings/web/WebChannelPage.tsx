import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../../../lib/auth-context";
import { useNavigate } from "react-router-dom";
import { API_URL } from "../../../../shared/api/client";
import { dashboardQueryKeys } from "../../../../shared/dashboard/query-keys";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";
import { toggleWebsiteAgent } from "../api";

type WidgetSetupDraft = {
  chatbotLogoUrl: string;
  chatbotSize: "small" | "medium" | "large";
  deviceVisibility: "both" | "phone" | "desktop";
  initialQuestions: [string, string, string];
  initialGreetingEnabled: boolean;
  initialGreeting: string;
  disclaimer: string;
  backgroundColor: string;
  previewOpen: boolean;
};

const DEFAULT_DRAFT: WidgetSetupDraft = {
  chatbotLogoUrl: "",
  chatbotSize: "medium",
  deviceVisibility: "both",
  initialQuestions: ["", "", ""],
  initialGreetingEnabled: true,
  initialGreeting: "Have questions about our business?",
  disclaimer: "Hey, how can I help you today?",
  backgroundColor: "#1a2b48",
  previewOpen: true
};

function normalizeHex(value: string): string {
  const v = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : "#1a2b48";
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function WebChannelPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { token, bootstrap, refetchBootstrap } = useDashboardShell();
  const widgetPreviewScrollRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState(DEFAULT_DRAFT);
  const [snippetCopied, setSnippetCopied] = useState<"idle" | "copied" | "error">("idle");
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    const key = `wagenai_widget_setup_draft_${user.id}`;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<WidgetSetupDraft>;
        setDraft({
          ...DEFAULT_DRAFT,
          ...parsed,
          initialQuestions: [
            parsed.initialQuestions?.[0] ?? "",
            parsed.initialQuestions?.[1] ?? "",
            parsed.initialQuestions?.[2] ?? ""
          ],
          backgroundColor: normalizeHex(parsed.backgroundColor ?? DEFAULT_DRAFT.backgroundColor)
        });
      }
    } catch { /* ignore */ }
  }, [user?.id]);

  useEffect(() => {
    if (!draft.previewOpen) return;
    const timer = window.setTimeout(() => {
      const el = widgetPreviewScrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 40);
    return () => window.clearTimeout(timer);
  }, [draft.previewOpen, draft.initialGreeting, draft.disclaimer]);

  const themeColor = normalizeHex(draft.backgroundColor);
  const previewSizeClass = draft.chatbotSize === "small" ? "size-small" : draft.chatbotSize === "large" ? "size-large" : "size-medium";
  const greetingText = (draft.initialGreetingEnabled ? draft.initialGreeting : draft.disclaimer).trim() || "Hi there, how can we help you?";
  const companyLabel = bootstrap?.userSummary?.name ?? "WAgen AI";
  const websiteEnabled = Boolean(bootstrap?.userSummary.aiActive);

  const scriptSnippet =
    `<script src="${escapeHtmlAttribute(API_URL)}/sdk/chatbot.bundle.js" ` +
    `wid="${escapeHtmlAttribute(user?.id ?? "")}" ` +
    `data-theme-color="${escapeHtmlAttribute(themeColor)}" ` +
    `data-position="right" ` +
    `data-greeting="${escapeHtmlAttribute(greetingText)}" ` +
    `data-api-base="${escapeHtmlAttribute(API_URL)}"></script>`;

  const toggleMutation = useMutation({
    mutationFn: () => toggleWebsiteAgent(token, !websiteEnabled),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.settingsRoot }),
        refetchBootstrap()
      ]);
      setInfo(
        websiteEnabled
          ? "Website channel paused. The widget stays installed, but automated replies are temporarily off."
          : "Website channel resumed. The widget stays installed and automated replies are back on."
      );
    },
    onError: (err) => setError((err as Error).message)
  });

  const updateDraft = (updater: (c: WidgetSetupDraft) => WidgetSetupDraft) => setDraft(updater);

  return (
    <section className="finance-shell">
      {(info || error) && (
        <article className="finance-panel">
          {info ? <p className="info-text">{info}</p> : null}
          {error ? <p className="error-text">{error}</p> : null}
        </article>
      )}

      <article className="channel-setup-panel">
        <header>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h3>Web Channel Setup</h3>
              <p>Customize your website chatbot appearance and pause or resume widget replies without removing the installation.</p>
            </div>
            <button
              type="button"
              className={websiteEnabled ? "go-live-switch on" : "go-live-switch"}
              disabled={toggleMutation.isPending}
              onClick={() => { setError(null); setInfo(null); toggleMutation.mutate(); }}
              title={websiteEnabled ? "Pause website channel replies" : "Resume website channel replies"}
            >
              <span />
            </button>
          </div>
        </header>

        <div className="web-widget-setup-layout">
          <section className="web-widget-form-section">
            <div className="web-widget-row">
              <label>
                Chatbot logo
                <input
                  value={draft.chatbotLogoUrl}
                  onChange={(e) => updateDraft((c) => ({ ...c, chatbotLogoUrl: e.target.value }))}
                  placeholder="Enter URL for chatbot icon"
                />
              </label>
            </div>

            <div className="web-widget-row">
              <p className="web-widget-label">Chatbot size</p>
              <div className="web-widget-radio-row">
                {(["small", "medium", "large"] as const).map((key) => (
                  <label key={key}>
                    <input type="radio" checked={draft.chatbotSize === key} onChange={() => updateDraft((c) => ({ ...c, chatbotSize: key }))} />
                    {key.charAt(0).toUpperCase() + key.slice(1)}
                  </label>
                ))}
              </div>
            </div>

            <div className="web-widget-row">
              <p className="web-widget-label">Device visibility</p>
              <div className="web-widget-radio-row">
                {(["both", "phone", "desktop"] as const).map((key) => (
                  <label key={key}>
                    <input type="radio" checked={draft.deviceVisibility === key} onChange={() => updateDraft((c) => ({ ...c, deviceVisibility: key }))} />
                    {key.charAt(0).toUpperCase() + key.slice(1)}
                  </label>
                ))}
              </div>
            </div>

            <div className="web-widget-row">
              <p className="web-widget-label">Initial questions (up to 3)</p>
              <div className="web-widget-question-list">
                {[0, 1, 2].map((idx) => (
                  <div key={idx} className="web-widget-question-item">
                    <input
                      value={draft.initialQuestions[idx as 0 | 1 | 2]}
                      onChange={(e) => {
                        const next = [...draft.initialQuestions] as [string, string, string];
                        next[idx as 0 | 1 | 2] = e.target.value;
                        setDraft((c) => ({ ...c, initialQuestions: next }));
                      }}
                      placeholder="Enter question"
                    />
                    <button type="button" className="link-btn" onClick={() => {
                      const next = [...draft.initialQuestions] as [string, string, string];
                      next[idx as 0 | 1 | 2] = "";
                      setDraft((c) => ({ ...c, initialQuestions: next }));
                    }}>Delete</button>
                  </div>
                ))}
              </div>
            </div>

            <div className="web-widget-row">
              <label className="web-widget-toggle-row">
                <span className="web-widget-label">Initial greeting</span>
                <button
                  type="button"
                  className={draft.initialGreetingEnabled ? "go-live-switch on" : "go-live-switch"}
                  onClick={() => updateDraft((c) => ({ ...c, initialGreetingEnabled: !c.initialGreetingEnabled }))}
                >
                  <span />
                </button>
              </label>
              <textarea rows={2} value={draft.initialGreeting} onChange={(e) => updateDraft((c) => ({ ...c, initialGreeting: e.target.value }))} placeholder="Enter greeting" />
            </div>

            <div className="web-widget-row">
              <label>
                Disclaimer
                <textarea rows={2} value={draft.disclaimer} onChange={(e) => updateDraft((c) => ({ ...c, disclaimer: e.target.value }))} placeholder="Enter fallback disclaimer" />
              </label>
            </div>

            <div className="web-widget-row">
              <label>
                Background colour
                <div className="web-widget-color-row">
                  <input type="color" value={themeColor} onChange={(e) => updateDraft((c) => ({ ...c, backgroundColor: e.target.value }))} />
                  <input value={draft.backgroundColor} onChange={(e) => updateDraft((c) => ({ ...c, backgroundColor: e.target.value }))} />
                </div>
              </label>
            </div>

            <div className="web-widget-row">
              <div className="web-widget-code-head">
                <p className="web-widget-label">Integration code</p>
                <button type="button" className="ghost-btn" onClick={async () => {
                  try { await navigator.clipboard.writeText(scriptSnippet); setSnippetCopied("copied"); }
                  catch { setSnippetCopied("error"); }
                }}>Copy</button>
              </div>
              <pre className="widget-inline-code"><code>{scriptSnippet}</code></pre>
              {snippetCopied === "copied" && <p className="tiny-note">Integration code copied.</p>}
              {snippetCopied === "error" && <p className="tiny-note">Copy failed. Copy from code block manually.</p>}
            </div>

            <div className="clone-hero-actions">
              <button type="button" className="primary-btn" onClick={() => {
                if (!user?.id) return;
                window.localStorage.setItem(`wagenai_widget_setup_draft_${user.id}`, JSON.stringify(draft));
                setInfo("Widget setup saved.");
                setSnippetCopied("idle");
              }}>Save</button>
              <button type="button" className="ghost-btn" onClick={() => navigate("/dashboard/studio/test")}>Test</button>
            </div>
          </section>

          <aside className="web-widget-preview-section">
            <div className="web-widget-preview-top">
              <label>
                Preview Widget
                <select value={draft.previewOpen ? "open" : "closed"} onChange={(e) => updateDraft((c) => ({ ...c, previewOpen: e.target.value === "open" }))}>
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                </select>
              </label>
            </div>
            <div className={`web-widget-preview-phone ${previewSizeClass}`}>
              <header style={{ background: themeColor }}>
                <strong>{companyLabel}</strong>
              </header>
              {draft.previewOpen && (
                <>
                  <div ref={widgetPreviewScrollRef} className="web-widget-preview-thread">
                    {draft.initialGreetingEnabled && draft.initialGreeting.trim() && <p>{draft.initialGreeting.trim()}</p>}
                    {draft.disclaimer.trim() && <small>{draft.disclaimer.trim()}</small>}
                  </div>
                  <footer>
                    <input placeholder="Type here..." readOnly />
                    <button type="button">Send</button>
                  </footer>
                </>
              )}
            </div>
            <button type="button" className="web-widget-preview-fab" style={{ background: themeColor }}>W</button>
          </aside>
        </div>
      </article>
    </section>
  );
}

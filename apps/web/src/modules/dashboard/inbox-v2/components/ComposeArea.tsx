import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useConvStore } from "../store/convStore";
import { useSendMessage, useCreateNote } from "../queries";
import { postTyping, listCannedResponses } from "../api";
import { useAuth } from "../../../../lib/auth-context";
import { uploadInboxMedia } from "../../../../lib/supabase";
import {
  aiAssistText,
  assignFlow,
  sendTemplate,
  patchAiMode,
  fetchPublishedFlows,
  fetchApprovedTemplates,
  type MessageTemplate
} from "../api";

interface Props {
  convId: string;
  optimisticMap: React.MutableRefObject<Map<string, string>>;
  replyToMsg?: import("../store/convStore").ConversationMessage | null;
  onClearReply?: () => void;
}


const TRANSLATE_LANGUAGES = ["English", "Hindi", "Spanish", "French", "Arabic", "Portuguese", "Bengali", "Urdu", "Gujarati", "Marathi", "Tamil", "Telugu"];
const PLACEHOLDER_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
const QUICK_EMOJIS = ["👍", "😊", "🙏", "✅", "🔥", "💯", "👋", "😄", "❤️", "🎉", "⚡", "📞", "📧", "💬", "🏷️", "🔔"];
const MAX_CHARS = 4000;

interface AttachedFile {
  file: File;
  previewUrl: string;
  name: string;
  mimeType: string;
}

function getTemplateBody(t: MessageTemplate): string {
  return t.components.find((c) => c.type === "BODY")?.text ?? t.name;
}

function extractVars(t: MessageTemplate): string[] {
  const body = getTemplateBody(t);
  const matches = [...body.matchAll(PLACEHOLDER_RE)];
  return [...new Set(matches.map((m) => `{{${(m[1] ?? "").trim()}}}`))];
}

interface TemplateVarsState {
  template: MessageTemplate;
  vars: string[];
  values: Record<string, string>;
  headerMediaUrl?: string | null;
}

export function ComposeArea({ convId, optimisticMap, replyToMsg, onClearReply }: Props) {
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [showCanned, setShowCanned] = useState(false);
  const [cannedSearch, setCannedSearch] = useState("");
  const [cannedIdx, setCannedIdx] = useState(-1);
  const [showReplyGuide, setShowReplyGuide] = useState(true);
  const [showAiAssistPopup, setShowAiAssistPopup] = useState(false);
  const [showFlowMenu, setShowFlowMenu] = useState(false);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [showTranslateSubmenu, setShowTranslateSubmenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isAiRewriting, setIsAiRewriting] = useState(false);
  const [templateVarsDialog, setTemplateVarsDialog] = useState<TemplateVarsState | null>(null);
  const [tookOver, setTookOver] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { token } = useAuth();
  const { byId, appendMessage, upsertConv } = useConvStore();
  const conv = byId[convId];
  const sendMsg = useSendMessage();
  const createNote = useCreateNote();

  const canManualReply = Boolean(conv && (conv.ai_paused || conv.manual_takeover || tookOver));
  const isApiChannel = conv?.channel_type === "api";

  // ── Queries ──────────────────────────────────────────────────────────────

  const cannedQuery = useQuery({
    queryKey: ["iv2-canned"],
    queryFn: () => listCannedResponses(token!),
    enabled: Boolean(token),
    staleTime: 30_000
  });

  const flowsQuery = useQuery({
    queryKey: ["iv2-flows"],
    queryFn: () => fetchPublishedFlows(token!),
    enabled: Boolean(token),
    staleTime: 60_000
  });

  const templatesQuery = useQuery({
    queryKey: ["iv2-templates", conv?.channel_linked_number ?? "all"],
    queryFn: () => fetchApprovedTemplates(token!, conv?.channel_linked_number ?? null),
    enabled: Boolean(token && isApiChannel),
    staleTime: 60_000
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const takeOverMut = useMutation({
    mutationFn: () => patchAiMode(token!, convId, true),
    onSuccess: () => {
      upsertConv({ id: convId, ai_paused: true, manual_takeover: true });
      setTookOver(true);
    }
  });

  const assignFlowMut = useMutation({
    mutationFn: ({ flowId }: { flowId: string }) => assignFlow(token!, flowId, convId),
    onSuccess: () => { setShowFlowMenu(false); showToast("Flow assigned"); },
    onError: (e: Error) => showToast(e.message)
  });

  const sendTemplateMut = useMutation({
    mutationFn: ({ templateId, vars }: { templateId: string; vars: Record<string, string> }) =>
      sendTemplate(token!, convId, templateId, vars),
    onSuccess: () => { setShowTemplateMenu(false); setTemplateVarsDialog(null); showToast("Template sent"); },
    onError: (e: Error) => showToast(e.message)
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function closeAllMenus() {
    setShowAiAssistPopup(false);
    setShowFlowMenu(false);
    setShowTemplateMenu(false);
    setShowTranslateSubmenu(false);
  }

  const broadcastTyping = useCallback((on: boolean) => {
    if (!token) return;
    void postTyping(token, convId, on);
  }, [token, convId]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value.slice(0, MAX_CHARS);
    setText(val);
    const openCanned = val.startsWith("/") && mode === "reply";
    setShowCanned(openCanned);
    if (openCanned) { setCannedSearch(val.slice(1).toLowerCase()); setCannedIdx(-1); }
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    typingDebounceRef.current = setTimeout(() => broadcastTyping(true), 300);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => broadcastTyping(false), 3_000);
  }, [broadcastTyping, mode]);

  const handleBlur = useCallback(() => {
    broadcastTyping(false);
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
  }, [broadcastTyping]);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    const hasFiles = attachedFiles.length > 0;
    if (!trimmed && !hasFiles) return;
    setIsUploading(hasFiles);

    // Upload files first (one at a time)
    const uploads: Array<{ url: string; mimeType: string }> = [];
    if (hasFiles) {
      try {
        for (const af of attachedFiles) {
          const result = await uploadInboxMedia(af.file);
          uploads.push(result);
        }
      } catch (e) {
        showToast((e as Error).message);
        setIsUploading(false);
        return;
      }
    }

    setIsUploading(false);
    const isPrivate = mode === "note";

    // Send one message per file, then text
    for (const upload of uploads) {
      const echoId = crypto.randomUUID();
      const tempId = `temp-${echoId}`;
      appendMessage(convId, {
        id: tempId, conversation_id: convId, direction: "outbound", sender_name: null,
        message_text: upload.url, content_type: upload.mimeType.startsWith("image/") ? "image" : upload.mimeType.startsWith("video/") ? "video" : upload.mimeType.startsWith("audio/") ? "audio" : "document",
        is_private: isPrivate, in_reply_to_id: null, echo_id: echoId, delivery_status: "pending",
        error_code: null, error_message: null, retry_count: 0, payload_json: { url: upload.url },
        ai_model: null, total_tokens: null, created_at: new Date().toISOString()
      });
      optimisticMap.current.set(echoId, tempId);
      void sendMsg.mutateAsync({ convId, params: { mediaUrl: upload.url, mediaMimeType: upload.mimeType, echoId, isPrivate } }).catch(() => {
        useConvStore.getState().patchMessageDelivery(convId, tempId, "failed");
        optimisticMap.current.delete(echoId);
      });
    }

    setAttachedFiles([]);

    if (trimmed) {
      setText("");
      setShowCanned(false);
      setCannedIdx(-1);
      broadcastTyping(false);

      if (isPrivate) {
        // Notes use dedicated endpoint — stored separately, always visible after reload
        try {
          await createNote.mutateAsync({ convId, content: trimmed });
        } catch (e) {
          showToast((e as Error).message);
        }
      } else {
        const echoId = crypto.randomUUID();
        const tempId = `temp-${echoId}`;
        const replyToId = replyToMsg?.id ?? null;
        appendMessage(convId, {
          id: tempId, conversation_id: convId, direction: "outbound", sender_name: null,
          message_text: trimmed, content_type: "text", is_private: false,
          in_reply_to_id: replyToId, echo_id: echoId, delivery_status: "pending",
          error_code: null, error_message: null, retry_count: 0, payload_json: null,
          ai_model: null, total_tokens: null, created_at: new Date().toISOString()
        });
        optimisticMap.current.set(echoId, tempId);
        onClearReply?.();
        try {
          await sendMsg.mutateAsync({ convId, params: { text: trimmed, echoId, isPrivate: false, inReplyToId: replyToId } });
        } catch {
          useConvStore.getState().patchMessageDelivery(convId, tempId, "failed");
          optimisticMap.current.delete(echoId);
        }
      }
    } else {
      setText("");
      setShowCanned(false);
      setCannedIdx(-1);
      broadcastTyping(false);
    }
  }, [text, attachedFiles, mode, convId, appendMessage, optimisticMap, sendMsg, broadcastTyping]);

  const cannedList = cannedQuery.data?.cannedResponses ?? [];
  const filteredCanned = cannedList.filter((c) =>
    !cannedSearch || c.short_code.includes(cannedSearch) || c.content.toLowerCase().includes(cannedSearch)
  );

  const selectCanned = useCallback((t: string) => {
    setText(t); setShowCanned(false); textareaRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCanned && filteredCanned.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCannedIdx((i) => (i + 1) % filteredCanned.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCannedIdx((i) => (i - 1 + filteredCanned.length) % filteredCanned.length);
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && cannedIdx >= 0) {
        e.preventDefault();
        const item = filteredCanned[cannedIdx];
        if (item) selectCanned(item.content);
        return;
      }
      if (e.key === "Escape") { setShowCanned(false); setCannedIdx(-1); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
    if (e.key === "Escape") { setShowCanned(false); closeAllMenus(); }
  }, [showCanned, filteredCanned, cannedIdx, handleSend, selectCanned]);

  const handleAiRewrite = useCallback(async () => {
    if (!text.trim() || isAiRewriting) return;
    setIsAiRewriting(true);
    try {
      const result = await aiAssistText(token!, text.trim(), "rewrite");
      setText(result.text);
      textareaRef.current?.focus();
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setIsAiRewriting(false);
      setShowAiAssistPopup(false);
    }
  }, [text, isAiRewriting, token]);

  const handleAiTranslate = useCallback(async (lang: string) => {
    if (!text.trim() || isAiRewriting) return;
    setIsAiRewriting(true);
    try {
      const result = await aiAssistText(token!, text.trim(), "translate", lang);
      setText(result.text);
      textareaRef.current?.focus();
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setIsAiRewriting(false);
      setShowAiAssistPopup(false);
      setShowTranslateSubmenu(false);
    }
  }, [text, isAiRewriting, token]);

  const handleSelectTemplate = useCallback((t: MessageTemplate) => {
    const vars = extractVars(t);
    if (vars.length === 0 && t.category !== "MARKETING") {
      sendTemplateMut.mutate({ templateId: t.id, vars: {} });
    } else {
      const values: Record<string, string> = {};
      vars.forEach((v) => { values[v] = ""; });
      setTemplateVarsDialog({ template: t, vars, values });
      setShowTemplateMenu(false);
    }
  }, [sendTemplateMut]);

  const applyFormat = useCallback((style: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = text.slice(start, end);
    const map: Record<string, [string, string]> = {
      bold: ["*", "*"], italic: ["_", "_"], strike: ["~", "~"], mono: ["`", "`"]
    };
    const [open, close] = map[style] ?? ["", ""];
    setText(text.slice(0, start) + open + selected + close + text.slice(end));
    setTimeout(() => { ta.setSelectionRange(start + open.length, end + open.length); ta.focus(); }, 0);
  }, [text]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const newFiles: AttachedFile[] = files.map((f) => ({
      file: f,
      previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : "",
      name: f.name,
      mimeType: f.type
    }));
    setAttachedFiles((prev) => [...prev, ...newFiles].slice(0, 5));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleRemoveAttachment = useCallback((idx: number) => {
    setAttachedFiles((prev) => {
      const next = [...prev];
      if (next[idx]?.previewUrl) URL.revokeObjectURL(next[idx].previewUrl);
      next.splice(idx, 1);
      return next;
    });
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (mode !== "reply") return;
    const imageItem = Array.from(e.clipboardData.items).find((item) => item.type.startsWith("image/"));
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    const named = new File([file], `paste-${Date.now()}.png`, { type: file.type });
    setAttachedFiles((prev) => [...prev, {
      file: named, previewUrl: URL.createObjectURL(named), name: named.name, mimeType: named.type
    }].slice(0, 5));
  }, [mode]);

  const handleEmojiSelect = useCallback((emoji: string) => {
    setText((prev) => prev + emoji);
    setShowEmojiPicker(false);
    textareaRef.current?.focus();
  }, []);

  const flows = flowsQuery.data ?? [];
  const templates = templatesQuery.data ?? [];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="iv-compose" style={{ position: "relative" }}>
      {/* Toast */}
      {toast && (
        <div className="iv-compose-toast">{toast}</div>
      )}

      {/* Template vars dialog */}
      {templateVarsDialog && (
        <div className="iv-tvd-overlay" onClick={() => setTemplateVarsDialog(null)}>
          <div className="iv-tvd" onClick={(e) => e.stopPropagation()}>
            <div className="iv-tvd-head">
              <strong>{templateVarsDialog.template.name}</strong>
              <button className="iv-tvd-close" onClick={() => setTemplateVarsDialog(null)}>✕</button>
            </div>
            <div className="iv-tvd-preview">{getTemplateBody(templateVarsDialog.template)}</div>
            {/* Header media upload (for MARKETING templates with image/video/pdf header) */}
            {templateVarsDialog.template.category === "MARKETING" && (
              <div className="iv-tvd-field">
                <label className="iv-tvd-label">Header media (image/video/PDF)</label>
                <input
                  type="file"
                  accept="image/*,video/*,application/pdf"
                  className="iv-tvd-input"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const result = await uploadInboxMedia(file);
                      setTemplateVarsDialog((prev) => prev ? { ...prev, headerMediaUrl: result.url } : prev);
                    } catch (err) {
                      showToast((err as Error).message);
                    }
                  }}
                />
                {templateVarsDialog.headerMediaUrl && (
                  <div style={{ fontSize: 11, color: "#22c55e", marginTop: 2 }}>✓ Uploaded</div>
                )}
              </div>
            )}
            {templateVarsDialog.vars.length > 0 && (
              <div className="iv-tvd-fields">
                {templateVarsDialog.vars.map((v) => (
                  <div key={v} className="iv-tvd-field">
                    <label className="iv-tvd-label">{v}</label>
                    <input
                      className="iv-tvd-input"
                      value={templateVarsDialog.values[v] ?? ""}
                      onChange={(e) => setTemplateVarsDialog((prev) =>
                        prev ? { ...prev, values: { ...prev.values, [v]: e.target.value } } : prev
                      )}
                      placeholder={`Value for ${v}`}
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="iv-tvd-footer">
              <button className="iv-tvd-cancel" onClick={() => setTemplateVarsDialog(null)}>Cancel</button>
              <button
                className="iv-tvd-send"
                disabled={sendTemplateMut.isPending}
                onClick={() => sendTemplateMut.mutate({
                  templateId: templateVarsDialog.template.id,
                  vars: templateVarsDialog.headerMediaUrl
                    ? { ...templateVarsDialog.values, headerMediaUrl: templateVarsDialog.headerMediaUrl }
                    : templateVarsDialog.values
                })}
              >
                {sendTemplateMut.isPending ? "Sending…" : "Send Template"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Canned popup */}
      {showCanned && filteredCanned.length > 0 && (
        <div className="iv-canned-popup">
          <input
            className="iv-canned-search"
            placeholder="Search canned responses..."
            value={cannedSearch}
            onChange={(e) => setCannedSearch(e.target.value)}
            autoFocus
          />
          {filteredCanned.map((c, i) => (
            <div
              key={c.id}
              className={`iv-canned-item${cannedIdx === i ? " selected" : ""}`}
              onClick={() => selectCanned(c.content)}
            >
              <span className="iv-canned-key">/{c.short_code}</span>
              <span className="iv-canned-text">{c.content}</span>
            </div>
          ))}
        </div>
      )}

      {/* Mode tabs */}
      <div className="iv-compose-tabs">
        <div className={`iv-compose-tab${mode === "reply" ? " active" : ""}`} onClick={() => setMode("reply")}>Reply</div>
        <div className={`iv-compose-tab${mode === "note" ? " active" : ""}`} onClick={() => setMode("note")}>🔒 Note</div>
      </div>

      {mode === "reply" && !canManualReply ? (
        /* ── AI takeover banner ── */
        <div className="iv-takeover-banner">
          <span>AI is handling this conversation.</span>
          <button
            className="iv-takeover-btn"
            disabled={takeOverMut.isPending}
            onClick={() => takeOverMut.mutate()}
          >
            {takeOverMut.isPending ? "Taking over…" : "Take over & reply manually"}
          </button>
        </div>
      ) : (
        <>
          {/* Reply channel hint */}
          {mode === "reply" && showReplyGuide && (
            <div className="iv-reply-guide">
              <div className="iv-reply-guide-copy">
                <strong>Reply channel</strong>
                <span>Use Template for approved API messages, Flow for automation, AI Assist for drafting.</span>
              </div>
              <button className="iv-reply-guide-close" onClick={() => setShowReplyGuide(false)}>×</button>
            </div>
          )}

          {/* Format bar */}
          <div className="iv-format-bar">
            <button className="iv-fmt-btn" onClick={() => applyFormat("bold")} title="Bold"><b>B</b></button>
            <button className="iv-fmt-btn" onClick={() => applyFormat("italic")} title="Italic"><i>I</i></button>
            <button className="iv-fmt-btn" onClick={() => applyFormat("strike")} title="Strikethrough">S̶</button>
            <button className="iv-fmt-btn" onClick={() => applyFormat("mono")} title="Monospace">{"`< />`"}</button>
            <div className="iv-fmt-sep" />
            <button className="iv-fmt-btn" title="List">≡</button>
          </div>

          {/* Attachment preview strip */}
          {attachedFiles.length > 0 && (
            <div className="iv-attachment-strip">
              {attachedFiles.map((af, i) => (
                <div key={i} className="iv-attachment-thumb">
                  {af.previewUrl
                    ? <img src={af.previewUrl} alt={af.name} />
                    : <span className="iv-attachment-file-icon">📄</span>
                  }
                  <span className="iv-attachment-name">{af.name.slice(0, 20)}</span>
                  <button className="iv-attachment-remove" onClick={() => handleRemoveAttachment(i)}>✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Reply-to preview */}
          {replyToMsg && (
            <div className="iv-reply-to-strip">
              <span className="iv-reply-to-icon">↩</span>
              <span className="iv-reply-to-text">
                {(replyToMsg.message_text ?? "").slice(0, 80) || "Media"}
              </span>
              <button className="iv-reply-to-clear" onClick={onClearReply} title="Cancel reply">✕</button>
            </div>
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            className={`iv-textarea${mode === "note" ? " note-mode" : ""}`}
            placeholder={mode === "note" ? "Write a private note... (@mention agents)" : "Shift+Enter for new line. Start with '/' for canned responses."}
            value={text}
            onChange={handleInput}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
          />
          {text.length > MAX_CHARS * 0.9 && (
            <div className="iv-char-counter" style={{ color: text.length >= MAX_CHARS ? "#ef4444" : "#94a3b8" }}>
              {text.length}/{MAX_CHARS}
            </div>
          )}

          {/* Toolbar with dropups */}
          <div className="iv-compose-footer" style={{ position: "relative" }}>
            {/* AI Assist popup */}
            {showAiAssistPopup && (
              <div className="iv-ai-popup">
                <div className="iv-ai-popup-head">
                  <span>AI Assist</span>
                  <button className="iv-ai-popup-close" onClick={() => setShowAiAssistPopup(false)}>✕</button>
                </div>
                <button
                  className="iv-ai-popup-item"
                  disabled={!text.trim() || isAiRewriting}
                  onClick={() => void handleAiRewrite()}
                >
                  <span>✨</span>
                  <span>{isAiRewriting ? "Rewriting…" : "Rewrite current draft"}</span>
                  <span>›</span>
                </button>
                <div
                  className="iv-ai-popup-item iv-ai-translate-row"
                  onMouseEnter={() => setShowTranslateSubmenu(true)}
                  onMouseLeave={() => setShowTranslateSubmenu(false)}
                >
                  <span>🔤</span>
                  <span>Translate current draft</span>
                  <span>›</span>
                  {showTranslateSubmenu && (
                    <div className="iv-translate-submenu">
                      {TRANSLATE_LANGUAGES.map((lang) => (
                        <button
                          key={lang}
                          disabled={!text.trim() || isAiRewriting}
                          onClick={() => void handleAiTranslate(lang)}
                        >
                          {lang}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Flow dropup */}
            {showFlowMenu && (
              <div className="iv-dropup">
                <div className="iv-dropup-label">Assign flow bot</div>
                {flowsQuery.isLoading ? (
                  <button disabled>Loading…</button>
                ) : flows.length === 0 ? (
                  <button disabled>No published flows</button>
                ) : flows.map((flow) => (
                  <button
                    key={flow.id}
                    disabled={assignFlowMut.isPending}
                    onClick={() => assignFlowMut.mutate({ flowId: flow.id })}
                  >
                    {flow.name}
                  </button>
                ))}
              </div>
            )}

            {/* Template dropup — API channel only */}
            {showTemplateMenu && isApiChannel && (
              <div className="iv-dropup iv-dropup-template">
                <div className="iv-dropup-label">Send approved template</div>
                {templatesQuery.isLoading ? (
                  <button disabled>Loading templates…</button>
                ) : templates.length === 0 ? (
                  <button disabled>No approved templates</button>
                ) : templates.map((t) => (
                  <button
                    key={t.id}
                    className="iv-template-item"
                    disabled={sendTemplateMut.isPending}
                    onClick={() => handleSelectTemplate(t)}
                  >
                    <strong>{t.name} <span className={`iv-tcat-${t.category.toLowerCase()}`}>{t.category}</span></strong>
                    <span>{getTemplateBody(t).slice(0, 80)}{getTemplateBody(t).length > 80 ? "…" : ""}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.txt"
              multiple
              style={{ display: "none" }}
              onChange={handleFileSelect}
            />
            {/* Emoji picker */}
            {showEmojiPicker && (
              <div className="iv-emoji-picker" ref={emojiPickerRef}>
                {QUICK_EMOJIS.map((emoji) => (
                  <button key={emoji} className="iv-emoji-btn" onClick={() => handleEmojiSelect(emoji)}>{emoji}</button>
                ))}
              </div>
            )}
            <button
              className={`iv-footer-btn${showEmojiPicker ? " active" : ""}`}
              title="Emoji"
              onClick={() => { setShowEmojiPicker((v) => !v); closeAllMenus(); }}
            >😊</button>
            <button
              className="iv-footer-btn"
              title="Attach file"
              disabled={attachedFiles.length >= 5}
              onClick={() => fileInputRef.current?.click()}
            >📎</button>
            {mode === "reply" && (
              <>
                <button
                  className={`iv-footer-pill${showFlowMenu ? " active" : ""}`}
                  title="Assign flow"
                  onClick={() => { setShowFlowMenu((v) => !v); setShowTemplateMenu(false); setShowAiAssistPopup(false); setShowTranslateSubmenu(false); }}
                >
                  Flow
                </button>
                {isApiChannel && (
                  <button
                    className={`iv-footer-pill${showTemplateMenu ? " active" : ""}`}
                    title="Send template"
                    disabled={sendTemplateMut.isPending}
                    onClick={() => { setShowTemplateMenu((v) => !v); setShowFlowMenu(false); setShowAiAssistPopup(false); setShowTranslateSubmenu(false); }}
                  >
                    {sendTemplateMut.isPending ? "Template…" : "Template"}
                  </button>
                )}
              </>
            )}
            <button
              className={`iv-footer-btn ai${showAiAssistPopup ? " active" : ""}`}
              title="AI Assist"
              onClick={() => { setShowAiAssistPopup((v) => !v); setShowFlowMenu(false); setShowTemplateMenu(false); setShowTranslateSubmenu(false); }}
            >
              ✨
            </button>
            <div className="iv-send-group">
              <button className="iv-btn-send" disabled={isUploading} onClick={() => void handleSend()}>
                {isUploading ? "Uploading…" : mode === "note" ? "Add Note" : "Send ↵"}
              </button>
              <button className="iv-btn-send-caret">▾</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

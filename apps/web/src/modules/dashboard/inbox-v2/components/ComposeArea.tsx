import { useCallback, useMemo, useRef, useState } from "react";
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
type TemplateMediaType = "IMAGE" | "VIDEO" | "DOCUMENT";

const TEMPLATE_MEDIA_INPUT_CONFIG: Record<TemplateMediaType, { label: string; accept: string; allowedMimeTypes: string[]; extensions: string[]; maxMb: number }> = {
  IMAGE: { label: "Image", accept: "image/jpeg,image/png", allowedMimeTypes: ["image/jpeg", "image/png"], extensions: [".jpg", ".jpeg", ".png"], maxMb: 5 },
  VIDEO: { label: "Video", accept: "video/mp4", allowedMimeTypes: ["video/mp4"], extensions: [".mp4"], maxMb: 16 },
  DOCUMENT: { label: "Document", accept: "application/pdf", allowedMimeTypes: ["application/pdf"], extensions: [".pdf"], maxMb: 10 }
};

interface AttachedFile {
  file: File;
  previewUrl: string;
  name: string;
  mimeType: string;
}

type TemplateDialogField =
  | { key: string; label: string; kind: "text"; placeholder: string }
  | { key: string; label: string; kind: "media"; mediaType: TemplateMediaType; description: string };

interface TemplateDialogUpload {
  fileName: string;
  mimeType: string;
  previewUrl: string | null;
}

function getTemplateBody(t: MessageTemplate): string {
  return t.components.find((c) => c.type === "BODY")?.text ?? t.name;
}

function extractTemplatePlaceholders(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = [...text.matchAll(PLACEHOLDER_RE)];
  return [...new Set(matches.map((m) => `{{${(m[1] ?? "").trim()}}}`))];
}

function buildTemplateDialogFields(t: MessageTemplate): TemplateDialogField[] {
  const fields: TemplateDialogField[] = [];
  const header = t.components.find((c) => c.type === "HEADER");
  if (header?.format === "IMAGE" || header?.format === "VIDEO" || header?.format === "DOCUMENT") {
    const config = TEMPLATE_MEDIA_INPUT_CONFIG[header.format];
    fields.push({
      key: "headerMediaUrl",
      label: `${config.label} header`,
      kind: "media",
      mediaType: header.format,
      description: `Upload ${config.extensions.join(", ")} up to ${config.maxMb}MB.`
    });
  }

  const placeholders = new Set<string>();
  for (const component of t.components) {
    extractTemplatePlaceholders(component.text).forEach((p) => placeholders.add(p));
    if (component.type === "BUTTONS") {
      (component.buttons ?? []).forEach((button) => extractTemplatePlaceholders(button.url).forEach((p) => placeholders.add(p)));
    }
  }

  fields.push(...Array.from(placeholders).map((p) => ({ key: p, label: p, kind: "text" as const, placeholder: `Value for ${p}` })));
  return fields;
}

function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
}

function validateTemplateMediaFile(mediaType: TemplateMediaType, file: File): string | null {
  const config = TEMPLATE_MEDIA_INPUT_CONFIG[mediaType];
  if (file.size > config.maxMb * 1024 * 1024) return `${config.label} files must be ${config.maxMb}MB or smaller.`;
  const mime = file.type.trim().toLowerCase();
  const extension = fileExtension(file.name);
  if (!config.allowedMimeTypes.includes(mime) && !config.extensions.includes(extension)) {
    return `${config.label} uploads must use ${config.extensions.join(", ")} files.`;
  }
  return null;
}

interface TemplateVarsState {
  template: MessageTemplate;
  fields: TemplateDialogField[];
  values: Record<string, string>;
  uploads: Record<string, TemplateDialogUpload>;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderRawDraftHtml(raw: string): string {
  const applyInline = (line: string) => {
    const escaped = escapeHtml(line);
    return escaped
      .replace(/```([\s\S]+?)```/g, "<code>$1</code>")
      .replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>")
      .replace(/_([^_\n]+)_/g, "<em>$1</em>")
      .replace(/~([^~\n]+)~/g, "<s>$1</s>");
  };

  return raw.split("\n").map(applyInline).join("<br>");
}

function serializeEditableNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeName === "BR") return "\n";
  if (!(node instanceof HTMLElement)) return "";

  const childText = Array.from(node.childNodes).map(serializeEditableNode).join("");
  const tag = node.tagName.toLowerCase();

  if (tag === "strong" || tag === "b") return `*${childText}*`;
  if (tag === "em" || tag === "i") return `_${childText}_`;
  if (tag === "s" || tag === "strike" || tag === "del") return `~${childText}~`;
  if (tag === "code") return `\`\`\`${childText}\`\`\``;
  if (tag === "div" || tag === "p") return `${childText}\n`;
  return childText;
}

function serializeEditable(root: HTMLElement | null): string {
  if (!root) return "";
  return Array.from(root.childNodes)
    .map(serializeEditableNode)
    .join("")
    .replace(/\n+$/g, "");
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
  const [templateUploadingFieldKey, setTemplateUploadingFieldKey] = useState<string | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
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
  const messages = useConvStore((s) => s.messagesByConvId[convId] ?? []);
  const isWithinApiWindow = useMemo(() => {
    if (!isApiChannel) return true;
    const latestInbound = messages
      .filter((m) => m.direction === "inbound")
      .reduce<string | null>((latest, msg) => {
        if (!latest) return msg.created_at;
        return Date.parse(msg.created_at) > Date.parse(latest) ? msg.created_at : latest;
      }, null);
    if (!latestInbound) return false;
    return Date.now() - Date.parse(latestInbound) <= 24 * 60 * 60 * 1000;
  }, [isApiChannel, messages]);
  const freeFormBlockedReason = isApiChannel && !isWithinApiWindow
    ? "24-hour WhatsApp window is closed. Send an approved template to reopen this chat."
    : null;

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

  function setDraftValue(raw: string) {
    const next = raw.slice(0, MAX_CHARS);
    setText(next);
    if (editorRef.current && serializeEditable(editorRef.current) !== next) {
      editorRef.current.innerHTML = renderRawDraftHtml(next);
    }
  }

  const broadcastTyping = useCallback((on: boolean) => {
    if (!token) return;
    void postTyping(token, convId, on);
  }, [token, convId]);

  const syncEditorText = useCallback(() => {
    const val = serializeEditable(editorRef.current).slice(0, MAX_CHARS);
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
    if (mode === "reply" && freeFormBlockedReason) {
      showToast(freeFormBlockedReason);
      return;
    }
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

    const replyToId = replyToMsg?.id ?? null;

    // Send the first attachment with the typed text as its caption, matching v1.
    for (let uploadIndex = 0; uploadIndex < uploads.length; uploadIndex += 1) {
      const upload = uploads[uploadIndex];
      const caption = !isPrivate && uploadIndex === 0 ? trimmed : "";
      const mediaKind = upload.mimeType.startsWith("image/")
        ? "image"
        : upload.mimeType.startsWith("video/")
          ? "video"
          : upload.mimeType.startsWith("audio/")
            ? "audio"
            : "document";
      const echoId = crypto.randomUUID();
      const tempId = `temp-${echoId}`;
      appendMessage(convId, {
        id: tempId, conversation_id: convId, direction: "outbound", sender_name: null,
        message_text: caption || upload.url, content_type: mediaKind,
        is_private: isPrivate, in_reply_to_id: caption ? replyToId : null, echo_id: echoId, delivery_status: "pending",
        error_code: null, error_message: null, retry_count: 0,
        payload_json: { type: "media", url: upload.url, mediaType: mediaKind, mimeType: upload.mimeType, caption },
        media_url: upload.url,
        message_type: mediaKind,
        message_content: { type: "media", url: upload.url, mediaType: mediaKind, mimeType: upload.mimeType, caption },
        source_type: "manual",
        ai_model: null, total_tokens: null, created_at: new Date().toISOString()
      });
      optimisticMap.current.set(echoId, tempId);
      void sendMsg.mutateAsync({ convId, params: { text: caption, mediaUrl: upload.url, mediaMimeType: upload.mimeType, echoId, isPrivate, inReplyToId: caption ? replyToId : null } }).catch(() => {
        useConvStore.getState().patchMessageDelivery(convId, tempId, "failed");
        optimisticMap.current.delete(echoId);
      });
    }

    setAttachedFiles([]);

    if (uploads.length > 0 && !isPrivate && trimmed) {
      setDraftValue("");
      setShowCanned(false);
      setCannedIdx(-1);
      broadcastTyping(false);
      onClearReply?.();
    } else if (trimmed) {
      setDraftValue("");
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
        appendMessage(convId, {
          id: tempId, conversation_id: convId, direction: "outbound", sender_name: null,
          message_text: trimmed, content_type: "text", is_private: false,
          in_reply_to_id: replyToId, echo_id: echoId, delivery_status: "pending",
          error_code: null, error_message: null, retry_count: 0, payload_json: null,
          source_type: "manual",
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
      setDraftValue("");
      setShowCanned(false);
      setCannedIdx(-1);
      broadcastTyping(false);
    }
  }, [text, attachedFiles, mode, freeFormBlockedReason, convId, appendMessage, optimisticMap, sendMsg, broadcastTyping, createNote, replyToMsg?.id, onClearReply]);

  const cannedList = cannedQuery.data?.cannedResponses ?? [];
  const filteredCanned = cannedList.filter((c) =>
    !cannedSearch || c.short_code.includes(cannedSearch) || c.content.toLowerCase().includes(cannedSearch)
  );

  const selectCanned = useCallback((t: string) => {
    setDraftValue(t); setShowCanned(false); editorRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
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
      setDraftValue(result.text);
      editorRef.current?.focus();
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
      setDraftValue(result.text);
      editorRef.current?.focus();
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setIsAiRewriting(false);
      setShowAiAssistPopup(false);
      setShowTranslateSubmenu(false);
    }
  }, [text, isAiRewriting, token]);

  const handleSelectTemplate = useCallback((t: MessageTemplate) => {
    const fields = buildTemplateDialogFields(t);
    if (fields.length === 0 && t.category !== "MARKETING") {
      sendTemplateMut.mutate({ templateId: t.id, vars: {} });
    } else {
      const values: Record<string, string> = {};
      fields.forEach((field) => { values[field.key] = ""; });
      setTemplateVarsDialog({ template: t, fields, values, uploads: {} });
      setShowTemplateMenu(false);
    }
  }, [sendTemplateMut]);

  const applyFormat = useCallback((style: string) => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.focus();
    if (style === "mono") {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (editor.contains(range.commonAncestorContainer)) {
          const selected = selection.toString();
          const code = document.createElement("code");
          code.textContent = selected || "monospace";
          range.deleteContents();
          range.insertNode(code);
          range.setStartAfter(code);
          range.setEndAfter(code);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    } else {
      const command = style === "bold" ? "bold" : style === "italic" ? "italic" : "strikeThrough";
      document.execCommand(command, false);
    }

    syncEditorText();
  }, [syncEditorText]);

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

  const handleTemplateFieldFileSelect = useCallback(async (field: Extract<TemplateDialogField, { kind: "media" }>, file: File) => {
    const validationError = validateTemplateMediaFile(field.mediaType, file);
    if (validationError) {
      showToast(validationError);
      return;
    }

    setTemplateUploadingFieldKey(field.key);
    try {
      const uploaded = await uploadInboxMedia(file);
      setTemplateVarsDialog((prev) => prev ? {
        ...prev,
        values: { ...prev.values, [field.key]: uploaded.url },
        uploads: {
          ...prev.uploads,
          [field.key]: {
            fileName: file.name,
            mimeType: uploaded.mimeType,
            previewUrl: field.mediaType === "IMAGE" ? uploaded.url : null
          }
        }
      } : prev);
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setTemplateUploadingFieldKey(null);
    }
  }, []);

  const insertPlainTextAtCursor = useCallback((value: string) => {
    const editor = editorRef.current;
    if (!editor) {
      setDraftValue(text + value);
      return;
    }
    editor.focus();
    document.execCommand("insertText", false, value);
    syncEditorText();
  }, [syncEditorText, text]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    if (mode !== "reply") return;
    const imageItem = Array.from(e.clipboardData.items).find((item) => item.type.startsWith("image/"));
    if (imageItem) {
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (!file) return;
      const named = new File([file], `paste-${Date.now()}.png`, { type: file.type });
      setAttachedFiles((prev) => [...prev, {
        file: named, previewUrl: URL.createObjectURL(named), name: named.name, mimeType: named.type
      }].slice(0, 5));
      return;
    }

    const pastedText = e.clipboardData.getData("text/plain");
    if (pastedText) {
      e.preventDefault();
      insertPlainTextAtCursor(pastedText);
    }
  }, [mode, insertPlainTextAtCursor]);

  const handleEmojiSelect = useCallback((emoji: string) => {
    insertPlainTextAtCursor(emoji);
    setShowEmojiPicker(false);
  }, [insertPlainTextAtCursor]);

  const flows = useMemo(
    () => (flowsQuery.data ?? []).filter((flow) => !conv?.channel_type || flow.channel === conv.channel_type),
    [flowsQuery.data, conv?.channel_type]
  );
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
            {templateVarsDialog.fields.length > 0 && (
              <div className="iv-tvd-fields">
                {templateVarsDialog.fields.map((field) => (
                  <div key={field.key} className="iv-tvd-field">
                    <label className="iv-tvd-label">{field.label}</label>
                    {field.kind === "media" ? (
                      <div className={`iv-tvd-upload${templateVarsDialog.values[field.key] ? " uploaded" : ""}`}>
                        <span>{field.description}</span>
                        <label className="iv-tvd-upload-btn">
                          {templateUploadingFieldKey === field.key ? "Uploading..." : templateVarsDialog.uploads[field.key] ? "Replace file" : `Upload ${TEMPLATE_MEDIA_INPUT_CONFIG[field.mediaType].label.toLowerCase()}`}
                          <input
                            type="file"
                            accept={TEMPLATE_MEDIA_INPUT_CONFIG[field.mediaType].accept}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void handleTemplateFieldFileSelect(field, file);
                              e.currentTarget.value = "";
                            }}
                          />
                        </label>
                        {templateVarsDialog.uploads[field.key] && (
                          <div className="iv-tvd-upload-meta">
                            {templateVarsDialog.uploads[field.key]?.previewUrl && (
                              <img src={templateVarsDialog.uploads[field.key]?.previewUrl ?? ""} alt={templateVarsDialog.uploads[field.key]?.fileName} />
                            )}
                            <span>{templateVarsDialog.uploads[field.key]?.fileName}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <input
                        className="iv-tvd-input"
                        value={templateVarsDialog.values[field.key] ?? ""}
                        onChange={(e) => setTemplateVarsDialog((prev) =>
                          prev ? { ...prev, values: { ...prev.values, [field.key]: e.target.value } } : prev
                        )}
                        placeholder={field.placeholder}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="iv-tvd-footer">
              <button className="iv-tvd-cancel" onClick={() => setTemplateVarsDialog(null)}>Cancel</button>
              <button
                className="iv-tvd-send"
                disabled={sendTemplateMut.isPending || Boolean(templateUploadingFieldKey) || templateVarsDialog.fields.some((field) => !templateVarsDialog.values[field.key]?.trim())}
                onClick={() => sendTemplateMut.mutate({
                  templateId: templateVarsDialog.template.id,
                  vars: templateVarsDialog.values
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
            <button className="iv-fmt-btn" disabled={mode === "reply" && Boolean(freeFormBlockedReason)} onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormat("bold")} title="Bold"><b>B</b></button>
            <button className="iv-fmt-btn" disabled={mode === "reply" && Boolean(freeFormBlockedReason)} onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormat("italic")} title="Italic"><i>I</i></button>
            <button className="iv-fmt-btn" disabled={mode === "reply" && Boolean(freeFormBlockedReason)} onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormat("strike")} title="Strikethrough">S̶</button>
            <button className="iv-fmt-btn" disabled={mode === "reply" && Boolean(freeFormBlockedReason)} onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormat("mono")} title="Monospace">{"`< />`"}</button>
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
          {freeFormBlockedReason && mode === "reply" && (
            <div className="iv-compose-policy">{freeFormBlockedReason}</div>
          )}
          <div
            ref={editorRef}
            className={`iv-rich-editor${mode === "note" ? " note-mode" : ""}`}
            contentEditable={!(mode === "reply" && Boolean(freeFormBlockedReason))}
            role="textbox"
            aria-multiline="true"
            data-placeholder={freeFormBlockedReason && mode === "reply"
              ? "Choose Template to send an approved message."
              : mode === "note"
                ? "Write a private note... (@mention agents)"
                : "Shift+Enter for new line. Start with '/' for canned responses."}
            suppressContentEditableWarning
            onInput={syncEditorText}
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
                <div className="iv-dropup-label">{conv?.channel_type?.toUpperCase() ?? "Channel"} flows</div>
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
              disabled={attachedFiles.length >= 5 || (mode === "reply" && Boolean(freeFormBlockedReason))}
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
              <button className="iv-btn-send" disabled={isUploading || (mode === "reply" && Boolean(freeFormBlockedReason))} onClick={() => void handleSend()}>
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

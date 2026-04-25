import { useCallback, useRef, useState } from "react";
import { useConvStore } from "../store/convStore";
import { useSendMessage } from "../queries";
import { postTyping } from "../api";
import { useAuth } from "../../../../lib/auth-context";

interface Props {
  convId: string;
  optimisticMap: React.MutableRefObject<Map<string, string>>;
}

const CANNED_RESPONSES = [
  { key: "/hello", text: "Hello! How can I help you today?" },
  { key: "/thanks", text: "Thank you for reaching out! We appreciate your business." },
  { key: "/follow", text: "I wanted to follow up on our previous conversation. Is there anything else I can help you with?" },
  { key: "/resolved", text: "Your issue has been resolved. Please don't hesitate to reach out if you need anything else." },
  { key: "/callback", text: "I'll have someone call you back within 24 hours." }
];

export function ComposeArea({ convId, optimisticMap }: Props) {
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [showCanned, setShowCanned] = useState(false);
  const [cannedSearch, setCannedSearch] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { token } = useAuth();
  const { appendMessage } = useConvStore();
  const sendMsg = useSendMessage();

  const broadcastTyping = useCallback((on: boolean) => {
    if (!token) return;
    void postTyping(token, convId, on);
  }, [token, convId]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

    // Show canned popup when starts with /
    setShowCanned(val.startsWith("/") && mode === "reply");
    if (val.startsWith("/")) setCannedSearch(val.slice(1).toLowerCase());

    // Typing debounce
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    typingDebounceRef.current = setTimeout(() => broadcastTyping(true), 300);

    // Stop typing after 3s silence
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
    if (!trimmed) return;

    const echoId = crypto.randomUUID();
    const tempId = `temp-${echoId}`;
    const isPrivate = mode === "note";

    // Optimistic bubble
    const optimistic = {
      id: tempId,
      conversation_id: convId,
      direction: "outbound" as const,
      sender_name: null,
      message_text: trimmed,
      content_type: "text" as const,
      is_private: isPrivate,
      in_reply_to_id: null,
      echo_id: echoId,
      delivery_status: "pending" as const,
      error_code: null,
      error_message: null,
      retry_count: 0,
      payload_json: null,
      created_at: new Date().toISOString()
    };
    appendMessage(convId, optimistic);
    optimisticMap.current.set(echoId, tempId);

    setText("");
    setShowCanned(false);
    broadcastTyping(false);

    try {
      await sendMsg.mutateAsync({ convId, params: { text: trimmed, echoId, isPrivate } });
    } catch {
      // Mark optimistic bubble as failed — WS message.updated will patch it
      // If WS doesn't come, bubble stays in optimistic state; retry is available
      const { patchMessageDelivery } = useConvStore.getState();
      patchMessageDelivery(convId, tempId, "failed");
      optimisticMap.current.delete(echoId);
    }
  }, [text, mode, convId, appendMessage, optimisticMap, sendMsg, broadcastTyping]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
    if (e.key === "Escape") {
      setShowCanned(false);
    }
  }, [handleSend]);

  const filteredCanned = CANNED_RESPONSES.filter(
    (c) => !cannedSearch || c.key.slice(1).includes(cannedSearch) || c.text.toLowerCase().includes(cannedSearch)
  );

  const selectCanned = useCallback((t: string) => {
    setText(t);
    setShowCanned(false);
    textareaRef.current?.focus();
  }, []);

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
    const newText = text.slice(0, start) + open + selected + close + text.slice(end);
    setText(newText);
    setTimeout(() => { ta.setSelectionRange(start + open.length, end + open.length); ta.focus(); }, 0);
  }, [text]);

  return (
    <div className="iv-compose" style={{ position: "relative" }}>
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
          {filteredCanned.map((c) => (
            <div key={c.key} className="iv-canned-item" onClick={() => selectCanned(c.text)}>
              <span className="iv-canned-key">{c.key}</span>
              <span className="iv-canned-text">{c.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Mode tabs */}
      <div className="iv-compose-tabs">
        <div className={`iv-compose-tab${mode === "reply" ? " active" : ""}`} onClick={() => setMode("reply")}>Reply</div>
        <div className={`iv-compose-tab${mode === "note" ? " active" : ""}`} onClick={() => setMode("note")}>🔒 Note</div>
      </div>

      {/* Format bar */}
      <div className="iv-format-bar">
        <button className="iv-fmt-btn" onClick={() => applyFormat("bold")} title="Bold"><b>B</b></button>
        <button className="iv-fmt-btn" onClick={() => applyFormat("italic")} title="Italic"><i>I</i></button>
        <button className="iv-fmt-btn" onClick={() => applyFormat("strike")} title="Strikethrough">S̶</button>
        <button className="iv-fmt-btn" onClick={() => applyFormat("mono")} title="Monospace">{"`< />`"}</button>
        <div className="iv-fmt-sep" />
        <button className="iv-fmt-btn" title="List">≡</button>
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        className={`iv-textarea${mode === "note" ? " note-mode" : ""}`}
        placeholder={mode === "note" ? "Write a private note... (@mention agents)" : "Shift+Enter for new line. Start with '/' for canned responses."}
        value={text}
        onChange={handleInput}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />

      {/* Footer */}
      <div className="iv-compose-footer">
        <button className="iv-footer-btn" title="Emoji">😊</button>
        <button className="iv-footer-btn" title="Attach">📎</button>
        {mode === "reply" && (
          <>
            <button className="iv-footer-btn" title="Template">📋</button>
            <button className="iv-footer-btn" title="Translate">🌐</button>
          </>
        )}
        <button className="iv-footer-btn ai" title="AI Assist">✨</button>
        <div className="iv-send-group">
          <button className="iv-btn-send" onClick={() => void handleSend()}>
            {mode === "note" ? "Add Note" : "Send ↵"}
          </button>
          <button className="iv-btn-send-caret">▾</button>
        </div>
      </div>
    </div>
  );
}

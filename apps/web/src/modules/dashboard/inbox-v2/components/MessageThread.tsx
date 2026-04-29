import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { differenceInSeconds } from "date-fns";
import { useConvStore, type ConversationMessage } from "../store/convStore";
import { useMessages, useMarkRead, useSetStatus, useRetryMessage, useNotes } from "../queries";
import { MessageBubble } from "./MessageBubble";
import { TypingIndicator } from "./TypingIndicator";
import { ComposeArea } from "./ComposeArea";
import { getNameAvatarColor, getNameInitials } from "./ConversationRow";

function shouldGroup(prev: ConversationMessage, curr: ConversationMessage): boolean {
  return (
    prev.direction === curr.direction &&
    !prev.is_private &&
    !curr.is_private &&
    differenceInSeconds(new Date(curr.created_at), new Date(prev.created_at)) < 300 &&
    prev.content_type !== "activity" &&
    curr.content_type !== "activity"
  );
}

function isSameDay(a: string, b: string): boolean {
  return new Date(Date.parse(a)).toDateString() === new Date(Date.parse(b)).toDateString();
}

function formatDateLabel(value: string): string {
  const d = new Date(Date.parse(value));
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined
  });
}

interface Props {
  convId: string;
  optimisticMap: React.MutableRefObject<Map<string, string>>;
}

export function MessageThread({ convId, optimisticMap }: Props) {
  const { byId, messagesByConvId, notesByConvId, typingState } = useConvStore();
  const conv = byId[convId];

  const messages = useMemo(() => {
    const msgs = messagesByConvId[convId] ?? [];
    const notes = notesByConvId[convId] ?? [];
    if (notes.length === 0) return msgs;
    const noteIds = new Set(notes.map((n) => n.id));
    const deduped = msgs.filter((m) => !noteIds.has(m.id));
    return [...deduped, ...notes].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  }, [messagesByConvId, notesByConvId, convId]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showFab, setShowFab] = useState(false);

  const messagesQuery = useMessages(convId);
  useNotes(convId);
  const markRead = useMarkRead();
  const setStatus = useSetStatus();
  const retryMsg = useRetryMessage();
  const [replyToMsg, setReplyToMsg] = useState<ConversationMessage | null>(null);
  const [showSuggestion, setShowSuggestion] = useState(true);
  useEffect(() => setShowSuggestion(true), [convId]);

  const inboundCount = useMemo(
    () => messages.filter((m) => m.direction === "inbound").length,
    [messages]
  );

  useEffect(() => {
    void markRead.mutateAsync(convId).catch(() => undefined);
  }, [convId, inboundCount]);

  // Auto-scroll to bottom on new messages if already at bottom
  useEffect(() => {
    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowFab(false);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    isAtBottomRef.current = atBottom;
    setShowFab(!atBottom);
  }, []);

  const handleRetry = useCallback((msgId: string) => {
    void retryMsg.mutateAsync({ convId, msgId });
  }, [convId, retryMsg]);

  const handleReply = useCallback((msg: ConversationMessage) => {
    setReplyToMsg(msg);
  }, []);

  const handleLoadOlder = useCallback(() => {
    void messagesQuery.fetchNextPage();
  }, [messagesQuery]);

  if (!conv) {
    return (
      <div className="iv-thread" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 14 }}>
        Select a conversation
      </div>
    );
  }

  const avatarColor = getNameAvatarColor(conv.contact_name, conv.phone_number);
  const scoreBand = conv.score >= 70 ? "hot" : conv.score >= 40 ? "warm" : "cold";
  const SUGGESTIONS = {
    hot:  { icon: "🚀", label: "Hot lead",  tip: "Reply with pricing or a booking link" },
    warm: { icon: "💬", label: "Warm lead", tip: "Qualify budget and timeline" },
    cold: { icon: "📧", label: "Cold lead", tip: "Nurture with educational content" },
  } as const;
  const suggestion = SUGGESTIONS[scoreBand];

  return (
    <div className="iv-thread">
      {/* Header */}
      <div className="iv-thread-header">
        <div className={`iv-avatar av-${avatarColor}`} style={{ width: 36, height: 36, fontSize: 11, flexShrink: 0 }}>
          {getNameInitials(conv.contact_name, conv.phone_number)}
        </div>
        <div>
          <div className="iv-thread-name">{conv.contact_name || conv.phone_number}</div>
          <div className="iv-thread-meta">{conv.channel_type === "api" ? "WhatsApp API" : conv.channel_type === "web" ? "Web Widget" : "WhatsApp QR"}</div>
        </div>
        <div className="iv-thread-actions">
          <button className="iv-btn-icon" title="Mute">🔕</button>
          <button
            className={`iv-btn-resolve ${conv.status === "resolved" ? "is-resolved" : "is-open"}`}
            onClick={() => setStatus.mutate({ convId, status: conv.status === "resolved" ? "open" : "resolved" })}
          >
            {conv.status === "resolved" ? "Reopen" : "Resolve"}
          </button>
        </div>
      </div>

      {/* Tags bar */}
      <div className="iv-thread-tags">
        <span className={`iv-thread-tag ${conv.ai_paused ? "iv-tag-paused" : "iv-tag-ai"}`}>
          {conv.ai_paused ? "⏸ AI Paused" : "🤖 AI Active"}
        </span>
        <span className={`iv-thread-tag iv-tag-score-${scoreBand}`}>
          {scoreBand === "hot" ? "🔥" : scoreBand === "warm" ? "☀️" : "❄️"} {scoreBand.charAt(0).toUpperCase() + scoreBand.slice(1)}
        </span>
        {conv.priority !== "none" && (
          <span className={`iv-thread-tag iv-priority-pill iv-priority-${conv.priority}`}>{conv.priority}</span>
        )}
        <span className={`iv-thread-tag iv-status-pill iv-status-${conv.status ?? "open"}`}>{conv.status ?? "open"}</span>
      </div>

      {/* Reply suggestion banner */}
      {showSuggestion && conv.score > 0 && (
        <div className="iv-reply-suggestion">
          <span>{suggestion.icon} <strong>{suggestion.label}</strong> — {suggestion.tip}</span>
          <button className="iv-reply-suggestion-close" onClick={() => setShowSuggestion(false)}>✕</button>
        </div>
      )}

      {/* Messages area */}
      <div className="iv-messages-area" ref={scrollRef} onScroll={handleScroll} style={{ position: "relative" }}>
        {/* Load older messages */}
        {messagesQuery.hasNextPage && (
          <div className="iv-load-older">
            <button
              className="iv-load-older-btn"
              onClick={handleLoadOlder}
              disabled={messagesQuery.isFetchingNextPage}
            >
              {messagesQuery.isFetchingNextPage ? "Loading…" : "Load older messages"}
            </button>
          </div>
        )}

        {messages.map((msg, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const isFirst = !prev || !shouldGroup(prev, msg);
          const isLast = !next || !shouldGroup(msg, next);
          const showAvatar = isLast && msg.direction === "inbound";
          const quoted = msg.in_reply_to_id
            ? messages.find((m) => m.id === msg.in_reply_to_id) ?? null
            : null;
          const showDate = !prev || !isSameDay(prev.created_at, msg.created_at);

          return (
            <div key={msg.id}>
              {showDate && (
                <div className="iv-date-separator">
                  <span>{formatDateLabel(msg.created_at)}</span>
                </div>
              )}
              <MessageBubble
                message={msg}
                isFirst={isFirst}
                showAvatar={showAvatar}
                convPhone={conv.phone_number}
                contactName={conv.contact_name}
                onRetry={handleRetry}
                onReply={handleReply}
                quotedMessage={quoted}
              />
            </div>
          );
        })}

        {typingState[convId] && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Scroll to bottom FAB */}
      {showFab && (
        <button className="iv-scroll-fab" onClick={scrollToBottom} title="Scroll to latest">
          ↓
        </button>
      )}

      {/* Compose */}
      <ComposeArea convId={convId} optimisticMap={optimisticMap} replyToMsg={replyToMsg} onClearReply={() => setReplyToMsg(null)} />
    </div>
  );
}

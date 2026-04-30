import { useEffect, useLayoutEffect, useRef, useCallback, useState, useMemo } from "react";
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
  onBack?: () => void;
  onOpenDetails?: () => void;
}

export function MessageThread({ convId, optimisticMap, onBack, onOpenDetails }: Props) {
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
  const didInitialScrollRef = useRef<string | null>(null);
  const pendingHistoryScrollRef = useRef<{ previousHeight: number; previousTop: number } | null>(null);
  const [showFab, setShowFab] = useState(false);

  const messagesQuery = useMessages(convId);
  useNotes(convId);
  const markRead = useMarkRead();
  const setStatus = useSetStatus();
  const retryMsg = useRetryMessage();
  const [replyToMsg, setReplyToMsg] = useState<ConversationMessage | null>(null);
  const [showSuggestion, setShowSuggestion] = useState(true);
  const lastReadSyncKeyRef = useRef<string | null>(null);

  const scrollToBottomNow = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    isAtBottomRef.current = true;
    setShowFab(false);
  }, []);

  useEffect(() => {
    setShowSuggestion(true);
    setReplyToMsg(null);
    setShowFab(false);
    isAtBottomRef.current = true;
    didInitialScrollRef.current = null;
    pendingHistoryScrollRef.current = null;
    lastReadSyncKeyRef.current = null;
  }, [convId]);

  const inboundCount = useMemo(
    () => messages.filter((m) => m.direction === "inbound").length,
    [messages]
  );

  // Mirror V1: an open thread is read. Also catches new inbound messages while
  // the active conversation's unread_count is intentionally kept at zero locally.
  useEffect(() => {
    if (markRead.isPending) return;
    const unreadCount = conv?.unread_count ?? 0;
    if (unreadCount <= 0 && inboundCount <= 0) return;
    const syncKey = `${convId}:${inboundCount}:${unreadCount}`;
    if (lastReadSyncKeyRef.current === syncKey) return;
    lastReadSyncKeyRef.current = syncKey;
    markRead.mutate(convId);
  }, [convId, inboundCount, conv?.unread_count, markRead.isPending]);

  useLayoutEffect(() => {
    if (messages.length === 0 || messagesQuery.isFetchingNextPage) return;
    if (didInitialScrollRef.current === convId) return;

    didInitialScrollRef.current = convId;
    scrollToBottomNow("auto");
    requestAnimationFrame(() => scrollToBottomNow("auto"));
  }, [convId, messages.length, messagesQuery.isFetchingNextPage, scrollToBottomNow]);

  useLayoutEffect(() => {
    if (messagesQuery.isFetchingNextPage) return;
    const pending = pendingHistoryScrollRef.current;
    const el = scrollRef.current;
    if (!pending || !el) return;

    const addedHeight = el.scrollHeight - pending.previousHeight;
    el.scrollTop = pending.previousTop + Math.max(0, addedHeight);
    pendingHistoryScrollRef.current = null;
  }, [messages.length, messagesQuery.isFetchingNextPage]);

  // Auto-scroll to bottom on new messages only when the agent is already there.
  useEffect(() => {
    if (didInitialScrollRef.current !== convId) return;
    if (pendingHistoryScrollRef.current || messagesQuery.isFetchingNextPage) return;
    if (isAtBottomRef.current) {
      requestAnimationFrame(() => scrollToBottomNow("smooth"));
    }
  }, [convId, messages.length, messagesQuery.isFetchingNextPage, scrollToBottomNow]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleMediaLoad = () => {
      if (isAtBottomRef.current && !pendingHistoryScrollRef.current) {
        requestAnimationFrame(() => scrollToBottomNow("auto"));
      }
    };

    el.addEventListener("load", handleMediaLoad, true);
    return () => el.removeEventListener("load", handleMediaLoad, true);
  }, [scrollToBottomNow]);

  const scrollToBottom = useCallback(() => {
    scrollToBottomNow("smooth");
  }, [scrollToBottomNow]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    isAtBottomRef.current = atBottom;
    setShowFab(!atBottom);
    if (
      el.scrollTop <= 80 &&
      messagesQuery.hasNextPage &&
      !messagesQuery.isFetchingNextPage &&
      !messagesQuery.isLoading
    ) {
      pendingHistoryScrollRef.current = {
        previousHeight: el.scrollHeight,
        previousTop: el.scrollTop
      };
      void messagesQuery.fetchNextPage();
    }
  }, [messagesQuery]);

  const handleRetry = useCallback((msgId: string) => {
    void retryMsg.mutateAsync({ convId, msgId });
  }, [convId, retryMsg]);

  const handleReply = useCallback((msg: ConversationMessage) => {
    setReplyToMsg(msg);
  }, []);

  const handleLoadOlder = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      pendingHistoryScrollRef.current = {
        previousHeight: el.scrollHeight,
        previousTop: el.scrollTop
      };
    }
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
  const isResolved = conv.status === "resolved";
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
        <button
          type="button"
          className="iv-mobile-action-btn iv-mobile-back-btn"
          onClick={onBack}
        >
          Back
        </button>
        <div className={`iv-avatar av-${avatarColor}`} style={{ width: 36, height: 36, fontSize: 11, flexShrink: 0 }}>
          {getNameInitials(conv.contact_name, conv.phone_number)}
        </div>
        <div>
          <div className="iv-thread-name">{conv.contact_name || conv.phone_number}</div>
          <div className="iv-thread-meta">{conv.channel_type === "api" ? "WhatsApp API" : conv.channel_type === "web" ? "Web Widget" : "WhatsApp QR"}</div>
        </div>
        <div className="iv-thread-actions">
          <button
            type="button"
            className="iv-mobile-action-btn iv-mobile-info-btn"
            onClick={onOpenDetails}
          >
            Info
          </button>
          <button
            className={`iv-btn-resolve ${isResolved ? "is-reopen" : "is-resolve"}`}
            disabled={setStatus.isPending}
            title={isResolved ? "Reopen conversation" : "Mark conversation resolved"}
            onClick={() => setStatus.mutate({ convId, status: isResolved ? "open" : "resolved" })}
          >
            {isResolved ? "Reopen" : "Resolve"}
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

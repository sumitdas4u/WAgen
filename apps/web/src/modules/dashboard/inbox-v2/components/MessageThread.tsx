import { useEffect, useRef, useCallback } from "react";
import { differenceInSeconds } from "date-fns";
import { useConvStore, type ConversationMessage } from "../store/convStore";
import { useMessages, useMarkRead, useSetStatus, useRetryMessage } from "../queries";
import { MessageBubble } from "./MessageBubble";
import { TypingIndicator } from "./TypingIndicator";
import { ComposeArea } from "./ComposeArea";
import { getAvatarColor } from "./ConversationRow";

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

interface Props {
  convId: string;
  optimisticMap: React.MutableRefObject<Map<string, string>>;
}

export function MessageThread({ convId, optimisticMap }: Props) {
  const { byId, messagesByConvId, typingState } = useConvStore();
  const conv = byId[convId];
  const messages = messagesByConvId[convId] ?? [];
  const bottomRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useMessages(convId);
  const markRead = useMarkRead();
  const setStatus = useSetStatus();
  const retryMsg = useRetryMessage();

  useEffect(() => {
    void markRead.mutateAsync(convId).catch(() => undefined);
  }, [convId]);

  // Auto-scroll to bottom on new messages if already at bottom
  useEffect(() => {
    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  const handleRetry = useCallback((msgId: string) => {
    void retryMsg.mutateAsync({ convId, msgId });
  }, [convId, retryMsg]);

  if (!conv) {
    return (
      <div className="iv-thread" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 14 }}>
        Select a conversation
      </div>
    );
  }

  const avatarColor = getAvatarColor(conv.phone_number);

  return (
    <div className="iv-thread">
      {/* Header */}
      <div className="iv-thread-header">
        <div className={`iv-avatar av-${avatarColor}`} style={{ width: 36, height: 36, fontSize: 11, flexShrink: 0 }}>
          {conv.phone_number.replace(/\D/g, "").slice(-2)}
        </div>
        <div>
          <div className="iv-thread-name">{conv.phone_number}</div>
          <div className="iv-thread-meta">{conv.channel_type === "api" ? "WhatsApp API" : conv.channel_type === "web" ? "Web Widget" : "WhatsApp QR"}</div>
        </div>
        <div className="iv-thread-actions">
          <button className="iv-btn-icon" title="Mute">🔕</button>
          <div style={{ display: "flex" }}>
            <button
              className="iv-btn-resolve"
              onClick={() => setStatus.mutate({ convId, status: conv.status === "resolved" ? "open" : "resolved" })}
            >
              {conv.status === "resolved" ? "Reopen" : "Resolve"}
            </button>
            <button className="iv-btn-resolve-caret">▾</button>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="iv-messages-area" ref={scrollRef} onScroll={handleScroll}>
        {messages.map((msg, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const isFirst = !prev || !shouldGroup(prev, msg);
          const isLast = !next || !shouldGroup(msg, next);
          const showAvatar = isLast && msg.direction === "inbound";
          const quoted = msg.in_reply_to_id
            ? messages.find((m) => m.id === msg.in_reply_to_id) ?? null
            : null;

          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              isFirst={isFirst}
              showAvatar={showAvatar}
              convPhone={conv.phone_number}
              onRetry={handleRetry}
              quotedMessage={quoted}
            />
          );
        })}

        {typingState[convId] && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Compose */}
      <ComposeArea convId={convId} optimisticMap={optimisticMap} />
    </div>
  );
}

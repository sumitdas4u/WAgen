import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { API_URL } from "../../../../lib/api";
import { useConvStore } from "../store/convStore";
import { useNotificationStore } from "../store/notificationStore";
import type { AgentNotification } from "../api";
import type { WSEvent } from "../types";

function toWsBase(url: string): string {
  if (url.startsWith("https://")) return url.replace("https://", "wss://");
  if (url.startsWith("http://")) return url.replace("http://", "ws://");
  return url;
}

const WS_BASE = toWsBase(API_URL);
const MAX_LAST_MSG_CONVS = 20;
const MAX_RECONNECT_RESYNC_CONVS = 5;
const CONVERSATION_REFRESH_DEBOUNCE_MS = 750;

function getLastMsgIds(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem("iv-last-msg-ids") ?? "{}");
  } catch {
    return {};
  }
}

function setLastMsgId(convId: string, msgId: string) {
  const current = getLastMsgIds();
  const entries = Object.entries(current);
  if (entries.length >= MAX_LAST_MSG_CONVS && !(convId in current)) {
    // evict oldest entry (first in map)
    delete current[entries[0][0]];
  }
  current[convId] = msgId;
  try {
    localStorage.setItem("iv-last-msg-ids", JSON.stringify(current));
  } catch {
    // ignore quota errors
  }
}

export function useRealtimeSocket(token: string | null) {
  const store = useConvStore();
  const notifStore = useNotificationStore();
  const qc = useQueryClient();
  const storeRef = useRef(store);
  const notifRef = useRef(notifStore);
  const qcRef = useRef(qc);
  const optimisticMap = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    storeRef.current = store;
    notifRef.current = notifStore;
    qcRef.current = qc;
  });

  // Expose optimisticMap so ComposeArea can register echo_id → tempId
  (useRealtimeSocket as unknown as { optimisticMap: Map<string, string> }).optimisticMap = optimisticMap.current;

  useEffect(() => {
    if (!token) return;

    let ws: WebSocket | null = null;
    let retryDelay = 1_000;
    let destroyed = false;
    let refreshTimer: number | null = null;
    let hasOpenedOnce = false;

    function scheduleConversationsRefresh() {
      if (refreshTimer !== null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void qcRef.current.invalidateQueries({ queryKey: ["iv2-convs"] });
      }, CONVERSATION_REFRESH_DEBOUNCE_MS);
    }


    function resync() {
      const lastMsgIds = getLastMsgIds();
      const s = storeRef.current;
      const loadedMessageConvIds = Object.keys(s.messagesByConvId).filter((convId) => {
        const messages = s.messagesByConvId[convId] ?? [];
        return messages.length > 0;
      });
      const convIds = Array.from(
        new Set([
          s.activeConvId,
          ...loadedMessageConvIds,
          ...s.ids.slice(0, MAX_RECONNECT_RESYNC_CONVS)
        ].filter((id): id is string => Boolean(id)))
      ).slice(0, MAX_RECONNECT_RESYNC_CONVS);

      for (const convId of convIds) {
        const lastId = lastMsgIds[convId];
        if (lastId) {
          void fetch(`${API_URL}/api/conversations/${convId}/messages/after?cursor=${encodeURIComponent(lastId)}`, {
            headers: { Authorization: `Bearer ${token}` }
          })
            .then((r) => r.json())
            .then((data: { messages?: import("../store/convStore").ConversationMessage[] }) => {
              for (const msg of data.messages ?? []) {
                s.appendMessage(convId, msg);
              }
            })
            .catch(() => undefined);
        }
      }
    }

    function handleMessage(raw: string) {
      let envelope: WSEvent;
      try {
        envelope = JSON.parse(raw) as WSEvent;
      } catch {
        return;
      }

      const s = storeRef.current;

      switch (envelope.event) {
        case "message.created": {
          const { conversationId, message } = envelope.data;
          setLastMsgId(conversationId, message.id);

          const normalised = {
            ...message,
            direction: message.direction as "inbound" | "outbound",
            delivery_status: message.delivery_status as import("../store/convStore").MsgDeliveryStatus,
            content_type: (message.content_type ?? "text") as import("../store/convStore").MsgContentType,
            message_content: (message as unknown as { message_content?: Record<string, unknown> | null }).message_content ?? null,
            payload_json: (message as unknown as { payload_json?: Record<string, unknown> }).payload_json ?? null
          };

          const tempId = optimisticMap.current.get(message.echo_id ?? "");
          if (tempId) {
            // Fast path: we have the temp→real mapping; replace the optimistic bubble.
            s.replaceOptimisticMessage(conversationId, tempId, normalised);
            optimisticMap.current.delete(message.echo_id!);
          } else {
            // Slow path: let mergeMessage dedup by sameId / sameEcho / sameTempId.
            // This handles: page-reload (no map), late WS, or duplicate delivery.
            s.appendMessage(conversationId, normalised);
          }
          break;
        }
        case "message.updated": {
          const { messageId, conversationId, deliveryStatus, errorCode, errorMessage, retryCount } = envelope.data;
          s.patchMessageDelivery(conversationId, messageId, deliveryStatus, errorCode, errorMessage, retryCount);
          break;
        }
        case "conversation.created":
          s.prependConv({
            ...envelope.data,
            status: (envelope.data.status ?? "open") as import("../store/convStore").ConvStatus,
            priority: "none",
            snoozed_until: null,
            agent_last_seen_at: null,
            unread_count: 0,
            phone_number: "",
            contact_name: null,
            stage: "",
            score: 0,
            lead_kind: "lead",
            channel_type: "qr",
            channel_linked_number: null,
            assigned_agent_profile_id: null,
            last_message: envelope.data.last_message?.text ?? null,
            last_message_at: envelope.data.last_message?.sent_at ?? null,
            ai_paused: false,
            manual_takeover: false,
            last_ai_reply_at: null,
            csat_rating: null,
            csat_sent_at: null,
            user_id: ""
          });
          // Fetch fresh full data so the stub is replaced with complete conversation details.
          scheduleConversationsRefresh();
          break;
        case "conversation.updated":
        case "conversation.status_changed":
        case "conversation.priority_changed": {
          const raw = envelope.data;
          // Some broadcasts (e.g. deliverConversationTemplateMessage) use "conversationId"
          // instead of "id" — normalise so all paths set the store key correctly.
          const convId: string = (raw as { id?: string }).id
            ?? (raw as { conversationId?: string }).conversationId
            ?? "";
          if (!convId) break;
          const lm = (raw as { last_message?: { text: string; sent_at: string } }).last_message;
          const update = {
            ...raw,
            id: convId,
            last_message: lm ? lm.text : (raw as unknown as { last_message?: string }).last_message,
            last_message_at: lm ? lm.sent_at : undefined,
          } as Partial<import("../store/convStore").Conversation> & { id: string };
          // Don't overwrite unread_count for the currently open conversation
          if (convId === s.activeConvId) {
            delete (update as Record<string, unknown>).unread_count;
          }
          // Optimistic update immediately so the row reflects the change
          s.upsertConv(update);
          // Refresh contact data — flow blocks may have mutated contact fields/tags
          void qcRef.current.invalidateQueries({ queryKey: ["iv2-contact", convId] });
          // Skip invalidation for the active conversation — upsertConv already applied
          // the update, and markRead.onSettled handles its own refetch. Refetching here
          // would briefly restore unread_count from the server and break mark-as-read.
          if (convId !== s.activeConvId) scheduleConversationsRefresh();
          break;
        }
        case "conversation.read":
          s.clearUnread(envelope.data.conversation_id);
          notifRef.current.markConversationRead(envelope.data.conversation_id);
          void qcRef.current.invalidateQueries({ queryKey: ["iv2-notifications"] });
          void qcRef.current.invalidateQueries({ queryKey: ["iv2-notifications-unread"] });
          break;
        case "conversation.typing_on":
          s.setTyping(envelope.data.conversation_id, true);
          break;
        case "conversation.typing_off":
          s.setTyping(envelope.data.conversation_id, false);
          break;
        case "conversations.bulk_updated": {
          const { ids, action } = envelope.data;
          for (const id of ids) {
            if (!s.byId[id]) continue;
            if (action === "resolve") s.upsertConv({ id, status: "resolved" as import("../store/convStore").ConvStatus });
            else if (action === "reopen") s.upsertConv({ id, status: "open" as import("../store/convStore").ConvStatus });
          }
          break;
        }
        case "conversation.label_changed":
          if (s.byId[envelope.data.id])
            s.upsertConv({ id: envelope.data.id, label_ids: envelope.data.label_ids });
          break;
        case "conversation.assigned":
          if (s.byId[envelope.data.id])
            s.upsertConv({ id: envelope.data.id, assigned_agent_profile_id: envelope.data.agent_id });
          break;
        case "contact.updated":
          // Invalidate contact/sidebar and list data so flow contact-field updates show immediately.
          void qcRef.current.invalidateQueries({ queryKey: ["iv2-contact", envelope.data.conversation_id] });
          scheduleConversationsRefresh();
          break;
        case "agent.notification":
          notifRef.current.prependNotification(envelope.data as AgentNotification);
          break;
        case "conversation.mentioned":
          // Mentions also surface as agent.notification.
          break;
        default:
          break;
      }
    }

    function connect() {
      if (destroyed) return;
      ws = new WebSocket(`${WS_BASE}/ws?token=${encodeURIComponent(token ?? "")}`);

      ws.onopen = () => {
        retryDelay = 1_000;
        if (hasOpenedOnce) {
          resync();
          // Refresh conversation list on reconnect so unread counts and new convs are current.
          scheduleConversationsRefresh();
        }
        hasOpenedOnce = true;
      };

      ws.onmessage = (e) => handleMessage(e.data as string);

      ws.onclose = () => {
        if (destroyed) return;
        setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      };

      ws.onerror = () => ws?.close();
    }

    connect();
    const ping = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) ws.send("ping");
    }, 25_000);

    return () => {
      destroyed = true;
      clearInterval(ping);
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      ws?.close();
    };
  }, [token]);

  return optimisticMap;
}

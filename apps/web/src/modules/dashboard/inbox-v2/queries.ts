import { useEffect } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { useAuth } from "../../../lib/auth-context";
import { useConvStore } from "./store/convStore";
import { useNotificationStore } from "./store/notificationStore";
import type { ConvPage } from "./api";
import type { ConvFilters, ConvFolder } from "./store/convStore";
import {
  fetchConversation,
  fetchConversationFacets,
  fetchConvPage,
  fetchConvMessages,
  fetchLabels,
  postMarkRead,
  patchStatus,
  patchPriority,
  putLabels,
  postMessage,
  postRetry,
  postBulk,
  fetchConvNotes,
  createConvNote,
  type SendMessageParams,
  type ConvNote
} from "./api";
import type { ConversationMessage } from "./store/convStore";

// ── Conversations ─────────────────────────────────────────────────────────

export function useConversations(folder: ConvFolder, searchQ: string, filters: ConvFilters) {
  const { token } = useAuth();
  const store = useConvStore();

  const query = useInfiniteQuery({
    queryKey: ["iv2-convs", folder, searchQ, filters],
    queryFn: ({ pageParam }) =>
      fetchConvPage(token!, {
        cursor: pageParam as string | undefined,
        limit: 30,
        folder,
        q: searchQ || null,
        filters
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!token,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false
  });

  useEffect(() => {
    if (!query.data) return;
    const all = query.data.pages.flatMap((p) => p.items);
    // Preserve optimistically-cleared unread_count for the active conversation so a
    // stale server response during an in-flight markRead mutation doesn't restore the badge.
    const { activeConvId, byId } = useConvStore.getState();
    const merged = activeConvId
      ? all.map((c) => {
          if (c.id !== activeConvId) return c;
          const local = byId[c.id];
          if (local && (local.unread_count ?? 0) === 0 && (c.unread_count ?? 0) > 0) {
            return { ...c, unread_count: 0 };
          }
          return c;
        })
      : all;
    store.setConversations(merged);
  }, [query.data]);

  return query;
}

export function useConversationFacets(folder: ConvFolder, searchQ: string, filters: ConvFilters) {
  const { token } = useAuth();

  return useQuery({
    queryKey: ["iv2-conv-facets", folder, searchQ, filters],
    queryFn: () => fetchConversationFacets(token!, {
      folder,
      q: searchQ || null,
      filters
    }),
    enabled: !!token,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false
  });
}

export function useConversation(convId: string | null) {
  const { token } = useAuth();
  const existing = useConvStore((s) => (convId ? s.byId[convId] : undefined));
  const upsertConv = useConvStore((s) => s.upsertConv);

  const query = useQuery({
    queryKey: ["iv2-conv", convId],
    queryFn: async () => {
      const data = await fetchConversation(token!, convId!);
      upsertConv(data.conversation);
      return data.conversation;
    },
    enabled: !!token && !!convId && !existing,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1
  });

  useEffect(() => {
    if (!existing && query.data) {
      upsertConv(query.data);
    }
  }, [existing, query.data, upsertConv]);

  return query;
}

export function useMessages(convId: string | null) {
  const { token } = useAuth();
  const store = useConvStore();

  const query = useInfiniteQuery({
    queryKey: ["iv2-msgs", convId],
    queryFn: ({ pageParam }) =>
      fetchConvMessages(token!, convId!, { before: pageParam as string | undefined, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor ?? undefined : undefined),
    enabled: !!token && !!convId,
    staleTime: 15_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false
  });

  useEffect(() => {
    if (!query.data || !convId) return;
    const all = [...query.data.pages].reverse().flatMap((p) => p.items);
    store.setMessages(convId, all);
  }, [query.data, convId]);

  return query;
}

export function useLabels() {
  const { token } = useAuth();
  const store = useConvStore();

  return useQuery({
    queryKey: ["iv2-labels"],
    queryFn: () => fetchLabels(token!).then((d) => { store.setLabels(d.labels); return d.labels; }),
    enabled: !!token,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────

export function useMarkRead() {
  const { token } = useAuth();
  const store = useConvStore();
  const notifStore = useNotificationStore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (convId: string) => postMarkRead(token!, convId),
    onMutate: async (convId) => {
      await qc.cancelQueries({ queryKey: ["iv2-convs"] });

      // Snapshot the current cache for rollback on error (same as V1)
      const previous = qc.getQueriesData<InfiniteData<ConvPage>>({ queryKey: ["iv2-convs"] });

      // Patch React Query cache directly — walk pages → items (same as V1)
      qc.setQueriesData<InfiniteData<ConvPage>>({ queryKey: ["iv2-convs"] }, (current) => {
        if (!current) return current;
        return {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            items: page.items.map((conv) =>
              conv.id === convId ? { ...conv, unread_count: 0 } : conv
            )
          }))
        };
      });

      // Also clear Zustand (V2's display layer reads from here)
      store.clearUnread(convId);
      notifStore.markConversationRead(convId);

      return { previous };
    },
    onError: (_err, _convId, context) => {
      // Roll back the cache snapshot (same as V1)
      if (context?.previous) {
        for (const [queryKey, data] of context.previous) {
          qc.setQueryData(queryKey, data);
        }
      }
    },
    onSettled: () => {
      // Invalidate after success OR error to sync with server (same as V1)
      void qc.invalidateQueries({ queryKey: ["iv2-convs"] });
      void qc.invalidateQueries({ queryKey: ["iv2-notifications"] });
      void qc.invalidateQueries({ queryKey: ["iv2-notifications-unread"] });
    }
  });
}

export function useSetStatus() {
  const { token } = useAuth();
  const store = useConvStore();
  return useMutation({
    mutationFn: ({ convId, status, snoozedUntil }: { convId: string; status: string; snoozedUntil?: string }) =>
      patchStatus(token!, convId, status, snoozedUntil),
    onMutate: ({ convId, status }) =>
      store.upsertConv({ id: convId, status: status as import("./store/convStore").ConvStatus })
  });
}

export function useSetPriority() {
  const { token } = useAuth();
  const store = useConvStore();
  return useMutation({
    mutationFn: ({ convId, priority }: { convId: string; priority: string }) => patchPriority(token!, convId, priority),
    onMutate: ({ convId, priority }) =>
      store.upsertConv({ id: convId, priority: priority as import("./store/convStore").ConvPriority })
  });
}

export function useSetLabels() {
  const { token } = useAuth();
  return useMutation({
    mutationFn: ({ convId, labelIds }: { convId: string; labelIds: string[] }) => putLabels(token!, convId, labelIds)
  });
}

export function useSendMessage() {
  const { token } = useAuth();
  return useMutation({
    mutationFn: ({ convId, params }: { convId: string; params: SendMessageParams }) =>
      postMessage(token!, convId, params)
  });
}

export function useRetryMessage() {
  const { token } = useAuth();
  const store = useConvStore();
  return useMutation({
    mutationFn: ({ convId, msgId }: { convId: string; msgId: string }) => postRetry(token!, convId, msgId),
    onSuccess: (data, variables) => {
      const retryCount = "retryCount" in data && typeof data.retryCount === "number" ? data.retryCount : undefined;
      store.patchMessageDelivery(variables.convId, variables.msgId, "pending", undefined, undefined, retryCount);
    }
  });
}

export function useBulkAction() {
  const { token } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, action, payload }: { ids: string[]; action: string; payload?: Record<string, unknown> }) =>
      postBulk(token!, ids, action, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["iv2-convs"] })
  });
}

// ── Notes ─────────────────────────────────────────────────────────────────────

function noteToMessage(note: ConvNote, convId: string): ConversationMessage {
  return {
    id: `note-${note.id}`,
    conversation_id: convId,
    direction: "outbound",
    sender_name: note.sender_name,
    message_text: note.content,
    content_type: "text",
    is_private: true,
    in_reply_to_id: null,
    echo_id: null,
    delivery_status: "delivered",
    error_code: null,
    error_message: null,
    retry_count: 0,
    payload_json: null,
    source_type: "manual",
    ai_model: null,
    total_tokens: null,
    created_at: note.created_at
  };
}

export function useNotes(convId: string | null) {
  const { token } = useAuth();
  const store = useConvStore();

  return useQuery({
    queryKey: ["iv2-notes", convId],
    queryFn: async () => {
      const { notes } = await fetchConvNotes(token!, convId!);
      store.setNotes(convId!, notes.map((n) => noteToMessage(n, convId!)));
      return notes;
    },
    enabled: !!token && !!convId
  });
}

export function useCreateNote() {
  const { token } = useAuth();
  const store = useConvStore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ convId, content }: { convId: string; content: string }) =>
      createConvNote(token!, convId, content),
    onSuccess: (data, { convId }) => {
      store.appendNote(convId, noteToMessage(data.note, convId));
      void qc.invalidateQueries({ queryKey: ["iv2-notes", convId] });
    }
  });
}

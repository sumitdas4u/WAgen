import { useEffect } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../lib/auth-context";
import { useConvStore } from "./store/convStore";
import {
  fetchConvSnapshot,
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

export function useConversations(_folder: string, _searchQ: string) {
  const { token } = useAuth();
  const store = useConvStore();

  const query = useInfiniteQuery({
    queryKey: ["iv2-convs"],
    queryFn: () => fetchConvSnapshot(token!),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!token,
    staleTime: 30_000
  });

  useEffect(() => {
    if (!query.data) return;
    const all = query.data.pages.flatMap((p) => p.items);
    store.setConversations(all);
  }, [query.data]);

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
    enabled: !!token && !!convId
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
    enabled: !!token
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────

export function useMarkRead() {
  const { token } = useAuth();
  const store = useConvStore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (convId: string) => postMarkRead(token!, convId),
    onMutate: async (convId) => {
      await qc.cancelQueries({ queryKey: ["iv2-convs"] });
      store.clearUnread(convId);
    },
    onSuccess: (_data, convId) => {
      store.clearUnread(convId);
      void qc.invalidateQueries({ queryKey: ["iv2-convs"] });
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
  return useMutation({
    mutationFn: ({ convId, msgId }: { convId: string; msgId: string }) => postRetry(token!, convId, msgId)
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

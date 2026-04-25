import { useEffect } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../lib/auth-context";
import { useConvStore } from "./store/convStore";
import {
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
  fetchConvSearch,
  type SendMessageParams
} from "./api";

// ── Conversations ─────────────────────────────────────────────────────────

export function useConversations(folder: string, searchQ: string) {
  const { token } = useAuth();
  const store = useConvStore();

  const query = useInfiniteQuery({
    queryKey: ["iv2-convs", folder, searchQ],
    queryFn: ({ pageParam }) =>
      searchQ
        ? fetchConvSearch(token!, searchQ).then((d) => ({ items: d.items, nextCursor: null, hasMore: false }))
        : fetchConvPage(token!, { cursor: pageParam as string | undefined, limit: 30, folder, q: searchQ || null }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!token
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
    const all = query.data.pages.flatMap((p) => p.items).reverse();
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
  return useMutation({
    mutationFn: (convId: string) => postMarkRead(token!, convId),
    onMutate: (convId) => store.clearUnread(convId)
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

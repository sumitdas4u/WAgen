import { useQueryClient } from "@tanstack/react-query";
import { useCallback, type PropsWithChildren } from "react";
import { useRealtime } from "../../lib/use-realtime";
import { normalizeDashboardBootstrap } from "../../shared/dashboard/bootstrap";
import { dashboardQueryKeys } from "../../shared/dashboard/query-keys";
import type { DashboardBootstrapResponse } from "../../shared/dashboard/contracts";

function getEventPayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function DashboardRealtimeProvider({
  token,
  children
}: PropsWithChildren<{ token: string }>) {
  const queryClient = useQueryClient();

  useRealtime(
    token,
    useCallback(
      (event) => {
        if (event.event === "conversation.updated") {
          const payload = getEventPayload(event.data);
          const conversationId =
            payload && typeof payload.conversationId === "string" ? payload.conversationId : null;
          void queryClient.invalidateQueries({
            predicate: (query) =>
              Array.isArray(query.queryKey) &&
              query.queryKey[0] === dashboardQueryKeys.inboxRoot[0] &&
              query.queryKey[1] === dashboardQueryKeys.inboxRoot[1] &&
              query.queryKey[2] === "conversations"
          });
          if (conversationId) {
            void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxMessages(conversationId) });
            void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.contactByConversation(conversationId) });
          }
          void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.contactsRoot });
          void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.reviewRoot });
        }

        if (event.event === "whatsapp.status") {
          const payload = getEventPayload(event.data);
          if (!payload) {
            return;
          }

          queryClient.setQueryData<DashboardBootstrapResponse | undefined>(dashboardQueryKeys.bootstrap, (current) => {
            if (!current) {
              return current;
            }

            const normalizedCurrent = normalizeDashboardBootstrap(current);

            return {
              ...normalizedCurrent,
              channelSummary: {
                ...normalizedCurrent.channelSummary,
                whatsapp: {
                  ...normalizedCurrent.channelSummary.whatsapp,
                  status:
                    typeof payload.status === "string" ? payload.status : normalizedCurrent.channelSummary.whatsapp.status,
                  phoneNumber:
                    typeof payload.phoneNumber === "string" || payload.phoneNumber === null
                      ? (payload.phoneNumber as string | null)
                      : normalizedCurrent.channelSummary.whatsapp.phoneNumber,
                  hasQr:
                    typeof payload.hasQr === "boolean" ? payload.hasQr : normalizedCurrent.channelSummary.whatsapp.hasQr,
                  qr:
                    typeof payload.qr === "string" || payload.qr === null
                      ? (payload.qr as string | null)
                      : normalizedCurrent.channelSummary.whatsapp.qr,
                  needsRelink:
                    typeof payload.needsRelink === "boolean"
                      ? payload.needsRelink
                      : normalizedCurrent.channelSummary.whatsapp.needsRelink,
                  statusMessage:
                    typeof payload.statusMessage === "string" || payload.statusMessage === null
                      ? (payload.statusMessage as string | null)
                      : normalizedCurrent.channelSummary.whatsapp.statusMessage
                }
              }
            };
          });

          void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.settingsRoot });
        }
      },
      [queryClient]
    )
  );

  return <>{children}</>;
}

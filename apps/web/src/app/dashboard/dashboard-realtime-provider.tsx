import { useQueryClient } from "@tanstack/react-query";
import { useCallback, type PropsWithChildren } from "react";
import { useRealtime } from "../../lib/use-realtime";
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
          void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxRoot });
          void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.leadsRoot });
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

            return {
              ...current,
              channelSummary: {
                ...current.channelSummary,
                whatsapp: {
                  ...current.channelSummary.whatsapp,
                  status:
                    typeof payload.status === "string" ? payload.status : current.channelSummary.whatsapp.status,
                  phoneNumber:
                    typeof payload.phoneNumber === "string" || payload.phoneNumber === null
                      ? (payload.phoneNumber as string | null)
                      : current.channelSummary.whatsapp.phoneNumber,
                  hasQr:
                    typeof payload.hasQr === "boolean" ? payload.hasQr : current.channelSummary.whatsapp.hasQr,
                  qr:
                    typeof payload.qr === "string" || payload.qr === null
                      ? (payload.qr as string | null)
                      : current.channelSummary.whatsapp.qr
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

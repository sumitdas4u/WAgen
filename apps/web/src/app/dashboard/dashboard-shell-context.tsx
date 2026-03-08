import { useQuery } from "@tanstack/react-query";
import { useMemo, type PropsWithChildren } from "react";
import { useAuth } from "../../lib/auth-context";
import { apiRequest } from "../../shared/api/client";
import { dashboardQueryKeys } from "../../shared/dashboard/query-keys";
import {
  DashboardShellContextProvider,
  type DashboardShellContextValue
} from "../../shared/dashboard/shell-context";
import { DashboardRealtimeProvider } from "./dashboard-realtime-provider";
import type { DashboardBootstrapResponse } from "../../shared/dashboard/contracts";

async function fetchDashboardBootstrap(token: string) {
  return apiRequest<DashboardBootstrapResponse>("/api/dashboard/bootstrap", { token });
}

export function DashboardShellDataProvider({ children }: PropsWithChildren) {
  const { token } = useAuth();

  if (!token) {
    throw new Error("DashboardShellDataProvider requires an authenticated token.");
  }

  const bootstrapQuery = useQuery({
    queryKey: dashboardQueryKeys.bootstrap,
    queryFn: () => fetchDashboardBootstrap(token)
  });

  const value = useMemo<DashboardShellContextValue>(
    () => ({
      token,
      bootstrap: bootstrapQuery.data ?? null,
      loading: bootstrapQuery.isLoading,
      refetchBootstrap: () => bootstrapQuery.refetch()
    }),
    [bootstrapQuery.data, bootstrapQuery.isLoading, bootstrapQuery, token]
  );

  return (
    <DashboardShellContextProvider value={value}>
      <DashboardRealtimeProvider token={token}>{children}</DashboardRealtimeProvider>
    </DashboardShellContextProvider>
  );
}

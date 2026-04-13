import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { fetchSettingsMetaConfig, fetchSettingsMetaConnections, fetchSettingsMetaStatus } from "./api";

export function buildSettingsMetaConfigQueryOptions(token: string) {
  return queryOptions({
    queryKey: dashboardQueryKeys.settingsMetaConfig,
    queryFn: () => fetchSettingsMetaConfig(token)
  });
}

export function useSettingsMetaConfigQuery(token: string) {
  return useQuery(buildSettingsMetaConfigQueryOptions(token));
}

export function buildSettingsMetaStatusQueryOptions(token: string) {
  return queryOptions({
    queryKey: dashboardQueryKeys.settingsMetaStatus,
    queryFn: () => fetchSettingsMetaStatus(token)
  });
}

export function useSettingsMetaStatusQuery(token: string) {
  return useQuery(buildSettingsMetaStatusQueryOptions(token));
}

export function buildSettingsMetaConnectionsQueryOptions(token: string) {
  return queryOptions({
    queryKey: dashboardQueryKeys.settingsMetaConnections,
    queryFn: () => fetchSettingsMetaConnections(token).then((response) => response.connections)
  });
}

export function useSettingsMetaConnectionsQuery(token: string) {
  return useQuery(buildSettingsMetaConnectionsQueryOptions(token));
}

export async function prefetchSettingsModuleData(queryClient: QueryClient, token: string) {
  await Promise.all([
    queryClient.prefetchQuery(buildSettingsMetaConfigQueryOptions(token)),
    queryClient.prefetchQuery(buildSettingsMetaStatusQueryOptions(token)),
    queryClient.prefetchQuery(buildSettingsMetaConnectionsQueryOptions(token))
  ]);
}

import { queryOptions, useQuery } from "@tanstack/react-query";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { fetchLeads, type LeadsFilters } from "./api";

export function buildLeadsQueryOptions(token: string, filters: LeadsFilters) {
  return queryOptions({
    queryKey: dashboardQueryKeys.leads({
      stage: filters.stage ?? "all",
      kind: filters.kind ?? "all",
      channelType: filters.channelType ?? "all",
      todayOnly: Boolean(filters.todayOnly),
      requiresReply: Boolean(filters.requiresReply)
    }),
    queryFn: () => fetchLeads(token, filters)
  });
}

export function useLeadsQuery(token: string, filters: LeadsFilters) {
  return useQuery(buildLeadsQueryOptions(token, filters));
}

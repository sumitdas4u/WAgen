import { queryOptions, useQuery } from "@tanstack/react-query";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { fetchAgents } from "./api";

export function buildAgentsQueryOptions(token: string) {
  return queryOptions({
    queryKey: dashboardQueryKeys.agents,
    queryFn: () => fetchAgents(token)
  });
}

export function useAgentsQuery(token: string) {
  return useQuery(buildAgentsQueryOptions(token));
}

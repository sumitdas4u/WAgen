import { queryOptions, useQuery } from "@tanstack/react-query";
import { dashboardQueryKeys } from "../../../../shared/dashboard/query-keys";
import { fetchPersonalityAgents } from "./api";

export function buildPersonalityAgentsQueryOptions(token: string) {
  return queryOptions({
    queryKey: dashboardQueryKeys.agents,
    queryFn: () => fetchPersonalityAgents(token)
  });
}

export function usePersonalityAgentsQuery(token: string) {
  return useQuery(buildPersonalityAgentsQueryOptions(token));
}

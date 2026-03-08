import { queryOptions, useQuery } from "@tanstack/react-query";
import { dashboardQueryKeys } from "../../../../shared/dashboard/query-keys";
import { fetchSources } from "./api";

export function buildKnowledgeSourcesQueryOptions(token: string) {
  return queryOptions({
    queryKey: dashboardQueryKeys.knowledgeSources,
    queryFn: () => fetchSources(token).then((response) => response.sources)
  });
}

export function useKnowledgeSourcesQuery(token: string) {
  return useQuery(buildKnowledgeSourcesQueryOptions(token));
}

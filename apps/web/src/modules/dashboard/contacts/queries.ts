import { queryOptions, useQuery } from "@tanstack/react-query";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { fetchContactsList, type ContactsFilters } from "./api";

export function buildContactsQueryOptions(token: string, filters: ContactsFilters) {
  return queryOptions({
    queryKey: dashboardQueryKeys.contacts({
      q: filters.q ?? "",
      type: filters.type ?? "all",
      source: filters.source ?? "all",
      limit: String(filters.limit ?? 250)
    }),
    queryFn: () => fetchContactsList(token, filters)
  });
}

export function useContactsQuery(token: string, filters: ContactsFilters) {
  return useQuery(buildContactsQueryOptions(token, filters));
}

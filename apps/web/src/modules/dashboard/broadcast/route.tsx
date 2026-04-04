import { useRoutes } from "react-router-dom";
import type { DashboardModulePrefetchContext } from "../../../shared/dashboard/module-contracts";
import { useDashboardShell } from "../../../shared/dashboard/shell-context";
import { fetchBroadcasts } from "../../../lib/api";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { BroadcastModulePage } from "./BroadcastModulePage";

export function Component() {
  const { token } = useDashboardShell();
  return useRoutes([
    { index: true, element: <BroadcastModulePage token={token} mode="list" /> },
    { path: "new", element: <BroadcastModulePage token={token} mode="new" /> },
    { path: ":campaignId", element: <BroadcastModulePage token={token} mode="detail" /> },
    { path: ":campaignId/retarget", element: <BroadcastModulePage token={token} mode="retarget" /> }
  ]);
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await queryClient.prefetchQuery({
    queryKey: dashboardQueryKeys.broadcasts,
    queryFn: () => fetchBroadcasts(token)
  });
}

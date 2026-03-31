import type { DashboardModulePrefetchContext } from "../../../../shared/dashboard/module-contracts";
import { prefetchSettingsModuleData } from "../queries";
import { WebChannelPage } from "./WebChannelPage";

export function Component() {
  return <WebChannelPage />;
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await prefetchSettingsModuleData(queryClient, token);
}

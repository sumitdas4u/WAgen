import type { DashboardModulePrefetchContext } from "../../../../shared/dashboard/module-contracts";
import { prefetchSettingsModuleData } from "../queries";
import { ApiChannelPage } from "./ApiChannelPage";

export function Component() {
  return <ApiChannelPage />;
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await prefetchSettingsModuleData(queryClient, token);
}

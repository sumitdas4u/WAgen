import { SettingsPage } from "../settings-page";
import type { DashboardModulePrefetchContext } from "../../../../shared/dashboard/module-contracts";
import { prefetchSettingsModuleData } from "../queries";

export function Component() {
  return <SettingsPage submenu="setup_web" />;
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await prefetchSettingsModuleData(queryClient, token);
}

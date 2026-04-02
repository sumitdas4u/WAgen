import type { DashboardModulePrefetchContext } from "../../../shared/dashboard/module-contracts";
import { useDashboardShell } from "../../../shared/dashboard/shell-context";
import { buildSettingsMetaStatusQueryOptions, useSettingsMetaStatusQuery } from "../settings/queries";
import { TemplateListPage } from "./TemplateListPage";
import { buildTemplatesQueryOptions } from "./queries";

export function Component() {
  const { token } = useDashboardShell();
  const metaStatusQuery = useSettingsMetaStatusQuery(token);

  return (
    <section className="clone-settings-view" style={{ fontFamily: "inherit" }}>
      <TemplateListPage token={token} metaStatus={metaStatusQuery.data ?? null} />
    </section>
  );
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await Promise.all([
    queryClient.prefetchQuery(buildTemplatesQueryOptions(token)),
    queryClient.prefetchQuery(buildSettingsMetaStatusQueryOptions(token))
  ]);
}

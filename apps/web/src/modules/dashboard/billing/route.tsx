import { DashboardBillingCenter } from "../../../components/dashboard-billing-center";
import { useDashboardShell } from "../../../shared/dashboard/shell-context";

export function Component() {
  const { token, refetchBootstrap } = useDashboardShell();
  return (
    <DashboardBillingCenter
      token={token}
      onCreditsRefresh={async () => {
        await refetchBootstrap();
      }}
    />
  );
}

export function prefetchData() {
  return undefined;
}

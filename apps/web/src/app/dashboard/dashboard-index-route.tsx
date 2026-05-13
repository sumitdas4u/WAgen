import { useLocation } from "react-router-dom";
import { DashboardHomePage } from "./DashboardHomePage";
import { LegacyDashboardRedirect } from "./legacy-dashboard-redirect";

export function DashboardIndexRoute() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  if (params.has("tab")) {
    return <LegacyDashboardRedirect />;
  }
  return <DashboardHomePage />;
}

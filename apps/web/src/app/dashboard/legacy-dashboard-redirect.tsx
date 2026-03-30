import { Navigate, useLocation } from "react-router-dom";

export function resolveLegacyDashboardPath(search: string): string {
  const params = new URLSearchParams(search);
  const tab = params.get("tab");
  const submenu = params.get("submenu");

  switch (tab) {
    case "contacts":
    case "leads":
      return "/dashboard/leads";
    case "billing":
      return "/dashboard/billing";
    case "knowledge":
      return "/dashboard/studio/knowledge";
    case "chatbot_personality":
      return "/dashboard/studio/personality";
    case "unanswered_questions":
      return "/dashboard/studio/review";
    case "bot_agents":
      return "/dashboard/agents";
    case "test_chatbot":
      return "/dashboard/studio/test";
    case "settings":
      if (submenu === "setup_qr") {
        return "/dashboard/settings/qr";
      }
      if (submenu === "setup_api") {
        return "/dashboard/settings/api";
      }
      return "/dashboard/settings/web";
    case "conversations":
    default:
      return "/dashboard/inbox";
  }
}

export function LegacyDashboardRedirect() {
  const location = useLocation();
  return <Navigate to={resolveLegacyDashboardPath(location.search)} replace />;
}

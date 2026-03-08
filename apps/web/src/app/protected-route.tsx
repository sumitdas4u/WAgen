import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { User } from "../lib/api";
import { useAuth } from "../lib/auth-context";

function isOnboardingComplete(user: User | null): boolean {
  if (!user) {
    return false;
  }

  const basics = user.business_basics;
  if (!basics || typeof basics !== "object") {
    return false;
  }

  const companyName = typeof basics.companyName === "string" ? basics.companyName.trim() : "";
  const whatDoYouSell = typeof basics.whatDoYouSell === "string" ? basics.whatDoYouSell.trim() : "";
  const targetAudience = typeof basics.targetAudience === "string" ? basics.targetAudience.trim() : "";

  return companyName.length >= 2 && whatDoYouSell.length >= 2 && targetAudience.length >= 2;
}

export function ProtectedRoute() {
  const { token, user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="loading-screen">Loading...</div>;
  }

  if (!token) {
    return <Navigate to="/signup" replace />;
  }

  const onOnboardingRoute = location.pathname === "/onboarding" || location.pathname === "/onboarding/qr";
  if (!isOnboardingComplete(user) && !onOnboardingRoute) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}

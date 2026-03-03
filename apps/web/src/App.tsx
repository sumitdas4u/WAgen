import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth-context";
import type { User } from "./lib/api";
import { SignupPage } from "./pages/SignupPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SuperAdminLoginPage } from "./pages/SuperAdminLoginPage";
import { SuperAdminPage } from "./pages/SuperAdminPage";
import { PurchasePage } from "./pages/PurchasePage";
import { PrivacyPolicyPage } from "./pages/PrivacyPolicyPage";
import { TermsOfServicePage } from "./pages/TermsOfServicePage";
import { ContactUsPage } from "./pages/ContactUsPage";
import { DataDeletionPage } from "./pages/DataDeletionPage";
import { MetaCallbackPage } from "./pages/MetaCallbackPage";
import { QrConnectPage } from "./pages/QrConnectPage";

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

function ProtectedLayout() {
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

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/signup" replace />} />
      <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
      <Route path="/terms-of-service" element={<TermsOfServicePage />} />
      <Route path="/contact-us" element={<ContactUsPage />} />
      <Route path="/data-deletion" element={<DataDeletionPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/super-admin">
        <Route path="login" element={<SuperAdminLoginPage />} />
        <Route index element={<SuperAdminPage />} />
        <Route path="*" element={<Navigate to="/super-admin/login" replace />} />
      </Route>
      <Route element={<ProtectedLayout />}>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/onboarding/qr" element={<QrConnectPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/meta-callback" element={<MetaCallbackPage />} />
        <Route path="/purchase" element={<PurchasePage />} />
        <Route path="/widget" element={<Navigate to="/dashboard?tab=settings&submenu=setup_web" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/signup" replace />} />
    </Routes>
  );
}

import { Suspense, lazy } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth-context";
import type { User } from "./lib/api";

const SignupPage = lazy(() => import("./pages/SignupPage").then((m) => ({ default: m.SignupPage })));
const OnboardingPage = lazy(() => import("./pages/OnboardingPage").then((m) => ({ default: m.OnboardingPage })));
const QrConnectPage = lazy(() => import("./pages/QrConnectPage").then((m) => ({ default: m.QrConnectPage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const PurchasePage = lazy(() => import("./pages/PurchasePage").then((m) => ({ default: m.PurchasePage })));
const MetaCallbackPage = lazy(() => import("./pages/MetaCallbackPage").then((m) => ({ default: m.MetaCallbackPage })));
const SuperAdminLoginPage = lazy(() =>
  import("./pages/SuperAdminLoginPage").then((m) => ({ default: m.SuperAdminLoginPage }))
);
const SuperAdminPage = lazy(() => import("./pages/SuperAdminPage").then((m) => ({ default: m.SuperAdminPage })));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage").then((m) => ({ default: m.PrivacyPolicyPage })));
const TermsOfServicePage = lazy(() => import("./pages/TermsOfServicePage").then((m) => ({ default: m.TermsOfServicePage })));
const ContactUsPage = lazy(() => import("./pages/ContactUsPage").then((m) => ({ default: m.ContactUsPage })));
const DataDeletionPage = lazy(() => import("./pages/DataDeletionPage").then((m) => ({ default: m.DataDeletionPage })));

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
    <Suspense fallback={<div className="loading-screen">Loading...</div>}>
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
    </Suspense>
  );
}

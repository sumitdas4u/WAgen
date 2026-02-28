import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth-context";
import { LandingPage } from "./pages/LandingPage";
import { SignupPage } from "./pages/SignupPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { DashboardPage } from "./pages/DashboardPage";
import { WidgetPage } from "./pages/WidgetPage";
import { SuperAdminLoginPage } from "./pages/SuperAdminLoginPage";
import { SuperAdminPage } from "./pages/SuperAdminPage";
import { PurchasePage } from "./pages/PurchasePage";

function ProtectedLayout() {
  const { token, loading } = useAuth();

  if (loading) {
    return <div className="loading-screen">Loading...</div>;
  }

  if (!token) {
    return <Navigate to="/signup" replace />;
  }

  return <Outlet />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/super-admin">
        <Route path="login" element={<SuperAdminLoginPage />} />
        <Route index element={<SuperAdminPage />} />
        <Route path="*" element={<Navigate to="/super-admin/login" replace />} />
      </Route>
      <Route element={<ProtectedLayout />}>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/purchase" element={<PurchasePage />} />
        <Route path="/widget" element={<WidgetPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

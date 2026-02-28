import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import { OrchidsLandingPage } from "./landing-orchids/OrchidsLandingPage";

export function LandingPage() {
  const { token } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (token) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate, token]);

  return <OrchidsLandingPage />;
}

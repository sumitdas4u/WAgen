import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import { completeMetaBusinessSignup, fetchMetaBusinessConfig } from "../lib/api";

export function MetaCallbackPage() {
  const { token, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [message, setMessage] = useState("Completing WhatsApp Business API setup...");

  useEffect(() => {
    if (loading) {
      return;
    }
    if (!token) {
      navigate("/signup", { replace: true });
      return;
    }

    const code = searchParams.get("code")?.trim();
    if (!code) {
      setStatus("error");
      setMessage("Missing Meta authorization code. Please restart the setup flow from dashboard.");
      return;
    }

    void (async () => {
      const config = await fetchMetaBusinessConfig(token);
      const redirectUri = config.redirectUri || `${window.location.origin}/meta-callback`;
      return completeMetaBusinessSignup(token, {
        code,
        redirectUri,
        metaBusinessId: searchParams.get("business_id") ?? undefined,
        wabaId: searchParams.get("waba_id") ?? undefined,
        phoneNumberId: searchParams.get("phone_number_id") ?? undefined,
        displayPhoneNumber: searchParams.get("display_phone_number") ?? undefined
      });
    })()
      .then(() => {
        setStatus("success");
        setMessage("Official WhatsApp Business API connected. Redirecting to dashboard...");
        setTimeout(() => navigate("/dashboard", { replace: true }), 900);
      })
      .catch((error) => {
        setStatus("error");
        setMessage((error as Error).message || "Failed to complete Meta setup.");
      });
  }, [loading, navigate, searchParams, token]);

  return (
    <main className="loading-screen">
      <div style={{ maxWidth: 560, textAlign: "center", padding: "1rem" }}>
        <h1>Meta Callback</h1>
        <p>{message}</p>
        {status === "error" ? (
          <button className="primary-btn" type="button" onClick={() => navigate("/dashboard", { replace: true })}>
            Back to Dashboard
          </button>
        ) : null}
      </div>
    </main>
  );
}

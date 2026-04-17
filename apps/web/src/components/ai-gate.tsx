import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";

interface AiGateProps {
  children: React.ReactNode;
  /** Message shown below the lock prompt. Defaults to a generic upgrade message. */
  message?: string;
}

/**
 * Wraps any AI-generation UI. When the user has no AI tokens left the children
 * are hidden and an upgrade prompt is shown in their place.
 */
export function AiGate({ children, message }: AiGateProps) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const balance = user?.ai_token_balance ?? 1; // treat unknown as positive
  if (balance > 0) {
    return <>{children}</>;
  }

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "0.75rem",
      padding: "1.5rem 1rem",
      textAlign: "center",
      border: "1px solid #e2eaf4",
      borderRadius: "12px",
      background: "#fff"
    }}>
      <span style={{ fontSize: "1.6rem" }}>🔒</span>
      <p style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "#122033" }}>
        AI credits exhausted
      </p>
      <p style={{ margin: 0, fontSize: "0.82rem", color: "#5f6f86" }}>
        {message ?? "Upgrade your plan to keep using AI-powered features."}
      </p>
      <button
        onClick={() => navigate("/dashboard/billing")}
        style={{
          appearance: "none",
          height: "2.2rem",
          padding: "0 1rem",
          border: 0,
          borderRadius: "8px",
          background: "#2563eb",
          color: "#fff",
          font: "inherit",
          fontSize: "0.83rem",
          fontWeight: 700,
          cursor: "pointer"
        }}
      >
        Upgrade plan
      </button>
    </div>
  );
}

/**
 * Hook version — returns { blocked: boolean } so callers can conditionally
 * disable buttons or show warnings without wrapping entire sections.
 */
export function useAiGate() {
  const { user } = useAuth();
  const balance = user?.ai_token_balance ?? 1;
  return { blocked: balance <= 0, balance };
}

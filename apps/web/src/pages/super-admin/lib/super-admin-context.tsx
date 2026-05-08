import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { clearSuperAdminToken, getStoredSuperAdminToken } from "../../../lib/super-admin-auth";

interface SuperAdminCtx {
  token: string;
  adminEmail: string;
  logout: () => void;
}

const SuperAdminContext = createContext<SuperAdminCtx | null>(null);

function decodeEmail(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return (payload as { email?: string }).email ?? "Admin";
  } catch {
    return "Admin";
  }
}

export function SuperAdminProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const stored = getStoredSuperAdminToken();
    if (!stored) {
      navigate("/super-admin/login", { replace: true });
    } else {
      setToken(stored);
    }
  }, [navigate]);

  const logout = () => {
    clearSuperAdminToken();
    navigate("/super-admin/login", { replace: true });
  };

  if (!token) return null;

  return (
    <SuperAdminContext.Provider value={{ token, adminEmail: decodeEmail(token), logout }}>
      {children}
    </SuperAdminContext.Provider>
  );
}

export function useSuperAdmin(): SuperAdminCtx {
  const ctx = useContext(SuperAdminContext);
  if (!ctx) throw new Error("useSuperAdmin must be used inside SuperAdminProvider");
  return ctx;
}

import { createContext, useContext, type PropsWithChildren } from "react";
import type { DashboardBootstrapResponse } from "./contracts";

export interface DashboardShellContextValue {
  token: string;
  bootstrap: DashboardBootstrapResponse | null;
  loading: boolean;
  refetchBootstrap: () => Promise<unknown>;
}

const DashboardShellContext = createContext<DashboardShellContextValue | null>(null);

export function DashboardShellContextProvider({
  value,
  children
}: PropsWithChildren<{ value: DashboardShellContextValue }>) {
  return <DashboardShellContext.Provider value={value}>{children}</DashboardShellContext.Provider>;
}

export function useDashboardShell() {
  const context = useContext(DashboardShellContext);
  if (!context) {
    throw new Error("useDashboardShell must be used within DashboardShellContextProvider.");
  }
  return context;
}

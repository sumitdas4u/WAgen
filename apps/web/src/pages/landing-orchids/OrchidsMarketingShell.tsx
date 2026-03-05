import type { ReactNode } from "react";
import { OrchidsFooter } from "./OrchidsFooter";
import { OrchidsHeader } from "./OrchidsHeader";
import "./orchids-landing.css";

type OrchidsMarketingShellProps = {
  children: ReactNode;
};

export function OrchidsMarketingShell({ children }: OrchidsMarketingShellProps) {
  return (
    <main className="orch-page">
      <OrchidsHeader />

      {children}

      <OrchidsFooter />
    </main>
  );
}

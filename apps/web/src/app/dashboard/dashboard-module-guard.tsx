import type { PropsWithChildren } from "react";
import type { DashboardModuleDefinition } from "../../shared/dashboard/module-contracts";
import { useDashboardShell } from "../../shared/dashboard/shell-context";
import type { DashboardBootstrapResponse } from "../../shared/dashboard/contracts";
import type { PlanEntitlements } from "../../lib/api";
import { ModuleNoPermission } from "../../components/module-no-permission";

const PLAN_ORDER: Record<PlanEntitlements["planCode"], number> = {
  trial: 0,
  starter: 1,
  pro: 2,
  business: 3
};

function hasRequiredPlan(currentPlan: PlanEntitlements["planCode"], requiredPlan?: PlanEntitlements["planCode"]): boolean {
  if (!requiredPlan) {
    return true;
  }
  return PLAN_ORDER[currentPlan] >= PLAN_ORDER[requiredPlan];
}

function hasRequiredEntitlements(
  current: PlanEntitlements,
  required: DashboardModuleDefinition["requiredEntitlements"]
): boolean {
  if (!required) {
    return true;
  }
  if (typeof required.maxApiNumbers === "number" && current.maxApiNumbers < required.maxApiNumbers) {
    return false;
  }
  if (typeof required.maxAgentProfiles === "number" && current.maxAgentProfiles < required.maxAgentProfiles) {
    return false;
  }
  if (typeof required.maxActiveFlows === "number" && (current.maxActiveFlows ?? 0) < required.maxActiveFlows) {
    return false;
  }
  if (required.module && current.modules?.[required.module] !== true) {
    return false;
  }
  if (required.prioritySupport && !current.prioritySupport) {
    return false;
  }
  return true;
}

function requiresKnownEntitlements(definition: DashboardModuleDefinition): boolean {
  return Boolean(definition.requiredPlan || definition.requiredEntitlements);
}

export function isDashboardModuleAccessible(
  definition: DashboardModuleDefinition,
  bootstrap: DashboardBootstrapResponse | null
): boolean {
  if (!bootstrap) {
    return !requiresKnownEntitlements(definition);
  }

  const featureFlags = bootstrap.featureFlags ?? {};
  const flagEnabled = definition.featureFlag ? featureFlags[definition.featureFlag] !== false : true;
  if (!flagEnabled) {
    return false;
  }

  return (
    hasRequiredPlan(bootstrap.planEntitlements.planCode, definition.requiredPlan) &&
    hasRequiredEntitlements(bootstrap.planEntitlements, definition.requiredEntitlements)
  );
}

export function DashboardModuleGuard({
  definition,
  children
}: PropsWithChildren<{ definition: DashboardModuleDefinition }>) {
  const { bootstrap } = useDashboardShell();

  // Bootstrap still loading — render children immediately, no wait
  if (!bootstrap) {
    return <>{children}</>;
  }

  // Bootstrap loaded and access confirmed — render page
  if (isDashboardModuleAccessible(definition, bootstrap)) {
    return <>{children}</>;
  }

  // Bootstrap loaded and access denied — show single reusable placeholder
  return <ModuleNoPermission />;
}

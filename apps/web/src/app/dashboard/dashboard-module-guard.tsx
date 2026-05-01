import { NavLink } from "react-router-dom";
import type { PropsWithChildren } from "react";
import type { DashboardModuleDefinition } from "../../shared/dashboard/module-contracts";
import { useDashboardShell } from "../../shared/dashboard/shell-context";
import type { DashboardBootstrapResponse } from "../../shared/dashboard/contracts";
import type { PlanEntitlements } from "../../lib/api";

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

function ModuleMessage({
  title,
  body,
  ctaLabel,
  ctaTo
}: {
  title: string;
  body: string;
  ctaLabel?: string;
  ctaTo?: string;
}) {
  return (
    <section className="finance-shell">
      <article className="finance-panel">
        <h2>{title}</h2>
        <p>{body}</p>
        {ctaLabel && ctaTo ? (
          <div className="clone-hero-actions">
            <NavLink className="primary-btn" to={ctaTo}>
              {ctaLabel}
            </NavLink>
          </div>
        ) : null}
      </article>
    </section>
  );
}

export function DashboardModuleGuard({
  definition,
  children
}: PropsWithChildren<{ definition: DashboardModuleDefinition }>) {
  const { bootstrap } = useDashboardShell();
  const featureFlags = bootstrap?.featureFlags ?? {};
  const flagEnabled = definition.featureFlag ? featureFlags[definition.featureFlag] !== false : true;

  if (!flagEnabled) {
    return (
      <ModuleMessage
        title="Module unavailable"
        body="This module is currently disabled by feature flags for this environment."
      />
    );
  }

  if (!bootstrap && requiresKnownEntitlements(definition)) {
    return (
      <ModuleMessage
        title="Checking access"
        body="We are checking your subscription before opening this module."
      />
    );
  }

  if (!isDashboardModuleAccessible(definition, bootstrap)) {
    return (
      <ModuleMessage
        title="Upgrade required"
        body="Your current subscription does not include this module. Upgrade your plan to unlock access."
        ctaLabel="Open billing"
        ctaTo="/dashboard/billing"
      />
    );
  }

  return <>{children}</>;
}

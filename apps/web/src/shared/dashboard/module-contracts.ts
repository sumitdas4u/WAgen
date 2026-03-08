import type { QueryClient } from "@tanstack/react-query";
import type { ComponentType } from "react";
import type { PlanEntitlements } from "../../lib/api";
import type { DashboardBootstrapResponse } from "./contracts";

export type DashboardNavSection = "main" | "studio" | "settings";
export type DashboardPrefetchStrategy = "code" | "code+data";
export type DashboardRequiredPlan = PlanEntitlements["planCode"];

export type DashboardIconName =
  | "brand"
  | "chats"
  | "leads"
  | "billing"
  | "knowledge"
  | "test"
  | "agents"
  | "settings"
  | "personality"
  | "unanswered"
  | "logout";

export interface DashboardEntitlementRequirement {
  maxApiNumbers?: number;
  maxAgentProfiles?: number;
  prioritySupport?: boolean;
}

export interface DashboardModuleRouteModule {
  Component: ComponentType;
  prefetchData?: (context: DashboardModulePrefetchContext) => Promise<void> | void;
}

export interface DashboardModulePrefetchContext {
  token: string;
  queryClient: QueryClient;
  bootstrap: DashboardBootstrapResponse | null;
}

export interface DashboardModuleDefinition {
  id: string;
  path: string;
  navTo: string;
  navLabel: string;
  subtitle: string;
  icon: DashboardIconName;
  section: DashboardNavSection;
  lazyRoute: () => Promise<DashboardModuleRouteModule>;
  legacyAliases?: string[];
  featureFlag?: string;
  requiredPlan?: DashboardRequiredPlan;
  requiredEntitlements?: DashboardEntitlementRequirement;
  prefetchStrategy?: DashboardPrefetchStrategy;
  requiresAuth: boolean;
}

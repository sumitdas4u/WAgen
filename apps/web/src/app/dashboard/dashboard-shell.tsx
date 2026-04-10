import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useMatches, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth-context";
import { dashboardModules } from "../../registry/dashboardModules";
import { DashboardIcon } from "../../shared/dashboard/icons";
import type { DashboardIconName } from "../../shared/dashboard/module-contracts";
import { useDashboardShell } from "../../shared/dashboard/shell-context";
import { DashboardShellDataProvider } from "./dashboard-shell-context";

type PrimaryNavId = "conversations" | "leads" | "broadcast" | "sequence" | "analytics" | "billing" | "knowledge" | "settings";

type PrimaryNavItem = {
  id: PrimaryNavId;
  label: string;
  icon: DashboardIconName;
  title: string;
  defaultModuleIds: string[];
};

type StudioNavItem = {
  moduleId: string;
  label: string;
  icon: DashboardIconName;
  to: string;
};

type SettingsNavItem = {
  moduleId: string;
  label: string;
  icon: DashboardIconName;
  to: string;
};

type AnalyticsNavItem = {
  label: string;
  icon: DashboardIconName;
  to: string;
};

const PRIMARY_NAV_ITEMS: PrimaryNavItem[] = [
  {
    id: "conversations",
    label: "Chats",
    icon: "chats",
    title: "Chats",
    defaultModuleIds: ["inbox"]
  },
  {
    id: "leads",
    label: "Contacts",
    icon: "leads",
    title: "Contacts",
    defaultModuleIds: ["leads"]
  },
  {
    id: "broadcast",
    label: "Broadcast",
    icon: "broadcast",
    title: "Broadcast",
    defaultModuleIds: ["broadcast"]
  },
  {
    id: "sequence",
    label: "Sequence",
    icon: "sequence",
    title: "Sequence",
    defaultModuleIds: ["sequence"]
  },
  {
    id: "analytics",
    label: "Analytics",
    icon: "analytics",
    title: "Analytics",
    defaultModuleIds: ["analytics"]
  },
  {
    id: "billing",
    label: "Billing",
    icon: "billing",
    title: "Billing",
    defaultModuleIds: ["billing"]
  },
  {
    id: "knowledge",
    label: "Chat Bot",
    icon: "knowledge",
    title: "Chat Bot",
    defaultModuleIds: ["studio-flows", "studio-knowledge", "studio-personality", "studio-review", "studio-test", "agents"]
  },
  {
    id: "settings",
    label: "Settings",
    icon: "settings",
    title: "Settings",
    defaultModuleIds: ["settings-web", "settings-qr", "settings-api", "settings-templates", "settings-contact-fields", "settings-webhooks"]
  }
];

const STUDIO_MENU_ITEMS: StudioNavItem[] = [
  { moduleId: "studio-flows", label: "Flows", icon: "flows", to: "/dashboard/studio/flows" },
  { moduleId: "studio-knowledge", label: "Knowledge Base", icon: "knowledge", to: "/dashboard/studio/knowledge" },
  {
    moduleId: "studio-personality",
    label: "Chatbot Personality",
    icon: "personality",
    to: "/dashboard/studio/personality"
  },
  { moduleId: "studio-review", label: "AI Review Center", icon: "unanswered", to: "/dashboard/studio/review" },
  { moduleId: "studio-test", label: "Test chatbot", icon: "test", to: "/dashboard/studio/test" },
  { moduleId: "agents", label: "AI Agents", icon: "agents", to: "/dashboard/agents" }
];

const SETTINGS_MENU_ITEMS: SettingsNavItem[] = [
  { moduleId: "settings-templates", label: "WhatsApp Templates", icon: "templates", to: "/dashboard/settings/templates" },
  { moduleId: "settings-web", label: "Web Channel", icon: "settings", to: "/dashboard/settings/web" },
  { moduleId: "settings-api", label: "WhatsApp API Channel", icon: "settings", to: "/dashboard/settings/api" },
  { moduleId: "settings-qr", label: "WhatsApp QR", icon: "chats", to: "/dashboard/settings/qr" },
  { moduleId: "settings-contact-fields", label: "Contact Fields", icon: "leads", to: "/dashboard/settings/contact-fields" },
  { moduleId: "settings-webhooks", label: "Generic Webhooks", icon: "settings", to: "/dashboard/settings/webhooks" }
];

const ANALYTICS_MENU_ITEMS: AnalyticsNavItem[] = [
  { label: "Dashboard", icon: "analytics", to: "/dashboard/analytics" },
  { label: "WA Failed message", icon: "unanswered", to: "/dashboard/analytics/failed-messages" },
  { label: "WA Notification message", icon: "templates", to: "/dashboard/analytics/notification-messages" },
  { label: "Conversation report", icon: "chats", to: "/dashboard/analytics/conversation-report" },
  { label: "Reports", icon: "billing", to: "/dashboard/analytics/reports" }
];

const SECTION_META: Record<string, { label: string; subtitle: string }> = {
  inbox: { label: "Chats", subtitle: "Live Inbox" },
  leads: { label: "Contacts", subtitle: "Customer Directory" },
  billing: { label: "Billing", subtitle: "Credits, invoices, and renewals" },
  broadcast: { label: "Broadcast", subtitle: "Broadcast campaigns, audiences, and retargeting" },
  sequence: { label: "Sequence", subtitle: "Behavior-based follow ups and remarketing" },
  analytics: { label: "Analytics", subtitle: "Message delivery and reporting" },
  "studio-knowledge": { label: "Knowledge Base", subtitle: "Manage all ingested sources" },
  "studio-flows": { label: "Flows", subtitle: "Build chatbot workflows visually" },
  "studio-personality": { label: "Chatbot Personality", subtitle: "Tune voice, identity, and behavior" },
  "studio-review": {
    label: "AI Review Center",
    subtitle: "Review low-confidence replies and teach better answers"
  },
  "studio-test": { label: "Test chatbot", subtitle: "Live widget test against your current setup" },
  agents: { label: "AI Agents", subtitle: "Single workflow shared across all channels" },
  "settings-web": { label: "Settings", subtitle: "Configure QR and Business API channels" },
  "settings-qr": { label: "Settings", subtitle: "Configure QR and Business API channels" },
  "settings-api": { label: "Settings", subtitle: "Configure QR and Business API channels" },
  "settings-templates": { label: "Settings", subtitle: "Manage WhatsApp message templates" },
  "settings-contact-fields": { label: "Settings", subtitle: "Manage contact fields" },
  "settings-webhooks": { label: "Settings", subtitle: "Configure generic webhook automations" }
};

function DashboardShellLayout() {
  const navigate = useNavigate();
  const matches = useMatches();
  const queryClient = useQueryClient();
  const { logout, user } = useAuth();
  const { bootstrap, loading, token } = useDashboardShell();
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const prefetchedModuleIds = useRef(new Set<string>());

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setIsMobileViewport(window.innerWidth <= 1100);
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 1100px)");
    const syncViewport = () => {
      setIsMobileViewport(mediaQuery.matches);
    };
    syncViewport();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncViewport);
      return () => {
        mediaQuery.removeEventListener("change", syncViewport);
      };
    }

    mediaQuery.addListener(syncViewport);
    return () => {
      mediaQuery.removeListener(syncViewport);
    };
  }, []);

  useEffect(() => {
    if (!isMobileViewport) {
      setIsMobileSidebarOpen(false);
    }
  }, [isMobileViewport]);

  useEffect(() => {
    if (!isMobileSidebarOpen) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMobileSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMobileSidebarOpen]);

  const currentModuleId = useMemo(() => {
    const match = [...matches].reverse().find((item) => {
      const handle = item.handle as { moduleId?: string } | undefined;
      return Boolean(handle?.moduleId);
    });
    return (match?.handle as { moduleId?: string } | undefined)?.moduleId ?? "inbox";
  }, [matches]);

  const featureFlags = bootstrap?.featureFlags ?? {};
  const isModuleEnabled = (moduleId: string) => {
    const definition = dashboardModules.find((item) => item.id === moduleId);
    if (!definition) {
      return false;
    }
    return definition.featureFlag ? featureFlags[definition.featureFlag] !== false : true;
  };

  const visibleStudioItems = STUDIO_MENU_ITEMS.filter((item) => isModuleEnabled(item.moduleId));
  const studioDefaultTo = visibleStudioItems[0]?.to ?? "/dashboard/studio/knowledge";
  const settingsDefaultTo =
    dashboardModules.find((item) => item.id === "settings-web" && isModuleEnabled(item.id))?.navTo ??
    dashboardModules.find((item) => item.id.startsWith("settings-") && isModuleEnabled(item.id))?.navTo ??
    "/dashboard/settings/web";

  const primaryNav = PRIMARY_NAV_ITEMS.filter((item) => item.defaultModuleIds.some((moduleId) => isModuleEnabled(moduleId)))
    .map((item) => ({
      ...item,
      to:
        item.id === "conversations"
          ? "/dashboard/inbox"
          : item.id === "leads"
            ? "/dashboard/leads"
            : item.id === "broadcast"
              ? "/dashboard/broadcast"
            : item.id === "sequence"
              ? "/dashboard/sequence"
            : item.id === "analytics"
              ? "/dashboard/analytics"
              : item.id === "billing"
                ? "/dashboard/billing"
                : item.id === "knowledge"
                  ? studioDefaultTo
                  : settingsDefaultTo
    }));

  const currentPrimaryNavId: PrimaryNavId =
    currentModuleId === "inbox"
      ? "conversations"
      : currentModuleId === "leads"
        ? "leads"
        : currentModuleId === "broadcast"
          ? "broadcast"
          : currentModuleId === "sequence"
            ? "sequence"
          : currentModuleId === "analytics"
            ? "analytics"
            : currentModuleId === "billing"
              ? "billing"
              : currentModuleId.startsWith("settings-")
                ? "settings"
                : "knowledge";

  const handleModulePrefetch = async (moduleId: string) => {
    const module = dashboardModules.find((definition) => definition.id === moduleId);
    if (!module?.prefetchStrategy || prefetchedModuleIds.current.has(module.id)) {
      return;
    }

    prefetchedModuleIds.current.add(module.id);

    try {
      const routeModule = await module.lazyRoute();
      if (module.prefetchStrategy === "code+data" && routeModule.prefetchData) {
        await routeModule.prefetchData({
          token,
          queryClient,
          bootstrap
        });
      }
    } catch {
      prefetchedModuleIds.current.delete(module.id);
    }
  };

  const companyLabel =
    (typeof user?.business_basics?.companyName === "string" && user.business_basics.companyName.trim()) ||
    bootstrap?.userSummary?.name ||
    user?.name ||
    "WAgen AI";

  useEffect(() => {
    document.title = `WAgen - ${companyLabel}`;
  }, [companyLabel]);

  const websiteChannelEnabled = Boolean(bootstrap?.channelSummary?.website?.enabled);
  const qrChannelStatus = bootstrap?.channelSummary?.whatsapp?.status ?? "not_connected";
  const qrChannelConnected = qrChannelStatus === "connected";
  const apiChannelConnected = Boolean(bootstrap?.channelSummary?.metaApi?.connected);
  const isAnyChannelConnected = websiteChannelEnabled || qrChannelConnected || apiChannelConnected;
  const connectionBadgeStatus = loading
    ? "checking"
    : isAnyChannelConnected
      ? "connected"
      : qrChannelStatus === "waiting_scan" || qrChannelStatus === "connecting"
        ? qrChannelStatus
        : "not_connected";
  const connectionBadgeLabel = loading
    ? "Checking..."
    : qrChannelConnected
      ? "QR connected"
      : apiChannelConnected
        ? "API connected"
        : websiteChannelEnabled
          ? "Web connected"
          : qrChannelStatus === "waiting_scan"
            ? "QR connecting"
            : "disconnected";
  const workspaceCreditsLabel = bootstrap
    ? `${bootstrap.creditsSummary.remaining_credits} / ${bootstrap.creditsSummary.total_credits}`
    : "-- / --";
  const workspaceLowCreditMessage = bootstrap?.creditsSummary.low_credit_message ?? null;
  const hasConfiguredAgentProfile = Boolean(bootstrap?.agentSummary?.hasConfiguredProfile);
  const showAgentOffBanner = Boolean(bootstrap && !bootstrap.userSummary.aiActive && hasConfiguredAgentProfile);

  const sectionMeta = SECTION_META[currentModuleId] ?? SECTION_META.inbox;
  const dashboardHeaderTitle = currentModuleId === "inbox" ? "Chats" : sectionMeta.label;
  const dashboardHeaderSubtitle =
    currentModuleId === "inbox"
      ? loading
        ? "Checking channel status."
        : isAnyChannelConnected
          ? "Live Inbox"
          : hasConfiguredAgentProfile
            ? "Waiting for agent to connect."
            : "No agent found yet. Create one to start receiving chats."
      : sectionMeta.subtitle;

  const isStudioSection = visibleStudioItems.some((item) => item.moduleId === currentModuleId);
  const isSettingsSection = currentModuleId.startsWith("settings-");
  const isAnalyticsSection = currentModuleId === "analytics";
  const visibleSettingsItems = SETTINGS_MENU_ITEMS.filter((item) => isModuleEnabled(item.moduleId));
  const showBillingActions = isModuleEnabled("billing");

  const renderSubSidebar = (title: string, items: Array<{ moduleId: string; label: string; icon: DashboardIconName; to: string }>) => (
    <section className="chatbot-studio-shell dashboard-flat-studio">
      <aside className="chatbot-studio-sidebar dashboard-flat-studio-sidebar">
        <h2>{title}</h2>
        <nav className="chatbot-studio-menu dashboard-flat-studio-menu">
          {items.map((item) => (
            <NavLink
              key={item.moduleId}
              to={item.to}
              className={({ isActive }) => (isActive ? "active" : "")}
              onMouseEnter={() => { void handleModulePrefetch(item.moduleId); }}
              onFocus={() => { void handleModulePrefetch(item.moduleId); }}
            >
              <span><DashboardIcon name={item.icon} /></span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="chatbot-studio-content">
        <Outlet />
      </div>
    </section>
  );

  const renderOutlet = () => {
    if (isStudioSection) {
      return renderSubSidebar("AI Agents", visibleStudioItems);
    }

    if (isSettingsSection) {
      return renderSubSidebar("Settings", visibleSettingsItems);
    }

    if (isAnalyticsSection) {
      return renderSubSidebar("Analytics", ANALYTICS_MENU_ITEMS.map((item) => ({
        moduleId: item.to,
        label: item.label,
        icon: item.icon,
        to: item.to
      })));
    }

    return <Outlet />;
  };

  return (
    <main className="dashboard-shell dashboard-clone-shell dashboard-flat-shell">
      <section className="clone-workspace">
        <aside
          className={
            isMobileViewport
              ? `clone-icon-rail dashboard-flat-sidebar ${isMobileSidebarOpen ? "mobile-open" : "mobile-closed"}`
              : "clone-icon-rail dashboard-flat-sidebar"
          }
          id="dashboard-mobile-sidebar"
        >
          <button className="clone-rail-logo dashboard-flat-brand" type="button" onClick={() => navigate("/dashboard/inbox")}>
            <span className="clone-rail-icon">
              <DashboardIcon name="brand" />
            </span>
            <span className="clone-rail-label">{companyLabel}</span>
          </button>

          <nav className="clone-rail-menu dashboard-flat-menu">
            {primaryNav.map((item) => (
              <NavLink
                key={item.id}
                to={item.to}
                title={item.title}
                className={({ isActive }) =>
                  isActive || currentPrimaryNavId === item.id
                    ? "clone-rail-btn dashboard-flat-item active"
                    : "clone-rail-btn dashboard-flat-item"
                }
                onMouseEnter={() => {
                  const prefetchModuleId = item.defaultModuleIds.find((moduleId) => isModuleEnabled(moduleId));
                  if (prefetchModuleId) {
                    void handleModulePrefetch(prefetchModuleId);
                  }
                }}
                onFocus={() => {
                  const prefetchModuleId = item.defaultModuleIds.find((moduleId) => isModuleEnabled(moduleId));
                  if (prefetchModuleId) {
                    void handleModulePrefetch(prefetchModuleId);
                  }
                }}
                onClick={() => setIsMobileSidebarOpen(false)}
              >
                <span className="clone-rail-icon">
                  <DashboardIcon name={item.icon} />
                </span>
                <span className="clone-rail-label">{item.label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="clone-rail-divider" />
          <div className="clone-rail-spacer" />

          <button
            className="clone-rail-btn dashboard-flat-item"
            type="button"
            title="Logout"
            onClick={() => {
              if (isMobileViewport) {
                setIsMobileSidebarOpen(false);
              }
              void logout();
              navigate("/signup", { replace: true });
            }}
          >
            <span className="clone-rail-icon">
              <DashboardIcon name="logout" />
            </span>
            <span className="clone-rail-label">Logout</span>
          </button>
        </aside>

        {isMobileViewport && isMobileSidebarOpen ? (
          <button
            type="button"
            className="dashboard-mobile-scrim"
            aria-label="Close menu"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
        ) : null}

        <section className="clone-main dashboard-flat-main">
          <header className="clone-main-header dashboard-flat-header">
            <div className="dashboard-header-left">
              {isMobileViewport ? (
                <button
                  type="button"
                  className="dashboard-mobile-menu-btn"
                  aria-label="Open menu"
                  aria-expanded={isMobileSidebarOpen}
                  aria-controls="dashboard-mobile-sidebar"
                  onClick={() => setIsMobileSidebarOpen((current) => !current)}
                >
                  &#9776;
                </button>
              ) : null}
              <div>
                <h1>{dashboardHeaderTitle}</h1>
                <p>{dashboardHeaderSubtitle}</p>
              </div>
            </div>

            <div className="clone-main-actions">
              {showBillingActions ? (
                <button
                  type="button"
                  className={bootstrap?.creditsSummary.low_credit ? "credits-chip credits-chip-low" : "credits-chip"}
                  onClick={() => navigate("/dashboard/billing")}
                  title="Open Billing"
                >
                  Credits: {workspaceCreditsLabel}
                </button>
              ) : null}
              <span className={`status-badge status-${connectionBadgeStatus}`}>{connectionBadgeLabel}</span>
            </div>
          </header>

          {showAgentOffBanner ? (
            <div className="agent-off-warning-banner" role="alert">
              <div className="agent-off-warning-copy">
                <strong>Your agent workflow is paused.</strong>
                <span>Please activate it from AI Agents to continue automated replies.</span>
              </div>
              <button type="button" className="ghost-btn" onClick={() => navigate("/dashboard/agents")}>
                Activate now
              </button>
            </div>
          ) : null}

          {workspaceLowCreditMessage ? (
            <div className="credits-warning-banner" role="status">
              {workspaceLowCreditMessage}
            </div>
          ) : null}

          <div className="dashboard-route-viewport">
            {renderOutlet()}
          </div>
        </section>
      </section>
    </main>
  );
}

export function DashboardShell() {
  return (
    <DashboardShellDataProvider>
      <DashboardShellLayout />
    </DashboardShellDataProvider>
  );
}

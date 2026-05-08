import { NavLink, Outlet, useLocation } from "react-router-dom";
import { SuperAdminProvider, useSuperAdmin } from "./lib/super-admin-context";
import styles from "./SuperAdminShell.module.css";

interface NavItem {
  label: string;
  to: string;
  soon?: boolean;
  end?: boolean;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    group: "Overview",
    items: [
      { label: "Dashboard", to: "/super-admin", end: true },
      { label: "Activity Feed", to: "/super-admin/activity" },
    ],
  },
  {
    group: "Workspace Mgmt",
    items: [
      { label: "Workspaces", to: "/super-admin/workspaces" },
      { label: "Users", to: "/super-admin/users" },
      { label: "Customer Success", to: "/super-admin/customer-success" },
      { label: "Fraud Detection", to: "/super-admin/fraud" },
    ],
  },
  {
    group: "Billing",
    items: [
      { label: "Billing & Subscriptions", to: "/super-admin/billing" },
      { label: "Plans", to: "/super-admin/plans" },
    ],
  },
  {
    group: "AI & Safety",
    items: [
      { label: "AI Logs", to: "/super-admin/ai-logs" },
      { label: "Spend Limits", to: "/super-admin/ai-spend-limits" },
      { label: "Abuse Flags", to: "/super-admin/abuse-flags" },
      { label: "Prompt Manager", to: "/super-admin/prompts" },
    ],
  },
  {
    group: "Channels",
    items: [
      { label: "QR Sessions", to: "/super-admin/qr-sessions" },
      { label: "WABA Connections", to: "/super-admin/waba" },
      { label: "Meta Compliance", to: "/super-admin/meta-compliance" },
    ],
  },
  {
    group: "Messaging",
    items: [
      { label: "Broadcasts", to: "/super-admin/broadcasts" },
      { label: "Broadcast Health", to: "/super-admin/broadcast-health" },
      { label: "Templates", to: "/super-admin/templates" },
    ],
  },
  {
    group: "Analytics",
    items: [
      { label: "Enterprise Analytics", to: "/super-admin/analytics" },
    ],
  },
  {
    group: "System",
    items: [
      { label: "System Health", to: "/super-admin/system-health" },
      { label: "Queue Monitor", to: "/super-admin/queues" },
      { label: "Webhook Logs", to: "/super-admin/webhook-logs" },
      { label: "Audit Logs", to: "/super-admin/audit-logs" },
      { label: "Emergency", to: "/super-admin/emergency" },
      { label: "Feature Flags", to: "/super-admin/feature-flags" },
    ],
  },
  {
    group: "Config",
    items: [
      { label: "Settings", to: "/super-admin/settings" },
    ],
  },
];

function SidebarNav() {
  return (
    <nav className={styles.sidebarNav}>
      {NAV.map((group) => (
        <div key={group.group} className={styles.navGroup}>
          <div className={styles.navGroupLabel}>{group.group}</div>
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `${styles.navLink}${isActive ? ` ${styles.navLinkActive}` : ""}`
              }
            >
              {item.label}
              {item.soon && <span className={styles.navBadge}>Soon</span>}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

function Topbar() {
  const { adminEmail, logout } = useSuperAdmin();
  const location = useLocation();

  const currentLabel = (() => {
    for (const group of NAV) {
      for (const item of group.items) {
        const path = item.to.replace("/super-admin", "") || "/";
        const loc = location.pathname.replace("/super-admin", "") || "/";
        if (item.end ? loc === path : loc.startsWith(path) && path !== "/") return item.label;
        if (item.end && (loc === "/" || loc === "")) return item.label;
      }
    }
    return "Super Admin";
  })();

  return (
    <header className={styles.topbar}>
      <div className={styles.topbarLeft}>
        <span>Super Admin</span>
        <span className={styles.topbarSep}>/</span>
        <strong>{currentLabel}</strong>
      </div>
      <div className={styles.topbarRight}>
        <span className={styles.adminPill}>{adminEmail}</span>
        <button className={styles.logoutBtn} onClick={logout}>Logout</button>
      </div>
    </header>
  );
}

function ShellInner() {
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarLogo}>
          <div className={styles.sidebarLogoTitle}>WagenAI</div>
          <div className={styles.sidebarLogoSub}>Super Admin Panel</div>
        </div>
        <SidebarNav />
      </aside>
      <div className={styles.main}>
        <Topbar />
        <div className={styles.content}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export function SuperAdminShell() {
  return (
    <SuperAdminProvider>
      <ShellInner />
    </SuperAdminProvider>
  );
}

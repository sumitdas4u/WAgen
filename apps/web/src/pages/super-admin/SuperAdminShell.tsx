import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { SuperAdminProvider, useSuperAdmin } from "./lib/super-admin-context";
import { fetchAdminSearch, type AdminSearchResults } from "../../lib/api";
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
      { label: "Coupons", to: "/super-admin/coupons" },
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

function GlobalSearch() {
  const { token } = useSuperAdmin();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminSearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(
    (q: string) => {
      if (q.trim().length < 2) { setResults(null); return; }
      setLoading(true);
      fetchAdminSearch(token, q)
        .then((r) => setResults(r.results))
        .catch(() => setResults(null))
        .finally(() => setLoading(false));
    },
    [token]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 300);
  };

  const handleOpen = () => {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleClose = () => {
    setOpen(false);
    setQuery("");
    setResults(null);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (open) handleClose();
        else handleOpen();
      }
      if (e.key === "Escape" && open) handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const totalResults = results
    ? results.workspaces.length + results.users.length + results.phones.length + results.campaigns.length
    : 0;

  return (
    <>
      <button
        className={styles.searchTrigger}
        onClick={handleOpen}
        title="Global search (Ctrl+K)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        Search…
        <kbd className={styles.searchKbd}>⌘K</kbd>
      </button>

      {open && (
        <div className={styles.searchBackdrop} onClick={handleClose}>
          <div className={styles.searchModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.searchInputRow}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                ref={inputRef}
                className={styles.searchInput}
                placeholder="Search workspaces, users, phones, campaigns…"
                value={query}
                onChange={handleChange}
                autoComplete="off"
              />
              {loading && <span className={styles.searchSpinner} />}
            </div>

            {results && totalResults === 0 && (
              <div className={styles.searchEmpty}>No results for "{query}"</div>
            )}

            {results && totalResults > 0 && (
              <div className={styles.searchResults}>
                {results.workspaces.length > 0 && (
                  <div className={styles.searchGroup}>
                    <div className={styles.searchGroupLabel}>Workspaces</div>
                    {results.workspaces.map((w) => (
                      <button
                        key={w.id}
                        className={styles.searchResultItem}
                        onClick={() => { navigate(`/super-admin/workspaces/${w.id}`); handleClose(); }}
                      >
                        <strong>{w.name}</strong>
                        <span>{w.ownerEmail}</span>
                      </button>
                    ))}
                  </div>
                )}
                {results.users.length > 0 && (
                  <div className={styles.searchGroup}>
                    <div className={styles.searchGroupLabel}>Users</div>
                    {results.users.map((u) => (
                      <button
                        key={u.id}
                        className={styles.searchResultItem}
                        onClick={() => { navigate(`/super-admin/users/${u.id}`); handleClose(); }}
                      >
                        <strong>{u.name}</strong>
                        <span>{u.email} · {u.plan}</span>
                      </button>
                    ))}
                  </div>
                )}
                {results.phones.length > 0 && (
                  <div className={styles.searchGroup}>
                    <div className={styles.searchGroupLabel}>Phone Numbers</div>
                    {results.phones.map((p) => (
                      <button
                        key={p.conversationId}
                        className={styles.searchResultItem}
                        onClick={() => handleClose()}
                      >
                        <strong>{p.phoneNumber}</strong>
                        <span>{p.workspaceName}</span>
                      </button>
                    ))}
                  </div>
                )}
                {results.campaigns.length > 0 && (
                  <div className={styles.searchGroup}>
                    <div className={styles.searchGroupLabel}>Broadcasts</div>
                    {results.campaigns.map((c) => (
                      <button
                        key={c.id}
                        className={styles.searchResultItem}
                        onClick={() => handleClose()}
                      >
                        <strong>{c.name}</strong>
                        <span>{c.workspaceName} · {c.status}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
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
        <GlobalSearch />
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

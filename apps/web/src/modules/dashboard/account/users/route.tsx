import "./../account.css";

const MOCK_MEMBERS = [
  { id: "1", name: "You (Owner)", email: "", role: "owner", initials: "YO", joinedAt: null },
];

const ROLES = [
  { key: "owner", label: "Owner", desc: "Full access including billing and account deletion" },
  { key: "admin", label: "Admin", desc: "Full access to all features except billing and account deletion" },
  { key: "member", label: "Member", desc: "Can view and reply to conversations, manage contacts" },
];

export function Component() {
  return (
    <div className="acc-page">
      <div className="acc-page-header">
        <h1 className="acc-page-title">Users &amp; Teams</h1>
        <div className="acc-header-actions">
          <button className="acc-save-btn" disabled title="Multi-user coming soon" style={{ opacity: 0.5, cursor: "not-allowed" }}>
            Invite member
          </button>
        </div>
      </div>

      {/* ── Coming soon banner ─────────────────────────────────────────────── */}
      <div className="acc-ai-wallet-banner">
        <div className="acc-ai-wallet-banner-inner">
          <p className="acc-ai-wallet-banner-title">Multi-user workspaces coming soon</p>
          <p className="acc-ai-wallet-banner-body">
            Invite team members, assign roles (Owner, Admin, Member), and manage access permissions.
            Your workspace currently runs as a single-user account.
          </p>
        </div>
      </div>

      {/* ── Members table ─────────────────────────────────────────────────── */}
      <div className="acc-table-card">
        <div className="acc-toolbar">
          <div>
            <p className="acc-card-title">Members</p>
            <p className="acc-card-subtitle" style={{ marginTop: "0.15rem" }}>
              {MOCK_MEMBERS.length} member · invites and role management coming soon
            </p>
          </div>
        </div>
        <table className="acc-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_MEMBERS.map((m) => (
              <tr key={m.id}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <div className="acc-avatar">{m.initials}</div>
                    <div>
                      <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "#122033", margin: 0 }}>
                        {m.name}
                      </p>
                      {m.email && (
                        <p style={{ fontSize: "0.75rem", color: "#5f6f86", margin: 0 }}>{m.email}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`acc-role-pill role-${m.role}`}>{m.role}</span>
                </td>
                <td>
                  <span className="acc-status-dot acc-status-dot--on">Active</span>
                </td>
                <td>
                  <button className="acc-secondary-btn" disabled style={{ opacity: 0.4, cursor: "not-allowed", height: "1.8rem", fontSize: "0.75rem" }}>
                    Manage
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Role descriptions ──────────────────────────────────────────────── */}
      <div className="acc-card">
        <div className="acc-card-head">
          <h2 className="acc-card-title">Roles &amp; permissions</h2>
        </div>
        <div className="acc-card-body" style={{ gap: "0.75rem" }}>
          {ROLES.map((r) => (
            <div key={r.key} style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
              <span className={`acc-role-pill role-${r.key}`} style={{ flexShrink: 0, marginTop: "0.1rem" }}>
                {r.label}
              </span>
              <p style={{ fontSize: "0.82rem", color: "#475569", margin: 0, lineHeight: 1.5 }}>
                {r.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function prefetchData() {
  return undefined;
}

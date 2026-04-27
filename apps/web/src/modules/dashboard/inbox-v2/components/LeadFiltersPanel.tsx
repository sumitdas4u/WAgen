import { useConvStore } from "../store/convStore";
import type { Conversation } from "../store/convStore";

function scoreToStage(score: number): "hot" | "warm" | "cold" {
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

function NavSection({ title }: { title: string }) {
  return <div className="iv-nav-section-head" style={{ cursor: "default" }}>{title}</div>;
}

function NavItem({ label, count, active, icon, dot, onClick }: {
  label: string; count?: number; active?: boolean; icon?: string; dot?: string; onClick: () => void;
}) {
  return (
    <div className={`iv-nav-item${active ? " active" : ""}`} onClick={onClick}>
      {dot && <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0 }} />}
      {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
      {label}
      {count !== undefined && <span className="iv-nav-badge">{count}</span>}
    </div>
  );
}

function FilterSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="iv-nav-filter-row">
      <div className="iv-nav-filter-label">{label}</div>
      {children}
    </div>
  );
}

function Pills<T extends string>({ options, value, onChange }: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="iv-lf-pills" style={{ marginTop: 4 }}>
      {options.map((o) => (
        <button
          key={o.value}
          className={`iv-lf-pill${value === o.value ? " active" : ""}`}
          style={{ fontSize: 10, padding: "2px 8px" }}
          onClick={() => onChange(o.value)}
        >{o.label}</button>
      ))}
    </div>
  );
}

interface Props { conversations: Conversation[] }

export function LeadFiltersPanel({ conversations }: Props) {
  const { filters, setFilters, labels, folder, setFolder } = useConvStore();

  const total = conversations.length;
  const unattended = conversations.filter((c) => c.ai_paused || c.manual_takeover).length;
  const hotCount = conversations.filter((c) => scoreToStage(c.score) === "hot").length;
  const pendingCount = conversations.filter((c) => c.status === "pending").length;
  const apiCount = conversations.filter((c) => c.channel_type === "api").length;
  const qrCount = conversations.filter((c) => c.channel_type === "qr").length;
  const webCount = conversations.filter((c) => c.channel_type === "web").length;

  const isDefault = filters.stage === "all" && filters.channel === "all" && filters.aiMode === "all" && filters.assignment === "all" && filters.labelId === "all";

  // Compute which nav item is "active"
  const activeView = (() => {
    if (filters.assignment === "assigned") return "my-inbox";
    if (filters.stage === "hot") return "hot-leads";
    if (folder === "pending") return "pending";
    if (filters.aiMode === "human") return "unattended";
    if (filters.channel === "api") return "wa-api";
    if (filters.channel === "qr") return "wa-qr";
    if (filters.channel === "web") return "web";
    if (isDefault) return "all";
    return "";
  })();

  function selectAll() {
    setFilters({ stage: "all", channel: "all", aiMode: "all", assignment: "all", labelId: "all" });
    setFolder("all");
  }

  return (
    <div className="iv-lf">
      {/* CONVERSATIONS section */}
      <NavSection title="CONVERSATIONS" />
      <NavItem
        label="All Conversations"
        count={total}
        active={activeView === "all"}
        onClick={selectAll}
      />
      <NavItem
        label="My Inbox"
        active={activeView === "my-inbox"}
        onClick={() => { selectAll(); setFilters({ assignment: "assigned" }); }}
      />
      <NavItem
        label="Unattended"
        count={unattended || undefined}
        active={activeView === "unattended"}
        onClick={() => { selectAll(); setFilters({ aiMode: "human" }); }}
      />

      {/* FOLDERS section */}
      <NavSection title="FOLDERS" />
      <NavItem
        label="Hot Leads"
        icon="🔥"
        count={hotCount || undefined}
        active={activeView === "hot-leads"}
        onClick={() => { selectAll(); setFilters({ stage: "hot" }); }}
      />
      <NavItem
        label="Pending Review"
        icon="⚠️"
        count={pendingCount || undefined}
        active={activeView === "pending"}
        onClick={() => { selectAll(); setFolder("pending"); }}
      />

      {/* CHANNELS section */}
      <NavSection title="CHANNELS" />
      <NavItem
        label="WhatsApp API"
        dot="#22c55e"
        count={apiCount || undefined}
        active={activeView === "wa-api"}
        onClick={() => { selectAll(); setFilters({ channel: "api" }); }}
      />
      <NavItem
        label="WhatsApp QR"
        dot="#22c55e"
        count={qrCount || undefined}
        active={activeView === "wa-qr"}
        onClick={() => { selectAll(); setFilters({ channel: "qr" }); }}
      />
      <NavItem
        label="Web Widget"
        dot="#8b5cf6"
        count={webCount || undefined}
        active={activeView === "web"}
        onClick={() => { selectAll(); setFilters({ channel: "web" }); }}
      />

      {/* Compact filter controls */}
      <div className="iv-nav-filters-divider" />

      <div className="iv-nav-filters">
        <FilterSection label="Lead Stage">
          <Pills
            value={filters.stage}
            onChange={(v) => setFilters({ stage: v })}
            options={[
              { label: "All", value: "all" },
              { label: "Hot", value: "hot" },
              { label: "Warm", value: "warm" },
              { label: "Cold", value: "cold" }
            ]}
          />
        </FilterSection>

        <FilterSection label="AI Status">
          <Pills
            value={filters.aiMode}
            onChange={(v) => setFilters({ aiMode: v })}
            options={[
              { label: "All", value: "all" },
              { label: "AI", value: "ai" },
              { label: "Human", value: "human" }
            ]}
          />
        </FilterSection>

        <FilterSection label="Assigned">
          <Pills
            value={filters.assignment}
            onChange={(v) => setFilters({ assignment: v })}
            options={[
              { label: "All", value: "all" },
              { label: "Assigned", value: "assigned" },
              { label: "Unassigned", value: "unassigned" }
            ]}
          />
        </FilterSection>

        <FilterSection label="Channel">
          <Pills
            value={filters.channel}
            onChange={(v) => setFilters({ channel: v })}
            options={[
              { label: "All", value: "all" },
              { label: "QR", value: "qr" },
              { label: "API", value: "api" },
              { label: "Web", value: "web" }
            ]}
          />
        </FilterSection>

        {labels.length > 0 && (
          <FilterSection label="Label">
            <div className="iv-lf-pills" style={{ marginTop: 4 }}>
              <button
                className={`iv-lf-pill${filters.labelId === "all" ? " active" : ""}`}
                style={{ fontSize: 10, padding: "2px 8px" }}
                onClick={() => setFilters({ labelId: "all" })}
              >All</button>
              {labels.map((l) => (
                <button
                  key={l.id}
                  className={`iv-lf-pill${filters.labelId === l.id ? " active" : ""}`}
                  style={{
                    fontSize: 10, padding: "2px 8px",
                    borderColor: filters.labelId === l.id ? l.color : undefined,
                    background: filters.labelId === l.id ? `${l.color}22` : undefined,
                    color: filters.labelId === l.id ? l.color : undefined
                  }}
                  onClick={() => setFilters({ labelId: l.id })}
                >
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: l.color, marginRight: 4, verticalAlign: "middle" }} />
                  {l.name}
                </button>
              ))}
            </div>
          </FilterSection>
        )}

        {!isDefault && (
          <button
            className="iv-lf-reset"
            style={{ margin: "4px 12px 8px", alignSelf: "flex-start" }}
            onClick={selectAll}
          >Clear filters</button>
        )}
      </div>
    </div>
  );
}

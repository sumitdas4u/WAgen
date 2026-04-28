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

const RESET_FILTERS = { stage: "all", channel: "all", aiMode: "all", assignment: "all", labelId: "all", leadKind: "all", priority: "all" } as const;

export function LeadFiltersPanel({ conversations }: Props) {
  const { filters, setFilters, labels } = useConvStore();

  const hotCount  = conversations.filter((c) => scoreToStage(c.score) === "hot").length;
  const warmCount = conversations.filter((c) => scoreToStage(c.score) === "warm").length;
  const coldCount = conversations.filter((c) => scoreToStage(c.score) === "cold").length;
  const apiCount  = conversations.filter((c) => c.channel_type === "api").length;
  const qrCount   = conversations.filter((c) => c.channel_type === "qr").length;
  const webCount  = conversations.filter((c) => c.channel_type === "web").length;

  // isDefault only checks filters — folder (tabs) is independent
  const isDefault =
    filters.stage === "all" &&
    filters.channel === "all" &&
    filters.aiMode === "all" &&
    filters.assignment === "all" &&
    filters.labelId === "all" &&
    filters.leadKind === "all" &&
    filters.priority === "all";

  // activeView only reflects filters state — tabs don't affect left panel
  const activeView = (() => {
    if (filters.stage === "hot"  && filters.channel === "all") return "hot-leads";
    if (filters.stage === "warm" && filters.channel === "all") return "warm-leads";
    if (filters.stage === "cold" && filters.channel === "all") return "cold-leads";
    if (filters.channel === "api") return "wa-api";
    if (filters.channel === "qr")  return "wa-qr";
    if (filters.channel === "web") return "web";
    if (isDefault) return "all";
    return "";
  })();

  // Only resets filters — never touches folder/tabs
  function resetFilters() {
    setFilters(RESET_FILTERS);
  }

  return (
    <div className="iv-lf">
      {/* LEAD STATUS section */}
      <NavSection title="LEAD STATUS" />
      <NavItem
        label="Hot Leads"
        icon="🔥"
        count={hotCount || undefined}
        active={activeView === "hot-leads"}
        onClick={() => setFilters({ ...RESET_FILTERS, stage: "hot" })}
      />
      <NavItem
        label="Warm Leads"
        icon="☀️"
        count={warmCount || undefined}
        active={activeView === "warm-leads"}
        onClick={() => setFilters({ ...RESET_FILTERS, stage: "warm" })}
      />
      <NavItem
        label="Cold Leads"
        icon="❄️"
        count={coldCount || undefined}
        active={activeView === "cold-leads"}
        onClick={() => setFilters({ ...RESET_FILTERS, stage: "cold" })}
      />

      {/* CHANNELS section */}
      <NavSection title="CHANNELS" />
      <NavItem
        label="WhatsApp API"
        dot="#22c55e"
        count={apiCount || undefined}
        active={activeView === "wa-api"}
        onClick={() => setFilters({ ...RESET_FILTERS, channel: "api" })}
      />
      <NavItem
        label="WhatsApp QR"
        dot="#22c55e"
        count={qrCount || undefined}
        active={activeView === "wa-qr"}
        onClick={() => setFilters({ ...RESET_FILTERS, channel: "qr" })}
      />
      <NavItem
        label="Web Widget"
        dot="#8b5cf6"
        count={webCount || undefined}
        active={activeView === "web"}
        onClick={() => setFilters({ ...RESET_FILTERS, channel: "web" })}
      />

      {/* Compact filter controls */}
      <div className="iv-nav-filters-divider" />

      <div className="iv-nav-filters">
        <FilterSection label="Lead Type">
          <Pills
            value={filters.leadKind}
            onChange={(v) => setFilters({ leadKind: v })}
            options={[
              { label: "All", value: "all" },
              { label: "Lead", value: "lead" },
              { label: "Feedback", value: "feedback" },
              { label: "Complaint", value: "complaint" },
              { label: "Other", value: "other" }
            ]}
          />
        </FilterSection>

        <FilterSection label="Priority">
          <Pills
            value={filters.priority}
            onChange={(v) => setFilters({ priority: v })}
            options={[
              { label: "All", value: "all" },
              { label: "Urgent", value: "urgent" },
              { label: "High", value: "high" },
              { label: "Medium", value: "medium" },
              { label: "Low", value: "low" }
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
            onClick={resetFilters}
          >Clear filters</button>
        )}
      </div>
    </div>
  );
}

import { useConvStore } from "../store/convStore";
import type { ConvFilters, Conversation } from "../store/convStore";

function scoreToStage(score: number): "hot" | "warm" | "cold" {
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

function PillGroup<T extends string>({
  options, value, onChange
}: { options: { label: string; value: T }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="iv-lf-pills">
      {options.map((o) => (
        <button
          key={o.value}
          className={`iv-lf-pill${value === o.value ? " active" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function FilterSelect({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <select className="iv-lf-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function FilterRow({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="iv-lf-row">
      <div className="iv-lf-row-head">
        <span className="iv-lf-row-label">{label}</span>
        <span className="iv-lf-row-hint">{hint}</span>
      </div>
      {children}
    </div>
  );
}

interface Props {
  conversations: Conversation[];
}

export function LeadFiltersPanel({ conversations }: Props) {
  const { filters, setFilters } = useConvStore();

  const allCount = conversations.length;
  const hotCount = conversations.filter((c) => scoreToStage(c.score) === "hot").length;
  const humanCount = conversations.filter((c) => c.manual_takeover || c.ai_paused).length;
  const unassignedCount = conversations.filter((c) => !c.assigned_agent_profile_id).length;

  const isDefault = Object.values(filters).every((v) => v === "all");

  function reset() {
    setFilters({ stage: "all", channel: "all", score: "all", assignment: "all", dateRange: "all", aiMode: "all", kind: "all" });
  }

  return (
    <div className="iv-lf">
      <div className="iv-lf-header">
        <div className="iv-lf-title">Lead Filters</div>
        <div className="iv-lf-subtitle">Lead intelligence filters that update the inbox instantly.</div>
      </div>

      {isDefault ? (
        <div className="iv-lf-no-filter">
          <div className="iv-lf-no-filter-label">No lead filter applied</div>
          <div className="iv-lf-no-filter-sub">All conversations are visible until you apply a filter below.</div>
        </div>
      ) : (
        <button className="iv-lf-reset" onClick={reset}>Clear all filters</button>
      )}

      <div className="iv-lf-stats">
        <div className="iv-lf-stat iv-lf-stat-all">
          <div className="iv-lf-stat-label">ALL CHATS</div>
          <div className="iv-lf-stat-val">{allCount}</div>
        </div>
        <div className="iv-lf-stat iv-lf-stat-hot">
          <div className="iv-lf-stat-label">HOT LEADS</div>
          <div className="iv-lf-stat-val">{hotCount}</div>
        </div>
        <div className="iv-lf-stat iv-lf-stat-human">
          <div className="iv-lf-stat-label">HUMAN HANDLING</div>
          <div className="iv-lf-stat-val">{humanCount}</div>
        </div>
        <div className="iv-lf-stat iv-lf-stat-unassigned">
          <div className="iv-lf-stat-label">UNASSIGNED</div>
          <div className="iv-lf-stat-val">{unassignedCount}</div>
        </div>
      </div>

      <div className="iv-lf-filters">
        <FilterRow label="Status" hint="Lead stage">
          <PillGroup
            value={filters.stage as ConvFilters["stage"]}
            onChange={(v) => setFilters({ stage: v })}
            options={[
              { label: "All", value: "all" },
              { label: "Hot", value: "hot" },
              { label: "Warm", value: "warm" },
              { label: "Cold", value: "cold" }
            ]}
          />
        </FilterRow>

        <FilterRow label="Source" hint="Conversation channel">
          <FilterSelect
            value={filters.channel}
            onChange={(v) => setFilters({ channel: v })}
            options={[
              { label: "All channels", value: "all" },
              { label: "WhatsApp QR", value: "qr" },
              { label: "WhatsApp API", value: "api" },
              { label: "Web Widget", value: "web" }
            ]}
          />
        </FilterRow>

        <FilterRow label="AI Score" hint="Derived from lead score">
          <PillGroup
            value={filters.score as ConvFilters["score"]}
            onChange={(v) => setFilters({ score: v })}
            options={[
              { label: "All scores", value: "all" },
              { label: "Hot", value: "hot" },
              { label: "Warm", value: "warm" },
              { label: "Cold", value: "cold" }
            ]}
          />
        </FilterRow>

        <FilterRow label="Lead Type" hint="Intent classification">
          <FilterSelect
            value={filters.kind}
            onChange={(v) => setFilters({ kind: v })}
            options={[
              { label: "All types", value: "all" },
              { label: "Lead", value: "lead" },
              { label: "Customer", value: "customer" },
              { label: "Support", value: "support" }
            ]}
          />
        </FilterRow>

        <FilterRow label="Assigned" hint="Owner routing">
          <FilterSelect
            value={filters.assignment}
            onChange={(v) => setFilters({ assignment: v })}
            options={[
              { label: "All owners", value: "all" },
              { label: "Assigned", value: "assigned" },
              { label: "Unassigned", value: "unassigned" }
            ]}
          />
        </FilterRow>

        <FilterRow label="AI Status" hint="Automation mode">
          <FilterSelect
            value={filters.aiMode}
            onChange={(v) => setFilters({ aiMode: v })}
            options={[
              { label: "AI + Human", value: "all" },
              { label: "AI only", value: "ai" },
              { label: "Human only", value: "human" }
            ]}
          />
        </FilterRow>

        <FilterRow label="Date" hint="Latest message window">
          <FilterSelect
            value={filters.dateRange}
            onChange={(v) => setFilters({ dateRange: v })}
            options={[
              { label: "All time", value: "all" },
              { label: "Today", value: "today" },
              { label: "This week", value: "week" },
              { label: "This month", value: "month" }
            ]}
          />
        </FilterRow>
      </div>
    </div>
  );
}

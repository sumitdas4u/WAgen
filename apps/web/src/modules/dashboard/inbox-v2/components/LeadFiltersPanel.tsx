import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../../lib/auth-context";
import { fetchConversationTags } from "../api";
import { useConvStore } from "../store/convStore";
import type { Conversation, ConvFilters } from "../store/convStore";
import { useConversationFacets } from "../queries";

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

const RESET_FILTERS: ConvFilters = { stage: "all", channel: "all", aiMode: "all", assignment: "all", labelId: "all", leadKind: "all", priority: "all", tags: [] };

export function LeadFiltersPanel({ conversations }: Props) {
  const { filters, setFilters, labels, folder } = useConvStore();
  const { token } = useAuth();
  const [tagSearch, setTagSearch] = useState("");
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const tagComboRef = useRef<HTMLDivElement | null>(null);
  const [tagMenuMaxHeight, setTagMenuMaxHeight] = useState(180);
  const facetsQuery = useConversationFacets(folder, "", filters);
  const tagOptionsQuery = useQuery({
    queryKey: ["iv2-conversation-tags", tagSearch],
    queryFn: () => fetchConversationTags(token!, tagSearch, 50),
    enabled: Boolean(token),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false
  });
  const tagOptions = useMemo(() => {
    const selected = filters.tags.map((tag) => ({ value: tag, count: 0 }));
    const options = tagOptionsQuery.data?.tags ?? [];
    const seen = new Set<string>();
    return [...selected, ...options].filter((option) => {
      const key = option.value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [filters.tags, tagOptionsQuery.data?.tags]);

  const loadedHotCount  = conversations.filter((c) => scoreToStage(c.score) === "hot").length;
  const loadedWarmCount = conversations.filter((c) => scoreToStage(c.score) === "warm").length;
  const loadedColdCount = conversations.filter((c) => scoreToStage(c.score) === "cold").length;
  const loadedApiCount  = conversations.filter((c) => c.channel_type === "api").length;
  const loadedQrCount   = conversations.filter((c) => c.channel_type === "qr").length;
  const loadedWebCount  = conversations.filter((c) => c.channel_type === "web").length;
  const hotCount = facetsQuery.data?.stages.hot ?? loadedHotCount;
  const warmCount = facetsQuery.data?.stages.warm ?? loadedWarmCount;
  const coldCount = facetsQuery.data?.stages.cold ?? loadedColdCount;
  const apiCount = facetsQuery.data?.channels.api ?? loadedApiCount;
  const qrCount = facetsQuery.data?.channels.qr ?? loadedQrCount;
  const webCount = facetsQuery.data?.channels.web ?? loadedWebCount;

  // isDefault only checks filters — folder (tabs) is independent
  const isDefault =
    filters.stage === "all" &&
    filters.channel === "all" &&
    filters.aiMode === "all" &&
    filters.assignment === "all" &&
    filters.labelId === "all" &&
    filters.leadKind === "all" &&
    filters.priority === "all" &&
    filters.tags.length === 0;

  useEffect(() => {
    if (!tagPickerOpen) return;

    const updateMenuHeight = () => {
      const combo = tagComboRef.current;
      if (!combo) return;

      const rect = combo.getBoundingClientRect();
      const panelBottom = combo.closest(".iv-nav")?.getBoundingClientRect().bottom ?? window.innerHeight;
      const available = Math.floor(panelBottom - rect.bottom - 12);
      setTagMenuMaxHeight(Math.max(96, available));
    };

    updateMenuHeight();
    window.addEventListener("resize", updateMenuHeight);
    window.addEventListener("scroll", updateMenuHeight, true);
    return () => {
      window.removeEventListener("resize", updateMenuHeight);
      window.removeEventListener("scroll", updateMenuHeight, true);
    };
  }, [tagPickerOpen, tagSearch, filters.tags.length]);

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

  function toggleTag(tag: string) {
    const normalized = tag.replace(/\s+/g, " ").trim();
    if (!normalized) return;
    const isSelected = filters.tags.some((current) => current.toLowerCase() === normalized.toLowerCase());
    setFilters({
      tags: isSelected
        ? filters.tags.filter((current) => current.toLowerCase() !== normalized.toLowerCase())
        : [...filters.tags, normalized]
    });
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

        <FilterSection label="Tags">
          <div className="iv-tag-filter">
            {filters.tags.length > 0 && (
              <div className="iv-tag-filter-selected">
                {filters.tags.map((tag) => (
                  <button key={tag} type="button" className="iv-tag-filter-chip" onClick={() => toggleTag(tag)} title={`Remove ${tag}`}>
                    <span>{tag}</span>
                    <span aria-hidden="true">x</span>
                  </button>
                ))}
              </div>
            )}
            <div
              className="iv-tag-filter-combo"
              ref={tagComboRef}
              style={{ "--iv-tag-filter-menu-max-height": `${tagMenuMaxHeight}px` } as React.CSSProperties}
            >
              <input
                className="iv-tag-filter-input"
                value={tagSearch}
                onChange={(event) => {
                  setTagSearch(event.target.value);
                  setTagPickerOpen(true);
                }}
                onFocus={() => setTagPickerOpen(true)}
                onBlur={() => window.setTimeout(() => setTagPickerOpen(false), 120)}
                placeholder="Search tags"
              />
              {tagPickerOpen && (
                <div className="iv-tag-filter-menu">
                  {tagOptionsQuery.isLoading ? (
                    <div className="iv-tag-filter-empty">Loading...</div>
                  ) : tagOptions.length === 0 ? (
                    <div className="iv-tag-filter-empty">No tags found</div>
                  ) : (
                    tagOptions.map((option) => {
                      const selected = filters.tags.some((tag) => tag.toLowerCase() === option.value.toLowerCase());
                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={`iv-tag-filter-option${selected ? " selected" : ""}`}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => toggleTag(option.value)}
                        >
                          <span className="iv-tag-filter-check">{selected ? "on" : ""}</span>
                          <span>{option.value}</span>
                          {option.count > 0 && <span className="iv-tag-filter-count">{option.count}</span>}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        </FilterSection>

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

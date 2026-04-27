import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useConvStore, type ConvFolder, type Conversation } from "../store/convStore";
import { useConversations, useBulkAction } from "../queries";
import { ConversationRow } from "./ConversationRow";
import { NotificationBell } from "./NotificationsPanel";

const FOLDERS: { key: ConvFolder; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "pending", label: "Pending" },
  { key: "resolved", label: "Resolved" },
  { key: "snoozed", label: "Snoozed" }
];

interface Props {
  onSelectConv: (id: string) => void;
  onNew?: () => void;
  onCannedManage?: () => void;
}

function scoreToStage(score: number) {
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

function applyLeadFilters(conv: Conversation, filters: import("../store/convStore").ConvFilters): boolean {
  if (filters.stage !== "all" && scoreToStage(conv.score) !== filters.stage) return false;
  if (filters.channel !== "all" && conv.channel_type !== filters.channel) return false;
  if (filters.assignment === "assigned" && !conv.assigned_agent_profile_id) return false;
  if (filters.assignment === "unassigned" && conv.assigned_agent_profile_id) return false;
  if (filters.aiMode === "ai" && (conv.ai_paused || conv.manual_takeover)) return false;
  if (filters.aiMode === "human" && !conv.ai_paused && !conv.manual_takeover) return false;
  if (filters.labelId !== "all" && !(conv.label_ids ?? []).includes(filters.labelId)) return false;
  if (filters.leadKind !== "all" && conv.lead_kind !== filters.leadKind) return false;
  if (filters.priority !== "all" && conv.priority !== filters.priority) return false;
  return true;
}

export function ConversationList({ onSelectConv, onNew, onCannedManage }: Props) {
  const { folder, setFolder, byId, ids, activeConvId, setActiveConv, labels, filters } = useConvStore();
  const [searchQ, setSearchQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const parentRef = useRef<HTMLDivElement>(null);
  const bulkAction = useBulkAction();

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = useConversations(folder, debouncedQ);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchQ), 300);
    return () => clearTimeout(t);
  }, [searchQ]);

  const filteredIds = ids.filter((id) => {
    const c = byId[id];
    if (!c) return false;
    if (!debouncedQ && folder !== "all" && c.status !== folder) return false;
    if (!applyLeadFilters(c, filters)) return false;
    return true;
  });

  const virtualizer = useVirtualizer({
    count: filteredIds.length + (hasNextPage ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 5
  });

  const items = virtualizer.getVirtualItems();

  const handleSelect = useCallback((id: string) => {
    setActiveConv(id);
    onSelectConv(id);
  }, [setActiveConv, onSelectConv]);

  const handleToggleSelect = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleBulk = useCallback((action: string) => {
    void bulkAction.mutateAsync({ ids: [...selectedIds], action }).then(() => setSelectedIds(new Set()));
  }, [selectedIds, bulkAction]);

  // Load more when last item visible
  useEffect(() => {
    const lastItem = items[items.length - 1];
    if (!lastItem) return;
    if (lastItem.index >= filteredIds.length - 1 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [items, filteredIds.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const folderCounts = ids.reduce<Record<string, number>>((acc, id) => {
    const s = byId[id]?.status ?? "open";
    acc[s] = (acc[s] ?? 0) + 1;
    acc.all = (acc.all ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="iv-convlist">
      <div className="iv-convlist-header">
        <div className="iv-convlist-title">
          Inbox
          <span className="iv-status-pill iv-status-open">{folderCounts.open ?? 0} open</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            {onCannedManage && (
              <button className="iv-btn-icon" title="Manage canned responses" style={{ fontSize: 13 }} onClick={onCannedManage}>⚡</button>
            )}
            {onNew && (
              <button className="iv-btn-icon" title="New conversation" style={{ fontSize: 16, fontWeight: 700 }} onClick={onNew}>+</button>
            )}
            <NotificationBell />
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="iv-bulk-bar">
            <span className="iv-bulk-count">{selectedIds.size} selected</span>
            <button className="iv-bulk-btn" disabled={bulkAction.isPending} onClick={() => handleBulk("resolve")}>Resolve</button>
            <button className="iv-bulk-btn" disabled={bulkAction.isPending} onClick={() => handleBulk("reopen")}>Reopen</button>
            <button className="iv-bulk-btn iv-bulk-cancel" onClick={() => setSelectedIds(new Set())}>✕ Clear</button>
          </div>
        )}

        <div className="iv-tabs">
          {FOLDERS.map((f) => (
            <div
              key={f.key}
              className={`iv-tab${folder === f.key ? " active" : ""}`}
              onClick={() => setFolder(f.key)}
            >
              {f.label}
              {folderCounts[f.key] != null && (
                <span className="iv-tab-count">{folderCounts[f.key]}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="iv-search">
        <input
          className="iv-searchinput"
          placeholder="Search conversations..."
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
        />
      </div>

      <div className="iv-convlist-body" ref={parentRef}>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {items.map((vItem) => {
            const id = filteredIds[vItem.index];
            if (!id) {
              // Loader sentinel
              return (
                <div key="loader" style={{ position: "absolute", top: vItem.start, width: "100%", height: vItem.size }}>
                  <ShimmerRow />
                  <ShimmerRow />
                </div>
              );
            }
            const conv = byId[id];
            if (!conv) return null;
            return (
              <div key={id} style={{ position: "absolute", top: vItem.start, width: "100%", height: vItem.size }}>
                <ConversationRow
                  conv={conv as Conversation}
                  labels={labels}
                  active={activeConvId === id}
                  selected={selectedIds.has(id)}
                  hasSelection={selectedIds.size > 0}
                  onToggleSelect={(e) => handleToggleSelect(id, e)}
                  onClick={() => handleSelect(id)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ShimmerRow() {
  return (
    <div className="iv-shimmer-row">
      <div className="iv-shimmer iv-shimmer-circle" />
      <div className="iv-shimmer-lines">
        <div className="iv-shimmer iv-shimmer-line w80" />
        <div className="iv-shimmer iv-shimmer-line w55" />
      </div>
    </div>
  );
}

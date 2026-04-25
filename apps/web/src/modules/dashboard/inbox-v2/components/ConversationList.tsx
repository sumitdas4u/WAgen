import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useConvStore, type ConvFolder, type Conversation } from "../store/convStore";
import { useConversations } from "../queries";
import { ConversationRow } from "./ConversationRow";

const FOLDERS: { key: ConvFolder; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "pending", label: "Pending" },
  { key: "resolved", label: "Resolved" },
  { key: "snoozed", label: "Snoozed" }
];

interface Props {
  onSelectConv: (id: string) => void;
}

export function ConversationList({ onSelectConv }: Props) {
  const { folder, setFolder, byId, ids, activeConvId, setActiveConv, labels } = useConvStore();
  const [searchQ, setSearchQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const parentRef = useRef<HTMLDivElement>(null);

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = useConversations(folder, debouncedQ);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchQ), 300);
    return () => clearTimeout(t);
  }, [searchQ]);

  const filteredIds = ids.filter((id) => {
    const c = byId[id];
    if (!c) return false;
    if (debouncedQ) return true; // server-side search already filtered
    if (folder === "all") return true;
    return c.status === folder;
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
        </div>

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

import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../../lib/auth-context";
import { useRealtimeSocket } from "./hooks/useRealtimeSocket";
import { useConvStore } from "./store/convStore";
import { useConversation } from "./queries";
import { ConversationList } from "./components/ConversationList";
import { MessageThread } from "./components/MessageThread";
import { DetailsSidebar } from "./components/DetailsSidebar";
import { LeadFiltersPanel } from "./components/LeadFiltersPanel";
import { NotificationsPanel } from "./components/NotificationsPanel";
import { NewConvModal } from "./components/NewConvModal";
import { CannedManageModal } from "./components/CannedManageModal";
import "./inbox-v2.css";

export function Component() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const { setActiveConv, activeConvId, byId, ids } = useConvStore();
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [showMobileDetails, setShowMobileDetails] = useState(false);
  const [showNewConv, setShowNewConv] = useState(false);
  const [showCannedManage, setShowCannedManage] = useState(false);

  const optimisticMap = useRealtimeSocket(token);
  const directConvQuery = useConversation(conversationId ?? null);

  const activeId = conversationId ?? activeConvId ?? null;
  const activeConv = activeId ? byId[activeId] : null;
  const isResolvingDirectConv = Boolean(conversationId && !activeConv && !directConvQuery.isError);
  const directConvError = Boolean(conversationId && !activeConv && directConvQuery.isError);
  const conversations = ids.map((id) => byId[id]).filter(Boolean);
  const shellClassName = [
    "iv-shell",
    activeId ? "iv-has-active" : "iv-list-mode",
    !showLeftPanel ? "iv-left-collapsed" : "",
    !showSidebar || !activeId ? "iv-right-collapsed" : "",
    showMobileFilters ? "iv-mobile-filters-open" : "",
    showMobileDetails ? "iv-mobile-details-open" : ""
  ].filter(Boolean).join(" ");

  const handleSelectConv = useCallback((id: string) => {
    setActiveConv(id);
    setShowMobileFilters(false);
    setShowMobileDetails(false);
    navigate(`/dashboard/inbox-v2/${id}`, { replace: true });
  }, [setActiveConv, navigate]);

  const handleBackToList = useCallback(() => {
    setActiveConv(null);
    setShowMobileDetails(false);
    navigate("/dashboard/inbox-v2", { replace: true });
  }, [navigate, setActiveConv]);

  useEffect(() => {
    if (conversationId) {
      setActiveConv(conversationId);
    }
  }, [conversationId, setActiveConv]);

  return (
    <div className={shellClassName}>
      <NotificationsPanel />
      {(showMobileFilters || showMobileDetails) && (
        <button
          type="button"
          className="iv-mobile-backdrop"
          aria-label="Close side panel"
          onClick={() => {
            setShowMobileFilters(false);
            setShowMobileDetails(false);
          }}
        />
      )}
      {/* Col 1: Lead filters nav */}
      {(showLeftPanel || showMobileFilters) && (
        <NavSidebar
          conversations={conversations}
          onClose={() => setShowMobileFilters(false)}
        />
      )}
      <button
        type="button"
        className={`iv-panel-toggle iv-panel-toggle-left${showLeftPanel ? " is-open" : ""}`}
        title={showLeftPanel ? "Hide filters" : "Show filters"}
        aria-label={showLeftPanel ? "Hide filters" : "Show filters"}
        onClick={() => setShowLeftPanel((v) => !v)}
      >
        {showLeftPanel ? "‹" : "›"}
      </button>

      {/* Col 2: Conversation list */}
      <ConversationList
        onSelectConv={handleSelectConv}
        onNew={() => setShowNewConv(true)}
        onCannedManage={() => setShowCannedManage(true)}
        onOpenFilters={() => setShowMobileFilters(true)}
      />

      {/* Col 3: Message thread */}
      {activeId && (!conversationId || activeConv) && !directConvError ? (
        <MessageThread
          convId={activeId}
          optimisticMap={optimisticMap as React.MutableRefObject<Map<string, string>>}
          onBack={handleBackToList}
          onOpenDetails={() => setShowMobileDetails(true)}
        />
      ) : activeId && isResolvingDirectConv ? (
        <ThreadState title="Opening conversation" detail="Loading the selected chat..." />
      ) : activeId && directConvError ? (
        <ThreadState title="Conversation not found" detail="This chat may have moved, been merged, or is unavailable for this account." />
      ) : (
        <EmptyThread />
      )}

      {/* Col 4: Details sidebar */}
      {(showSidebar || showMobileDetails) && activeId && (
        <DetailsSidebar convId={activeId} onClose={() => setShowMobileDetails(false)} />
      )}
      {activeId && (
        <button
          type="button"
          className={`iv-panel-toggle iv-panel-toggle-right${showSidebar ? " is-open" : ""}`}
          title={showSidebar ? "Hide details" : "Show details"}
          aria-label={showSidebar ? "Hide details" : "Show details"}
          onClick={() => setShowSidebar((v) => !v)}
        >
          {showSidebar ? "›" : "‹"}
        </button>
      )}

      {showNewConv && (
        <NewConvModal
          onClose={() => setShowNewConv(false)}
          onCreated={(id) => { handleSelectConv(id); setShowNewConv(false); }}
        />
      )}
      {showCannedManage && <CannedManageModal onClose={() => setShowCannedManage(false)} />}
    </div>
  );
}

function NavSidebar({
  conversations,
  onClose
}: {
  conversations: import("./store/convStore").Conversation[];
  onClose?: () => void;
}) {
  return (
    <div className="iv-nav">
      <div className="iv-mobile-panel-head">
        <span>Filters</span>
        <button type="button" onClick={onClose} aria-label="Close filters">×</button>
      </div>
      <LeadFiltersPanel conversations={conversations} />
    </div>
  );
}

function EmptyThread() {
  return (
    <div className="iv-thread-state iv-empty-thread" style={{
      flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: "#f8fafc", gap: 12
    }}>
      <div style={{ fontSize: 48 }}>💬</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#334155", fontFamily: "'Space Grotesk', sans-serif" }}>
        Select a conversation
      </div>
      <div style={{ fontSize: 13, color: "#94a3b8" }}>
        Choose from the list to start chatting
      </div>
    </div>
  );
}

function ThreadState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="iv-thread-state" style={{
      flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: "#f8fafc", gap: 8, textAlign: "center", padding: 24
    }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#334155", fontFamily: "'Space Grotesk', sans-serif" }}>
        {title}
      </div>
      <div style={{ fontSize: 13, color: "#64748b", maxWidth: 360 }}>
        {detail}
      </div>
    </div>
  );
}

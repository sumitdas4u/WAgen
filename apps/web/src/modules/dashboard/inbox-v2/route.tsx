import { useCallback, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../../lib/auth-context";
import { useRealtimeSocket } from "./hooks/useRealtimeSocket";
import { useConvStore } from "./store/convStore";
import { ConversationList } from "./components/ConversationList";
import { MessageThread } from "./components/MessageThread";
import { DetailsSidebar } from "./components/DetailsSidebar";
import { LeadFiltersPanel } from "./components/LeadFiltersPanel";
import "./inbox-v2.css";

export function Component() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const { setActiveConv, activeConvId, byId, ids } = useConvStore();
  const [showSidebar] = useState(true);

  const optimisticMap = useRealtimeSocket(token);

  const activeId = conversationId ?? activeConvId ?? null;
  const conversations = ids.map((id) => byId[id]).filter(Boolean);

  const handleSelectConv = useCallback((id: string) => {
    setActiveConv(id);
    navigate(`/dashboard/inbox-v2/${id}`, { replace: true });
  }, [setActiveConv, navigate]);

  return (
    <div className="iv-shell">
      {/* Col 1: Lead filters nav */}
      <NavSidebar conversations={conversations} />

      {/* Col 2: Conversation list */}
      <ConversationList onSelectConv={handleSelectConv} />

      {/* Col 3: Message thread */}
      {activeId ? (
        <MessageThread
          convId={activeId}
          optimisticMap={optimisticMap as React.MutableRefObject<Map<string, string>>}
        />
      ) : (
        <EmptyThread />
      )}

      {/* Col 4: Details sidebar */}
      {showSidebar && activeId && (
        <DetailsSidebar convId={activeId} />
      )}
    </div>
  );
}

function NavSidebar({ conversations }: { conversations: import("./store/convStore").Conversation[] }) {
  return (
    <div className="iv-nav">
      <div className="iv-nav-org">
        <div className="iv-nav-logo">W</div>
        <span className="iv-nav-orgname">WAgen</span>
        <span className="iv-nav-caret">▾</span>
      </div>

      <LeadFiltersPanel conversations={conversations} />
    </div>
  );
}

function EmptyThread() {
  return (
    <div style={{
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

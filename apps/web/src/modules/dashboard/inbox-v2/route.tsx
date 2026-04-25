import { useCallback, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../../lib/auth-context";
import { useRealtimeSocket } from "./hooks/useRealtimeSocket";
import { useConvStore } from "./store/convStore";
import { ConversationList } from "./components/ConversationList";
import { MessageThread } from "./components/MessageThread";
import { DetailsSidebar } from "./components/DetailsSidebar";
import "./inbox-v2.css";

export function Component() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const { setActiveConv, activeConvId } = useConvStore();
  const [showSidebar, setShowSidebar] = useState(true);

  const optimisticMap = useRealtimeSocket(token);

  const activeId = conversationId ?? activeConvId ?? null;

  const handleSelectConv = useCallback((id: string) => {
    setActiveConv(id);
    navigate(`/dashboard/inbox-v2/${id}`, { replace: true });
  }, [setActiveConv, navigate]);

  return (
    <div className="iv-shell">
      {/* Col 1: Nav sidebar — minimal for now, full WAgen nav handled by DashboardShell */}
      <NavSidebar />

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

function NavSidebar() {
  return (
    <div className="iv-nav">
      <div className="iv-nav-org">
        <div className="iv-nav-logo">W</div>
        <span className="iv-nav-orgname">WAgen</span>
        <span className="iv-nav-caret">▾</span>
      </div>

      <div className="iv-nav-search">
        <div style={{ position: "relative", flex: 1 }}>
          <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#94a3b8" }}>🔍</span>
          <input className="iv-nav-searchinput" placeholder="Search..." />
        </div>
        <button className="iv-nav-compose" title="New conversation">✏</button>
      </div>

      <div className="iv-nav-section-head">
        <span>💬</span> Conversations
        <span className="iv-nav-section-caret">▾</span>
      </div>
      <div className="iv-nav-item active">
        <span>📥</span> Inbox v2
        <span className="iv-nav-badge">0</span>
      </div>
      <div className="iv-nav-item" onClick={() => window.location.href = "/dashboard/inbox"}>
        <span>📭</span> Inbox (classic)
      </div>

      <div className="iv-nav-section-head" style={{ marginTop: 8 }}>
        <span>⭐</span> Views
        <span className="iv-nav-section-caret">▾</span>
      </div>
      <div className="iv-nav-subitem">All Conversations</div>
      <div className="iv-nav-subitem">Mine</div>
      <div className="iv-nav-subitem">Unassigned</div>

      <div className="iv-nav-footer">
        <div className="iv-nav-avatar-wrap">
          <div className="iv-nav-avatar">A</div>
          <div className="iv-online-dot" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#334155", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            Agent
          </div>
        </div>
      </div>
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

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import {
  connectWhatsApp,
  fetchConversationMessages,
  fetchConversations,
  fetchDashboardOverview,
  setAgentActive,
  setConversationPaused,
  setManualTakeover,
  type Conversation,
  type ConversationMessage,
  type DashboardOverviewResponse
} from "../lib/api";
import { useRealtime } from "../lib/use-realtime";

export function DashboardPage() {
  const { token, logout } = useAuth();
  const navigate = useNavigate();

  const [overview, setOverview] = useState<DashboardOverviewResponse | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );

  const loadData = useCallback(async () => {
    if (!token) {
      return;
    }

    setError(null);
    const [overviewResponse, conversationsResponse] = await Promise.all([
      fetchDashboardOverview(token),
      fetchConversations(token)
    ]);

    setOverview(overviewResponse);
    setConversations(conversationsResponse.conversations);
    setSelectedConversationId((current) => current ?? conversationsResponse.conversations[0]?.id ?? null);
  }, [token]);

  useEffect(() => {
    void loadData().catch((loadError) => {
      setError((loadError as Error).message);
    });
  }, [loadData]);

  useEffect(() => {
    if (!token || !selectedConversationId) {
      setMessages([]);
      return;
    }

    void fetchConversationMessages(token, selectedConversationId)
      .then((response) => setMessages(response.messages))
      .catch((loadError) => setError((loadError as Error).message));
  }, [selectedConversationId, token]);

  useEffect(() => {
    if (!token) {
      return;
    }

    const pollTimer = setInterval(() => {
      void loadData().catch(() => undefined);
      if (selectedConversationId) {
        void fetchConversationMessages(token, selectedConversationId)
          .then((response) => setMessages(response.messages))
          .catch(() => undefined);
      }
    }, 8000);

    return () => clearInterval(pollTimer);
  }, [loadData, selectedConversationId, token]);

  useRealtime(
    token,
    useCallback(
      (event) => {
        if (event.event === "conversation.updated") {
          void loadData();
          if (selectedConversationId && token) {
            void fetchConversationMessages(token, selectedConversationId)
              .then((response) => setMessages(response.messages))
              .catch(() => undefined);
          }
        }

        if (event.event === "whatsapp.status") {
          setOverview((current) => {
            if (!current) {
              return current;
            }
            return {
              ...current,
              whatsapp: {
                ...current.whatsapp,
                ...(event.data as Record<string, unknown>)
              }
            };
          });
        }
      },
      [loadData, selectedConversationId, token]
    )
  );

  const handleManualToggle = async () => {
    if (!token || !selectedConversation) {
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await setManualTakeover(token, selectedConversation.id, !selectedConversation.manual_takeover);
      await loadData();
      setInfo(selectedConversation.manual_takeover ? "Manual takeover disabled." : "Manual takeover enabled.");
    } catch (toggleError) {
      setError((toggleError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handlePauseToggle = async () => {
    if (!token || !selectedConversation) {
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await setConversationPaused(token, selectedConversation.id, !selectedConversation.ai_paused);
      await loadData();
      setInfo(selectedConversation.ai_paused ? "AI resumed for this chat." : "AI paused for this chat.");
    } catch (toggleError) {
      setError((toggleError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleReconnectWhatsApp = async () => {
    if (!token) {
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await connectWhatsApp(token);
      await loadData();
      setInfo("Reconnect requested. If QR is needed, open Onboarding to scan it.");
    } catch (connectError) {
      setError((connectError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handlePauseAgent = async () => {
    if (!token || !overview) {
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await setAgentActive(token, !overview.agent.active);
      await loadData();
      setInfo(overview.agent.active ? "Agent paused." : "Agent activated.");
    } catch (pauseError) {
      setError((pauseError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <h1>WAgen Dashboard</h1>
        <div className="header-actions">
          <button className="ghost-btn" onClick={() => navigate("/onboarding")}>Onboarding</button>
          <button
            className="ghost-btn"
            onClick={() => {
              logout();
              navigate("/signup", { replace: true });
            }}
          >
            Logout
          </button>
        </div>
      </header>

      <section className="overview-grid">
        <article>
          <h3>Conversations Today</h3>
          <p>{overview?.overview.leadsToday ?? 0}</p>
        </article>
        <article>
          <h3>Priority Chats</h3>
          <p>{overview?.overview.hotLeads ?? 0}</p>
        </article>
        <article>
          <h3>Active Follow-ups</h3>
          <p>{overview?.overview.warmLeads ?? 0}</p>
        </article>
        <article>
          <h3>Resolved Threads</h3>
          <p>{overview?.overview.closedDeals ?? 0}</p>
        </article>
      </section>

      <section className="status-row">
        <span>
          WhatsApp: <strong>{overview?.whatsapp.status ?? "disconnected"}</strong>
        </span>
        {overview?.whatsapp.hasQr ? <span>QR ready. Open Onboarding to scan.</span> : null}
        <span>
          Knowledge Chunks: <strong>{overview?.knowledge.chunks ?? 0}</strong>
        </span>
        <span>
          WAgen: <strong>{overview?.agent.active ? "Live" : "Paused"}</strong>
        </span>
      </section>

      <section className="dashboard-main">
        <aside className="conversation-list">
          <h2>Conversations</h2>
          {conversations.length === 0 ? (
            <p className="empty-note">
              No conversations yet. Send a new inbound message from another number to this WhatsApp to create leads.
            </p>
          ) : null}
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              className={conversation.id === selectedConversationId ? "conversation-item active" : "conversation-item"}
              onClick={() => setSelectedConversationId(conversation.id)}
            >
              <header>
                <strong>{conversation.phone_number}</strong>
                <small>{conversation.stage.toUpperCase()}</small>
              </header>
              <p>{conversation.last_message || "No messages yet"}</p>
              <footer>Score: {conversation.score}</footer>
            </button>
          ))}
        </aside>

        <section className="chat-panel">
          <header>
            <h2>{selectedConversation?.phone_number || "Select a conversation"}</h2>
            {selectedConversation && (
              <div className="chat-actions">
                <button className="ghost-btn" disabled={busy} onClick={handleManualToggle}>
                  {selectedConversation.manual_takeover ? "Disable Manual" : "Manual Takeover"}
                </button>
                <button className="ghost-btn" disabled={busy} onClick={handlePauseToggle}>
                  {selectedConversation.ai_paused ? "Resume AI" : "Pause AI"}
                </button>
              </div>
            )}
          </header>

          <div className="messages-scroll">
            {messages.map((message) => (
              <div key={message.id} className={`bubble ${message.direction}`}>
                <p>{message.message_text}</p>
                <small>{new Date(message.created_at).toLocaleTimeString()}</small>
              </div>
            ))}
          </div>
        </section>

        <aside className="settings-panel">
          <h2>Settings</h2>
          <button className="ghost-btn" disabled={busy} onClick={handleReconnectWhatsApp}>
            Reconnect WhatsApp
          </button>
          <button className="ghost-btn" disabled={busy} onClick={handlePauseAgent}>
            {overview?.agent.active ? "Pause Agent" : "Activate Agent"}
          </button>
        </aside>
      </section>

      {info && <p className="info-text">{info}</p>}
      {error && <p className="error-text">{error}</p>}
    </main>
  );
}

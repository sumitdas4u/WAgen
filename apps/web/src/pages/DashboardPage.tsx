import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import {
  connectWhatsApp,
  fetchConversationMessages,
  fetchConversations,
  fetchDashboardOverview,
  fetchUsageAnalytics,
  setAgentActive,
  setConversationPaused,
  setManualTakeover,
  type Conversation,
  type ConversationMessage,
  type DashboardOverviewResponse,
  type UsageAnalyticsResponse
} from "../lib/api";
import { useRealtime } from "../lib/use-realtime";

export function DashboardPage() {
  const { token, logout } = useAuth();
  const navigate = useNavigate();

  const [overview, setOverview] = useState<DashboardOverviewResponse | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [usage, setUsage] = useState<UsageAnalyticsResponse["usage"] | null>(null);
  const [activeTab, setActiveTab] = useState<"conversations" | "finance">("conversations");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );

  const formatInr = useCallback((value: number) => `₹${value.toFixed(4)}`, []);
  const formatPhone = useCallback((value: string | null | undefined) => {
    if (!value) {
      return "Unknown";
    }
    const digits = value.replace(/\D/g, "");
    if (!digits) {
      return value;
    }
    return `+${digits}`;
  }, []);

  const loadData = useCallback(async () => {
    if (!token) {
      return;
    }

    setError(null);
    const [overviewResponse, conversationsResponse, usageResponse] = await Promise.all([
      fetchDashboardOverview(token),
      fetchConversations(token),
      fetchUsageAnalytics(token, { days: 30, limit: 200 })
    ]);

    setOverview(overviewResponse);
    setConversations(conversationsResponse.conversations);
    setUsage(usageResponse.usage);
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
      setInfo("Reconnect requested. Open Onboarding if QR scan is needed.");
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
          <button className="primary-btn" onClick={() => navigate("/onboarding?focus=qr")}>Scan QR</button>
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

      <section className="dashboard-tabbar">
        <button
          className={activeTab === "conversations" ? "ghost-btn active-tab" : "ghost-btn"}
          onClick={() => setActiveTab("conversations")}
        >
          Conversations
        </button>
        <button
          className={activeTab === "finance" ? "ghost-btn active-tab" : "ghost-btn"}
          onClick={() => setActiveTab("finance")}
        >
          Finance Analytics
        </button>
      </section>

      {activeTab === "conversations" ? (
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
                <strong>{formatPhone(conversation.phone_number)}</strong>
                <small>{conversation.stage.toUpperCase()}</small>
              </header>
              <p>{conversation.last_message || "No messages yet"}</p>
              <footer>Score: {conversation.score}</footer>
            </button>
          ))}
        </aside>

        <section className="chat-panel">
          <header>
            <h2>{selectedConversation ? formatPhone(selectedConversation.phone_number) : "Select a conversation"}</h2>
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
                {message.direction === "outbound" && message.total_tokens ? (
                  <small className="token-meta">
                    Tokens: {message.total_tokens}
                    {typeof message.prompt_tokens === "number" ? ` (P:${message.prompt_tokens}` : ""}
                    {typeof message.completion_tokens === "number" ? ` C:${message.completion_tokens})` : ""}
                    {message.ai_model ? ` • ${message.ai_model}` : ""}
                  </small>
                ) : null}
                <small>{new Date(message.created_at).toLocaleTimeString()}</small>
              </div>
            ))}
          </div>
        </section>

        <aside className="settings-panel">
          <h2>Chat Details</h2>
          {selectedConversation ? (
            <div className="chat-user-details">
              <div><strong>Name:</strong> {selectedConversation.contact_name || "Unknown"}</div>
              <div><strong>Phone:</strong> {formatPhone(selectedConversation.phone_number)}</div>
              <div><strong>Stage:</strong> {selectedConversation.stage}</div>
              <div><strong>Score:</strong> {selectedConversation.score}</div>
              <div><strong>Manual:</strong> {selectedConversation.manual_takeover ? "On" : "Off"}</div>
              <div><strong>AI Paused:</strong> {selectedConversation.ai_paused ? "Yes" : "No"}</div>
            </div>
          ) : (
            <p className="tiny-note">Select a conversation to view contact details.</p>
          )}

          <h2>Settings</h2>
          <button className="ghost-btn" disabled={busy} onClick={handleReconnectWhatsApp}>
            Reconnect WhatsApp
          </button>
          <button className="ghost-btn" disabled={busy} onClick={handlePauseAgent}>
            {overview?.agent.active ? "Pause Agent" : "Activate Agent"}
          </button>
        </aside>
      </section>
      ) : (
        <section className="finance-shell">
          <div className="overview-grid finance-grid">
            <article>
              <h3>Total AI Messages (30d)</h3>
              <p>{usage?.messages ?? 0}</p>
            </article>
            <article>
              <h3>Total Tokens</h3>
              <p>{usage?.total_tokens ?? 0}</p>
            </article>
            <article>
              <h3>Estimated Cost (INR)</h3>
              <p>{formatInr(usage?.estimated_cost_inr ?? 0)}</p>
            </article>
            <article>
              <h3>Avg Cost / Message</h3>
              <p>
                {formatInr(
                  usage && usage.messages > 0 ? usage.estimated_cost_inr / usage.messages : 0
                )}
              </p>
            </article>
          </div>

          <div className="finance-panels">
            <article className="finance-panel">
              <h2>Cost by Model</h2>
              {usage?.by_model.length ? (
                <div className="finance-table-wrap">
                  <table className="finance-table">
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th>Messages</th>
                        <th>Tokens</th>
                        <th>Cost (INR)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.by_model.map((row) => (
                        <tr key={row.ai_model}>
                          <td>{row.ai_model}</td>
                          <td>{row.messages}</td>
                          <td>{row.total_tokens}</td>
                          <td>{formatInr(row.estimated_cost_inr)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="empty-note">No model usage data yet.</p>
              )}
            </article>

            <article className="finance-panel">
              <h2>Recent Message Cost History</h2>
              {usage?.recent_messages.length ? (
                <div className="finance-table-wrap">
                  <table className="finance-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Phone</th>
                        <th>Model</th>
                        <th>Tokens</th>
                        <th>Cost (INR)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.recent_messages.slice(0, 60).map((row) => (
                        <tr key={row.message_id}>
                          <td>{new Date(row.created_at).toLocaleString()}</td>
                          <td>{row.conversation_phone}</td>
                          <td>{row.ai_model}</td>
                          <td>{row.total_tokens}</td>
                          <td>{formatInr(row.estimated_cost_inr)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="empty-note">No outbound AI messages with token usage yet.</p>
              )}
            </article>
          </div>
        </section>
      )}

      {info && <p className="info-text">{info}</p>}
      {error && <p className="error-text">{error}</p>}
    </main>
  );
}

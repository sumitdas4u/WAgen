import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchAdminUserUsage,
  fetchAdminModel,
  fetchAdminOverview,
  fetchAdminSubscriptions,
  fetchAdminUsers,
  updateAdminModel,
  type AdminSubscriptionSummary,
  type AdminOverview,
  type AdminUserUsage,
  type UsageAnalyticsResponse
} from "../lib/api";

const ADMIN_TOKEN_KEY = "super_admin_token";

export function SuperAdminPage() {
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUserUsage[]>([]);
  const [subscriptions, setSubscriptions] = useState<AdminSubscriptionSummary[]>([]);
  const [currentModel, setCurrentModel] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [usageUser, setUsageUser] = useState<AdminUserUsage | null>(null);
  const [usage, setUsage] = useState<UsageAnalyticsResponse["usage"] | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(ADMIN_TOKEN_KEY);
    if (!stored) {
      navigate("/super-admin/login", { replace: true });
      return;
    }
    setToken(stored);
  }, [navigate]);

  const load = async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [overviewResponse, usersResponse, modelResponse, subscriptionsResponse] = await Promise.all([
        fetchAdminOverview(token),
        fetchAdminUsers(token, { limit: 300 }),
        fetchAdminModel(token),
        fetchAdminSubscriptions(token, { limit: 300 })
      ]);
      setOverview(overviewResponse.overview);
      setUsers(usersResponse.users);
      setSubscriptions(subscriptionsResponse.subscriptions);
      setCurrentModel(modelResponse.currentModel);
      setSelectedModel(modelResponse.currentModel);
      setAvailableModels(modelResponse.availableModels);
    } catch (loadError) {
      setError((loadError as Error).message);
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      navigate("/super-admin/login", { replace: true });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  const totalUsersLabel = useMemo(() => overview?.totalUsers ?? 0, [overview]);

  const handleSaveModel = async () => {
    if (!token || !selectedModel) {
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      await updateAdminModel(token, selectedModel);
      setCurrentModel(selectedModel);
      setInfo(`Global model updated to ${selectedModel}`);
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenUsage = async (user: AdminUserUsage) => {
    if (!token) {
      return;
    }
    setUsageUser(user);
    setUsage(null);
    setUsageLoading(true);
    setError(null);
    try {
      const response = await fetchAdminUserUsage(token, user.userId, { days: 30, limit: 200 });
      setUsage(response.usage);
    } catch (usageError) {
      setError((usageError as Error).message);
    } finally {
      setUsageLoading(false);
    }
  };

  const closeUsageModal = () => {
    setUsageUser(null);
    setUsage(null);
  };

  const formatInr = (value: number) => `INR ${value.toFixed(4)}`;

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <h1>Super Admin</h1>
        <div className="header-actions">
          <button className="ghost-btn" onClick={() => void load()} disabled={loading}>Refresh</button>
          <button
            className="ghost-btn"
            onClick={() => {
              localStorage.removeItem(ADMIN_TOKEN_KEY);
              navigate("/super-admin/login", { replace: true });
            }}
          >
            Logout
          </button>
        </div>
      </header>

      <section className="overview-grid">
        <article><h3>Total SaaS Users</h3><p>{totalUsersLabel}</p></article>
        <article><h3>Active Agents</h3><p>{overview?.activeAgents ?? 0}</p></article>
        <article><h3>Total Messages</h3><p>{overview?.totalMessages ?? 0}</p></article>
        <article><h3>Total Knowledge Chunks</h3><p>{overview?.totalChunks ?? 0}</p></article>
      </section>

      <section className="finance-panel">
        <h2>Global GPT Model</h2>
        <div className="header-actions">
          <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
            {availableModels.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
          <button className="primary-btn" onClick={handleSaveModel} disabled={loading || !selectedModel}>
            Save Model
          </button>
        </div>
        <p className="tiny-note">Current model used for all tenant replies: <strong>{currentModel || "Not set"}</strong></p>
      </section>

      <section className="finance-panel">
        <h2>All Users Analytics</h2>
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Plan</th>
                <th>AI</th>
                <th>Conversations</th>
                <th>Messages</th>
                <th>Chunks</th>
                <th>Tokens (All Time)</th>
                <th>Cost (INR, All Time)</th>
                <th>Created</th>
                <th>Usage</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.userId}>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
                  <td>{user.plan}</td>
                  <td>{user.aiActive ? "On" : "Off"}</td>
                  <td>{user.conversations}</td>
                  <td>{user.messages}</td>
                  <td>{user.chunks}</td>
                  <td>{user.totalTokens}</td>
                  <td>{user.costInr.toFixed(4)}</td>
                  <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                  <td>
                    <button className="ghost-btn" type="button" onClick={() => void handleOpenUsage(user)}>
                      View Usage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="finance-panel">
        <h2>Subscription & Payment Details</h2>
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Razorpay Subscription ID</th>
                <th>Current End</th>
                <th>Last Payment</th>
                <th>Last Payment Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((subscription) => (
                <tr key={subscription.id}>
                  <td>{subscription.userName}</td>
                  <td>{subscription.userEmail}</td>
                  <td>{subscription.planCode}</td>
                  <td>{subscription.status}</td>
                  <td>{subscription.razorpaySubscriptionId ?? "-"}</td>
                  <td>{subscription.currentEndAt ? new Date(subscription.currentEndAt).toLocaleString() : "-"}</td>
                  <td>
                    {subscription.lastPayment
                      ? `${(subscription.lastPayment.amountPaise / 100).toFixed(2)} ${subscription.lastPayment.currency}`
                      : "-"}
                  </td>
                  <td>{subscription.lastPayment?.status ?? "-"}</td>
                  <td>{new Date(subscription.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {usageUser && (
        <div className="kb-modal-backdrop" onClick={closeUsageModal}>
          <div className="kb-modal kb-modal-wide" onClick={(event) => event.stopPropagation()}>
            <h3>Usage: {usageUser.name} (Last 30 days)</h3>
            {usageLoading ? <p className="tiny-note">Loading usage...</p> : null}
            {!usageLoading && usage ? (
              <>
                <div className="overview-grid finance-grid">
                  <article>
                    <h3>Total AI Messages</h3>
                    <p>{usage.messages}</p>
                  </article>
                  <article>
                    <h3>Total Tokens</h3>
                    <p>{usage.total_tokens}</p>
                  </article>
                  <article>
                    <h3>Estimated Cost (INR)</h3>
                    <p>{formatInr(usage.estimated_cost_inr)}</p>
                  </article>
                  <article>
                    <h3>Avg Cost / Message</h3>
                    <p>{formatInr(usage.messages > 0 ? usage.estimated_cost_inr / usage.messages : 0)}</p>
                  </article>
                </div>

                <div className="finance-panels">
                  <article className="finance-panel">
                    <h2>Cost by Model</h2>
                    {usage.by_model.length ? (
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
                    {usage.recent_messages.length ? (
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
              </>
            ) : null}
            <div className="kb-modal-actions">
              <button className="primary-btn" type="button" onClick={closeUsageModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {info && <p className="info-text">{info}</p>}
      {error && <p className="error-text">{error}</p>}
    </main>
  );
}

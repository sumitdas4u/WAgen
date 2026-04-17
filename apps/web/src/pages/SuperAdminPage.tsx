import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  API_URL,
  adjustAdminWorkspaceCredits,
  fetchAdminUserUsage,
  fetchAdminPlans,
  fetchAdminModel,
  fetchAdminOverview,
  fetchAdminSubscriptions,
  fetchAdminUsers,
  fetchAdminWorkspaces,
  resetAdminWorkspaceWallet,
  updateAdminPlan,
  updateAdminWorkspaceStatus,
  updateAdminModel,
  fetchAdminProvider,
  updateAdminProvider,
  clearAdminProvider,
  testAdminProvider,
  type AdminSubscriptionSummary,
  type AdminOverview,
  type AdminUserUsage,
  type AdminWorkspaceSummary,
  type WorkspacePlanSummary,
  type UsageAnalyticsResponse,
  type AiProviderMeta
} from "../lib/api";
import { clearSuperAdminToken, getStoredSuperAdminToken } from "../lib/super-admin-auth";

export function SuperAdminPage() {
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUserUsage[]>([]);
  const [subscriptions, setSubscriptions] = useState<AdminSubscriptionSummary[]>([]);
  const [plans, setPlans] = useState<WorkspacePlanSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<AdminWorkspaceSummary[]>([]);
  const [currentModel, setCurrentModel] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  // AI Provider
  const [providerList, setProviderList] = useState<AiProviderMeta[]>([]);
  const [activeProvider, setActiveProvider] = useState<{ provider: string; model: string | null; hasApiKey: boolean } | null>(null);
  const [providerDraft, setProviderDraft] = useState<{ provider: string; apiKey: string; model: string }>({ provider: "openai", apiKey: "", model: "" });
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerTesting, setProviderTesting] = useState(false);
  const [providerTestResult, setProviderTestResult] = useState<
    { ok: true; provider: string; model: string; reply: string; latencyMs: number } |
    { ok: false; provider: string; error: string } |
    null
  >(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [usageUser, setUsageUser] = useState<AdminUserUsage | null>(null);
  const [usage, setUsage] = useState<UsageAnalyticsResponse["usage"] | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [planCreditDrafts, setPlanCreditDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    const stored = getStoredSuperAdminToken();
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
      const [overviewResponse, usersResponse, modelResponse, subscriptionsResponse, plansResponse, workspacesResponse, providerResponse] = await Promise.all([
        fetchAdminOverview(token),
        fetchAdminUsers(token, { limit: 300 }),
        fetchAdminModel(token),
        fetchAdminSubscriptions(token, { limit: 300 }),
        fetchAdminPlans(token, { includeInactive: true }),
        fetchAdminWorkspaces(token, { limit: 500 }),
        fetchAdminProvider(token)
      ]);
      setOverview(overviewResponse.overview);
      setUsers(usersResponse.users);
      setSubscriptions(subscriptionsResponse.subscriptions);
      setPlans(plansResponse.plans);
      setWorkspaces(workspacesResponse.workspaces);
      setCurrentModel(modelResponse.currentModel);
      setSelectedModel(modelResponse.currentModel);
      setAvailableModels(modelResponse.availableModels);
      setProviderList(providerResponse.providers);
      setActiveProvider(providerResponse.active);
      if (providerResponse.active) {
        const meta = providerResponse.providers.find(p => p.id === providerResponse.active!.provider);
        setProviderDraft({
          provider: providerResponse.active.provider,
          apiKey: "",
          model: providerResponse.active.model ?? meta?.chatModels[0] ?? ""
        });
      }
      setPlanCreditDrafts(
        plansResponse.plans.reduce<Record<string, string>>((acc, plan) => {
          acc[plan.id] = String(plan.monthlyCredits);
          return acc;
        }, {})
      );
    } catch (loadError) {
      setError((loadError as Error).message);
      clearSuperAdminToken();
      navigate("/super-admin/login", { replace: true });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  const totalUsersLabel = useMemo(() => overview?.totalUsers ?? 0, [overview]);

  const handleSaveProvider = async () => {
    if (!token || !providerDraft.provider || !providerDraft.apiKey.trim()) return;
    setProviderSaving(true);
    setError(null);
    setInfo(null);
    try {
      await updateAdminProvider(token, {
        provider: providerDraft.provider,
        apiKey: providerDraft.apiKey.trim(),
        model: providerDraft.model.trim() || undefined
      });
      const updated = await fetchAdminProvider(token);
      setActiveProvider(updated.active);
      setProviderDraft(d => ({ ...d, apiKey: "" }));
      setInfo(`AI provider set to ${providerDraft.provider}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProviderSaving(false);
    }
  };

  const handleClearProvider = async () => {
    if (!token) return;
    setProviderSaving(true);
    setError(null);
    setInfo(null);
    try {
      await clearAdminProvider(token);
      setActiveProvider(null);
      setProviderDraft({ provider: "openai", apiKey: "", model: "" });
      setInfo("AI provider config cleared — system falls back to OPENAI_API_KEY env var.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProviderSaving(false);
    }
  };

  const handleTestProvider = async () => {
    if (!token) return;
    setProviderTesting(true);
    setProviderTestResult(null);
    try {
      const result = await testAdminProvider(token);
      setProviderTestResult(result);
    } catch (e) {
      setProviderTestResult({ ok: false, provider: providerDraft.provider, error: (e as Error).message });
    } finally {
      setProviderTesting(false);
    }
  };

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

  const handleSavePlanCredits = async (plan: WorkspacePlanSummary) => {
    if (!token) {
      return;
    }
    const nextCredits = Number(planCreditDrafts[plan.id] ?? plan.monthlyCredits);
    if (!Number.isFinite(nextCredits) || nextCredits < 0) {
      setError("Monthly credits must be a valid number.");
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      await updateAdminPlan(token, plan.id, { monthlyCredits: Math.floor(nextCredits) });
      setInfo(`Updated ${plan.name} monthly credits to ${Math.floor(nextCredits)}.`);
      await load();
    } catch (updateError) {
      setError((updateError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleWorkspaceStatus = async (
    workspace: AdminWorkspaceSummary,
    status: "active" | "suspended" | "deleted"
  ) => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      await updateAdminWorkspaceStatus(token, workspace.workspaceId, { status });
      setInfo(`Workspace ${workspace.workspaceName} is now ${status}.`);
      await load();
    } catch (statusError) {
      setError((statusError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleWorkspaceCreditAdjust = async (workspace: AdminWorkspaceSummary, deltaCredits: number) => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      await adjustAdminWorkspaceCredits(token, {
        workspaceId: workspace.workspaceId,
        deltaCredits,
        reason: "Super admin adjustment"
      });
      setInfo(`Adjusted ${workspace.workspaceName} credits by ${deltaCredits}.`);
      await load();
    } catch (adjustError) {
      setError((adjustError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleWorkspaceWalletReset = async (workspace: AdminWorkspaceSummary) => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      await resetAdminWorkspaceWallet(token, {
        workspaceId: workspace.workspaceId,
        reason: "Super admin reset"
      });
      setInfo(`Reset ${workspace.workspaceName} wallet to plan credits.`);
      await load();
    } catch (resetError) {
      setError((resetError as Error).message);
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
          <a className="ghost-btn" href={`${API_URL}/api/admin/queues`} target="_blank" rel="noreferrer">
            Queue Dashboard
          </a>
          <button className="ghost-btn" onClick={() => void load()} disabled={loading}>Refresh</button>
          <button
            className="ghost-btn"
            onClick={() => {
              clearSuperAdminToken();
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

      {/* ── AI Provider Config ──────────────────────────────────────────── */}
      <section className="finance-panel">
        <h2>AI Provider Config</h2>
        {activeProvider ? (
          <p className="tiny-note" style={{ marginBottom: "0.75rem" }}>
            Active: <strong>{activeProvider.provider}</strong>
            {activeProvider.model ? ` / ${activeProvider.model}` : ""}
            {" "}· API key configured ✓
          </p>
        ) : (
          <p className="tiny-note" style={{ marginBottom: "0.75rem" }}>
            No DB override — using <strong>OPENAI_API_KEY</strong> env var (fallback)
          </p>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: "0.3rem" }}>Provider</label>
            <select
              value={providerDraft.provider}
              onChange={(e) => {
                const pid = e.target.value;
                const meta = providerList.find(p => p.id === pid);
                setProviderDraft(d => ({ ...d, provider: pid, model: meta?.chatModels[0] ?? "" }));
              }}
              style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #ddd" }}
            >
              {providerList.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: "0.3rem" }}>Model</label>
            <select
              value={providerDraft.model}
              onChange={(e) => setProviderDraft(d => ({ ...d, model: e.target.value }))}
              style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #ddd" }}
            >
              {(providerList.find(p => p.id === providerDraft.provider)?.chatModels ?? []).map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: "0.3rem" }}>
              API Key {activeProvider ? "(leave blank to keep existing)" : ""}
            </label>
            <input
              type="password"
              value={providerDraft.apiKey}
              onChange={(e) => setProviderDraft(d => ({ ...d, apiKey: e.target.value }))}
              placeholder={activeProvider ? "••••••••• (unchanged)" : "sk-... or API key"}
              style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #ddd", boxSizing: "border-box" }}
            />
          </div>
        </div>
        {(providerList.find(p => p.id === providerDraft.provider) && !providerList.find(p => p.id === providerDraft.provider)!.supportsEmbeddings) && (
          <p className="tiny-note" style={{ color: "#b45309", marginBottom: "0.5rem" }}>
            ⚠ {providerList.find(p => p.id === providerDraft.provider)!.label} does not support embeddings — a separate OPENAI_API_KEY env var is required for the RAG pipeline.
          </p>
        )}
        <div className="header-actions">
          <button
            className="primary-btn"
            onClick={() => void handleSaveProvider()}
            disabled={providerSaving || !providerDraft.provider || (!activeProvider && !providerDraft.apiKey.trim())}
          >
            {providerSaving ? "Saving…" : "Save Provider"}
          </button>
          {activeProvider && (
            <button className="ghost-btn" onClick={() => void handleClearProvider()} disabled={providerSaving}>
              Clear (use env)
            </button>
          )}
          <button
            className="ghost-btn"
            onClick={() => void handleTestProvider()}
            disabled={providerTesting}
            style={{ borderColor: providerTestResult ? (providerTestResult.ok ? "#22c55e" : "#be123c") : undefined }}
          >
            {providerTesting ? "Testing…" : "Test Connection"}
          </button>
        </div>
        {providerTestResult && (
          <div style={{
            marginTop: "0.75rem",
            padding: "0.75rem 1rem",
            borderRadius: 8,
            border: `1px solid ${providerTestResult.ok ? "#bbf7d0" : "#fecdd3"}`,
            background: providerTestResult.ok ? "#f0fdf4" : "#fff1f2",
            fontSize: "0.82rem"
          }}>
            {providerTestResult.ok ? (
              <>
                <strong style={{ color: "#166534" }}>✓ Connected</strong>
                {" — "}
                <span style={{ color: "#334155" }}>
                  <strong>{providerTestResult.provider}</strong> / <code style={{ background: "#e2e8f0", padding: "1px 5px", borderRadius: 4 }}>{providerTestResult.model}</code>
                  {" "}({providerTestResult.latencyMs}ms)
                </span>
                <p style={{ margin: "0.4rem 0 0", color: "#475569", fontStyle: "italic" }}>
                  "{providerTestResult.reply.slice(0, 160)}{providerTestResult.reply.length > 160 ? "…" : ""}"
                </p>
              </>
            ) : (
              <>
                <strong style={{ color: "#be123c" }}>✗ Failed</strong>
                {" — "}
                <span style={{ color: "#be123c" }}>{providerTestResult.error}</span>
              </>
            )}
          </div>
        )}
      </section>

      {/* ── Legacy model override (per-model within the active provider) ── */}
      <section className="finance-panel">
        <h2>Legacy Model Override</h2>
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
        <p className="tiny-note">Current effective model: <strong>{currentModel || "Not set"}</strong></p>
      </section>

      <section className="finance-panel">
        <h2>Plan Credits Management</h2>
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Price / Month</th>
                <th>Monthly Credits</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id}>
                  <td>{plan.code}</td>
                  <td>{plan.name}</td>
                  <td>{plan.priceMonthly}</td>
                  <td>
                    <input
                      value={planCreditDrafts[plan.id] ?? String(plan.monthlyCredits)}
                      onChange={(event) =>
                        setPlanCreditDrafts((current) => ({
                          ...current,
                          [plan.id]: event.target.value
                        }))
                      }
                      style={{ width: 120 }}
                    />
                  </td>
                  <td>{plan.status}</td>
                  <td>
                    <button className="ghost-btn" onClick={() => void handleSavePlanCredits(plan)} disabled={loading}>
                      Save
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        <h2>Workspace Credit Control</h2>
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Plan</th>
                <th>Credits</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((workspace) => (
                <tr key={workspace.workspaceId}>
                  <td>{workspace.workspaceName}</td>
                  <td>
                    {workspace.ownerName}
                    <br />
                    <small>{workspace.ownerEmail}</small>
                  </td>
                  <td>{workspace.workspaceStatus}</td>
                  <td>{workspace.planName ?? workspace.planCode ?? "-"}</td>
                  <td>
                    {workspace.remainingCredits} / {workspace.totalCredits}
                  </td>
                  <td>
                    <div className="header-actions">
                      <button
                        className="ghost-btn"
                        onClick={() =>
                          void handleWorkspaceStatus(
                            workspace,
                            workspace.workspaceStatus === "active" ? "suspended" : "active"
                          )
                        }
                        disabled={loading}
                      >
                        {workspace.workspaceStatus === "active" ? "Suspend" : "Activate"}
                      </button>
                      <button
                        className="ghost-btn"
                        onClick={() => void handleWorkspaceCreditAdjust(workspace, 100)}
                        disabled={loading}
                      >
                        +100
                      </button>
                      <button
                        className="ghost-btn"
                        onClick={() => void handleWorkspaceCreditAdjust(workspace, -100)}
                        disabled={loading}
                      >
                        -100
                      </button>
                      <button
                        className="ghost-btn"
                        onClick={() => void handleWorkspaceWalletReset(workspace)}
                        disabled={loading}
                      >
                        Reset Wallet
                      </button>
                      <button
                        className="ghost-btn"
                        onClick={() => void handleWorkspaceStatus(workspace, "deleted")}
                        disabled={loading || workspace.workspaceStatus === "deleted"}
                      >
                        Delete
                      </button>
                    </div>
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

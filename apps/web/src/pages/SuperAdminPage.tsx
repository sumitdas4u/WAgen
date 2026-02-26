import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchAdminModel,
  fetchAdminOverview,
  fetchAdminUsers,
  updateAdminModel,
  type AdminOverview,
  type AdminUserUsage
} from "../lib/api";

const ADMIN_TOKEN_KEY = "super_admin_token";

export function SuperAdminPage() {
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUserUsage[]>([]);
  const [currentModel, setCurrentModel] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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
      const [overviewResponse, usersResponse, modelResponse] = await Promise.all([
        fetchAdminOverview(token),
        fetchAdminUsers(token, { limit: 300 }),
        fetchAdminModel(token)
      ]);
      setOverview(overviewResponse.overview);
      setUsers(usersResponse.users);
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
                <th>Tokens</th>
                <th>Cost (INR)</th>
                <th>Created</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {info && <p className="info-text">{info}</p>}
      {error && <p className="error-text">{error}</p>}
    </main>
  );
}

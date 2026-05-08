import { useEffect, useState } from "react";
import {
  fetchAdminModel,
  fetchAdminProvider,
  updateAdminModel,
  updateAdminProvider,
  clearAdminProvider,
  testAdminProvider,
  type AiProviderMeta,
} from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

type TestResult =
  | { ok: true; provider: string; model: string; reply: string; latencyMs: number }
  | { ok: false; provider: string; error: string };

export function SettingsPage() {
  const { token } = useSuperAdmin();
  const [providerList, setProviderList] = useState<AiProviderMeta[]>([]);
  const [activeProvider, setActiveProvider] = useState<{ provider: string; model: string | null; hasApiKey: boolean } | null>(null);
  const [draft, setDraft] = useState<{ provider: string; apiKey: string; model: string }>({ provider: "openai", apiKey: "", model: "" });
  const [currentModel, setCurrentModel] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [modelRes, provRes] = await Promise.all([fetchAdminModel(token), fetchAdminProvider(token)]);
      setCurrentModel(modelRes.currentModel);
      setSelectedModel(modelRes.currentModel);
      setAvailableModels(modelRes.availableModels);
      setProviderList(provRes.providers);
      setActiveProvider(provRes.active);
      if (provRes.active) {
        const meta = provRes.providers.find((p) => p.id === provRes.active!.provider);
        setDraft({ provider: provRes.active.provider, apiKey: "", model: provRes.active.model ?? meta?.chatModels[0] ?? "" });
      }
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [token]);

  const saveProvider = async () => {
    if (!draft.provider || (!activeProvider && !draft.apiKey.trim())) return;
    setSaving(true); setError(null); setInfo(null);
    try {
      await updateAdminProvider(token, { provider: draft.provider, apiKey: draft.apiKey.trim(), model: draft.model.trim() || undefined });
      const updated = await fetchAdminProvider(token);
      setActiveProvider(updated.active);
      setDraft((d) => ({ ...d, apiKey: "" }));
      setInfo(`AI provider set to ${draft.provider}`);
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };

  const clearProvider = async () => {
    setSaving(true); setError(null); setInfo(null);
    try {
      await clearAdminProvider(token);
      setActiveProvider(null);
      setDraft({ provider: "openai", apiKey: "", model: "" });
      setInfo("AI provider cleared — system falls back to OPENAI_API_KEY env var.");
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };

  const testProvider = async () => {
    setTesting(true); setTestResult(null);
    try {
      setTestResult(await testAdminProvider(token));
    } catch (e) {
      setTestResult({ ok: false, provider: draft.provider, error: (e as Error).message });
    } finally { setTesting(false); }
  };

  const saveModel = async () => {
    if (!selectedModel) return;
    setLoading(true); setError(null); setInfo(null);
    try {
      await updateAdminModel(token, selectedModel);
      setCurrentModel(selectedModel);
      setInfo(`Global model updated to ${selectedModel}`);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  const currentMeta = providerList.find((p) => p.id === draft.provider);

  return (
    <div>
      <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: "0 0 1.5rem" }}>Settings</h1>

      {/* AI Provider Config */}
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
              value={draft.provider}
              onChange={(e) => {
                const pid = e.target.value;
                const meta = providerList.find((p) => p.id === pid);
                setDraft((d) => ({ ...d, provider: pid, model: meta?.chatModels[0] ?? "" }));
              }}
              style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #ddd" }}
            >
              {providerList.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: "0.3rem" }}>Model</label>
            <select
              value={draft.model}
              onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
              style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #ddd" }}
            >
              {(currentMeta?.chatModels ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: "0.3rem" }}>
              API Key {activeProvider ? "(leave blank to keep existing)" : ""}
            </label>
            <input
              type="password"
              value={draft.apiKey}
              onChange={(e) => setDraft((d) => ({ ...d, apiKey: e.target.value }))}
              placeholder={activeProvider ? "••••• (unchanged)" : "sk-... or API key"}
              style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #ddd", boxSizing: "border-box" }}
            />
          </div>
        </div>

        {currentMeta && !currentMeta.supportsEmbeddings && (
          <p className="tiny-note" style={{ color: "#b45309", marginBottom: "0.5rem" }}>
            {currentMeta.label} does not support embeddings — a separate OPENAI_API_KEY is required for the RAG pipeline.
          </p>
        )}

        <div className="header-actions">
          <button className="primary-btn" onClick={() => void saveProvider()} disabled={saving || !draft.provider || (!activeProvider && !draft.apiKey.trim())}>
            {saving ? "Saving…" : "Save Provider"}
          </button>
          {activeProvider && (
            <button className="ghost-btn" onClick={() => void clearProvider()} disabled={saving}>Clear (use env)</button>
          )}
          <button
            className="ghost-btn"
            onClick={() => void testProvider()}
            disabled={testing}
            style={{ borderColor: testResult ? (testResult.ok ? "#22c55e" : "#be123c") : undefined }}
          >
            {testing ? "Testing…" : "Test Connection"}
          </button>
        </div>

        {testResult && (
          <div style={{
            marginTop: "0.75rem", padding: "0.75rem 1rem", borderRadius: 8,
            border: `1px solid ${testResult.ok ? "#bbf7d0" : "#fecdd3"}`,
            background: testResult.ok ? "#f0fdf4" : "#fff1f2",
            fontSize: "0.82rem",
          }}>
            {testResult.ok ? (
              <>
                <strong style={{ color: "#166534" }}>Connected</strong>
                {" — "}
                <strong>{testResult.provider}</strong> / <code style={{ background: "#e2e8f0", padding: "1px 5px", borderRadius: 4 }}>{testResult.model}</code>
                {" "}({testResult.latencyMs}ms)
                <p style={{ margin: "0.4rem 0 0", color: "#475569", fontStyle: "italic" }}>
                  "{testResult.reply.slice(0, 160)}{testResult.reply.length > 160 ? "…" : ""}"
                </p>
              </>
            ) : (
              <>
                <strong style={{ color: "#be123c" }}>Failed</strong>
                {" — "}
                <span style={{ color: "#be123c" }}>{testResult.error}</span>
              </>
            )}
          </div>
        )}
      </section>

      {/* Legacy model override */}
      <section className="finance-panel">
        <h2>Legacy Model Override</h2>
        <div className="header-actions">
          <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
            {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button className="primary-btn" onClick={() => void saveModel()} disabled={loading || !selectedModel}>
            Save Model
          </button>
        </div>
        <p className="tiny-note" style={{ marginTop: "0.5rem" }}>
          Current effective model: <strong>{currentModel || "Not set"}</strong>
        </p>
      </section>

      {info && <p className="info-text" style={{ marginTop: "1rem" }}>{info}</p>}
      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}

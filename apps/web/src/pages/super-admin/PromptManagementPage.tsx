import { useEffect, useState } from "react";
import { useSuperAdmin } from "./lib/super-admin-context";

interface PromptTemplate {
  id: string;
  key: string;
  name: string;
  content: string;
  version: number;
  isActive: boolean;
  updatedAt: string;
}

function fetchAdminPrompts(token: string): Promise<{ prompts: PromptTemplate[] }> {
  return fetch("/api/admin/prompts", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json() as Promise<{ prompts: PromptTemplate[] }>);
}

function updateAdminPrompt(token: string, key: string, content: string): Promise<{ prompt: PromptTemplate }> {
  return fetch(`/api/admin/prompts/${key}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  }).then((r) => r.json() as Promise<{ prompt: PromptTemplate }>);
}

export function PromptManagementPage() {
  const { token } = useSuperAdmin();
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editing, setEditing] = useState<PromptTemplate | null>(null);
  const [draft, setDraft] = useState("");

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchAdminPrompts(token);
      setPrompts(r.prompts ?? []);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [token]);

  const handleEdit = (p: PromptTemplate) => {
    setEditing(p);
    setDraft(p.content);
    setInfo(null);
    setError(null);
  };

  const handleSave = async () => {
    if (!editing) return;
    setLoading(true); setError(null); setInfo(null);
    try {
      await updateAdminPrompt(token, editing.key, draft);
      setInfo(`"${editing.name}" updated to v${editing.version + 1}`);
      setEditing(null);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>Prompt Management</h1>
        <button className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </div>

      {prompts.length === 0 && !loading ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#94a3b8", background: "#fff", borderRadius: 10, border: "1px solid #e2eaf4" }}>
          No prompt templates found. Run the migration to seed the default prompts.
        </div>
      ) : (
        <div style={{ display: "grid", gap: "1rem" }}>
          {prompts.map((p) => (
            <div key={p.id} style={{ background: "#fff", border: "1px solid #e2eaf4", borderRadius: 10, padding: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
                <div>
                  <h3 style={{ margin: "0 0 0.2rem", fontSize: "0.95rem", fontWeight: 700 }}>{p.name}</h3>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <code style={{ fontSize: "0.75rem", background: "#f1f5f9", padding: "2px 6px", borderRadius: 4 }}>{p.key}</code>
                    <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>v{p.version}</span>
                    <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Updated {new Date(p.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <button className="ghost-btn" style={{ fontSize: "0.8rem" }} onClick={() => handleEdit(p)}>Edit</button>
              </div>
              <pre style={{
                margin: 0,
                fontSize: "0.8rem",
                background: "#f8fafc",
                padding: "0.75rem",
                borderRadius: 6,
                border: "1px solid #e2eaf4",
                whiteSpace: "pre-wrap",
                color: "#475569",
                maxHeight: 100,
                overflow: "hidden",
              }}>
                {p.content}
              </pre>
            </div>
          ))}
        </div>
      )}

      {info && <p className="info-text" style={{ marginTop: "1rem" }}>{info}</p>}
      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}

      {editing && (
        <div className="kb-modal-backdrop" onClick={() => setEditing(null)}>
          <div className="kb-modal kb-modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>Edit: {editing.name}</h3>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.82rem", color: "#64748b" }}>
              Editing <code>{editing.key}</code> · Current version: v{editing.version}
            </p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{
                width: "100%",
                minHeight: 200,
                padding: "10px 12px",
                borderRadius: 6,
                border: "1px solid #ddd",
                fontSize: "0.85rem",
                fontFamily: "monospace",
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />
            <div className="kb-modal-actions">
              <button className="ghost-btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="primary-btn" onClick={() => void handleSave()} disabled={loading}>
                {loading ? "Saving…" : `Save as v${editing.version + 1}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "../../../../lib/auth-context";
import { listCannedResponses, createCannedResponse, updateCannedResponse, deleteCannedResponse } from "../../inbox-v2/api";
import type { CannedResponse } from "../../inbox-v2/api";
import "./../account.css";

interface FormState {
  name: string;
  short_code: string;
  content: string;
}

const EMPTY_FORM: FormState = { name: "", short_code: "", content: "" };

export function Component() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["iv2-canned"],
    queryFn: () => listCannedResponses(token!),
    enabled: Boolean(token),
    staleTime: 30_000
  });

  const createMut = useMutation({
    mutationFn: (data: FormState) => createCannedResponse(token!, data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["iv2-canned"] }); setForm(EMPTY_FORM); setError(null); },
    onError: (e: Error) => setError(e.message)
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FormState> }) => updateCannedResponse(token!, id, data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["iv2-canned"] }); setEditId(null); setForm(EMPTY_FORM); setError(null); },
    onError: (e: Error) => setError(e.message)
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteCannedResponse(token!, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["iv2-canned"] }),
    onError: (e: Error) => setError(e.message)
  });

  const startEdit = (cr: CannedResponse) => {
    setEditId(cr.id);
    setForm({ name: cr.name, short_code: cr.short_code, content: cr.content });
    setError(null);
  };

  const cancelEdit = () => { setEditId(null); setForm(EMPTY_FORM); setError(null); };

  const handleSubmit = () => {
    if (!form.name.trim() || !form.short_code.trim() || !form.content.trim()) {
      setError("All fields are required.");
      return;
    }
    if (editId) {
      updateMut.mutate({ id: editId, data: form });
    } else {
      createMut.mutate(form);
    }
  };

  const isPending = createMut.isPending || updateMut.isPending;
  const list = query.data?.cannedResponses ?? [];

  return (
    <div className="account-section">
      <div className="account-section-head">
        <h2 className="account-section-title">Canned Responses</h2>
        <p className="account-section-desc">
          Save reply shortcuts triggered by <code>/short_code</code> in the compose area.
        </p>
      </div>

      {error && <div className="account-error">{error}</div>}

      {/* Form */}
      <div className="account-card" style={{ marginBottom: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 12, marginBottom: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label className="account-field-label">Name</label>
            <input
              className="account-field-input"
              placeholder="e.g. Greeting"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label className="account-field-label">Short code</label>
            <input
              className="account-field-input"
              placeholder="e.g. hello"
              value={form.short_code}
              onChange={(e) => setForm((p) => ({ ...p, short_code: e.target.value.replace(/\s/g, "").toLowerCase() }))}
            />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
          <label className="account-field-label">Content</label>
          <textarea
            className="account-field-input"
            rows={3}
            placeholder="Reply text..."
            value={form.content}
            onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))}
            style={{ resize: "vertical" }}
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="account-btn-primary" disabled={isPending} onClick={handleSubmit}>
            {isPending ? "Saving…" : editId ? "Update" : "Add Response"}
          </button>
          {editId && <button className="account-btn-secondary" onClick={cancelEdit}>Cancel</button>}
        </div>
      </div>

      {/* List */}
      {query.isLoading ? (
        <div style={{ color: "#94a3b8", fontSize: 13 }}>Loading…</div>
      ) : list.length === 0 ? (
        <div style={{ color: "#94a3b8", fontSize: 13 }}>No canned responses yet. Add one above.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {list.map((cr) => (
            <div key={cr.id} className="account-card" style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#122033" }}>{cr.name}</span>
                  <code style={{ fontSize: 11, background: "#f0f4ff", color: "#2563eb", padding: "1px 6px", borderRadius: 5, fontWeight: 700 }}>/{cr.short_code}</code>
                </div>
                <div style={{ fontSize: 12.5, color: "#475569", lineHeight: 1.5 }}>{cr.content}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button className="account-btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => startEdit(cr)}>Edit</button>
                <button
                  className="account-btn-secondary"
                  style={{ padding: "4px 10px", fontSize: 12, color: "#ef4444", borderColor: "#fecaca" }}
                  disabled={deleteMut.isPending}
                  onClick={() => { if (confirm(`Delete "${cr.name}"?`)) deleteMut.mutate(cr.id); }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

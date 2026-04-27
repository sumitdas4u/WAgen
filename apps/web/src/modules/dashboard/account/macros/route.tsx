import { useState } from "react";
import "./../account.css";

export interface Macro {
  id: string;
  name: string;
  actions: MacroAction[];
  created_at: string;
}

export type MacroActionType = "send_message" | "set_status" | "assign_label" | "set_priority";

export interface MacroAction {
  type: MacroActionType;
  value: string;
}

const ACTION_LABELS: Record<MacroActionType, string> = {
  send_message: "Send message",
  set_status: "Set status",
  assign_label: "Assign label",
  set_priority: "Set priority"
};

const ACTION_OPTIONS: MacroActionType[] = ["send_message", "set_status", "assign_label", "set_priority"];

function loadMacros(): Macro[] {
  try { return JSON.parse(localStorage.getItem("iv2-macros") ?? "[]") as Macro[]; }
  catch { return []; }
}

function saveMacros(macros: Macro[]) {
  try { localStorage.setItem("iv2-macros", JSON.stringify(macros)); } catch { /* noop */ }
}

const EMPTY_ACTION: MacroAction = { type: "send_message", value: "" };

export function Component() {
  const [macros, setMacros] = useState<Macro[]>(loadMacros);
  const [name, setName] = useState("");
  const [actions, setActions] = useState<MacroAction[]>([{ ...EMPTY_ACTION }]);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const persist = (next: Macro[]) => { setMacros(next); saveMacros(next); };

  const startEdit = (m: Macro) => {
    setEditId(m.id);
    setName(m.name);
    setActions(m.actions.map((a) => ({ ...a })));
    setError(null);
  };

  const cancelEdit = () => { setEditId(null); setName(""); setActions([{ ...EMPTY_ACTION }]); setError(null); };

  const handleSave = () => {
    if (!name.trim()) { setError("Name is required."); return; }
    if (actions.some((a) => !a.value.trim())) { setError("All action values are required."); return; }
    if (editId) {
      persist(macros.map((m) => m.id === editId ? { ...m, name: name.trim(), actions } : m));
      cancelEdit();
    } else {
      persist([...macros, { id: crypto.randomUUID(), name: name.trim(), actions, created_at: new Date().toISOString() }]);
      setName(""); setActions([{ ...EMPTY_ACTION }]);
    }
    setError(null);
  };

  const deleteMacro = (id: string) => {
    if (!confirm("Delete this macro?")) return;
    persist(macros.filter((m) => m.id !== id));
    if (editId === id) cancelEdit();
  };

  const addAction = () => setActions((a) => [...a, { ...EMPTY_ACTION }]);
  const removeAction = (i: number) => setActions((a) => a.filter((_, j) => j !== i));
  const updateAction = (i: number, field: keyof MacroAction, val: string) =>
    setActions((a) => a.map((x, j) => j === i ? { ...x, [field]: val } : x));

  return (
    <div className="account-section">
      <div className="account-section-head">
        <h2 className="account-section-title">Macros</h2>
        <p className="account-section-desc">
          Save multi-step action sequences. Apply macros from the compose area to automate repetitive tasks.
        </p>
      </div>

      {error && <div className="account-error">{error}</div>}

      {/* Form */}
      <div className="account-card" style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 12 }}>
          <label className="account-field-label">Macro name</label>
          <input className="account-field-input" placeholder="e.g. Close and resolve" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label className="account-field-label" style={{ marginBottom: 6, display: "block" }}>Actions</label>
          {actions.map((action, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <select
                className="account-field-input"
                style={{ flex: "0 0 160px" }}
                value={action.type}
                onChange={(e) => updateAction(i, "type", e.target.value)}
              >
                {ACTION_OPTIONS.map((o) => <option key={o} value={o}>{ACTION_LABELS[o]}</option>)}
              </select>
              <input
                className="account-field-input"
                style={{ flex: 1 }}
                placeholder={action.type === "send_message" ? "Message text…" : "Value…"}
                value={action.value}
                onChange={(e) => updateAction(i, "value", e.target.value)}
              />
              {actions.length > 1 && (
                <button
                  style={{ width: 28, height: 28, border: "1px solid #fecdd3", borderRadius: 6, background: "#fff1f2", color: "#dc2626", cursor: "pointer", fontSize: 16, display: "grid", placeItems: "center" }}
                  onClick={() => removeAction(i)}
                >×</button>
              )}
            </div>
          ))}
          <button className="account-btn-secondary" style={{ fontSize: 12, padding: "4px 10px" }} onClick={addAction}>+ Add action</button>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="account-btn-primary" onClick={handleSave}>{editId ? "Update macro" : "Save macro"}</button>
          {editId && <button className="account-btn-secondary" onClick={cancelEdit}>Cancel</button>}
        </div>
      </div>

      {/* List */}
      {macros.length === 0 ? (
        <div style={{ color: "#94a3b8", fontSize: 13 }}>No macros yet. Create one above.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {macros.map((m) => (
            <div key={m.id} className="account-card" style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#122033", marginBottom: 6 }}>{m.name}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {m.actions.map((a, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#64748b" }}>
                      <span style={{ fontWeight: 600, color: "#334155" }}>{ACTION_LABELS[a.type]}:</span> {a.value}
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button className="account-btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => startEdit(m)}>Edit</button>
                <button className="account-btn-secondary" style={{ padding: "4px 10px", fontSize: 12, color: "#ef4444", borderColor: "#fecaa3" }} onClick={() => deleteMacro(m.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

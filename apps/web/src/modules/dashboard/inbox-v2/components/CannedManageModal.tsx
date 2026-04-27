import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../../lib/auth-context";
import {
  listCannedResponses,
  createCannedResponse,
  updateCannedResponse,
  deleteCannedResponse,
  type CannedResponse
} from "../api";

interface Props { onClose: () => void }

export function CannedManageModal({ onClose }: Props) {
  const { token } = useAuth();
  const qc = useQueryClient();

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["iv2-canned-manage"] });
    void qc.invalidateQueries({ queryKey: ["iv2-canned"] });
  };

  const query = useQuery({
    queryKey: ["iv2-canned-manage"],
    queryFn: () => listCannedResponses(token!),
    enabled: !!token
  });

  const createMut = useMutation({
    mutationFn: (p: { name: string; short_code: string; content: string }) => createCannedResponse(token!, p),
    onSuccess: invalidate
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...p }: { id: string; name: string; short_code: string; content: string }) =>
      updateCannedResponse(token!, id, p),
    onSuccess: invalidate
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteCannedResponse(token!, id),
    onSuccess: invalidate
  });

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editContent, setEditContent] = useState("");

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newContent, setNewContent] = useState("");

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  function startEdit(c: CannedResponse) {
    setEditId(c.id); setEditName(c.name); setEditCode(c.short_code); setEditContent(c.content);
  }

  function saveEdit() {
    if (!editId) return;
    void updateMut.mutateAsync({ id: editId, name: editName, short_code: editCode, content: editContent })
      .then(() => setEditId(null));
  }

  function saveNew() {
    void createMut.mutateAsync({ name: newName, short_code: newCode, content: newContent })
      .then(() => { setCreating(false); setNewName(""); setNewCode(""); setNewContent(""); });
  }

  const items = query.data?.cannedResponses ?? [];

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", height: 34,
    border: "1.5px solid #e2eaf4", borderRadius: 8, padding: "0 10px",
    fontSize: 12.5, fontFamily: "Manrope, sans-serif", outline: "none",
    background: "#fff", marginBottom: 5, display: "block"
  };
  const taStyle: React.CSSProperties = { ...inputStyle, height: 60, resize: "vertical" as const, padding: "6px 10px" };

  return (
    <div className="iv-modal-overlay" onClick={onClose}>
      <div className="iv-modal iv-modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="iv-tvd-head">
          <strong>Canned Responses</strong>
          <button className="iv-tvd-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          {query.isLoading && <div style={{ color: "#94a3b8", fontSize: 13, padding: "8px 0" }}>Loading…</div>}

          {items.map((c) =>
            editId === c.id ? (
              <div key={c.id} className="iv-canned-edit-row">
                <input style={inputStyle} placeholder="Name" value={editName} onChange={(e) => setEditName(e.target.value)} />
                <input style={inputStyle} placeholder="Short code (e.g. greet)" value={editCode} onChange={(e) => setEditCode(e.target.value)} />
                <textarea style={taStyle} placeholder="Content…" value={editContent} onChange={(e) => setEditContent(e.target.value)} />
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="iv-tvd-send" style={{ fontSize: 12, padding: "3px 10px", height: "auto" }} disabled={updateMut.isPending} onClick={saveEdit}>Save</button>
                  <button className="iv-tvd-cancel" style={{ fontSize: 12, padding: "3px 10px", height: "auto" }} onClick={() => setEditId(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div key={c.id} className="iv-canned-manage-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#122033", display: "flex", gap: 6, alignItems: "center" }}>
                    {c.name}
                    <span style={{ fontFamily: "monospace", fontSize: 11, color: "#2563eb", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4, padding: "0 4px" }}>/{c.short_code}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#5f6f86", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>{c.content}</div>
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "center" }}>
                  <button className="iv-btn-icon" style={{ fontSize: 13 }} onClick={() => startEdit(c)}>✎</button>
                  {deleteConfirm === c.id ? (
                    <>
                      <button style={{ background: "#fee2e2", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 11, color: "#dc2626", cursor: "pointer" }} disabled={deleteMut.isPending} onClick={() => void deleteMut.mutateAsync(c.id).then(() => setDeleteConfirm(null))}>Confirm</button>
                      <button className="iv-btn-icon" style={{ fontSize: 11 }} onClick={() => setDeleteConfirm(null)}>✕</button>
                    </>
                  ) : (
                    <button className="iv-btn-icon" style={{ fontSize: 13, color: "#ef4444" }} onClick={() => setDeleteConfirm(c.id)}>🗑</button>
                  )}
                </div>
              </div>
            )
          )}

          {creating ? (
            <div className="iv-canned-edit-row" style={{ marginTop: 4 }}>
              <input style={inputStyle} placeholder="Name" value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} />
              <input style={inputStyle} placeholder="Short code (e.g. greet)" value={newCode} onChange={(e) => setNewCode(e.target.value)} />
              <textarea style={taStyle} placeholder="Content…" value={newContent} onChange={(e) => setNewContent(e.target.value)} />
              <div style={{ display: "flex", gap: 6 }}>
                <button className="iv-tvd-send" style={{ fontSize: 12, padding: "3px 10px", height: "auto" }} disabled={createMut.isPending} onClick={saveNew}>Create</button>
                <button className="iv-tvd-cancel" style={{ fontSize: 12, padding: "3px 10px", height: "auto" }} onClick={() => setCreating(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button
              style={{ display: "flex", alignItems: "center", gap: 6, background: "#f0f4ff", border: "1px dashed #c7d6f7", borderRadius: 8, padding: "9px 12px", fontSize: 12.5, color: "#2563eb", cursor: "pointer", width: "100%", marginTop: 4 }}
              onClick={() => setCreating(true)}
            >
              + New canned response
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../../../lib/auth-context";

// Fetch contact by ID directly
async function fetchContactById(token: string, id: string) {
  const res = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/api/contacts?id=${id}&limit=1`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Failed to load contact");
  const data = (await res.json()) as { contacts: ContactData[] };
  return data.contacts[0] ?? null;
}

async function patchContact(token: string, id: string, payload: Partial<ContactData>) {
  const res = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/api/contacts/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: "Update failed" }))) as { error?: string };
    throw new Error(err.error ?? "Update failed");
  }
  return res.json() as Promise<{ contact: ContactData }>;
}

interface ContactData {
  id: string;
  display_name: string | null;
  phone_number: string;
  email: string | null;
  contact_type: string;
  tags: string[];
  source_type: string;
  created_at: string;
  custom_field_values?: Array<{ field_id: string; field_name: string; field_label: string; field_type: string; value: string | null }>;
}

export function ContactDetailPage() {
  const { contactId } = useParams<{ contactId: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<{ name: string; email: string; type: string; tags: string }>({
    name: "", email: "", type: "lead", tags: ""
  });
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["contact-detail", contactId],
    queryFn: () => fetchContactById(token!, contactId!),
    enabled: Boolean(token && contactId),
    staleTime: 30_000
  });

  const contact = query.data;

  const startEdit = () => {
    if (!contact) return;
    setForm({
      name: contact.display_name ?? "",
      email: contact.email ?? "",
      type: contact.contact_type,
      tags: contact.tags.join(", ")
    });
    setEditing(true);
    setError(null);
  };

  const updateMut = useMutation({
    mutationFn: () => patchContact(token!, contactId!, {
      ...(form.name.trim() ? { display_name: form.name.trim() } : {}),
      email: form.email.trim() || null,
      contact_type: form.type,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean)
    } as Partial<ContactData>),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["contact-detail", contactId] });
      setEditing(false);
      setError(null);
    },
    onError: (e: Error) => setError(e.message)
  });

  if (query.isLoading) {
    return (
      <div style={{ padding: 32, color: "#94a3b8" }}>Loading contact…</div>
    );
  }

  if (!contact) {
    return (
      <div style={{ padding: 32, color: "#ef4444" }}>Contact not found.</div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 24px", fontFamily: "Manrope, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button
          onClick={() => navigate(-1)}
          style={{ border: "1px solid #e2eaf4", background: "#fff", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 13, color: "#5f6f86" }}
        >
          ← Back
        </button>
        <h1 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 20, fontWeight: 800, color: "#122033", margin: 0 }}>
          Contact Detail
        </h1>
        {!editing && (
          <button
            onClick={startEdit}
            style={{ marginLeft: "auto", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13, fontWeight: 700 }}
          >
            Edit
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 8, padding: "10px 14px", marginBottom: 16, color: "#dc2626", fontSize: 13 }}>
          {error}
        </div>
      )}

      {!editing ? (
        <div style={{ background: "#fff", border: "1px solid #e2eaf4", borderRadius: 12, padding: "24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <Row label="Name" value={contact.display_name ?? "—"} />
          <Row label="Phone" value={contact.phone_number} />
          <Row label="Email" value={contact.email ?? "—"} />
          <Row label="Type" value={contact.contact_type} />
          <Row label="Source" value={contact.source_type} />
          <Row label="Tags" value={contact.tags.length > 0 ? contact.tags.join(", ") : "—"} />
          <Row label="Created" value={new Date(contact.created_at).toLocaleString()} />

          {contact.custom_field_values && contact.custom_field_values.length > 0 && (
            <>
              <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 14, fontSize: 10.5, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" }}>Custom Fields</div>
              {contact.custom_field_values.map((fv) => (
                <Row key={fv.field_id} label={fv.field_label || fv.field_name} value={fv.value ?? "—"} />
              ))}
            </>
          )}
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e2eaf4", borderRadius: 12, padding: "24px", display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Name">
            <input className="cd-input" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          </Field>
          <Field label="Email">
            <input className="cd-input" type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
          </Field>
          <Field label="Type">
            <select className="cd-input" value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}>
              {["lead", "feedback", "complaint", "other"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Tags (comma-separated)">
            <input className="cd-input" value={form.tags} onChange={(e) => setForm((p) => ({ ...p, tags: e.target.value }))} placeholder="e.g. vip, enterprise" />
          </Field>

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", cursor: "pointer", fontSize: 13, fontWeight: 700 }}
              disabled={updateMut.isPending}
              onClick={() => updateMut.mutate()}
            >
              {updateMut.isPending ? "Saving…" : "Save"}
            </button>
            <button
              style={{ background: "#f8fafc", border: "1px solid #e2eaf4", borderRadius: 8, padding: "9px 16px", cursor: "pointer", fontSize: 13, color: "#5f6f86" }}
              onClick={() => { setEditing(false); setError(null); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <div style={{ width: 120, fontSize: 11, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.04em", paddingTop: 1, flexShrink: 0 }}>{label}</div>
      <div style={{ fontSize: 13.5, color: "#122033", flex: 1 }}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</label>
      {children}
    </div>
  );
}

// Named export for lazy loading
export { ContactDetailPage as Component };

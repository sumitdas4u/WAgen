import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ContactField, ContactFieldType } from "../../../../lib/api";
import {
  createContactField,
  deleteContactField,
  listContactFields,
  updateContactField
} from "../../../../lib/api";
import { dashboardQueryKeys } from "../../../../shared/dashboard/query-keys";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";

const FIELD_TYPES: { value: ContactFieldType; label: string }[] = [
  { value: "TEXT", label: "Text" },
  { value: "MULTI_TEXT", label: "Multi Text" },
  { value: "NUMBER", label: "Number" },
  { value: "SWITCH", label: "Switch" },
  { value: "DATE", label: "Date" }
];

type AddFieldDraft = {
  label: string;
  name: string;
  field_type: ContactFieldType;
  is_mandatory: boolean;
};

const EMPTY_DRAFT: AddFieldDraft = { label: "", name: "", field_type: "TEXT", is_mandatory: false };

function toSnakeCase(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

export function ContactFieldsPage() {
  const queryClient = useQueryClient();
  const { token } = useDashboardShell();
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState<AddFieldDraft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);

  const fieldsQuery = useQuery({
    queryKey: dashboardQueryKeys.contactFields,
    queryFn: () => listContactFields(token).then((r) => r.fields),
    enabled: Boolean(token)
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.contactFieldsRoot });

  const createMutation = useMutation({
    mutationFn: (d: AddFieldDraft) => createContactField(token, d),
    onSuccess: async () => { await invalidate(); setShowAddForm(false); setDraft(EMPTY_DRAFT); setFormError(null); },
    onError: (err) => setFormError((err as Error).message)
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      updateContactField(token, id, { is_active }),
    onSuccess: () => invalidate()
  });

  const toggleMandatoryMutation = useMutation({
    mutationFn: ({ id, is_mandatory }: { id: string; is_mandatory: boolean }) =>
      updateContactField(token, id, { is_mandatory }),
    onSuccess: () => invalidate()
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteContactField(token, id),
    onSuccess: () => invalidate()
  });

  const fields = fieldsQuery.data ?? [];
  const displayed = showActiveOnly ? fields.filter((f) => f.is_active) : fields;

  const handleLabelChange = (value: string) => {
    setDraft((c) => ({ ...c, label: value, name: toSnakeCase(value) }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.label.trim()) { setFormError("Label is required."); return; }
    if (!draft.name.trim()) { setFormError("Name is required."); return; }
    createMutation.mutate(draft);
  };

  return (
    <section className="finance-shell">
      <article className="channel-setup-panel">
        <header>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}>
            <div>
              <h3>Contact Fields</h3>
              <p>Define extra fields to capture on contacts.</p>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={showActiveOnly}
                  onChange={(e) => setShowActiveOnly(e.target.checked)}
                />
                Display Only Active Fields
              </label>
              <button
                type="button"
                className="primary-btn"
                onClick={() => { setShowAddForm((v) => !v); setFormError(null); setDraft(EMPTY_DRAFT); }}
              >
                + Add
              </button>
            </div>
          </div>
        </header>

        {showAddForm && (
          <form className="contact-fields-add-form" onSubmit={handleSubmit}>
            <h4>New Field</h4>
            {formError && <p className="error-text">{formError}</p>}
            <div className="contact-fields-form-row">
              <label>
                Label
                <input
                  value={draft.label}
                  onChange={(e) => handleLabelChange(e.target.value)}
                  placeholder="e.g. Instagram ID"
                  maxLength={100}
                  autoFocus
                />
              </label>
              <label>
                Name <span style={{ fontSize: "0.75rem", color: "#888" }}>(auto-generated)</span>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((c) => ({ ...c, name: toSnakeCase(e.target.value) }))}
                  placeholder="e.g. instagram_id"
                  maxLength={100}
                />
              </label>
              <label>
                Type
                <select value={draft.field_type} onChange={(e) => setDraft((c) => ({ ...c, field_type: e.target.value as ContactFieldType }))}>
                  {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={draft.is_mandatory}
                  onChange={(e) => setDraft((c) => ({ ...c, is_mandatory: e.target.checked }))}
                />
                Mandatory
              </label>
            </div>
            <div className="clone-hero-actions">
              <button type="submit" className="primary-btn" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Saving..." : "Save Field"}
              </button>
              <button type="button" className="ghost-btn" onClick={() => { setShowAddForm(false); setFormError(null); }}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {fieldsQuery.isLoading ? (
          <p style={{ padding: "1rem", color: "#888" }}>Loading fields...</p>
        ) : (
          <div className="contact-fields-table-wrapper">
            <table className="contact-fields-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Mandatory</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {displayed.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: "2rem", color: "#888" }}>
                      {showActiveOnly ? "No active fields." : "No fields yet. Click + Add to create one."}
                    </td>
                  </tr>
                ) : (
                  displayed.map((field) => (
                    <ContactFieldRow
                      key={field.id}
                      field={field}
                      onToggleActive={(is_active) => toggleActiveMutation.mutate({ id: field.id, is_active })}
                      onToggleMandatory={(is_mandatory) => toggleMandatoryMutation.mutate({ id: field.id, is_mandatory })}
                      onDelete={() => {
                        if (window.confirm(`Delete field "${field.label}"?`)) {
                          deleteMutation.mutate(field.id);
                        }
                      }}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}

function ContactFieldRow({
  field,
  onToggleActive,
  onToggleMandatory,
  onDelete
}: {
  field: ContactField;
  onToggleActive: (v: boolean) => void;
  onToggleMandatory: (v: boolean) => void;
  onDelete: () => void;
}) {
  const typeLabel = FIELD_TYPES.find((t) => t.value === field.field_type)?.label ?? field.field_type;

  return (
    <tr>
      <td>{field.label}</td>
      <td style={{ color: "#666", fontFamily: "monospace", fontSize: "0.85em" }}>{field.name}</td>
      <td>
        <span className="contact-field-type-badge">{typeLabel}</span>
      </td>
      <td>
        <button
          type="button"
          className={field.is_active ? "go-live-switch on" : "go-live-switch"}
          onClick={() => onToggleActive(!field.is_active)}
          title={field.is_active ? "Deactivate" : "Activate"}
        >
          <span />
        </button>
      </td>
      <td>
        <button
          type="button"
          className={field.is_mandatory ? "go-live-switch on" : "go-live-switch"}
          onClick={() => onToggleMandatory(!field.is_mandatory)}
          title={field.is_mandatory ? "Mark optional" : "Mark mandatory"}
        >
          <span />
        </button>
      </td>
      <td>
        <button
          type="button"
          className="link-btn"
          onClick={onDelete}
          style={{ color: "#e53e3e" }}
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

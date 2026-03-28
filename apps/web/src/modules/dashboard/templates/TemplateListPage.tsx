import { useState } from "react";
import type { MessageTemplate, MetaBusinessStatus } from "../../../lib/api";
import { TemplateCreatePage } from "./TemplateCreatePage";
import { TemplateStatusBadge } from "./TemplateStatusBadge";
import { useDeleteTemplateMutation, useSyncTemplatesMutation, useTemplatesQuery } from "./queries";

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "64px 24px",
        textAlign: "center",
        gap: "16px"
      }}
    >
      <div style={{ fontSize: "48px" }}>📋</div>
      <div style={{ fontWeight: 700, fontSize: "18px" }}>No templates yet</div>
      <div style={{ color: "#666", fontSize: "14px", maxWidth: "360px" }}>
        Create your first WhatsApp message template to start broadcasting to your customers.
        Templates must be approved by Meta before sending.
      </div>
      <button
        type="button"
        onClick={onNew}
        style={{
          padding: "12px 24px",
          borderRadius: "8px",
          background: "#25d366",
          color: "#fff",
          border: "none",
          fontWeight: 700,
          fontSize: "14px",
          cursor: "pointer"
        }}
      >
        + Create Template
      </button>
    </div>
  );
}

function TemplateRow({
  template,
  onDelete,
  deleting
}: {
  template: MessageTemplate;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const bodyComp = template.components.find((c) => c.type === "BODY");
  const preview = bodyComp?.text?.slice(0, 60) ?? "—";

  return (
    <tr style={{ borderBottom: "1px solid #f0f0f0" }}>
      <td style={{ padding: "12px 16px", verticalAlign: "middle" }}>
        <div style={{ fontWeight: 600, fontSize: "14px" }}>{template.name}</div>
        <div style={{ fontSize: "12px", color: "#888", marginTop: "2px" }}>
          {preview}{bodyComp?.text && bodyComp.text.length > 60 ? "…" : ""}
        </div>
      </td>
      <td style={{ padding: "12px 16px", verticalAlign: "middle", whiteSpace: "nowrap" }}>
        <span
          style={{
            fontSize: "12px",
            fontWeight: 600,
            padding: "3px 8px",
            borderRadius: "6px",
            background:
              template.category === "MARKETING"
                ? "#eff6ff"
                : template.category === "UTILITY"
                  ? "#f0fdf4"
                  : "#fdf4ff",
            color:
              template.category === "MARKETING"
                ? "#1d4ed8"
                : template.category === "UTILITY"
                  ? "#166534"
                  : "#7e22ce"
          }}
        >
          {template.category}
        </span>
      </td>
      <td style={{ padding: "12px 16px", verticalAlign: "middle", fontSize: "13px", color: "#555" }}>
        {template.language}
      </td>
      <td style={{ padding: "12px 16px", verticalAlign: "middle" }}>
        <TemplateStatusBadge status={template.status} />
      </td>
      <td style={{ padding: "12px 16px", verticalAlign: "middle", fontSize: "12px", color: "#888" }}>
        {template.qualityScore ?? "—"}
      </td>
      <td style={{ padding: "12px 16px", verticalAlign: "middle", fontSize: "12px", color: "#888", whiteSpace: "nowrap" }}>
        {new Date(template.createdAt).toLocaleDateString()}
      </td>
      <td style={{ padding: "12px 16px", verticalAlign: "middle" }}>
        {confirmDelete ? (
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              type="button"
              onClick={() => {
                onDelete(template.id);
                setConfirmDelete(false);
              }}
              disabled={deleting}
              style={{
                padding: "4px 10px",
                borderRadius: "6px",
                background: "#dc2626",
                color: "#fff",
                border: "none",
                fontWeight: 600,
                fontSize: "12px",
                cursor: "pointer"
              }}
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              style={{
                padding: "4px 10px",
                borderRadius: "6px",
                background: "#f3f4f6",
                color: "#333",
                border: "none",
                fontSize: "12px",
                cursor: "pointer"
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              background: "none",
              border: "1.5px solid #e0e0e0",
              color: "#dc2626",
              fontSize: "12px",
              cursor: "pointer"
            }}
          >
            Delete
          </button>
        )}
      </td>
    </tr>
  );
}

interface Props {
  token: string;
  metaStatus?: MetaBusinessStatus | null;
}

export function TemplateListPage({ token, metaStatus }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const templatesQuery = useTemplatesQuery(token);
  const syncMutation = useSyncTemplatesMutation(token);
  const deleteMutation = useDeleteTemplateMutation(token);

  const templates = templatesQuery.data ?? [];

  if (showCreate) {
    return (
      <TemplateCreatePage
        token={token}
        metaStatus={metaStatus}
        onBack={() => setShowCreate(false)}
        onCreated={(t) => {
          setShowCreate(false);
          setSuccessMsg(`Template "${t.name}" submitted for Meta approval.`);
        }}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 700 }}>Message Templates</h2>
          <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#666" }}>
            Create and manage WhatsApp broadcast templates. Templates require Meta approval before sending.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            type="button"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || templatesQuery.isFetching}
            style={{
              padding: "9px 16px",
              borderRadius: "8px",
              border: "1.5px solid #e0e0e0",
              background: "#fff",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              color: "#555"
            }}
          >
            {syncMutation.isPending ? "Syncing…" : "↻ Sync from Meta"}
          </button>
          <button
            type="button"
            onClick={() => { setSuccessMsg(null); setShowCreate(true); }}
            style={{
              padding: "9px 18px",
              borderRadius: "8px",
              background: "#25d366",
              color: "#fff",
              border: "none",
              fontWeight: 700,
              fontSize: "13px",
              cursor: "pointer"
            }}
          >
            + New Template
          </button>
        </div>
      </div>

      {/* Success toast */}
      {successMsg && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "8px",
            background: "#f0fdf4",
            color: "#166534",
            border: "1px solid #86efac",
            fontSize: "14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          ✓ {successMsg}
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#166534", fontSize: "16px" }}
          >
            ×
          </button>
        </div>
      )}

      {/* No Meta connection warning */}
      {metaStatus && !metaStatus.connected && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "8px",
            background: "#fffbeb",
            color: "#92400e",
            border: "1px solid #fde68a",
            fontSize: "13px"
          }}
        >
          ⚠️ No Meta WhatsApp Business connection found. Connect your account in{" "}
          <strong>Settings → API Channel</strong> to create and submit templates.
        </div>
      )}

      {/* Loading skeleton */}
      {templatesQuery.isLoading && (
        <div style={{ padding: "40px", textAlign: "center", color: "#aaa", fontSize: "14px" }}>
          Loading templates…
        </div>
      )}

      {/* Empty state */}
      {!templatesQuery.isLoading && templates.length === 0 && (
        <EmptyState onNew={() => setShowCreate(true)} />
      )}

      {/* Table */}
      {templates.length > 0 && (
        <div
          style={{
            border: "1.5px solid #e0e0e0",
            borderRadius: "12px",
            overflow: "hidden"
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                {["Template Name", "Category", "Language", "Status", "Quality", "Created", "Actions"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "10px 16px",
                      textAlign: "left",
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#888",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      borderBottom: "1px solid #e0e0e0"
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  onDelete={(id) => deleteMutation.mutate(id)}
                  deleting={deleteMutation.isPending}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Sync error */}
      {syncMutation.isError && (
        <div style={{ padding: "10px 14px", borderRadius: "8px", background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", fontSize: "13px" }}>
          Sync failed: {(syncMutation.error as Error).message}
        </div>
      )}
    </div>
  );
}

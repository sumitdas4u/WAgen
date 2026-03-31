import type { TemplateStatus } from "../../../lib/api";

const STATUS_CONFIG: Record<TemplateStatus, { label: string; color: string }> = {
  APPROVED: { label: "Approved", color: "var(--color-success, #16a34a)" },
  PENDING: { label: "Pending Review", color: "var(--color-warning, #d97706)" },
  REJECTED: { label: "Rejected", color: "var(--color-error, #dc2626)" },
  PAUSED: { label: "Paused", color: "var(--color-neutral, #6b7280)" },
  DISABLED: { label: "Disabled", color: "var(--color-neutral, #6b7280)" }
};

export function TemplateStatusBadge({ status }: { status: TemplateStatus }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "2px 8px",
        borderRadius: "999px",
        fontSize: "12px",
        fontWeight: 600,
        background: `${config.color}1a`,
        color: config.color,
        border: `1px solid ${config.color}33`,
        whiteSpace: "nowrap"
      }}
    >
      <span
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: config.color,
          flexShrink: 0
        }}
      />
      {config.label}
    </span>
  );
}

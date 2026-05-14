import { useNavigate } from "react-router-dom";
import type { ReminderConfig } from "../../../../lib/api";

interface Props {
  config: ReminderConfig;
  icon: string;
  label: string;
}

export function ReminderCard({ config, icon, label }: Props) {
  const navigate = useNavigate();

  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: 20,
        cursor: "pointer",
        background: "#fff",
        transition: "box-shadow 120ms ease"
      }}
      onClick={() => navigate(`/dashboard/reminder/${config.config_key}/capture`)}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 16px rgba(0,0,0,0.08)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "none"; }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 24 }}>{icon}</div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "3px 8px",
            borderRadius: 999,
            background: config.enabled ? "#dcfce7" : "#f1f5f9",
            color: config.enabled ? "#166534" : "#64748b",
            border: `1px solid ${config.enabled ? "#bbf7d0" : "#e2e8f0"}`
          }}
        >
          {config.enabled ? "ENABLED" : "DISABLED"}
        </span>
      </div>
      <div style={{ fontWeight: 700, fontSize: 15, color: "#122033" }}>
        {config.custom_label ?? label}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
        <span style={{
          fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 999,
          background: config.capture_enabled ? "#eff6ff" : "#f1f5f9",
          color: config.capture_enabled ? "#1d4ed8" : "#94a3b8",
          border: `1px solid ${config.capture_enabled ? "#bfdbfe" : "#e2eaf4"}`
        }}>
          Capture {config.capture_enabled ? "on" : "off"}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 999,
          background: config.campaign_enabled ? "#f0fdf4" : "#f1f5f9",
          color: config.campaign_enabled ? "#166534" : "#94a3b8",
          border: `1px solid ${config.campaign_enabled ? "#bbf7d0" : "#e2eaf4"}`
        }}>
          Campaign {config.campaign_enabled ? "on" : "off"}
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button
          style={{
            fontSize: 12, padding: "5px 12px", borderRadius: 6,
            border: "1px solid #e2e8f0", background: "#f8fafc",
            color: "#334155", cursor: "pointer", fontWeight: 600
          }}
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/dashboard/reminder/${config.config_key}/capture`);
          }}
        >
          Capture
        </button>
        <button
          style={{
            fontSize: 12, padding: "5px 12px", borderRadius: 6,
            border: "1px solid #e2e8f0", background: "#f8fafc",
            color: "#334155", cursor: "pointer", fontWeight: 600
          }}
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/dashboard/reminder/${config.config_key}/campaign`);
          }}
        >
          Campaign
        </button>
      </div>
    </div>
  );
}

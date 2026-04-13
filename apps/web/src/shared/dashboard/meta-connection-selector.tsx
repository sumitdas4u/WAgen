import type { MetaBusinessConnection } from "../../lib/api";

function formatConnectionLabel(connection: MetaBusinessConnection): string {
  return connection.displayPhoneNumber || connection.linkedNumber || connection.phoneNumberId;
}

function isConnectionActive(connection: MetaBusinessConnection): boolean {
  return connection.status === "connected" && connection.enabled;
}

interface MetaConnectionSelectorProps {
  connections: MetaBusinessConnection[];
  value: string;
  onChange: (connectionId: string) => void;
  label?: string;
  required?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
  activeOnly?: boolean;
}

export function MetaConnectionSelector({
  connections,
  value,
  onChange,
  label = "Connection",
  required = false,
  allowEmpty = false,
  emptyLabel = "Select a connection",
  disabled = false,
  activeOnly = false
}: MetaConnectionSelectorProps) {
  const options = activeOnly
    ? connections.filter(isConnectionActive)
    : connections;

  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#334155" }}>
        {label}{required ? " *" : ""}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        style={{
          width: "100%",
          minHeight: "2.5rem",
          borderRadius: "10px",
          border: "1px solid #dbe2ea",
          background: disabled ? "#f8fafc" : "#fff",
          padding: "0 0.8rem",
          color: "#0f172a"
        }}
      >
        {allowEmpty ? <option value="">{emptyLabel}</option> : null}
        {options.map((connection) => {
          const active = isConnectionActive(connection);
          const suffix = active ? "Active" : connection.status === "disconnected" ? "Deleted" : connection.enabled ? connection.status : "Paused";
          return (
            <option key={connection.id} value={connection.id}>
              {formatConnectionLabel(connection)} - {suffix}
            </option>
          );
        })}
      </select>
    </label>
  );
}

export function getConnectionActiveLabel(connection: MetaBusinessConnection | null | undefined): string {
  if (!connection) {
    return "Missing";
  }
  if (connection.status === "disconnected") {
    return "Deleted";
  }
  if (connection.status !== "connected") {
    return connection.status;
  }
  return connection.enabled ? "Active" : "Paused";
}

export function isMetaConnectionActive(connection: MetaBusinessConnection | null | undefined): boolean {
  return Boolean(connection && connection.status === "connected" && connection.enabled);
}

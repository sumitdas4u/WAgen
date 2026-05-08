import { useEffect, useState } from "react";
import { fetchAdminWabaConnections, type AdminWabaConnection } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const DAY_MS = 24 * 60 * 60 * 1000;

function isExpiringSoon(tokenExpiresAt: string | null): boolean {
  if (!tokenExpiresAt) return false;
  return new Date(tokenExpiresAt).getTime() - Date.now() < 7 * DAY_MS;
}

export function WabaPage() {
  const { token } = useSuperAdmin();
  const [connections, setConnections] = useState<AdminWabaConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showExpiring, setShowExpiring] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchAdminWabaConnections(token);
      setConnections(r.connections);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [token]);

  const filtered = connections.filter((c) => {
    if (showExpiring && !isExpiringSoon(c.tokenExpiresAt)) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        c.userEmail.toLowerCase().includes(q) ||
        c.userName.toLowerCase().includes(q) ||
        (c.displayPhoneNumber ?? "").includes(q) ||
        (c.wabaId ?? "").includes(q)
      );
    }
    return true;
  });

  const expiringCount = connections.filter((c) => isExpiringSoon(c.tokenExpiresAt)).length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>WABA Connections</h1>
        <button className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </div>

      {expiringCount > 0 && (
        <div style={{ marginBottom: "1rem", padding: "12px 16px", borderRadius: 8, background: "#fff7ed", border: "1px solid #fed7aa", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "#ea580c", fontWeight: 700, fontSize: "0.88rem" }}>
            ⚠ {expiringCount} connection{expiringCount !== 1 ? "s" : ""} with tokens expiring within 7 days
          </span>
          <button
            onClick={() => setShowExpiring((v) => !v)}
            style={{ marginLeft: "auto", background: "none", border: "1px solid #f97316", color: "#ea580c", borderRadius: 5, padding: "3px 10px", cursor: "pointer", fontSize: "0.8rem" }}
          >
            {showExpiring ? "Show All" : "Show Expiring"}
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Search user / phone / WABA ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: "0.85rem", width: 280 }}
        />
        <span style={{ fontSize: "0.82rem", color: "#64748b" }}>{filtered.length} connection{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      <section className="finance-panel">
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>User</th><th>Phone</th><th>WABA ID</th><th>Status</th>
                <th>Enabled</th><th>Billing Status</th><th>Token Expires</th><th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const expiring = isExpiringSoon(c.tokenExpiresAt);
                return (
                  <tr key={c.id} style={expiring ? { background: "#fff7ed" } : undefined}>
                    <td>{c.userName}<br /><small style={{ color: "#64748b", fontSize: "0.78rem" }}>{c.userEmail}</small></td>
                    <td>{c.displayPhoneNumber ?? c.linkedNumber ?? "-"}</td>
                    <td style={{ fontSize: "0.78rem" }}>{c.wabaId ?? "-"}</td>
                    <td>
                      <span style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 12,
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        background: c.status === "active" ? "#dcfce720" : "#f1f5f9",
                        color: c.status === "active" ? "#16a34a" : "#64748b",
                      }}>
                        {c.status}
                      </span>
                    </td>
                    <td>
                      <span style={{ color: c.enabled ? "#22c55e" : "#94a3b8", fontWeight: 600, fontSize: "0.8rem" }}>
                        {c.enabled ? "Yes" : "No"}
                      </span>
                    </td>
                    <td style={{ fontSize: "0.8rem" }}>{c.billingStatus ?? "-"}</td>
                    <td style={{ fontSize: "0.8rem", color: expiring ? "#ea580c" : undefined, fontWeight: expiring ? 600 : undefined }}>
                      {c.tokenExpiresAt ? new Date(c.tokenExpiresAt).toLocaleDateString() : "-"}
                      {expiring && " ⚠"}
                    </td>
                    <td style={{ fontSize: "0.78rem" }}>{new Date(c.updatedAt).toLocaleString()}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "#94a3b8", padding: "2rem" }}>No WABA connections found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}

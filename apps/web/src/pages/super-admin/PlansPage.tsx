import { useEffect, useState } from "react";
import { fetchAdminPlans, updateAdminPlan, type WorkspacePlanSummary } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

export function PlansPage() {
  const { token } = useSuperAdmin();
  const [plans, setPlans] = useState<WorkspacePlanSummary[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchAdminPlans(token, { includeInactive: true });
      setPlans(r.plans);
      setDrafts(r.plans.reduce<Record<string, string>>((acc, p) => { acc[p.id] = String(p.monthlyCredits); return acc; }, {}));
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [token]);

  const save = async (plan: WorkspacePlanSummary) => {
    const next = Number(drafts[plan.id] ?? plan.monthlyCredits);
    if (!Number.isFinite(next) || next < 0) { setError("Monthly credits must be a valid number."); return; }
    setLoading(true); setError(null); setInfo(null);
    try {
      await updateAdminPlan(token, plan.id, { monthlyCredits: Math.floor(next) });
      setInfo(`Updated ${plan.name} to ${Math.floor(next)} credits.`);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>Plans</h1>
        <button className="ghost-btn" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <section className="finance-panel">
        <h2>Plan Credits Management</h2>
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>Code</th><th>Name</th><th>Price / Month</th><th>Monthly Credits</th><th>Status</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td>{p.code}</td>
                  <td>{p.name}</td>
                  <td>{p.priceMonthly}</td>
                  <td>
                    <input
                      value={drafts[p.id] ?? String(p.monthlyCredits)}
                      onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                      style={{ width: 120 }}
                    />
                  </td>
                  <td>{p.status}</td>
                  <td>
                    <button className="ghost-btn" onClick={() => void save(p)} disabled={loading}>Save</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {info && <p className="info-text" style={{ marginTop: "1rem" }}>{info}</p>}
      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}

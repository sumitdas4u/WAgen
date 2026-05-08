import { useEffect, useState } from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, ResponsiveContainer, Legend } from "recharts";
import { fetchBusinessAnalytics, type BusinessAnalytics } from "../../lib/api";
import { useSuperAdmin } from "./lib/super-admin-context";

const PIE_COLORS = ["#ef8354", "#3b82f6", "#22c55e", "#a855f7", "#f59e0b"];

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <article style={{ background: "#fff", border: "1px solid #e2eaf4", borderRadius: 10, padding: "1.25rem" }}>
      <h3 style={{ margin: "0 0 0.25rem", fontSize: "0.8rem", color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</h3>
      <p style={{ margin: 0, fontSize: "1.7rem", fontWeight: 800, color: "#122033" }}>{value}</p>
      {sub && <p style={{ margin: "0.2rem 0 0", fontSize: "0.78rem", color: "#94a3b8" }}>{sub}</p>}
    </article>
  );
}

function fmt(n: number): string {
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)}Cr`;
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

export function AnalyticsPage() {
  const { token } = useSuperAdmin();
  const [data, setData] = useState<BusinessAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchBusinessAnalytics(token);
      setData(r);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [token]);

  if (loading && !data) return (
    <div style={{ padding: "3rem", textAlign: "center", color: "#94a3b8" }}>Loading analytics…</div>
  );

  if (!data) return (
    <div>
      <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", marginBottom: "1.5rem" }}>Enterprise Analytics</h1>
      {error && <p className="error-text">{error}</p>}
    </div>
  );

  const pieData = Object.entries(data.planDistribution).map(([name, value]) => ({ name, value }));
  const trendData = data.workspaceTrend.map((d) => ({ ...d, date: d.date.slice(5) }));
  const revenueData = data.revenueByPlan.map((r) => ({ name: r.plan, mrr: r.mrrInr, workspaces: r.count }));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>Enterprise Analytics</h1>
        <button className="ghost-btn" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </div>

      {/* Summary Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
        <StatCard label="MRR" value={fmt(data.mrrInr)} sub={`ARR: ${fmt(data.mrrInr * 12)}`} />
        <StatCard label="Total Workspaces" value={data.totalWorkspaces.toLocaleString()} />
        <StatCard label="Active Subscriptions" value={data.activeSubscriptions.toLocaleString()} />
        <StatCard label="Trial Workspaces" value={data.trialWorkspaces.toLocaleString()} />
        <StatCard label="New (30d)" value={`+${data.newWorkspaces30d}`} sub={`Churned: ${data.churned30d}`} />
        <StatCard label="AI Cost (30d)" value={fmt(data.totalAiCostInr)} />
        <StatCard label="Total Broadcasts" value={data.totalBroadcastsSent.toLocaleString()} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "1.5rem" }}>
        {/* Workspace Trend */}
        <section className="finance-panel">
          <h3 style={{ margin: "0 0 1rem", fontSize: "0.95rem", fontWeight: 700, color: "#122033" }}>New Workspaces (30d)</h3>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trendData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Area type="monotone" dataKey="count" stroke="#ef8354" fill="#fde8dc" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: "0.85rem" }}>
              No workspace signups in last 30 days
            </div>
          )}
        </section>

        {/* Plan Distribution Pie */}
        <section className="finance-panel">
          <h3 style={{ margin: "0 0 1rem", fontSize: "0.95rem", fontWeight: 700, color: "#122033" }}>Plan Distribution</h3>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, value }) => `${name} (${value})`} labelLine={false}>
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: "0.85rem" }}>
              No plan data available
            </div>
          )}
        </section>
      </div>

      {/* Revenue by Plan */}
      {revenueData.length > 0 && (
        <section className="finance-panel" style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ margin: "0 0 1rem", fontSize: "0.95rem", fontWeight: 700, color: "#122033" }}>MRR by Plan (Active Subscriptions)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={revenueData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="mrr" tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(v as number)} />
              <YAxis yAxisId="ws" orientation="right" tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value, name) => [name === "mrr" ? fmt(value as number) : value, name === "mrr" ? "MRR" : "Workspaces"]} />
              <Bar yAxisId="mrr" dataKey="mrr" fill="#ef8354" radius={[3, 3, 0, 0]} name="mrr" />
              <Bar yAxisId="ws" dataKey="workspaces" fill="#3b82f6" radius={[3, 3, 0, 0]} name="workspaces" />
              <Legend />
            </BarChart>
          </ResponsiveContainer>
        </section>
      )}

      {error && <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}

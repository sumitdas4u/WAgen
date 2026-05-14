import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { fetchReminderConfigs } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import type { DashboardModulePrefetchContext } from "../../../shared/dashboard/module-contracts";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { useReminderConfigsQuery } from "./queries";
import { ReminderCard } from "./components/ReminderCard";

const CARD_DEFS: Array<{ config_key: string; icon: string; label: string }> = [
  { config_key: "birthday", icon: "🎂", label: "Birthday" },
  { config_key: "anniversary", icon: "💍", label: "Anniversary" }
];

function ReminderOverviewPage() {
  const { token } = useAuth();
  const { data: configs, isLoading, error } = useReminderConfigsQuery(token ?? "");

  if (isLoading) {
    return <div style={{ padding: 24, color: "#64748b" }}>Loading reminders...</div>;
  }

  if (error) {
    return <div style={{ padding: 24, color: "#dc2626" }}>Failed to load reminders.</div>;
  }

  const cards = CARD_DEFS.map((def) => ({
    def,
    config: configs?.find((c) => c.config_key === def.config_key)
  })).filter((c): c is { def: (typeof CARD_DEFS)[0]; config: NonNullable<typeof c.config> } =>
    Boolean(c.config)
  );

  const customConfigs = configs?.filter((c) => c.reminder_type === "custom") ?? [];

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, color: "#122033", marginBottom: 4, letterSpacing: "-0.03em" }}>
        Reminders
      </h1>
      <p style={{ fontSize: 14, color: "#64748b", marginBottom: 24 }}>
        Capture dates from contacts and send birthday / anniversary campaigns automatically.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
        {cards.map(({ def, config }) => (
          <ReminderCard
            key={config.config_key}
            config={config}
            icon={def.icon}
            label={def.label}
          />
        ))}
        {customConfigs.map((config) => (
          <ReminderCard
            key={config.config_key}
            config={config}
            icon="📅"
            label={config.custom_label ?? config.config_key}
          />
        ))}
      </div>
    </div>
  );
}

const LazyCaptureDetail = lazy(() =>
  import("./[config_key]/capture").then((m) => ({ default: m.CapturePage }))
);
const LazyCampaignDetail = lazy(() =>
  import("./[config_key]/campaign").then((m) => ({ default: m.CampaignPage }))
);

function CaptureDetailPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading...</div>}>
      <LazyCaptureDetail />
    </Suspense>
  );
}

function CampaignDetailPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading...</div>}>
      <LazyCampaignDetail />
    </Suspense>
  );
}

export function Component() {
  return (
    <Routes>
      <Route index element={<ReminderOverviewPage />} />
      <Route path=":configKey/capture" element={<CaptureDetailPage />} />
      <Route path=":configKey/campaign" element={<CampaignDetailPage />} />
      <Route path="*" element={<Navigate to="/dashboard/reminder" replace />} />
    </Routes>
  );
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await queryClient.prefetchQuery({
    queryKey: dashboardQueryKeys.reminderConfigs,
    queryFn: () => fetchReminderConfigs(token).then((result) => result.configs)
  });
}

import { useLocation, useNavigate, useParams, useRoutes } from "react-router-dom";
import type { MessageTemplate, MetaBusinessStatus } from "../../../lib/api";
import type { DashboardModulePrefetchContext } from "../../../shared/dashboard/module-contracts";
import { useDashboardShell } from "../../../shared/dashboard/shell-context";
import { buildSettingsMetaStatusQueryOptions, useSettingsMetaStatusQuery } from "../settings/queries";
import { BroadcastsPage } from "./BroadcastsPage";
import { TemplateCreatePage } from "./TemplateCreatePage";
import { TemplateListPage } from "./TemplateListPage";
import { buildTemplatesQueryOptions, useTemplatesQuery } from "./queries";

// ─── Create / duplicate page wrapper ─────────────────────────────────────────

function TemplateCreateRoute({
  token,
  metaStatus
}: {
  token: string;
  metaStatus: MetaBusinessStatus | null;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id?: string }>();
  const templatesQuery = useTemplatesQuery(token);

  // Prefill can come from navigation state (duplicate action) or from URL :id
  const prefillFromState = (location.state as { prefill?: MessageTemplate } | null)?.prefill;
  const prefillFromId = id ? (templatesQuery.data ?? []).find((t) => t.id === id) : undefined;
  const prefill = prefillFromState ?? prefillFromId;

  return (
    <TemplateCreatePage
      token={token}
      metaStatus={metaStatus}
      prefill={prefill}
      onBack={() => navigate("/dashboard/templates")}
      onCreated={() => navigate("/dashboard/templates")}
    />
  );
}

// ─── Module component ─────────────────────────────────────────────────────────

export function Component() {
  const { token } = useDashboardShell();
  const location = useLocation();
  const navigate = useNavigate();
  const metaStatusQuery = useSettingsMetaStatusQuery(token);
  const metaStatus = metaStatusQuery.data ?? null;

  const element = useRoutes([
    {
      index: true,
      element: <TemplateListPage token={token} metaStatus={metaStatus} />
    },
    {
      path: "new",
      element: <TemplateCreateRoute token={token} metaStatus={metaStatus} />
    },
    {
      path: ":id",
      element: <TemplateCreateRoute token={token} metaStatus={metaStatus} />
    },
    {
      path: "broadcasts",
      element: <BroadcastsPage token={token} metaStatus={metaStatus} />
    }
  ]);

  const isBroadcastsRoute = location.pathname.includes("/dashboard/templates/broadcasts");

  return (
    <section className="clone-settings-view" style={{ fontFamily: "inherit" }}>
      <div style={{ display: "flex", gap: "10px", marginBottom: "18px" }}>
        <button
          type="button"
          onClick={() => navigate("/dashboard/templates")}
          style={{
            padding: "9px 14px",
            borderRadius: "999px",
            border: isBroadcastsRoute ? "1px solid #d1d5db" : "1px solid #86efac",
            background: isBroadcastsRoute ? "#fff" : "#f0fdf4",
            color: isBroadcastsRoute ? "#475569" : "#166534",
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          Templates
        </button>
        <button
          type="button"
          onClick={() => navigate("/dashboard/templates/broadcasts")}
          style={{
            padding: "9px 14px",
            borderRadius: "999px",
            border: isBroadcastsRoute ? "1px solid #86efac" : "1px solid #d1d5db",
            background: isBroadcastsRoute ? "#f0fdf4" : "#fff",
            color: isBroadcastsRoute ? "#166534" : "#475569",
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          Broadcasts
        </button>
      </div>
      {element}
    </section>
  );
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await Promise.all([
    queryClient.prefetchQuery(buildTemplatesQueryOptions(token)),
    queryClient.prefetchQuery(buildSettingsMetaStatusQueryOptions(token))
  ]);
}

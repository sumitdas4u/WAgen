import { useEffect } from "react";
import { useLocation, useNavigate, useParams, useRoutes } from "react-router-dom";
import type { MessageTemplate, MetaBusinessStatus } from "../../../lib/api";
import type { DashboardModulePrefetchContext } from "../../../shared/dashboard/module-contracts";
import { useDashboardShell } from "../../../shared/dashboard/shell-context";
import { buildSettingsMetaStatusQueryOptions, useSettingsMetaStatusQuery } from "../settings/queries";
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
      onBack={() => navigate("/dashboard/settings/templates")}
      onCreated={() => navigate("/dashboard/settings/templates")}
    />
  );
}

// ─── Module component ─────────────────────────────────────────────────────────

function LegacyTemplatesRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/dashboard/settings/templates", { replace: true });
  }, [navigate]);
  return null;
}

export function Component() {
  const { token } = useDashboardShell();
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
      element: <LegacyTemplatesRedirect />
    }
  ]);

  return (
    <section className="clone-settings-view" style={{ fontFamily: "inherit" }}>{element}</section>
  );
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await Promise.all([
    queryClient.prefetchQuery(buildTemplatesQueryOptions(token)),
    queryClient.prefetchQuery(buildSettingsMetaStatusQueryOptions(token))
  ]);
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { AgentProfilePayload, BusinessBasicsPayload } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import { AgentsTab } from "../../../pages/dashboard/tabs/agents-tab";
import type { DashboardModulePrefetchContext } from "../../../shared/dashboard/module-contracts";
import { useDashboardShell } from "../../../shared/dashboard/shell-context";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { saveAgentProfile, toggleAgentActive } from "./api";
import { buildAgentsQueryOptions, useAgentsQuery } from "./queries";

const DEFAULT_BUSINESS_BASICS: BusinessBasicsPayload = {
  companyName: "",
  whatDoYouSell: "",
  targetAudience: "",
  usp: "",
  objections: "",
  defaultCountry: "IN",
  defaultCurrency: "INR",
  greetingScript: "",
  availabilityScript: "",
  objectionHandlingScript: "",
  bookingScript: "",
  feedbackCollectionScript: "",
  complaintHandlingScript: "",
  supportEmail: "",
  aiDoRules: "",
  aiDontRules: "",
  escalationWhenToEscalate: "Escalate to a human when the question is outside known business info or customer asks.",
  escalationContactPerson: "",
  escalationPhoneNumber: "",
  escalationEmail: ""
};

function loadBusinessBasics(value: unknown): BusinessBasicsPayload {
  if (!value || typeof value !== "object") {
    return DEFAULT_BUSINESS_BASICS;
  }
  return {
    ...DEFAULT_BUSINESS_BASICS,
    ...(value as Partial<BusinessBasicsPayload>)
  };
}

export function Component() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { token, bootstrap, refetchBootstrap } = useDashboardShell();
  const agentsQuery = useAgentsQuery(token);
  const [selectedAgentProfileId, setSelectedAgentProfileId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState("");
  const [agentObjectiveType, setAgentObjectiveType] = useState<"lead" | "feedback" | "complaint" | "hybrid">("lead");
  const [agentTaskDescription, setAgentTaskDescription] = useState("");

  const sortedProfiles = useMemo(
    () =>
      [...(agentsQuery.data ?? [])].sort((a, b) => {
        if (a.isActive !== b.isActive) {
          return Number(b.isActive) - Number(a.isActive);
        }
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }),
    [agentsQuery.data]
  );

  const selectedAgentProfile = useMemo(
    () =>
      sortedProfiles.find((profile) => profile.id === selectedAgentProfileId) ??
      sortedProfiles[0] ??
      null,
    [selectedAgentProfileId, sortedProfiles]
  );

  useEffect(() => {
    if (!selectedAgentProfile) {
      setSelectedAgentProfileId(null);
      setAgentName("");
      setAgentObjectiveType("lead");
      setAgentTaskDescription("");
      return;
    }
    setSelectedAgentProfileId(selectedAgentProfile.id);
    setAgentName(selectedAgentProfile.name);
    setAgentObjectiveType(selectedAgentProfile.objectiveType);
    setAgentTaskDescription(selectedAgentProfile.taskDescription ?? "");
  }, [selectedAgentProfile?.id]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: AgentProfilePayload = {
        name: agentName.trim(),
        linkedNumber: selectedAgentProfile?.linkedNumber ?? "web",
        channelType: selectedAgentProfile?.channelType ?? "web",
        businessBasics: selectedAgentProfile?.businessBasics ?? loadBusinessBasics(user?.business_basics),
        personality: selectedAgentProfile?.personality ?? user?.personality ?? "friendly_warm",
        customPrompt: selectedAgentProfile?.customPrompt ?? user?.custom_personality_prompt ?? undefined,
        objectiveType: agentObjectiveType,
        taskDescription: agentTaskDescription.trim(),
        isActive: selectedAgentProfile?.isActive ?? true
      };
      return saveAgentProfile(token, selectedAgentProfile?.id ?? null, payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.agentsRoot });
    }
  });

  const toggleMutation = useMutation({
    mutationFn: () => toggleAgentActive(token, !Boolean(bootstrap?.userSummary.aiActive)),
    onSuccess: async () => {
      await refetchBootstrap();
    }
  });

  return (
    <AgentsTab
      busy={saveMutation.isPending || toggleMutation.isPending || agentsQuery.isFetching}
      selectedAgentProfile={selectedAgentProfile}
      agentActive={Boolean(bootstrap?.userSummary.aiActive)}
      agentName={agentName}
      agentObjectiveType={agentObjectiveType}
      agentTaskDescription={agentTaskDescription}
      onToggleAgentActive={() => {
        toggleMutation.mutate();
      }}
      onAgentNameChange={setAgentName}
      onAgentObjectiveTypeChange={setAgentObjectiveType}
      onAgentTaskDescriptionChange={setAgentTaskDescription}
      onSubmit={() => {
        saveMutation.mutate();
      }}
    />
  );
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await queryClient.prefetchQuery(buildAgentsQueryOptions(token));
}

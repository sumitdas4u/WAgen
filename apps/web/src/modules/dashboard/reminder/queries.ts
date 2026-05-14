import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteReminderConfig,
  fetchReminderConfigs,
  fetchReminderCampaignSteps,
  upsertReminderConfig,
  type ReminderConfig,
  type ReminderConfigWriteInput
} from "../../../lib/api";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";

export function useReminderConfigsQuery(token: string) {
  return useQuery({
    queryKey: dashboardQueryKeys.reminderConfigs,
    queryFn: () => fetchReminderConfigs(token).then((r) => r.configs),
    staleTime: 30_000
  });
}

export function useReminderStepsQuery(token: string, configKey: string) {
  return useQuery({
    queryKey: dashboardQueryKeys.reminderSteps(configKey),
    queryFn: () => fetchReminderCampaignSteps(token, configKey).then((r) => r.steps),
    staleTime: 30_000
  });
}

export function useUpsertReminderConfigMutation(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ configKey, input }: { configKey: string; input: ReminderConfigWriteInput }) =>
      upsertReminderConfig(token, configKey, input),
    onSuccess: ({ config, steps }, { configKey }) => {
      queryClient.setQueryData<ReminderConfig[]>(
        dashboardQueryKeys.reminderConfigs,
        (current) => {
          if (!current) return [config];
          const idx = current.findIndex((c) => c.config_key === config.config_key);
          return idx >= 0
            ? current.map((c, i) => (i === idx ? config : c))
            : [...current, config];
        }
      );
      queryClient.setQueryData(dashboardQueryKeys.reminderSteps(configKey), steps);
    }
  });
}

export function useDeleteReminderConfigMutation(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (configKey: string) => deleteReminderConfig(token, configKey),
    onSuccess: (_, configKey) => {
      queryClient.setQueryData<ReminderConfig[]>(
        dashboardQueryKeys.reminderConfigs,
        (current) => current?.filter((c) => c.config_key !== configKey)
      );
    }
  });
}

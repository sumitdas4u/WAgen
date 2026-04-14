import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { getTodayReport, getDailyReports, fetchNotifSettings, saveNotifSettings } from "./api";

export function useTodayReportQuery(token: string) {
  return useQuery({
    queryKey: dashboardQueryKeys.todayReport,
    queryFn: () => getTodayReport(token),
    staleTime: 5 * 60 * 1000
  });
}

export function useDailyReportsQuery(token: string) {
  return useQuery({
    queryKey: dashboardQueryKeys.dailyReports,
    queryFn: () => getDailyReports(token)
  });
}

export function useNotificationSettingsQuery(token: string) {
  return useQuery({
    queryKey: dashboardQueryKeys.notificationSettings,
    queryFn: () => fetchNotifSettings(token)
  });
}

export function useToggleNotificationMutation(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => saveNotifSettings(token, enabled),
    onSuccess: (data) => {
      queryClient.setQueryData(dashboardQueryKeys.notificationSettings, data);
    }
  });
}

import {
  fetchTodayReport,
  fetchDailyReports,
  getNotificationSettings,
  updateNotificationSettings
} from "../../../lib/api";

export function getTodayReport(token: string) {
  return fetchTodayReport(token);
}

export function getDailyReports(token: string) {
  return fetchDailyReports(token);
}

export function fetchNotifSettings(token: string) {
  return getNotificationSettings(token);
}

export function saveNotifSettings(token: string, dailyReportEnabled: boolean) {
  return updateNotificationSettings(token, dailyReportEnabled);
}

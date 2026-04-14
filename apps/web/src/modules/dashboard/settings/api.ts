import {
  completeMetaBusinessSignup,
  connectWhatsApp,
  deleteMyAccount,
  disconnectMetaBusiness,
  disconnectWhatsApp,
  fetchMetaBusinessProfile,
  fetchMetaBusinessConfig,
  fetchMetaBusinessConnections,
  fetchChannelDefaultReply,
  fetchMetaBusinessStatus,
  saveChannelDefaultReply,
  setMetaBusinessChannelEnabled,
  setWhatsAppChannelEnabled,
  setAgentActive,
  type CompleteMetaSignupPayload,
  updateMetaBusinessProfile,
  uploadMetaBusinessProfileLogo,
  getNotificationSettings,
  updateNotificationSettings
} from "../../../lib/api";

export function fetchSettingsMetaConfig(token: string) {
  return fetchMetaBusinessConfig(token);
}

export function fetchSettingsMetaStatus(token: string, forceRefresh = false) {
  return fetchMetaBusinessStatus(token, { forceRefresh });
}

export function fetchSettingsMetaConnections(token: string, forceRefresh = false) {
  return fetchMetaBusinessConnections(token, { forceRefresh });
}

export function fetchSettingsChannelDefaultReply(token: string, channel: "web" | "qr" | "api") {
  return fetchChannelDefaultReply(token, channel);
}

export function saveSettingsChannelDefaultReply(
  token: string,
  channel: "web" | "qr" | "api",
  payload: Parameters<typeof saveChannelDefaultReply>[2]
) {
  return saveChannelDefaultReply(token, channel, payload);
}

export function activateQrChannel(token: string, options?: { resetAuth?: boolean }) {
  return connectWhatsApp(token, options);
}

export function deactivateQrChannel(token: string) {
  return disconnectWhatsApp(token);
}

export function setQrChannelEnabled(token: string, enabled: boolean) {
  return setWhatsAppChannelEnabled(token, enabled);
}

export function completeMetaSignup(token: string, payload: CompleteMetaSignupPayload) {
  return completeMetaBusinessSignup(token, payload);
}

export function deactivateMetaChannel(token: string, connectionId?: string) {
  return disconnectMetaBusiness(token, { connectionId });
}

export function setApiChannelEnabled(token: string, enabled: boolean, connectionId?: string) {
  return setMetaBusinessChannelEnabled(token, { enabled, connectionId });
}

export function fetchSettingsMetaProfile(token: string, connectionId?: string) {
  return fetchMetaBusinessProfile(token, { connectionId });
}

export function saveSettingsMetaProfile(
  token: string,
  payload: Parameters<typeof updateMetaBusinessProfile>[1]
) {
  return updateMetaBusinessProfile(token, payload);
}

export function uploadSettingsMetaProfileLogo(token: string, file: File, connectionId?: string) {
  return uploadMetaBusinessProfileLogo(token, file, { connectionId });
}

export function toggleWebsiteAgent(token: string, active: boolean) {
  return setAgentActive(token, active);
}

export function deleteAccount(token: string) {
  return deleteMyAccount(token, { confirmText: "DELETE" });
}

export function fetchNotificationSettings(token: string) {
  return getNotificationSettings(token);
}

export function saveNotificationSettings(token: string, dailyReportEnabled: boolean) {
  return updateNotificationSettings(token, dailyReportEnabled);
}

import {
  completeMetaBusinessSignup,
  connectWhatsApp,
  deleteMyAccount,
  disconnectMetaBusiness,
  disconnectWhatsApp,
  fetchMetaBusinessConfig,
  fetchMetaBusinessStatus,
  setAgentActive,
  type CompleteMetaSignupPayload
} from "../../../lib/api";

export function fetchSettingsMetaConfig(token: string) {
  return fetchMetaBusinessConfig(token);
}

export function fetchSettingsMetaStatus(token: string, forceRefresh = false) {
  return fetchMetaBusinessStatus(token, { forceRefresh });
}

export function activateQrChannel(token: string) {
  return connectWhatsApp(token);
}

export function deactivateQrChannel(token: string) {
  return disconnectWhatsApp(token);
}

export function completeMetaSignup(token: string, payload: CompleteMetaSignupPayload) {
  return completeMetaBusinessSignup(token, payload);
}

export function deactivateMetaChannel(token: string, connectionId?: string) {
  return disconnectMetaBusiness(token, { connectionId });
}

export function toggleWebsiteAgent(token: string, active: boolean) {
  return setAgentActive(token, active);
}

export function deleteAccount(token: string) {
  return deleteMyAccount(token, { confirmText: "DELETE" });
}

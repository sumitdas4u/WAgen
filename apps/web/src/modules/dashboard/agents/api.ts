import {
  createAgentProfile,
  fetchAgentProfiles,
  setAgentActive,
  updateAgentProfile,
  type AgentProfile,
  type AgentProfilePayload
} from "../../../lib/api";

export async function fetchAgents(token: string): Promise<AgentProfile[]> {
  const response = await fetchAgentProfiles(token);
  return response.profiles;
}

export function saveAgentProfile(
  token: string,
  profileId: string | null,
  payload: AgentProfilePayload
) {
  return profileId ? updateAgentProfile(token, profileId, payload) : createAgentProfile(token, payload);
}

export function toggleAgentActive(token: string, active: boolean) {
  return setAgentActive(token, active);
}

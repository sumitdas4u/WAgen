import {
  fetchAgentProfiles,
  saveBusinessBasics,
  savePersonality,
  updateAgentProfile,
  type AgentProfile,
  type BusinessBasicsPayload,
  type User
} from "../../../../lib/api";

export function persistBusinessBasics(token: string, payload: BusinessBasicsPayload) {
  return saveBusinessBasics(token, payload);
}

export async function fetchPersonalityAgents(token: string): Promise<AgentProfile[]> {
  const response = await fetchAgentProfiles(token);
  return response.profiles;
}

export function persistPersonality(
  token: string,
  payload: { personality: User["personality"]; customPrompt?: string }
) {
  return savePersonality(token, payload);
}

export function syncAgentProfile(
  token: string,
  profile: AgentProfile,
  payload: {
    businessBasics: BusinessBasicsPayload;
    personality: User["personality"];
    customPrompt?: string;
  }
) {
  return updateAgentProfile(token, profile.id, {
    name: profile.name,
    channelType: profile.channelType,
    linkedNumber: profile.linkedNumber,
    businessBasics: payload.businessBasics,
    personality: payload.personality,
    customPrompt: payload.customPrompt,
    objectiveType: profile.objectiveType,
    taskDescription: profile.taskDescription,
    isActive: profile.isActive
  });
}

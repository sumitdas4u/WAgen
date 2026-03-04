import { pool } from "../db/pool.js";
import type { AgentChannelType, AgentObjectiveType, PersonalityOption } from "../types/models.js";

export type ChannelType = AgentChannelType;

export interface AgentProfileRecord {
  id: string;
  userId: string;
  name: string;
  channelType: AgentChannelType;
  linkedNumber: string;
  businessBasics: Record<string, unknown>;
  personality: PersonalityOption;
  customPrompt: string | null;
  objectiveType: AgentObjectiveType;
  taskDescription: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type AgentProfileRow = {
  id: string;
  user_id: string;
  name: string;
  channel_type: AgentChannelType;
  linked_number: string;
  business_basics: Record<string, unknown>;
  personality: PersonalityOption;
  custom_personality_prompt: string | null;
  objective_type: AgentObjectiveType;
  task_description: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function mapRow(row: AgentProfileRow): AgentProfileRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    channelType: row.channel_type,
    linkedNumber: row.linked_number,
    businessBasics: row.business_basics,
    personality: row.personality,
    customPrompt: row.custom_personality_prompt,
    objectiveType: row.objective_type,
    taskDescription: row.task_description,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function normalizeLinkedNumber(raw: string, channelType: AgentChannelType): string {
  if (channelType === "web") {
    return "web";
  }

  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    throw new Error("Linked number must contain 8 to 15 digits.");
  }
  return digits;
}

async function deactivateOtherProfiles(
  userId: string,
  keepId?: string
): Promise<void> {
  await pool.query(
    `UPDATE agent_profiles
     SET is_active = FALSE
     WHERE user_id = $1
       AND is_active = TRUE
       AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [userId, keepId ?? null]
  );
}

export async function listAgentProfiles(userId: string): Promise<AgentProfileRecord[]> {
  const result = await pool.query<AgentProfileRow>(
    `SELECT id,
            user_id,
            name,
            channel_type,
            linked_number,
            business_basics,
            personality,
            custom_personality_prompt,
            objective_type,
            task_description,
            is_active,
            created_at::text,
            updated_at::text
     FROM agent_profiles
     WHERE user_id = $1
     ORDER BY is_active DESC, updated_at DESC`,
    [userId]
  );

  return result.rows.map(mapRow);
}

export async function createAgentProfile(
  userId: string,
  payload: {
    name: string;
    channelType: AgentChannelType;
    linkedNumber: string;
    businessBasics: Record<string, unknown>;
    personality: PersonalityOption;
    customPrompt?: string;
    objectiveType: AgentObjectiveType;
    taskDescription?: string;
    isActive?: boolean;
  }
): Promise<AgentProfileRecord> {
  const linkedNumber = normalizeLinkedNumber(payload.linkedNumber, payload.channelType);
  const isActive = payload.isActive ?? true;
  if (isActive) {
    await deactivateOtherProfiles(userId);
  }

  const result = await pool.query<AgentProfileRow>(
    `INSERT INTO agent_profiles (
       user_id,
       name,
       channel_type,
       linked_number,
       business_basics,
       personality,
       custom_personality_prompt,
       objective_type,
       task_description,
       is_active
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
     RETURNING id,
               user_id,
               name,
               channel_type,
               linked_number,
               business_basics,
               personality,
               custom_personality_prompt,
               objective_type,
               task_description,
               is_active,
               created_at::text,
               updated_at::text`,
    [
      userId,
      payload.name.trim(),
      payload.channelType,
      linkedNumber,
      JSON.stringify(payload.businessBasics ?? {}),
      payload.personality,
      payload.customPrompt?.trim() || null,
      payload.objectiveType,
      payload.taskDescription?.trim() || "",
      isActive
    ]
  );

  return mapRow(result.rows[0]);
}

export async function updateAgentProfile(
  userId: string,
  profileId: string,
  payload: {
    name: string;
    channelType: AgentChannelType;
    linkedNumber: string;
    businessBasics: Record<string, unknown>;
    personality: PersonalityOption;
    customPrompt?: string;
    objectiveType: AgentObjectiveType;
    taskDescription?: string;
    isActive?: boolean;
  }
): Promise<AgentProfileRecord | null> {
  const linkedNumber = normalizeLinkedNumber(payload.linkedNumber, payload.channelType);
  const isActive = payload.isActive ?? true;
  if (isActive) {
    await deactivateOtherProfiles(userId, profileId);
  }

  const result = await pool.query<AgentProfileRow>(
    `UPDATE agent_profiles
     SET name = $1,
         channel_type = $2,
         linked_number = $3,
         business_basics = $4::jsonb,
         personality = $5,
         custom_personality_prompt = $6,
         objective_type = $7,
         task_description = $8,
         is_active = $9
     WHERE id = $10
       AND user_id = $11
     RETURNING id,
               user_id,
               name,
               channel_type,
               linked_number,
               business_basics,
               personality,
               custom_personality_prompt,
               objective_type,
               task_description,
               is_active,
               created_at::text,
               updated_at::text`,
    [
      payload.name.trim(),
      payload.channelType,
      linkedNumber,
      JSON.stringify(payload.businessBasics ?? {}),
      payload.personality,
      payload.customPrompt?.trim() || null,
      payload.objectiveType,
      payload.taskDescription?.trim() || "",
      isActive,
      profileId,
      userId
    ]
  );

  if ((result.rowCount ?? 0) === 0) {
    return null;
  }
  return mapRow(result.rows[0]);
}

export async function deleteAgentProfile(userId: string, profileId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM agent_profiles
     WHERE id = $1
       AND user_id = $2`,
    [profileId, userId]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function resolveAgentProfileForChannel(
  userId: string,
  channelType: AgentChannelType,
  linkedNumber: string | null | undefined
): Promise<AgentProfileRecord | null> {
  let normalized: string | null = null;
  try {
    if (linkedNumber) {
      normalized = normalizeLinkedNumber(linkedNumber, channelType);
    }
  } catch {
    normalized = null;
  }

  const result = await pool.query<AgentProfileRow>(
    `SELECT id,
            user_id,
            name,
            channel_type,
            linked_number,
            business_basics,
            personality,
            custom_personality_prompt,
            objective_type,
            task_description,
            is_active,
            created_at::text,
            updated_at::text
     FROM agent_profiles
     WHERE user_id = $1
       AND is_active = TRUE
     ORDER BY CASE
         WHEN channel_type = $2 AND linked_number = $3 THEN 0
         WHEN channel_type = 'web' AND linked_number = 'web' THEN 1
         ELSE 2
       END,
       updated_at DESC
     LIMIT 1`,
    [userId, channelType, normalized ?? ""]
  );

  if ((result.rowCount ?? 0) === 0) {
    return null;
  }

  return mapRow(result.rows[0]);
}

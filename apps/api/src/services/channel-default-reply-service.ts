import { pool } from "../db/pool.js";
import type { AgentChannelType, User } from "../types/models.js";
import { getPublishedFlowsForUser, type FlowRow } from "./flow-service.js";
import { getUserById } from "./user-service.js";

export type ChannelDefaultReplyMode = "manual" | "flow" | "ai";

export interface ChannelDefaultReplyConfig {
  channel: AgentChannelType;
  mode: ChannelDefaultReplyMode;
  flowId: string | null;
  agentProfileId: string | null;
  invalidReplyLimit: number;
  source: "explicit" | "legacy_flow_ai" | "legacy_default_flow" | "default";
}

const DEFAULT_INVALID_REPLY_LIMIT = 2;

function normalizeInvalidReplyLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_INVALID_REPLY_LIMIT;
  }
  return Math.max(1, Math.min(2, Math.floor(parsed)));
}

function readSettingsRoot(basics: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const raw = basics?.channelDefaultReplySettings;
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function readChannelRecord(
  basics: Record<string, unknown> | null | undefined,
  channel: AgentChannelType
): Record<string, unknown> | null {
  const root = readSettingsRoot(basics);
  const raw = root[channel];
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

function normalizeExplicitConfig(params: {
  channel: AgentChannelType;
  raw: Record<string, unknown> | null;
}): ChannelDefaultReplyConfig | null {
  const { channel, raw } = params;
  if (!raw) {
    return null;
  }

  const mode = raw.mode;
  if (mode !== "manual" && mode !== "flow" && mode !== "ai") {
    return null;
  }

  const flowId = typeof raw.flowId === "string" && raw.flowId.trim() ? raw.flowId.trim() : null;
  const agentProfileId =
    typeof raw.agentProfileId === "string" && raw.agentProfileId.trim()
      ? raw.agentProfileId.trim()
      : null;

  return {
    channel,
    mode,
    flowId,
    agentProfileId,
    invalidReplyLimit: normalizeInvalidReplyLimit(raw.invalidReplyLimit),
    source: "explicit"
  };
}

function hasLegacyAiFallback(flow: FlowRow): boolean {
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  const startNode = nodes.find((node) => {
    if (!node || typeof node !== "object") {
      return false;
    }
    return (node as { type?: string }).type === "flowStart";
  }) as { data?: Record<string, unknown> } | undefined;

  return startNode?.data?.fallbackUseAi === true;
}

export async function resolveChannelDefaultReplyConfig(
  userId: string,
  channel: AgentChannelType,
  options?: { user?: User | null; publishedFlows?: FlowRow[] }
): Promise<ChannelDefaultReplyConfig> {
  const user = options?.user ?? (await getUserById(userId));
  const explicit = normalizeExplicitConfig({
    channel,
    raw: readChannelRecord((user?.business_basics as Record<string, unknown> | null | undefined) ?? null, channel)
  });
  if (explicit) {
    return explicit;
  }

  const flows = options?.publishedFlows ?? (await getPublishedFlowsForUser(userId, channel));
  const legacyAiFlow = flows.find(hasLegacyAiFallback);
  if (legacyAiFlow) {
    return {
      channel,
      mode: "ai",
      flowId: null,
      agentProfileId: null,
      invalidReplyLimit: DEFAULT_INVALID_REPLY_LIMIT,
      source: "legacy_flow_ai"
    };
  }

  const legacyDefaultReplyFlow = flows.find((flow) => flow.is_default_reply === true) ?? null;
  if (legacyDefaultReplyFlow) {
    return {
      channel,
      mode: "flow",
      flowId: legacyDefaultReplyFlow.id,
      agentProfileId: null,
      invalidReplyLimit: DEFAULT_INVALID_REPLY_LIMIT,
      source: "legacy_default_flow"
    };
  }

  return {
    channel,
    mode: "manual",
    flowId: null,
    agentProfileId: null,
    invalidReplyLimit: DEFAULT_INVALID_REPLY_LIMIT,
    source: "default"
  };
}

export async function saveChannelDefaultReplyConfig(
  userId: string,
  input: {
    channel: AgentChannelType;
    mode: ChannelDefaultReplyMode;
    flowId?: string | null;
    agentProfileId?: string | null;
    invalidReplyLimit?: number | null;
  }
): Promise<ChannelDefaultReplyConfig> {
  const user = await getUserById(userId);
  if (!user) {
    throw new Error("User not found.");
  }

  const currentBasics = (user.business_basics as Record<string, unknown> | null | undefined) ?? {};
  const currentRoot = readSettingsRoot(currentBasics);
  const nextRoot: Record<string, unknown> = {
    ...currentRoot,
    [input.channel]: {
      mode: input.mode,
      flowId: input.mode === "flow" ? input.flowId ?? null : null,
      agentProfileId: input.mode === "ai" ? input.agentProfileId ?? null : null,
      invalidReplyLimit: normalizeInvalidReplyLimit(input.invalidReplyLimit)
    }
  };

  await pool.query(
    `UPDATE users
     SET business_basics = $1::jsonb
     WHERE id = $2`,
    [
      JSON.stringify({
        ...currentBasics,
        channelDefaultReplySettings: nextRoot
      }),
      userId
    ]
  );

  return resolveChannelDefaultReplyConfig(userId, input.channel, {
    user: {
      ...user,
      business_basics: {
        ...currentBasics,
        channelDefaultReplySettings: nextRoot
      }
    }
  });
}

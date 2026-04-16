import { openAIService } from "../../openai-service.js";
import { deductTokens, AI_TOKEN_COSTS } from "../../ai-token-service.js";
import { getNextNodeId, interpolate } from "../helpers.js";
import type { FlowBlockModule, FlowVariables } from "../types.js";

interface AiAgentMapping {
  variableName: string;
  path: string;
}

function normalizeVariableName(value: unknown, fallback: string): string {
  const normalized = String(value ?? "")
    .replace(/\{\{|\}\}/g, "")
    .trim()
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || fallback;
}

function readMappings(value: unknown): AiAgentMapping[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const mapping = (item ?? {}) as {
        variableName?: unknown;
        path?: unknown;
      };
      return {
        variableName: normalizeVariableName(mapping.variableName, ""),
        path: String(mapping.path ?? "").trim()
      };
    })
    .filter((mapping) => mapping.variableName && mapping.path);
}

function tokenizePath(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
}

function getValueAtPath(input: unknown, path: string): unknown {
  if (!path.trim()) {
    return input;
  }

  let current: unknown = input;
  for (const token of tokenizePath(path)) {
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return null;
      }
      current = current[index];
      continue;
    }

    if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[token];
      continue;
    }

    return null;
  }

  return current;
}

function serializeVariableValue(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildMappedVariables(responseBody: unknown, mappings: AiAgentMapping[]): FlowVariables {
  const mapped: FlowVariables = {};

  for (const mapping of mappings) {
    mapped[mapping.variableName] = serializeVariableValue(
      getValueAtPath(responseBody, mapping.path)
    );
  }

  return mapped;
}

export const aiAgentBlock: FlowBlockModule = {
  type: "aiAgent",
  async execute(context) {
    const instructions = String(context.node.data.instructions ?? "").trim();
    const inputTemplate = interpolate(String(context.node.data.inputTemplate ?? ""), context.vars).trim();
    const outputMode = String(context.node.data.outputMode ?? "text").trim().toLowerCase() === "json"
      ? "json"
      : "text";
    const saveAs = normalizeVariableName(context.node.data.saveAs, "ai_agent_result");
    const responseMappings = readMappings(context.node.data.responseMappings);

    const fail = (message: string, extra?: FlowVariables) => ({
      signal: "continue" as const,
      nextNodeId: getNextNodeId(context.nodes, context.edges, context.node.id, "fail"),
      variables: {
        ...context.vars,
        [saveAs]: "",
        [`${saveAs}_ok`]: false,
        [`${saveAs}_status`]: "failed",
        [`${saveAs}_error`]: message,
        ...(extra ?? {})
      }
    });

    if (!openAIService.isConfigured()) {
      return fail("OPENAI_API_KEY is not configured.");
    }
    if (!instructions) {
      return fail("AI Agent instructions are required.");
    }

    try {
      if (outputMode === "json") {
        const json = await openAIService.generateJson(
          [
            "You are a flow automation AI agent.",
            "Return only valid JSON.",
            "Do not wrap the JSON in markdown fences.",
            instructions
          ].join("\n\n"),
          inputTemplate || "No input provided."
        );
        if (context.userId) {
          void deductTokens(context.userId, "ai_agent_flow", AI_TOKEN_COSTS.ai_agent_flow);
        }

        return {
          signal: "continue",
          nextNodeId: getNextNodeId(context.nodes, context.edges, context.node.id, "success"),
          variables: {
            ...context.vars,
            [saveAs]: JSON.stringify(json),
            [`${saveAs}_ok`]: true,
            [`${saveAs}_status`]: "completed",
            [`${saveAs}_error`]: "",
            [`${saveAs}_payload`]: json,
            ...buildMappedVariables(json, responseMappings)
          }
        };
      }

      const reply = await openAIService.generateReply(
        [
          "You are a flow automation AI agent.",
          "Process the provided input and return the final result only.",
          instructions
        ].join("\n\n"),
        inputTemplate || "No input provided."
      );
      if (context.userId) {
        void deductTokens(context.userId, "ai_agent_flow", AI_TOKEN_COSTS.ai_agent_flow);
      }

      return {
        signal: "continue",
        nextNodeId: getNextNodeId(context.nodes, context.edges, context.node.id, "success"),
        variables: {
          ...context.vars,
          [saveAs]: reply.content,
          [`${saveAs}_ok`]: true,
          [`${saveAs}_status`]: "completed",
          [`${saveAs}_error`]: "",
          [`${saveAs}_payload`]: reply.content,
          [`${saveAs}_model`]: reply.model
        }
      };
    } catch (error) {
      return fail((error as Error).message);
    }
  }
};

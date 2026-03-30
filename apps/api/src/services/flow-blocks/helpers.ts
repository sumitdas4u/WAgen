import type {
  FlowButtonOption,
  FlowListSection,
  FlowListRow,
  FlowMessagePayload
} from "../outbound-message-types.js";
import { summarizeFlowMessage } from "../outbound-message-types.js";
import type { FlowEdge, FlowNode, FlowVariables } from "./types.js";

export interface FlowChoiceOption {
  id: string;
  label: string;
  aliases?: string[];
}

function normalizeTextValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function getNextNode(
  nodes: FlowNode[],
  edges: FlowEdge[],
  sourceId: string,
  handleId?: string | null
): FlowNode | null {
  const edge = edges.find(
    (candidate) =>
      candidate.source === sourceId &&
      (handleId == null ||
        candidate.sourceHandle === handleId ||
        candidate.sourceHandle == null)
  );
  if (!edge) {
    return null;
  }
  return nodes.find((candidate) => candidate.id === edge.target) ?? null;
}

export function getNextNodeId(
  nodes: FlowNode[],
  edges: FlowEdge[],
  sourceId: string,
  handleId?: string | null
): string | null {
  return getNextNode(nodes, edges, sourceId, handleId)?.id ?? null;
}

export function getDefaultNextNodeId(
  nodes: FlowNode[],
  edges: FlowEdge[],
  sourceId: string
): string | null {
  return (
    getNextNodeId(nodes, edges, sourceId, "out") ??
    getNextNodeId(nodes, edges, sourceId)
  );
}

export function interpolate(value: string, vars: FlowVariables): string {
  return value.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ""));
}

export function asText(value: unknown): string {
  return String(value ?? "").trim();
}

export function joinTextParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function summarizeAsText(payload: FlowMessagePayload): string {
  return summarizeFlowMessage(payload);
}

export function buildButtonOptions(
  value: unknown,
  vars: FlowVariables
): FlowButtonOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((rawButton) => {
      const button = (rawButton ?? {}) as { id?: unknown; label?: unknown };
      return {
        id: asText(button.id),
        label: interpolate(String(button.label ?? ""), vars).trim()
      };
    })
    .filter((button) => button.id && button.label);
}

export function buildListSections(
  value: unknown,
  vars: FlowVariables
): FlowListSection[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((rawSection) => {
      const section = (rawSection ?? {}) as {
        title?: unknown;
        rows?: Array<{ id?: unknown; title?: unknown; description?: unknown }>;
      };
      const rows: FlowListRow[] = Array.isArray(section.rows)
        ? section.rows
            .map((rawRow) => ({
              id: asText(rawRow.id),
              title: interpolate(String(rawRow.title ?? ""), vars).trim(),
              description: interpolate(String(rawRow.description ?? ""), vars).trim()
            }))
            .filter((row) => row.id && row.title)
        : [];

      return {
        title: interpolate(String(section.title ?? ""), vars).trim(),
        rows
      };
    })
    .filter((section) => section.rows.length > 0);
}

export function flattenListChoices(sections: FlowListSection[]): FlowChoiceOption[] {
  return sections.flatMap((section) =>
    section.rows.map((row) => ({
      id: row.id,
      label: row.title,
      aliases: [row.description ?? "", section.title]
    }))
  );
}

export function buildChoicePrompt(options: FlowChoiceOption[]): string {
  return options
    .map((option, index) => `${index + 1}. ${option.label}`)
    .join("\n");
}

export function matchChoiceByMessage(
  message: string,
  options: FlowChoiceOption[]
): FlowChoiceOption | null {
  const normalizedMessage = normalizeTextValue(message);
  if (!normalizedMessage) {
    return null;
  }

  const numericPrefixMatch = normalizedMessage.match(/^(\d+)(?:$|[\s\)\].,:-]+.*$)/);
  if (numericPrefixMatch) {
    const index = Number(numericPrefixMatch[1]) - 1;
    if (index >= 0 && index < options.length) {
      return options[index];
    }
  }

  const tokenize = (option: FlowChoiceOption): string[] =>
    [option.id, option.label, ...(option.aliases ?? [])]
      .map(normalizeTextValue)
      .filter(Boolean);

  for (const option of options) {
    const tokens = tokenize(option);
    if (tokens.some((token) => token === normalizedMessage)) {
      return option;
    }
  }

  for (const option of options) {
    const tokens = tokenize(option);
    if (
      tokens.some(
        (token) =>
          token.length > 1 &&
          (normalizedMessage.includes(token) || token.includes(normalizedMessage))
      )
    ) {
      return option;
    }
  }

  return null;
}

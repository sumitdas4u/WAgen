import { z } from "zod";
import { openAIService } from "./openai-service.js";

export type FlowChannel = "web" | "qr" | "api";
export type FlowTriggerType =
  | "keyword"
  | "any_message"
  | "template_reply"
  | "qr_start"
  | "website_start";

export interface FlowDraftTrigger {
  id: string;
  type: FlowTriggerType;
  value: string;
}

export interface FlowDraftNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface FlowDraftEdge {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
}

export interface GenerateFlowDraftRequest {
  prompt: string;
  channel: FlowChannel;
}

export interface GenerateFlowDraftResponse {
  name: string;
  channel: FlowChannel;
  nodes: FlowDraftNode[];
  edges: FlowDraftEdge[];
  triggers: FlowDraftTrigger[];
  warnings: string[];
}

const ALLOWED_NODE_TYPES = [
  "flowStart",
  "sendText",
  "askQuestion",
  "condition",
  "requestIntervention",
  "apiRequest"
] as const;

const SUPPORTED_BY_CHANNEL: Record<(typeof ALLOWED_NODE_TYPES)[number], FlowChannel[]> = {
  flowStart: ["web", "qr", "api"],
  sendText: ["web", "qr", "api"],
  askQuestion: ["web", "qr", "api"],
  condition: ["web", "qr", "api"],
  requestIntervention: ["web", "qr", "api"],
  apiRequest: ["web", "qr", "api"]
};

const flowTriggerSchema = z.object({
  type: z.enum(["keyword", "any_message", "template_reply", "qr_start", "website_start"]),
  value: z.string().default("")
});

const baseNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(ALLOWED_NODE_TYPES),
  data: z.record(z.unknown())
});

const edgeSchema = z.object({
  source: z.string().min(1),
  sourceHandle: z.string().optional(),
  target: z.string().min(1)
});

const aiDraftSchema = z.object({
  name: z.string().optional(),
  triggers: z.array(flowTriggerSchema).optional(),
  nodes: z.array(baseNodeSchema),
  edges: z.array(edgeSchema)
});

const PLACEHOLDER_PATTERN = /\{\{[A-Za-z_]\w*\}\}/;

function makeId(prefix: string) {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${suffix}`;
}

function normalizeText(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeVariableName(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value : fallback;
  const cleaned = raw
    .replace(/[{}]/g, "")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!cleaned) {
    return fallback;
  }
  const normalized = /^[A-Za-z_]/.test(cleaned) ? cleaned : `var_${cleaned}`;
  return normalized.toLowerCase();
}

function normalizeHandleForNode(nodeType: string, handle: unknown): string | undefined {
  if (typeof handle !== "string" || !handle.trim()) {
    return undefined;
  }
  const trimmed = handle.trim();
  if (nodeType === "condition") {
    return trimmed === "false" ? "false" : "true";
  }
  if (nodeType === "apiRequest") {
    return trimmed === "fail" ? "fail" : "success";
  }
  return trimmed;
}

function hasExternalIntegrationIntent(prompt: string): boolean {
  return /\b(api|webhook|http|https|integration|crm|erp|post to|send to|external)\b/i.test(prompt);
}

function isPromptVague(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (trimmed.length < 16) {
    return true;
  }
  return /\b(flow|draft|bot|automation)\b/i.test(trimmed) && trimmed.split(/\s+/).length < 5;
}

function makeMinimalDraft(channel: FlowChannel, prompt: string): GenerateFlowDraftResponse {
  const startId = makeId("start");
  const welcomeId = makeId("send");
  const collectId = makeId("ask");
  const thanksId = makeId("done");
  const normalizedPrompt = prompt.trim();
  const name =
    normalizedPrompt.length > 0
      ? `${normalizedPrompt.replace(/\s+/g, " ").slice(0, 42)} Draft`
      : "AI Generated Flow Draft";

  return {
    name,
    channel,
    triggers: [
      {
        id: makeId("trigger"),
        type: channel === "web" ? "website_start" : channel === "qr" ? "qr_start" : "keyword",
        value: channel === "api" ? "{{trigger_keyword}}" : ""
      }
    ],
    nodes: [
      {
        id: startId,
        type: "flowStart",
        position: { x: 80, y: 160 },
        data: {
          kind: "flowStart",
          label: "{{flow_label}}",
          triggers: [],
          welcomeMessage: "Hi from {{business_name}}. We would love your feedback about {{feedback_topic}}.",
          fallbackUseAi: false
        }
      },
      {
        id: welcomeId,
        type: "sendText",
        position: { x: 360, y: 160 },
        data: {
          kind: "sendText",
          text: "Please share your experience with {{feedback_topic}} in a few words."
        }
      },
      {
        id: collectId,
        type: "askQuestion",
        position: { x: 640, y: 160 },
        data: {
          kind: "askQuestion",
          question: "What feedback would you like to share about {{feedback_topic}}?",
          variableName: "customer_feedback",
          inputType: "text"
        }
      },
      {
        id: thanksId,
        type: "sendText",
        position: { x: 920, y: 160 },
        data: {
          kind: "sendText",
          text: "{{thank_you_message}}"
        }
      }
    ],
    edges: [
      { id: makeId("edge"), source: startId, sourceHandle: "out", target: welcomeId },
      { id: makeId("edge"), source: welcomeId, sourceHandle: "out", target: collectId },
      { id: makeId("edge"), source: collectId, sourceHandle: "out", target: thanksId }
    ],
    warnings: [
      "Used placeholder values for business-specific content.",
      "Prompt was vague, so a minimal scaffold was generated."
    ]
  };
}

function buildSystemPrompt(channel: FlowChannel, prompt: string) {
  return [
    "You generate a generic flow draft blueprint for a conversation automation builder.",
    "Return only valid JSON. Do not use markdown. Do not add commentary.",
    `Target channel: ${channel}.`,
    "Use only these node types: flowStart, sendText, askQuestion, condition, requestIntervention, apiRequest.",
    "Do not use menu, catalog, product-item, list, button menu, or commerce-specific assumptions unless the user explicitly asks for them.",
    "Prefer simple, safe flows with placeholders instead of guessing business facts.",
    "Use placeholders like {{business_name}}, {{feedback_topic}}, {{thank_you_message}}, {{handoff_contact}}, {{trigger_keyword}}.",
    "Every node must have id, type, and data.",
    "Return edges separately as { source, sourceHandle?, target }.",
    "flowStart nodes should have data with: kind, label, welcomeMessage, fallbackUseAi.",
    "sendText nodes should have data with: kind, text.",
    "askQuestion nodes should have data with: kind, question, variableName, inputType.",
    "condition nodes should have data with: kind, variable, operator, value.",
    "requestIntervention nodes should have data with: kind, message, teamId, timeout.",
    "apiRequest nodes should have data with: kind, method, url, headers, bodyMode, body, timeoutMs, saveResponseAs, responsePath, responseMappings.",
    "If external integration is not clearly requested, do not include apiRequest.",
    "Always include exactly one flowStart node.",
    "Keep the draft editable and generic."
  ].join("\n");
}

function buildUserPrompt(prompt: string) {
  return [
    "Generate a flow draft blueprint JSON with this shape:",
    "{",
    '  "name": "Flow name",',
    '  "triggers": [{ "type": "keyword|any_message|template_reply|qr_start|website_start", "value": "" }],',
    '  "nodes": [{ "id": "n1", "type": "flowStart|sendText|askQuestion|condition|requestIntervention|apiRequest", "data": {} }],',
    '  "edges": [{ "source": "n1", "sourceHandle": "out|true|false|success|fail", "target": "n2" }]',
    "}",
    "",
    `User request:\n${prompt.trim()}`
  ].join("\n");
}

function normalizeNodeData(
  type: (typeof ALLOWED_NODE_TYPES)[number],
  data: Record<string, unknown>,
  warnings: string[]
): Record<string, unknown> {
  switch (type) {
    case "flowStart":
      return {
        kind: "flowStart",
        label: normalizeText(data.label, "{{flow_label}}"),
        triggers: [],
        welcomeMessage: normalizeText(
          data.welcomeMessage,
          "Hi from {{business_name}}. How can we help you with {{feedback_topic}} today?"
        ),
        fallbackUseAi: data.fallbackUseAi === true
      };
    case "sendText":
      return {
        kind: "sendText",
        text: normalizeText(data.text, "{{thank_you_message}}")
      };
    case "askQuestion": {
      const inputType = ["text", "number", "email", "phone"].includes(String(data.inputType))
        ? String(data.inputType)
        : "text";
      return {
        kind: "askQuestion",
        question: normalizeText(
          data.question,
          "Please share more details about {{feedback_topic}}."
        ),
        variableName: normalizeVariableName(data.variableName, "customer_response"),
        inputType
      };
    }
    case "condition": {
      const operator = [
        "equals",
        "not_equals",
        "contains",
        "greater",
        "less",
        "exists",
        "not_exists"
      ].includes(String(data.operator))
        ? String(data.operator)
        : "contains";
      return {
        kind: "condition",
        variable: normalizeText(data.variable, "{{customer_response}}"),
        operator,
        value: normalizeText(data.value, "{{escalation_keyword}}")
      };
    }
    case "requestIntervention":
      return {
        kind: "requestIntervention",
        message: normalizeText(
          data.message,
          "A team member from {{business_name}} will follow up with you shortly."
        ),
        teamId: normalizeText(data.teamId, "{{handoff_contact}}"),
        timeout: Math.max(30, Number(data.timeout) || 300)
      };
    case "apiRequest":
      warnings.push("External integration was included. Review API details before publishing.");
      return {
        kind: "apiRequest",
        method: ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(String(data.method).toUpperCase())
          ? String(data.method).toUpperCase()
          : "POST",
        url: normalizeText(data.url, "https://api.example.com/{{integration_path}}"),
        headers: Array.isArray(data.headers) ? data.headers : [],
        bodyMode: ["none", "json", "text"].includes(String(data.bodyMode)) ? String(data.bodyMode) : "json",
        body: normalizeText(data.body, "{\"feedback\":\"{{customer_feedback}}\"}"),
        timeoutMs: normalizeText(data.timeoutMs, "15000"),
        saveResponseAs: normalizeVariableName(data.saveResponseAs, "api_response"),
        responsePath: normalizeText(data.responsePath, ""),
        responseMappings: Array.isArray(data.responseMappings) ? data.responseMappings : []
      };
  }
}

function layoutNodes(
  nodes: Array<{ id: string; type: (typeof ALLOWED_NODE_TYPES)[number]; data: Record<string, unknown> }>,
  edges: FlowDraftEdge[]
): FlowDraftNode[] {
  const incomingCounts = new Map<string, number>();
  const childrenBySource = new Map<string, FlowDraftEdge[]>();
  for (const edge of edges) {
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) ?? 0) + 1);
    const current = childrenBySource.get(edge.source) ?? [];
    current.push(edge);
    childrenBySource.set(edge.source, current);
  }

  const roots = nodes.filter((node) => (incomingCounts.get(node.id) ?? 0) === 0);
  const rootId = roots.find((node) => node.type === "flowStart")?.id ?? nodes[0]?.id;
  const levelByNode = new Map<string, number>();
  const laneByNode = new Map<string, number>();
  const queue = rootId ? [rootId] : [];
  levelByNode.set(rootId ?? "", 0);
  laneByNode.set(rootId ?? "", 0);
  const nextLaneForLevel = new Map<number, number>([[0, 0]]);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentLevel = levelByNode.get(currentId) ?? 0;
    const currentLane = laneByNode.get(currentId) ?? 0;
    const children = childrenBySource.get(currentId) ?? [];
    children.forEach((edge, index) => {
      const nextLevel = currentLevel + 1;
      const fallbackLane = currentLane + index;
      const lane = edge.sourceHandle === "false" || edge.sourceHandle === "fail"
        ? fallbackLane + 1
        : fallbackLane;
      if (!levelByNode.has(edge.target)) {
        levelByNode.set(edge.target, nextLevel);
        laneByNode.set(edge.target, lane);
        nextLaneForLevel.set(nextLevel, Math.max(nextLaneForLevel.get(nextLevel) ?? 0, lane));
        queue.push(edge.target);
      }
    });
  }

  return nodes.map((node, index) => {
    const level = levelByNode.get(node.id) ?? index;
    const lane = laneByNode.get(node.id) ?? 0;
    return {
      ...node,
      position: {
        x: 80 + level * 290,
        y: 120 + lane * 180
      }
    };
  });
}

function normalizeDraft(
  raw: unknown,
  channel: FlowChannel,
  prompt: string
): GenerateFlowDraftResponse {
  const parsed = aiDraftSchema.parse(raw);
  const warnings: string[] = ["Used placeholder values for business-specific content."];
  const integrationAllowed = hasExternalIntegrationIntent(prompt);
  const startNodeCount = parsed.nodes.filter((node) => node.type === "flowStart").length;
  if (startNodeCount !== 1) {
    throw new Error("Generated draft must contain exactly one flowStart node.");
  }

  const normalizedNodes = parsed.nodes
    .filter((node) => SUPPORTED_BY_CHANNEL[node.type].includes(channel))
    .filter((node) => integrationAllowed || node.type !== "apiRequest")
    .map((node) => ({
      id: node.id.trim(),
      type: node.type,
      data: normalizeNodeData(node.type, node.data, warnings)
    }));

  if (!integrationAllowed && parsed.nodes.some((node) => node.type === "apiRequest")) {
    warnings.push("External integration was omitted because the prompt did not clearly request one.");
  }

  const nodeIds = new Set(normalizedNodes.map((node) => node.id));
  const edgeIds = new Set<string>();
  const normalizedEdges = parsed.edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => {
      const sourceNode = normalizedNodes.find((node) => node.id === edge.source);
      const sourceHandle = sourceNode
        ? normalizeHandleForNode(sourceNode.type, edge.sourceHandle)
        : undefined;
      let edgeId = makeId("edge");
      while (edgeIds.has(edgeId)) {
        edgeId = makeId("edge");
      }
      edgeIds.add(edgeId);
      return {
        id: edgeId,
        source: edge.source,
        sourceHandle,
        target: edge.target
      };
    });

  const normalizedTriggers = (parsed.triggers ?? [])
    .filter((trigger) => {
      if (channel === "web") {
        return trigger.type !== "qr_start";
      }
      if (channel === "qr") {
        return trigger.type !== "website_start";
      }
      return true;
    })
    .map((trigger) => ({
      id: makeId("trigger"),
      type: trigger.type,
      value: normalizeText(trigger.value, "")
    }));

  if (normalizedTriggers.length === 0) {
    normalizedTriggers.push({
      id: makeId("trigger"),
      type: channel === "web" ? "website_start" : channel === "qr" ? "qr_start" : "keyword",
      value: channel === "api" ? "{{trigger_keyword}}" : ""
    });
    warnings.push("No valid trigger was generated, so a default trigger placeholder was added.");
  }

  const laidOutNodes = layoutNodes(normalizedNodes, normalizedEdges);
  const draft = {
    name: normalizeText(parsed.name, `${prompt.trim().slice(0, 40) || "AI Generated"} Draft`),
    channel,
    nodes: laidOutNodes,
    edges: normalizedEdges,
    triggers: normalizedTriggers,
    warnings
  };

  if (!draft.nodes.some((node) => {
    const values = Object.values(node.data);
    return values.some((value) => typeof value === "string" && PLACEHOLDER_PATTERN.test(value));
  })) {
    warnings.push("No placeholders were detected, so you should review business-specific copy before publishing.");
  }

  return draft;
}

export async function generateFlowDraft(
  input: GenerateFlowDraftRequest
): Promise<GenerateFlowDraftResponse> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new Error("Prompt is required.");
  }

  if (!openAIService.isConfigured() || isPromptVague(prompt)) {
    return makeMinimalDraft(input.channel, prompt);
  }

  try {
    const raw = await openAIService.generateJson(
      buildSystemPrompt(input.channel, prompt),
      buildUserPrompt(prompt)
    );
    return normalizeDraft(raw, input.channel, prompt);
  } catch (error) {
    console.warn(`[FlowDraftGenerator] Falling back to minimal draft: ${(error as Error).message}`);
    const fallback = makeMinimalDraft(input.channel, prompt);
    fallback.warnings.push("AI output could not be normalized, so a safe fallback draft was generated.");
    return fallback;
  }
}

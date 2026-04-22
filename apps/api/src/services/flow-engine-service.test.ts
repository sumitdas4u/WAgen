import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowRow, FlowSessionRow, FlowTrigger } from "./flow-service.js";
import type { FlowNode, FlowEdge, FlowBlockModule } from "./flow-blocks/types.js";

const mocks = vi.hoisted(() => {
  const state: {
    publishedFlows: FlowRow[];
    activeSession: FlowSessionRow | null;
    lastCompletedSession: FlowSessionRow | null;
    defaultReplyConfig: {
      channel: "api";
      mode: "ai";
      flowId: null;
      agentProfileId: null;
      invalidReplyLimit: number;
      source: "explicit";
    };
    flowLookup: Map<string, FlowRow>;
    inboundCount: number;
  } = {
    publishedFlows: [],
    activeSession: null,
    lastCompletedSession: null,
    defaultReplyConfig: {
      channel: "api",
      mode: "ai",
      flowId: null,
      agentProfileId: null,
      invalidReplyLimit: 2,
      source: "explicit"
    },
    flowLookup: new Map<string, FlowRow>(),
    inboundCount: 2
  };

  return {
    state,
    updateFlowSessionMock: vi.fn(),
    createFlowSessionMock: vi.fn(),
    setConversationManualAndPausedMock: vi.fn(),
    getContactByConversationIdMock: vi.fn(),
    poolQueryMock: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT * FROM flows WHERE id = $1 LIMIT 1")) {
        const flowId = String(params?.[0] ?? "");
        return { rows: state.flowLookup.has(flowId) ? [state.flowLookup.get(flowId)] : [] };
      }

      if (sql.includes("FROM conversation_messages")) {
        return { rows: [{ total: String(state.inboundCount) }] };
      }

      if (sql.includes("FROM conversations")) {
        return {
          rows: [
            {
              id: String(params?.[0] ?? "conv-1"),
              phone_number: "919999999999",
              stage: "",
              score: 0,
              channel_type: "api",
              user_id: "user-1"
            }
          ]
        };
      }

      throw new Error(`Unexpected pool.query: ${sql}`);
    })
  };
});

vi.mock("../db/pool.js", () => ({
  pool: {
    query: mocks.poolQueryMock
  }
}));

vi.mock("./conversation-service.js", () => ({
  setConversationManualAndPaused: mocks.setConversationManualAndPausedMock
}));

vi.mock("./contacts-service.js", () => ({
  getContactByConversationId: mocks.getContactByConversationIdMock
}));

vi.mock("./channel-default-reply-service.js", () => ({
  resolveChannelDefaultReplyConfig: vi.fn(async () => mocks.state.defaultReplyConfig)
}));

vi.mock("./flow-blocks/registry.js", () => {
  const flowStartBlock: FlowBlockModule = {
    type: "flowStart",
    async execute(context) {
      const routes = Array.isArray(context.node.data.routes) ? context.node.data.routes : [];
      const triggerId = String(context.vars.__flow_trigger_id ?? "");

      if (routes.length > 0) {
        const matchedRoute = routes.find(
          (route: { id: string; triggers?: Array<{ id?: string }> }) =>
            Array.isArray(route.triggers) && route.triggers.some((trigger) => trigger.id === triggerId)
        );
        const matchedHandle = matchedRoute ? matchedRoute.id : "default";
        const nextNodeId =
          context.edges.find((edge) => edge.source === context.node.id && edge.sourceHandle === matchedHandle)?.target ??
          null;
        return { signal: "continue", nextNodeId, variables: context.vars };
      }

      const nextNodeId =
        context.edges.find((edge) => edge.source === context.node.id && (edge.sourceHandle === "out" || edge.sourceHandle == null))?.target ??
        null;
      return { signal: "continue", nextNodeId, variables: context.vars };
    }
  };

  const sendTextBlock: FlowBlockModule = {
    type: "sendText",
    async execute(context) {
      const text = String(context.node.data.text ?? "").replace(/\{\{\s*name\s*\}\}/g, String(context.vars.name ?? ""));
      if (text.trim()) {
        await context.sendReply({ type: "text", text });
      }
      return { signal: "continue", nextNodeId: null, variables: context.vars };
    }
  };

  const askQuestionBlock: FlowBlockModule = {
    type: "askQuestion",
    async execute(context) {
      const text = String(context.node.data.question ?? "");
      if (text.trim()) {
        await context.sendReply({ type: "text", text });
      }
      return {
        signal: "wait",
        waitingFor: "message",
        waitingNodeId: context.node.id,
        variables: context.vars
      };
    },
    async resumeWait(context) {
      return {
        signal: "advance",
        nextHandleId: "out",
        variables: {
          ...context.vars,
          [String(context.node.data.variableName ?? "answer")]: context.message
        }
      };
    }
  };

  const registry = new Map<string, FlowBlockModule>([
    ["flowStart", flowStartBlock],
    ["sendText", sendTextBlock],
    ["askQuestion", askQuestionBlock]
  ]);

  return {
    getFlowBlockModule: (type: string) => registry.get(type) ?? null
  };
});

vi.mock("./flow-service.js", () => ({
  createFlowSession: mocks.createFlowSessionMock,
  getActiveFlowSession: vi.fn(async () => mocks.state.activeSession),
  getLastCompletedFlowSession: vi.fn(async () => mocks.state.lastCompletedSession),
  getPublishedFlowsForUser: vi.fn(async () => mocks.state.publishedFlows),
  updateFlowSession: mocks.updateFlowSessionMock
}));

import { handleFlowMessage } from "./flow-engine-service.js";

function makeFlow(params: {
  id: string;
  triggers?: FlowTrigger[];
  nodes?: FlowNode[];
  edges?: FlowEdge[];
  isDefaultReply?: boolean;
}): FlowRow {
  return {
    id: params.id,
    user_id: "user-1",
    name: params.id,
    channel: "api",
    connection_id: "conn-1",
    nodes: params.nodes ?? [],
    edges: params.edges ?? [],
    triggers: params.triggers ?? [],
    variables: {},
    published: true,
    is_default_reply: params.isDefaultReply ?? false,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString()
  };
}

function makeSimpleFlow(params: {
  id: string;
  triggers?: FlowTrigger[];
  replyText: string;
}): FlowRow {
  const startId = `${params.id}-start`;
  const sendId = `${params.id}-send`;
  return makeFlow({
    id: params.id,
    triggers: params.triggers,
    nodes: [
      { id: startId, type: "flowStart", data: { label: "Start", welcomeMessage: "", triggers: [], routes: [] } },
      { id: sendId, type: "sendText", data: { text: params.replyText } }
    ],
    edges: [{ id: `${params.id}-edge`, source: startId, sourceHandle: "out", target: sendId }]
  });
}

function makeRoutedFlow(params: {
  id: string;
  routeTrigger: FlowTrigger;
  matchedReply: string;
  defaultReply: string;
}): FlowRow {
  const startId = `${params.id}-start`;
  const matchedId = `${params.id}-matched`;
  const defaultId = `${params.id}-default`;
  return makeFlow({
    id: params.id,
    nodes: [
      {
        id: startId,
        type: "flowStart",
        data: {
          label: "Start",
          welcomeMessage: "",
          triggers: [],
          routes: [{ id: "route-orders", label: "Orders", triggers: [params.routeTrigger] }]
        }
      },
      { id: matchedId, type: "sendText", data: { text: params.matchedReply } },
      { id: defaultId, type: "sendText", data: { text: params.defaultReply } }
    ],
    edges: [
      { id: `${params.id}-matched-edge`, source: startId, sourceHandle: "route-orders", target: matchedId },
      { id: `${params.id}-default-edge`, source: startId, sourceHandle: "default", target: defaultId }
    ]
  });
}

describe("handleFlowMessage — AI fallback takeover", () => {
  beforeEach(() => {
    mocks.state.publishedFlows = [];
    mocks.state.activeSession = null;
    mocks.state.lastCompletedSession = null;
    mocks.state.defaultReplyConfig = {
      channel: "api",
      mode: "ai",
      flowId: null,
      agentProfileId: null,
      invalidReplyLimit: 2,
      source: "explicit"
    };
    mocks.state.flowLookup = new Map<string, FlowRow>();
    mocks.state.inboundCount = 2;
    mocks.updateFlowSessionMock.mockReset();
    mocks.createFlowSessionMock.mockReset();
    mocks.setConversationManualAndPausedMock.mockReset();
    mocks.getContactByConversationIdMock.mockReset();
    mocks.getContactByConversationIdMock.mockResolvedValue(null);
    mocks.createFlowSessionMock.mockImplementation(async (flowId: string, conversationId: string, variables: Record<string, unknown>) => ({
      id: `session-${flowId}`,
      flow_id: flowId,
      conversation_id: conversationId,
      current_node_id: null,
      status: "active",
      variables,
      waiting_for: null,
      waiting_node_id: null,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString()
    }));
  });

  it("re-enters a keyword flow from ai_mode and completes the old AI session", async () => {
    const oldFlow = makeSimpleFlow({ id: "old-ai-flow", replyText: "old" });
    const matchedFlow = makeSimpleFlow({
      id: "orders-flow",
      triggers: [{ id: "trigger-order", type: "keyword", value: "order" }],
      replyText: "Orders flow"
    });
    mocks.state.flowLookup.set(oldFlow.id, oldFlow);
    mocks.state.publishedFlows = [matchedFlow];
    mocks.state.activeSession = {
      id: "session-old",
      flow_id: oldFlow.id,
      conversation_id: "conv-1",
      current_node_id: oldFlow.nodes[0] ? (oldFlow.nodes[0] as FlowNode).id : null,
      status: "ai_mode",
      variables: {},
      waiting_for: null,
      waiting_node_id: null,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString()
    };

    const sent: string[] = [];
    const result = await handleFlowMessage({
      userId: "user-1",
      conversationId: "conv-1",
      channelType: "api",
      message: "I want to place an order",
      sendReply: async (payload) => {
        if (payload.type === "text") sent.push(payload.text);
      }
    });

    expect(result).toEqual({ result: "handled" });
    expect(mocks.updateFlowSessionMock).toHaveBeenCalledWith("session-old", {
      status: "completed",
      waiting_for: null,
      waiting_node_id: null
    });
    expect(mocks.createFlowSessionMock).toHaveBeenCalledWith(
      "orders-flow",
      "conv-1",
      expect.objectContaining({ __flow_trigger_id: "trigger-order" })
    );
    expect(sent).toContain("Orders flow");
  });

  it("keeps AI control when ai_mode has no specific trigger match", async () => {
    const oldFlow = makeSimpleFlow({ id: "old-ai-flow", replyText: "old" });
    const genericFlow = makeSimpleFlow({
      id: "generic-flow",
      triggers: [{ id: "trigger-any", type: "any_message", value: "" }],
      replyText: "Generic flow"
    });
    mocks.state.flowLookup.set(oldFlow.id, oldFlow);
    mocks.state.publishedFlows = [genericFlow];
    mocks.state.activeSession = {
      id: "session-old",
      flow_id: oldFlow.id,
      conversation_id: "conv-1",
      current_node_id: null,
      status: "ai_mode",
      variables: {},
      waiting_for: null,
      waiting_node_id: null,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString()
    };

    const result = await handleFlowMessage({
      userId: "user-1",
      conversationId: "conv-1",
      channelType: "api",
      message: "hello there",
      sendReply: async () => {}
    });

    expect(result).toEqual({ result: "use_ai" });
    expect(mocks.createFlowSessionMock).not.toHaveBeenCalled();
    expect(mocks.updateFlowSessionMock).not.toHaveBeenCalledWith(
      "session-old",
      expect.objectContaining({ status: "completed" })
    );
  });

  it("routes to the matched start-node route when ai_mode is interrupted by a keyword", async () => {
    const oldFlow = makeSimpleFlow({ id: "old-ai-flow", replyText: "old" });
    const routedFlow = makeRoutedFlow({
      id: "routed-flow",
      routeTrigger: { id: "route-trigger-order", type: "keyword", value: "order" },
      matchedReply: "Matched orders route",
      defaultReply: "Default route"
    });
    mocks.state.flowLookup.set(oldFlow.id, oldFlow);
    mocks.state.publishedFlows = [routedFlow];
    mocks.state.activeSession = {
      id: "session-old",
      flow_id: oldFlow.id,
      conversation_id: "conv-1",
      current_node_id: null,
      status: "ai_mode",
      variables: {},
      waiting_for: null,
      waiting_node_id: null,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString()
    };

    const sent: string[] = [];
    const result = await handleFlowMessage({
      userId: "user-1",
      conversationId: "conv-1",
      channelType: "api",
      message: "order status",
      sendReply: async (payload) => {
        if (payload.type === "text") sent.push(payload.text);
      }
    });

    expect(result).toEqual({ result: "handled" });
    expect(mocks.createFlowSessionMock).toHaveBeenCalledWith(
      "routed-flow",
      "conv-1",
      expect.objectContaining({ __flow_trigger_id: "route-trigger-order" })
    );
    expect(sent).toContain("Matched orders route");
    expect(sent).not.toContain("Default route");
  });

  it("does not take over a waiting session with a new keyword flow", async () => {
    const waitingFlow = makeFlow({
      id: "waiting-flow",
      nodes: [
        { id: "start", type: "flowStart", data: { label: "Start", welcomeMessage: "", triggers: [], routes: [] } },
        { id: "ask", type: "askQuestion", data: { question: "What is your name?", variableName: "name", inputType: "text" } },
        { id: "done", type: "sendText", data: { text: "Thanks {{name}}" } }
      ],
      edges: [
        { id: "edge-1", source: "start", sourceHandle: "out", target: "ask" },
        { id: "edge-2", source: "ask", sourceHandle: "out", target: "done" }
      ]
    });
    const keywordFlow = makeSimpleFlow({
      id: "orders-flow",
      triggers: [{ id: "trigger-order", type: "keyword", value: "order" }],
      replyText: "Orders flow"
    });
    mocks.state.flowLookup.set(waitingFlow.id, waitingFlow);
    mocks.state.publishedFlows = [keywordFlow];
    mocks.state.activeSession = {
      id: "session-waiting",
      flow_id: waitingFlow.id,
      conversation_id: "conv-1",
      current_node_id: "ask",
      status: "waiting",
      variables: {},
      waiting_for: "message",
      waiting_node_id: "ask",
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString()
    };

    const sent: string[] = [];
    const result = await handleFlowMessage({
      userId: "user-1",
      conversationId: "conv-1",
      channelType: "api",
      message: "order 123",
      sendReply: async (payload) => {
        if (payload.type === "text") sent.push(payload.text);
      }
    });

    expect(result).toEqual({ result: "handled" });
    expect(mocks.createFlowSessionMock).not.toHaveBeenCalled();
    expect(sent).toContain("Thanks order 123");
  });
});

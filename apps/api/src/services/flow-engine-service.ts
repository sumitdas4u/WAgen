import { pool } from "../db/pool.js";
import {
  formatFlowLocationValue,
  parseFlowLocationInput
} from "./flow-input-codec.js";
import { setConversationManualAndPaused } from "./conversation-service.js";
import { getContactByConversationId } from "./contacts-service.js";
import {
  buildButtonOptions,
  buildChoicePrompt,
  buildListSections,
  flattenListChoices,
  getNextNode,
  interpolate,
  matchChoiceByMessage
} from "./flow-blocks/helpers.js";
import { getFlowBlockModule } from "./flow-blocks/registry.js";
import {
  resolveFlowOutputChannel,
  type FlowChannelType,
  type FlowEdge,
  type FlowNode,
  type FlowOutputChannel,
  type FlowStepResult,
  type FlowVariables,
  type FlowWaitResumeResult,
  type SendReplyFn
} from "./flow-blocks/types.js";
import {
  createFlowSession,
  getActiveFlowSession,
  getLastCompletedFlowSession,
  getPublishedFlowsForUser,
  updateFlowSession,
  type FlowRow,
  type FlowSessionRow,
  type FlowTrigger
} from "./flow-service.js";
import { resolveChannelDefaultReplyConfig } from "./channel-default-reply-service.js";

export type FlowHandleResult =
  | { result: "handled" }
  | { result: "use_ai" }
  | { result: "use_default_reply" }
  | { result: "not_matched" }
  | { result: "failed" };

interface FlowExecutionOptions {
  userId?: string | null;
  channelType: FlowChannelType;
}

const MAX_STEPS = 20;
const FLOW_META_KEY = "__flow";
const __FLOW_TRIGGER_ID_KEY = "__flow_trigger_id";

interface ConversationVariableContextRow {
  id: string;
  phone_number: string;
  stage: string;
  score: number;
  channel_type: FlowChannelType | null;
}

function buildContactVariables(input: {
  contact: Awaited<ReturnType<typeof getContactByConversationId>>;
  conversation: ConversationVariableContextRow | null;
}): FlowVariables {
  const { contact, conversation } = input;
  const custom = Object.fromEntries(
    (contact?.custom_field_values ?? [])
      .filter((field) => field.field_name)
      .map((field) => [field.field_name, field.value ?? ""])
  );

  return {
    name: contact?.display_name ?? "",
    phone: contact?.phone_number ?? conversation?.phone_number ?? "",
    email: contact?.email ?? "",
    type: contact?.contact_type ?? "",
    tags: Array.isArray(contact?.tags) ? contact.tags.join(", ") : "",
    source: contact?.source_type ?? "",
    source_id: contact?.source_id ?? "",
    source_url: contact?.source_url ?? "",
    custom,
    contact: {
      id: contact?.id ?? "",
      name: contact?.display_name ?? "",
      phone: contact?.phone_number ?? conversation?.phone_number ?? "",
      email: contact?.email ?? "",
      type: contact?.contact_type ?? "",
      tags: contact?.tags ?? [],
      source: contact?.source_type ?? "",
      source_id: contact?.source_id ?? "",
      source_url: contact?.source_url ?? "",
      custom
    },
    conversation: {
      id: conversation?.id ?? "",
      phone: conversation?.phone_number ?? "",
      stage: conversation?.stage ?? "",
      score: conversation?.score ?? 0,
      channel: conversation?.channel_type ?? ""
    }
  };
}

async function buildConversationFlowVariables(params: {
  userId: string;
  conversationId: string;
}): Promise<FlowVariables> {
  const [contact, conversation] = await Promise.all([
    getContactByConversationId(params.userId, params.conversationId),
    pool
      .query<ConversationVariableContextRow>(
        `SELECT id, phone_number, stage, score, channel_type
         FROM conversations
         WHERE id = $1
         LIMIT 1`,
        [params.conversationId]
      )
      .then((result) => result.rows[0] ?? null)
  ]);

  return buildContactVariables({ contact, conversation });
}

function isFlowCompatibleWithChannel(
  flow: FlowRow,
  channelType: FlowChannelType
): boolean {
  return flow.channel === channelType;
}

async function markFlowSessionFailed(sessionId: string | null | undefined): Promise<void> {
  if (!sessionId) {
    return;
  }

  try {
    await updateFlowSession(sessionId, {
      status: "failed",
      waiting_for: null,
      waiting_node_id: null
    });
  } catch (error) {
    console.warn("[FlowEngine] Failed to mark session as failed:", error);
  }
}

function getFlowGraph(flow: FlowRow): {
  nodes: FlowNode[];
  edges: FlowEdge[];
  startNode: FlowNode | null;
} {
  const nodes = (Array.isArray(flow.nodes) ? flow.nodes : []) as FlowNode[];
  const edges = (Array.isArray(flow.edges) ? flow.edges : []) as FlowEdge[];
  return {
    nodes,
    edges,
    startNode: nodes.find((node) => node.type === "flowStart") ?? null
  };
}

function getEffectiveTriggers(flow: FlowRow): { id?: string; type: string; value: string }[] {
  const flowLevel = Array.isArray(flow.triggers) ? flow.triggers : [];
  const { nodes } = getFlowGraph(flow);
  const startNode = nodes.find((node) => node.type === "flowStart");

  const nodeTriggers = Array.isArray(startNode?.data?.triggers)
    ? (startNode.data.triggers as Array<{ id?: string; type: string; value: string }>)
    : [];

  const routeTriggers = Array.isArray(startNode?.data?.routes)
    ? (startNode.data.routes as Array<{ triggers?: Array<{ id?: string; type: string; value: string }> }>)
        .flatMap((route) => route.triggers ?? [])
    : [];

  const merged = [...flowLevel];
  for (const trigger of [...nodeTriggers, ...routeTriggers]) {
    if (
      !merged.some(
        (candidate) =>
          candidate.type === trigger.type && candidate.value === trigger.value
      )
    ) {
      merged.push({
        id: trigger.id ?? trigger.type,
        type: trigger.type as FlowTrigger["type"],
        value: trigger.value
      });
    }
  }

  return merged;
}

function readFlowMeta(vars: FlowVariables): {
  invalidReplyCounts: Record<string, number>;
} {
  const raw = vars[FLOW_META_KEY];
  if (!raw || typeof raw !== "object") {
    return { invalidReplyCounts: {} };
  }

  const record = raw as Record<string, unknown>;
  const source =
    record.invalidReplyCounts && typeof record.invalidReplyCounts === "object"
      ? (record.invalidReplyCounts as Record<string, unknown>)
      : {};

  return {
    invalidReplyCounts: Object.fromEntries(
      Object.entries(source).map(([key, value]) => [key, Math.max(0, Number(value) || 0)])
    )
  };
}

function writeFlowMeta(
  vars: FlowVariables,
  meta: { invalidReplyCounts: Record<string, number> }
): FlowVariables {
  return {
    ...vars,
    [FLOW_META_KEY]: meta
  };
}

function incrementInvalidReplyCount(vars: FlowVariables, nodeId: string): {
  attempts: number;
  variables: FlowVariables;
} {
  const meta = readFlowMeta(vars);
  const attempts = (meta.invalidReplyCounts[nodeId] ?? 0) + 1;
  return {
    attempts,
    variables: writeFlowMeta(vars, {
      invalidReplyCounts: {
        ...meta.invalidReplyCounts,
        [nodeId]: attempts
      }
    })
  };
}

function resetInvalidReplyCount(vars: FlowVariables, nodeId: string): FlowVariables {
  const meta = readFlowMeta(vars);
  if (!(nodeId in meta.invalidReplyCounts)) {
    return vars;
  }

  const nextCounts = { ...meta.invalidReplyCounts };
  delete nextCounts[nodeId];
  return writeFlowMeta(vars, {
    invalidReplyCounts: nextCounts
  });
}

function matchesTemplateReply(message: string, triggerValue: string): boolean {
  const normalizedMessage = message.toLowerCase().trim();
  const normalizedTrigger = triggerValue.trim().toLowerCase();
  if (!normalizedTrigger) {
    return false;
  }

  return (
    normalizedMessage === normalizedTrigger ||
    normalizedMessage.startsWith(`${normalizedTrigger} `) ||
    normalizedMessage.endsWith(` ${normalizedTrigger}`) ||
    normalizedMessage.includes(` ${normalizedTrigger} `)
  );
}

function matchesChannelStartTrigger(params: {
  channelType: FlowChannelType;
  isFirstInboundMessage: boolean;
  lowerMessage: string;
  trigger: { type: string; value: string };
}): boolean {
  const { channelType, isFirstInboundMessage, lowerMessage, trigger } = params;
  if (!isFirstInboundMessage) {
    return false;
  }

  if (trigger.type === "qr_start" && channelType !== "qr") {
    return false;
  }
  if (trigger.type === "website_start" && channelType !== "web") {
    return false;
  }

  const expected = trigger.value.trim().toLowerCase();
  if (!expected) {
    return true;
  }

  return lowerMessage.startsWith(expected);
}

function matchingFlow(params: {
  message: string;
  flows: FlowRow[];
  channelType: FlowChannelType;
  isFirstInboundMessage: boolean;
}): FlowRow | null {
  const { message, flows, channelType, isFirstInboundMessage } = params;
  const lower = message.toLowerCase().trim();

  const byKeyword = flows.find((flow) =>
    getEffectiveTriggers(flow).some(
      (trigger) =>
        trigger.type === "keyword" &&
        trigger.value &&
        lower.includes(trigger.value.toLowerCase())
    )
  );
  if (byKeyword) {
    return byKeyword;
  }

  const byTemplateReply = flows.find((flow) =>
    getEffectiveTriggers(flow).some(
      (trigger) =>
        trigger.type === "template_reply" &&
        matchesTemplateReply(message, trigger.value)
    )
  );
  if (byTemplateReply) {
    return byTemplateReply;
  }

  const byChannelStart = flows.find((flow) =>
    getEffectiveTriggers(flow).some(
      (trigger) =>
        (trigger.type === "qr_start" || trigger.type === "website_start") &&
        matchesChannelStartTrigger({
          channelType,
          isFirstInboundMessage,
          lowerMessage: lower,
          trigger
        })
    )
  );
  if (byChannelStart) {
    return byChannelStart;
  }

  const anyMessageFlow = flows.find((flow) =>
    getEffectiveTriggers(flow).some((trigger) => trigger.type === "any_message")
  );
  if (anyMessageFlow) {
    return anyMessageFlow;
  }

  return flows.find((flow) => getEffectiveTriggers(flow).length === 0) ?? null;
}

function findMatchedTrigger(params: {
  message: string;
  flows: FlowRow[];
  channelType: FlowChannelType;
  isFirstInboundMessage: boolean;
}): { flow: FlowRow; triggerId: string } | null {
  const { message, flows, channelType, isFirstInboundMessage } = params;
  const lower = message.toLowerCase().trim();

  for (const flow of flows) {
    const triggers = getEffectiveTriggers(flow);
    const matched = triggers.find(
      (t) => t.type === "keyword" && t.value && lower.includes(t.value.toLowerCase())
    );
    if (matched) return { flow, triggerId: matched.id ?? matched.type };
  }

  for (const flow of flows) {
    const triggers = getEffectiveTriggers(flow);
    const matched = triggers.find(
      (t) => t.type === "template_reply" && matchesTemplateReply(message, t.value)
    );
    if (matched) return { flow, triggerId: matched.id ?? matched.type };
  }

  for (const flow of flows) {
    const triggers = getEffectiveTriggers(flow);
    const matched = triggers.find(
      (t) =>
        (t.type === "qr_start" || t.type === "website_start") &&
        matchesChannelStartTrigger({
          channelType,
          isFirstInboundMessage,
          lowerMessage: lower,
          trigger: t
        })
    );
    if (matched) return { flow, triggerId: matched.id ?? matched.type };
  }

  for (const flow of flows) {
    const triggers = getEffectiveTriggers(flow);
    const matched = triggers.find((t) => t.type === "any_message");
    if (matched) return { flow, triggerId: matched.id ?? matched.type };
  }

  const fallback = flows.find((flow) => getEffectiveTriggers(flow).length === 0);
  return fallback ? { flow: fallback, triggerId: "" } : null;
}

function isSpecificTriggerMatch(matchResult: { flow: FlowRow; triggerId: string } | null): boolean {
  if (!matchResult || !matchResult.triggerId) {
    return false;
  }

  const matchedTrigger = getEffectiveTriggers(matchResult.flow).find(
    (trigger) => (trigger.id ?? trigger.type) === matchResult.triggerId
  );

  return (
    matchedTrigger?.type === "keyword" ||
    matchedTrigger?.type === "template_reply" ||
    matchedTrigger?.type === "qr_start" ||
    matchedTrigger?.type === "website_start"
  );
}

async function executeFlowNode(params: {
  node: FlowNode;
  nodes: FlowNode[];
  edges: FlowEdge[];
  vars: FlowVariables;
  sendReply: SendReplyFn;
  channel: FlowOutputChannel;
  userId?: string | null;
}): Promise<FlowStepResult> {
  const blockModule = getFlowBlockModule(params.node.type);
  if (!blockModule) {
    console.warn(`[FlowEngine] Unknown block type: ${params.node.type}`);
    return {
      signal: "end",
      variables: params.vars
    };
  }

  return blockModule.execute({
    node: params.node,
    nodes: params.nodes,
    edges: params.edges,
    vars: params.vars,
    sendReply: params.sendReply,
    channel: params.channel,
    userId: params.userId
  });
}

async function fallbackResumeWait(params: {
  session: FlowSessionRow;
  waitNode: FlowNode;
  message: string;
  sendReply: SendReplyFn;
  vars: FlowVariables;
}): Promise<FlowWaitResumeResult> {
  const { session, waitNode, message, sendReply, vars } = params;

  if (session.waiting_for === "button") {
    const choices =
      waitNode.type === "list"
        ? flattenListChoices(buildListSections(waitNode.data.sections, vars))
        : buildButtonOptions(waitNode.data.buttons, vars).map((button) => ({
            id: button.id,
            label: button.label
          }));

    const choice = matchChoiceByMessage(message, choices);
    if (!choice) {
      await sendReply({
        type: "text",
        text: `Please choose one of:\n${buildChoicePrompt(choices)}`
      });
      return {
        signal: "stay_waiting",
        variables: vars
      };
    }

    return {
      signal: "advance",
      nextHandleId: choice.id,
      variables: vars
    };
  }

  if (session.waiting_for === "message") {
    const variableName =
      String(waitNode.data.variableName ?? "answer").trim() || "answer";
    return {
      signal: "advance",
      nextHandleId: "out",
      variables: {
        ...vars,
        [variableName]: message
      }
    };
  }

  if (session.waiting_for === "location") {
    const variableName =
      String(waitNode.data.variableName ?? "location").trim() || "location";
    const location = parseFlowLocationInput(message);
    if (!location) {
      await sendReply({
        type: "text",
        text: "Please share your WhatsApp location so I can continue."
      });
      return {
        signal: "stay_waiting",
        variables: vars
      };
    }

    return {
      signal: "advance",
      nextHandleId: "out",
      variables: {
        ...vars,
        [variableName]: formatFlowLocationValue(location),
        [`${variableName}_latitude`]: location.latitude,
        [`${variableName}_longitude`]: location.longitude,
        ...(location.name ? { [`${variableName}_name`]: location.name } : {}),
        ...(location.address ? { [`${variableName}_address`]: location.address } : {}),
        ...(location.url ? { [`${variableName}_url`]: location.url } : {}),
        [`${variableName}_source`]: location.source ?? "native",
        [`${variableName}_payload`]: location
      }
    };
  }

  if (session.waiting_for === "payment") {
    return {
      signal: "advance",
      nextHandleId: message.toLowerCase().includes("paid") ? "success" : "fail",
      variables: vars
    };
  }

  return {
    signal: "stay_waiting",
    variables: vars
  };
}

async function runChain(
  startNode: FlowNode,
  nodes: FlowNode[],
  edges: FlowEdge[],
  session: FlowSessionRow,
  vars: FlowVariables,
  sendReply: SendReplyFn,
  options: FlowExecutionOptions
): Promise<FlowHandleResult> {
  let node: FlowNode | null = startNode;
  let currentVars = vars;
  let steps = 0;
  const channel = resolveFlowOutputChannel(options.channelType);

  while (node && steps < MAX_STEPS) {
    steps += 1;
    const result = await executeFlowNode({
      node,
      nodes,
      edges,
      vars: currentVars,
      sendReply,
      channel,
      userId: options.userId
    });
    currentVars = result.variables;

    if (result.signal === "wait") {
      await updateFlowSession(session.id, {
        current_node_id: node.id,
        variables: currentVars,
        status: "waiting",
        waiting_for: result.waitingFor ?? null,
        waiting_node_id: result.waitingNodeId ?? node.id
      });
      return { result: "handled" };
    }

    if (result.signal === "use_ai") {
      const mode = String(node.data.mode ?? "one_shot");
      if (mode === "ongoing") {
        await updateFlowSession(session.id, {
          current_node_id: node.id,
          variables: currentVars,
          status: "ai_mode",
          waiting_for: null,
          waiting_node_id: null
        });
      } else {
        await updateFlowSession(session.id, {
          current_node_id: node.id,
          variables: currentVars,
          status: "waiting",
          waiting_for: "ai_reply",
          waiting_node_id: result.afterAiNodeId ?? null
        });
      }
      return { result: "use_ai" };
    }

    if (result.signal === "end") {
      if (result.handoffToHuman && options.userId) {
        await setConversationManualAndPaused(options.userId, session.conversation_id);
      }
      await updateFlowSession(session.id, {
        status: "completed",
        variables: currentVars,
        waiting_for: null,
        waiting_node_id: null
      });
      return { result: "handled" };
    }

    if (!result.nextNodeId) {
      await updateFlowSession(session.id, {
        status: "completed",
        variables: currentVars,
        waiting_for: null,
        waiting_node_id: null
      });
      return { result: "handled" };
    }

    node = nodes.find((candidate) => candidate.id === result.nextNodeId) ?? null;
  }

  await updateFlowSession(session.id, {
    status: "completed",
    variables: currentVars
  });
  return { result: "handled" };
}

async function resumeWaiting(
  session: FlowSessionRow,
  nodes: FlowNode[],
  edges: FlowEdge[],
  message: string,
  sendReply: SendReplyFn,
  options: FlowExecutionOptions,
  invalidReplyLimit: number
): Promise<FlowHandleResult> {
  if (session.waiting_for === "ai_reply") {
    if (!session.waiting_node_id) {
      await updateFlowSession(session.id, { status: "completed" });
      return { result: "handled" };
    }

    const nextNode = nodes.find((node) => node.id === session.waiting_node_id);
    if (!nextNode) {
      await updateFlowSession(session.id, { status: "completed" });
      return { result: "handled" };
    }

    await updateFlowSession(session.id, {
      status: "active",
      waiting_for: null,
      waiting_node_id: null
    });
    return runChain(nextNode, nodes, edges, session, session.variables, sendReply, options);
  }

  const waitNode = nodes.find((node) => node.id === session.waiting_node_id);
  if (!waitNode) {
    await updateFlowSession(session.id, { status: "completed" });
    return { result: "handled" };
  }

  const blockModule = getFlowBlockModule(waitNode.type);
  const channel = resolveFlowOutputChannel(options.channelType);
  const resumeResult = blockModule?.resumeWait
    ? await blockModule.resumeWait({
        node: waitNode,
        nodes,
        edges,
        vars: session.variables,
        message,
        sendReply,
        channel,
        userId: options.userId
      })
    : await fallbackResumeWait({
        session,
        waitNode,
        message,
        sendReply,
        vars: session.variables
      });

  if (resumeResult.signal === "stay_waiting") {
    const invalidAttempt = incrementInvalidReplyCount(resumeResult.variables, waitNode.id);
    if (invalidAttempt.attempts >= invalidReplyLimit) {
      await updateFlowSession(session.id, {
        variables: invalidAttempt.variables,
        status: "completed",
        waiting_for: null,
        waiting_node_id: null
      });
      return { result: "use_default_reply" };
    }

    await updateFlowSession(session.id, {
      variables: invalidAttempt.variables,
      status: "waiting",
      waiting_for: session.waiting_for,
      waiting_node_id: session.waiting_node_id
    });
    return { result: "handled" };
  }

  const nextNode = resumeResult.nextHandleId
    ? getNextNode(nodes, edges, waitNode.id, resumeResult.nextHandleId)
    : null;

  if (!nextNode) {
    if (resumeResult.nextHandleId && session.waiting_for === "button") {
      console.warn(
        `[FlowEngine] Missing next edge for choice conversation=${session.conversation_id} node=${waitNode.id} handle=${resumeResult.nextHandleId}`
      );
      await sendReply({
        type: "text",
        text: "That option is not connected yet in the flow. Please choose another option."
      });
      await updateFlowSession(session.id, {
        variables: resumeResult.variables,
        status: "waiting",
        waiting_for: session.waiting_for,
        waiting_node_id: session.waiting_node_id
      });
      return { result: "handled" };
    }

    await updateFlowSession(session.id, {
      status: "completed",
      variables: resumeResult.variables,
      waiting_for: null,
      waiting_node_id: null
    });
    return { result: "handled" };
  }

  const advancedVariables = resetInvalidReplyCount(resumeResult.variables, waitNode.id);

  await updateFlowSession(session.id, {
    current_node_id: nextNode.id,
    variables: advancedVariables,
    status: "active",
    waiting_for: null,
    waiting_node_id: null
  });

  return runChain(
    nextNode,
    nodes,
    edges,
    { ...session, variables: advancedVariables },
    advancedVariables,
    sendReply,
    options
  );
}

async function isFirstInboundMessage(conversationId: string): Promise<boolean> {
  const result = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM conversation_messages
     WHERE conversation_id = $1
       AND direction = 'inbound'`,
    [conversationId]
  );

  return Number(result.rows[0]?.total ?? 0) <= 1;
}

async function loadConversationExecutionContext(conversationId: string): Promise<{
  userId: string | null;
  channelType: FlowChannelType;
}> {
  const result = await pool.query<{
    user_id: string;
    channel_type: FlowChannelType | null;
  }>(
    `SELECT user_id, channel_type
     FROM conversations
     WHERE id = $1
     LIMIT 1`,
    [conversationId]
  );

  return {
    userId: result.rows[0]?.user_id ?? null,
    channelType: result.rows[0]?.channel_type ?? "web"
  };
}

export async function advanceFlowAfterAiReply(
  conversationId: string,
  sendReply: SendReplyFn
): Promise<void> {
  let sessionId: string | null = null;

  try {
    const session = await getActiveFlowSession(conversationId);
    if (!session || session.waiting_for !== "ai_reply") {
      return;
    }
    sessionId = session.id;

    const flowResult = await pool.query<FlowRow>(
      "SELECT * FROM flows WHERE id = $1 LIMIT 1",
      [session.flow_id]
    );
    const flow = flowResult.rows[0];
    if (!flow) {
      return;
    }

    const { nodes, edges } = getFlowGraph(flow);
    if (!session.waiting_node_id) {
      await updateFlowSession(session.id, { status: "completed" });
      return;
    }

    const nextNode = nodes.find((node) => node.id === session.waiting_node_id);
    if (!nextNode) {
      await updateFlowSession(session.id, { status: "completed" });
      return;
    }

    const executionContext = await loadConversationExecutionContext(conversationId);
    await updateFlowSession(session.id, {
      status: "active",
      waiting_for: null,
      waiting_node_id: null
    });
    await runChain(nextNode, nodes, edges, session, session.variables, sendReply, {
      userId: executionContext.userId,
      channelType: executionContext.channelType
    });
  } catch (error) {
    await markFlowSessionFailed(sessionId);
    console.warn("[FlowEngine] advanceFlowAfterAiReply error:", error);
  }
}

export async function getActiveAiReplyContextNote(
  conversationId: string
): Promise<string> {
  const session = await getActiveFlowSession(conversationId);
  if (!session?.current_node_id) {
    return "";
  }

  const flowResult = await pool.query<FlowRow>(
    "SELECT * FROM flows WHERE id = $1 LIMIT 1",
    [session.flow_id]
  );
  const flow = flowResult.rows[0];
  if (!flow) {
    return "";
  }

  const { nodes } = getFlowGraph(flow);
  const currentNode = nodes.find((node) => node.id === session.current_node_id);
  if (!currentNode || currentNode.type !== "aiReply") {
    return "";
  }

  return interpolate(String(currentNode.data.contextNote ?? ""), session.variables).trim();
}

export async function startFlowForConversation(input: {
  userId: string;
  flowId: string;
  conversationId: string;
  sendReply: SendReplyFn;
}): Promise<FlowSessionRow> {
  const flowResult = await pool.query<FlowRow>(
    "SELECT * FROM flows WHERE id = $1 AND user_id = $2 LIMIT 1",
    [input.flowId, input.userId]
  );
  const flow = flowResult.rows[0];
  if (!flow) {
    throw new Error("Flow not found.");
  }

  const { nodes, edges, startNode } = getFlowGraph(flow);
  if (!startNode) {
    throw new Error("Flow start node is missing.");
  }

  await pool.query(
    `UPDATE flow_sessions
     SET status = 'completed'
     WHERE conversation_id = $1
       AND status IN ('active', 'waiting', 'ai_mode')`,
    [input.conversationId]
  );

  await pool.query(
    `UPDATE conversations
     SET manual_takeover = FALSE,
         ai_paused = FALSE
     WHERE id = $1
       AND user_id = $2`,
    [input.conversationId, input.userId]
  );

  const executionContext = await loadConversationExecutionContext(input.conversationId);
  if (!isFlowCompatibleWithChannel(flow, executionContext.channelType)) {
    throw new Error(
      `Flow channel "${flow.channel}" does not match conversation channel "${executionContext.channelType}".`
    );
  }

  const initialVars = await buildConversationFlowVariables({
    userId: input.userId,
    conversationId: input.conversationId
  });
  const session = await createFlowSession(flow.id, input.conversationId, initialVars);

  try {
    await runChain(startNode, nodes, edges, session, initialVars, input.sendReply, {
      userId: input.userId,
      channelType: executionContext.channelType
    });
    return session;
  } catch (error) {
    await updateFlowSession(session.id, { status: "failed" });
    throw error;
  }
}

export async function handleFlowMessage(input: {
  userId: string;
  conversationId: string;
  channelType: FlowChannelType;
  message: string;
  sendReply: SendReplyFn;
}): Promise<FlowHandleResult> {
  let sessionIdToFail: string | null = null;

  try {
    const { userId, conversationId, channelType, message, sendReply } = input;
    const flows = await getPublishedFlowsForUser(userId, channelType);
    const defaultReplyConfig = await resolveChannelDefaultReplyConfig(userId, channelType, {
      publishedFlows: flows
    });
    const selectedDefaultReplyFlow =
      defaultReplyConfig.mode === "flow" && defaultReplyConfig.flowId
        ? flows.find((flow) => flow.id === defaultReplyConfig.flowId) ?? null
        : null;
    const nonDefaultFlows = selectedDefaultReplyFlow
      ? flows.filter((flow) => flow.id !== selectedDefaultReplyFlow.id)
      : flows;
    const startMatchedFlow = async (matchedFlow: FlowRow, matchedTriggerId: string): Promise<FlowHandleResult> => {
      const { nodes, edges, startNode } = getFlowGraph(matchedFlow);
      if (!startNode) {
        return { result: "not_matched" };
      }

      const initialVars = {
        ...await buildConversationFlowVariables({ userId, conversationId }),
        [__FLOW_TRIGGER_ID_KEY]: matchedTriggerId
      };
      const session = await createFlowSession(matchedFlow.id, conversationId, initialVars);
      sessionIdToFail = session.id;

      try {
        return await runChain(startNode, nodes, edges, session, initialVars, sendReply, {
          userId,
          channelType
        });
      } catch (error) {
        await markFlowSessionFailed(session.id);
        console.warn(
          `[FlowEngine] New session failed conversation=${conversationId} session=${session.id}:`,
          error
        );
        return { result: "failed" };
      }
    };

    const existingSession = await getActiveFlowSession(conversationId);
    if (existingSession) {
      sessionIdToFail = existingSession.id;
      const flowResult = await pool.query<FlowRow>(
        "SELECT * FROM flows WHERE id = $1 LIMIT 1",
        [existingSession.flow_id]
      );
      const flow = flowResult.rows[0];
      if (!flow) {
        await markFlowSessionFailed(existingSession.id);
        return { result: "failed" };
      }

      if (!isFlowCompatibleWithChannel(flow, channelType)) {
        await markFlowSessionFailed(existingSession.id);
        return { result: "failed" };
      }

      const { nodes, edges, startNode } = getFlowGraph(flow);

      try {
        if (existingSession.status === "ai_mode") {
          const aiModeMatch = findMatchedTrigger({
            message,
            flows: nonDefaultFlows,
            channelType,
            isFirstInboundMessage: await isFirstInboundMessage(conversationId)
          });
          if (!aiModeMatch || !isSpecificTriggerMatch(aiModeMatch)) {
            return { result: "use_ai" };
          }

          await updateFlowSession(existingSession.id, {
            status: "completed",
            waiting_for: null,
            waiting_node_id: null
          });
          sessionIdToFail = null;
          return startMatchedFlow(aiModeMatch.flow, aiModeMatch.triggerId);
        }

        if (existingSession.status === "waiting" && existingSession.waiting_node_id) {
          return await resumeWaiting(existingSession, nodes, edges, message, sendReply, {
            userId,
            channelType
          }, defaultReplyConfig.invalidReplyLimit);
        }

        const currentNode =
          (existingSession.current_node_id
            ? nodes.find((node) => node.id === existingSession.current_node_id)
            : null) ?? startNode;

        if (!currentNode) {
          await updateFlowSession(existingSession.id, { status: "completed" });
          return { result: "not_matched" };
        }

        return await runChain(
          currentNode,
          nodes,
          edges,
          existingSession,
          existingSession.variables,
          sendReply,
          {
            userId,
            channelType
          }
        );
      } catch (error) {
        await markFlowSessionFailed(existingSession.id);
        console.warn(
          `[FlowEngine] Existing session failed conversation=${conversationId} session=${existingSession.id}:`,
          error
        );
        return { result: "failed" };
      }
    }

    const firstInbound = await isFirstInboundMessage(conversationId);

    const matchResult = findMatchedTrigger({
      message,
      flows: nonDefaultFlows,
      channelType,
      isFirstInboundMessage: firstInbound
    });
    const matchedFlow = matchResult?.flow ?? null;
    const matchedTriggerId = matchResult?.triggerId ?? "";

    // any_message and no-trigger flows are generic catches — same concept as default reply.
    // If a dedicated default reply flow exists, it takes priority over these generic flows.
    const isGenericMatch =
      matchedFlow !== null &&
      (() => {
        const triggers = getEffectiveTriggers(matchedFlow);
        return (
          triggers.length === 0 ||
          triggers.every((t) => t.type === "any_message")
        );
      })();

    if ((selectedDefaultReplyFlow || defaultReplyConfig.mode === "ai") && (isGenericMatch || matchedFlow === null)) {
      // Also: if a specific flow just completed and would re-trigger, prefer default reply
      const recentlyCompleted =
        !isGenericMatch && matchedFlow
          ? await getLastCompletedFlowSession(conversationId)
          : null;
      const shouldUseDefaultReply =
        isGenericMatch ||
        (recentlyCompleted?.flow_id === matchedFlow?.id) ||
        matchedFlow === null;

      if (shouldUseDefaultReply) {
        if (defaultReplyConfig.mode === "flow" && selectedDefaultReplyFlow) {
          const { nodes, edges, startNode: drStartNode } = getFlowGraph(selectedDefaultReplyFlow);
          if (drStartNode) {
            const initialVars = await buildConversationFlowVariables({ userId, conversationId });
            const session = await createFlowSession(selectedDefaultReplyFlow.id, conversationId, initialVars);
            sessionIdToFail = session.id;
            try {
              return await runChain(drStartNode, nodes, edges, session, initialVars, sendReply, {
                userId,
                channelType
              });
            } catch (error) {
              await markFlowSessionFailed(session.id);
              console.warn(
                `[FlowEngine] Default reply flow failed conversation=${conversationId} session=${session.id}:`,
                error
              );
              return { result: "failed" };
            }
          }
        }

        if (defaultReplyConfig.mode === "ai") {
          return { result: "use_ai" };
        }
      }
    }

    if (!matchedFlow) {
      if (defaultReplyConfig.mode === "ai") {
        return { result: "use_ai" };
      }

      // Check for a default reply flow — catches all unmatched messages for this channel
      if (defaultReplyConfig.mode === "flow" && selectedDefaultReplyFlow) {
        const { nodes, edges, startNode: drStartNode } = getFlowGraph(selectedDefaultReplyFlow);
        if (drStartNode) {
          const initialVars = await buildConversationFlowVariables({ userId, conversationId });
          const session = await createFlowSession(selectedDefaultReplyFlow.id, conversationId, initialVars);
          sessionIdToFail = session.id;
          try {
            return await runChain(drStartNode, nodes, edges, session, initialVars, sendReply, {
              userId,
              channelType
            });
          } catch (error) {
            await markFlowSessionFailed(session.id);
            console.warn(
              `[FlowEngine] Default reply flow failed conversation=${conversationId} session=${session.id}:`,
              error
            );
            return { result: "failed" };
          }
        }
      }

      return { result: "not_matched" };
    }

    return startMatchedFlow(matchedFlow, matchedTriggerId);
  } catch (error) {
    await markFlowSessionFailed(sessionIdToFail);
    console.warn("[FlowEngine] Unhandled error:", error);
    return { result: "failed" };
  }
}

import type { FlowMessagePayload } from "../outbound-message-types.js";
import type { FlowSessionRow } from "../flow-service.js";

export interface FlowNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
}

export type FlowChannelType = "web" | "qr" | "api";
export type FlowOutputChannel = "web" | "baileys" | "api_whatsapp";
export type SendReplyFn = (payload: FlowMessagePayload) => Promise<void>;
export type FlowVariables = Record<string, unknown>;

export interface FlowStepResult {
  signal: "continue" | "wait" | "use_ai" | "end";
  nextNodeId?: string | null;
  waitingFor?: FlowSessionRow["waiting_for"];
  waitingNodeId?: string | null;
  afterAiNodeId?: string | null;
  handoffToHuman?: boolean;
  variables: FlowVariables;
}

export interface FlowWaitResumeResult {
  signal: "advance" | "stay_waiting";
  nextHandleId?: string | null;
  variables: FlowVariables;
}

export interface FlowBlockExecutionContext {
  node: FlowNode;
  nodes: FlowNode[];
  edges: FlowEdge[];
  vars: FlowVariables;
  sendReply: SendReplyFn;
  channel: FlowOutputChannel;
  userId?: string | null;
}

export interface FlowBlockResumeContext {
  node: FlowNode;
  nodes: FlowNode[];
  edges: FlowEdge[];
  vars: FlowVariables;
  message: string;
  sendReply: SendReplyFn;
  channel: FlowOutputChannel;
  userId?: string | null;
}

export interface FlowBlockModule {
  type: string;
  execute(context: FlowBlockExecutionContext): Promise<FlowStepResult>;
  resumeWait?(context: FlowBlockResumeContext): Promise<FlowWaitResumeResult>;
}

export function resolveFlowOutputChannel(channelType: FlowChannelType): FlowOutputChannel {
  if (channelType === "api") {
    return "api_whatsapp";
  }
  if (channelType === "qr") {
    return "baileys";
  }
  return "web";
}

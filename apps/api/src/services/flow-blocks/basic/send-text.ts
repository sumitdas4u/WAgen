import { getDefaultNextNodeId, interpolate } from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

export const sendTextBlock: FlowBlockModule = {
  type: "sendText",
  async execute(context) {
    const text = interpolate(String(context.node.data.text ?? ""), context.vars);

    if (text.trim()) {
      await context.sendReply({ type: "text", text });
    }

    return {
      signal: "continue",
      nextNodeId: getDefaultNextNodeId(context.nodes, context.edges, context.node.id),
      variables: context.vars
    };
  }
};

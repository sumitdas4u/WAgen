import { getDefaultNextNodeId, interpolate } from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

export const flowStartBlock: FlowBlockModule = {
  type: "flowStart",
  async execute(context) {
    const welcome = interpolate(
      String(context.node.data.welcomeMessage ?? ""),
      context.vars
    ).trim();

    if (welcome) {
      await context.sendReply({ type: "text", text: welcome });
    }

    return {
      signal: "continue",
      nextNodeId: getDefaultNextNodeId(
        context.nodes,
        context.edges,
        context.node.id
      ),
      variables: context.vars
    };
  }
};

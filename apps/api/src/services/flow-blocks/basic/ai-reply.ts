import { getDefaultNextNodeId } from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

export const aiReplyBlock: FlowBlockModule = {
  type: "aiReply",
  async execute(context) {
    const mode = String(context.node.data.mode ?? "one_shot");

    if (mode === "ongoing") {
      return {
        signal: "use_ai",
        variables: context.vars
      };
    }

    return {
      signal: "use_ai",
      afterAiNodeId: getDefaultNextNodeId(
        context.nodes,
        context.edges,
        context.node.id
      ),
      variables: context.vars
    };
  }
};

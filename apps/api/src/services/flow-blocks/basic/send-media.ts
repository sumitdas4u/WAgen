import { getDefaultNextNodeId, interpolate } from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

export const sendMediaBlock: FlowBlockModule = {
  type: "sendMedia",
  async execute(context) {
    const mediaType = String(context.node.data.mediaType ?? "image") as
      | "image"
      | "video"
      | "document"
      | "audio";
    const url = interpolate(String(context.node.data.url ?? ""), context.vars);
    const caption = interpolate(String(context.node.data.caption ?? ""), context.vars);

    if (url.trim()) {
      await context.sendReply({
        type: "media",
        mediaType,
        url,
        ...(caption.trim() ? { caption } : {})
      });
    }

    return {
      signal: "continue",
      nextNodeId: getDefaultNextNodeId(context.nodes, context.edges, context.node.id),
      variables: context.vars
    };
  }
};

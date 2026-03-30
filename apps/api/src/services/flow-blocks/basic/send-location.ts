import { getDefaultNextNodeId, interpolate } from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

export const sendLocationBlock: FlowBlockModule = {
  type: "sendLocation",
  async execute(context) {
    const latitude = parseFloat(String(context.node.data.latitude ?? "0"));
    const longitude = parseFloat(String(context.node.data.longitude ?? "0"));
    const name = interpolate(String(context.node.data.name ?? ""), context.vars);
    const address = interpolate(String(context.node.data.address ?? ""), context.vars);

    if (!isNaN(latitude) && !isNaN(longitude)) {
      await context.sendReply({
        type: "location_share",
        latitude,
        longitude,
        ...(name.trim() ? { name } : {}),
        ...(address.trim() ? { address } : {})
      });
    }

    return {
      signal: "continue",
      nextNodeId: getDefaultNextNodeId(context.nodes, context.edges, context.node.id),
      variables: context.vars
    };
  }
};

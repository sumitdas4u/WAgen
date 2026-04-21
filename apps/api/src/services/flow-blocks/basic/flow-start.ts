import { getDefaultNextNodeId, getNextNodeId, interpolate } from "../helpers.js";
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

    const routes = Array.isArray(context.node.data.routes) ? context.node.data.routes : [];
    const triggerId = String(context.vars["__flow_trigger_id"] ?? "");

    if (routes.length > 0) {
      const matchedRoute = routes.find(
        (route: { id: string; triggers?: Array<{ id?: string }> }) =>
          Array.isArray(route.triggers) &&
          route.triggers.some((t: { id?: string }) => t.id === triggerId)
      );
      const handleId = matchedRoute ? String(matchedRoute.id) : "default";
      return {
        signal: "continue",
        nextNodeId: getNextNodeId(context.nodes, context.edges, context.node.id, handleId),
        variables: context.vars
      };
    }

    return {
      signal: "continue",
      nextNodeId: getDefaultNextNodeId(context.nodes, context.edges, context.node.id),
      variables: context.vars
    };
  }
};

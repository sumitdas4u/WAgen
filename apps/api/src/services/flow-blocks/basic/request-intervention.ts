import { interpolate } from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

export const requestInterventionBlock: FlowBlockModule = {
  type: "requestIntervention",
  async execute(context) {
    const text = interpolate(
      String(context.node.data.message ?? "Connecting you with an agent..."),
      context.vars
    ).trim();

    if (text) {
      await context.sendReply({ type: "text", text });
    }

    return {
      signal: "end",
      handoffToHuman: true,
      variables: context.vars
    };
  }
};

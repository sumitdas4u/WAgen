import {
  formatFlowLocationValue,
  parseFlowLocationInput
} from "../../flow-input-codec.js";
import { interpolate } from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

export const askLocationBlock: FlowBlockModule = {
  type: "askLocation",
  async execute(context) {
    const prompt = interpolate(
      String(context.node.data.promptMessage ?? "Please share your location."),
      context.vars
    ).trim();

    if (prompt) {
      await context.sendReply({ type: "text", text: prompt });
    }

    return {
      signal: "wait",
      waitingFor: "location",
      waitingNodeId: context.node.id,
      variables: context.vars
    };
  },
  async resumeWait(context) {
    const variableName = String(context.node.data.variableName ?? "location").trim() || "location";
    const location = parseFlowLocationInput(context.message);

    if (!location) {
      await context.sendReply({
        type: "text",
        text: "Please share your WhatsApp location so I can continue."
      });
      return {
        signal: "stay_waiting",
        variables: context.vars
      };
    }

    return {
      signal: "advance",
      nextHandleId: "out",
      variables: {
        ...context.vars,
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
};

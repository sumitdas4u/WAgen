import {
  buildButtonOptions,
  buildChoicePrompt,
  getDefaultNextNodeId,
  interpolate,
  matchChoiceByMessage,
  summarizeAsText
} from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

export const textButtonsBlock: FlowBlockModule = {
  type: "textButtons",
  async execute(context) {
    const text = interpolate(String(context.node.data.message ?? ""), context.vars);
    const footer = interpolate(String(context.node.data.footer ?? ""), context.vars);
    const buttons = buildButtonOptions(context.node.data.buttons, context.vars);

    if (!buttons.length) {
      if (text.trim()) {
        await context.sendReply({ type: "text", text });
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

    if (context.channel === "web") {
      await context.sendReply({
        type: "text",
        text: summarizeAsText({
          type: "text_buttons",
          text,
          footer,
          buttons
        })
      });
    } else {
      await context.sendReply({
        type: "text_buttons",
        text,
        footer,
        buttons
      });
    }

    return {
      signal: "wait",
      waitingFor: "button",
      waitingNodeId: context.node.id,
      variables: context.vars
    };
  },
  async resumeWait(context) {
    const buttons = buildButtonOptions(context.node.data.buttons, context.vars);
    if (!buttons.length) {
      return {
        signal: "advance",
        nextHandleId: "out",
        variables: context.vars
      };
    }

    const choice = matchChoiceByMessage(
      context.message,
      buttons.map((button) => ({ id: button.id, label: button.label }))
    );

    if (!choice) {
      await context.sendReply({
        type: "text",
        text: `Please choose one of:\n${buildChoicePrompt(
          buttons.map((button) => ({ id: button.id, label: button.label }))
        )}`
      });
      return {
        signal: "stay_waiting",
        variables: context.vars
      };
    }

    return {
      signal: "advance",
      nextHandleId: choice.id,
      variables: context.vars
    };
  }
};

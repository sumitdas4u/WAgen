import {
  buildChoicePrompt,
  buildListSections,
  flattenListChoices,
  getDefaultNextNodeId,
  interpolate,
  matchChoiceByMessage,
  summarizeAsText
} from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

export const listBlock: FlowBlockModule = {
  type: "list",
  async execute(context) {
    const text = interpolate(String(context.node.data.message ?? ""), context.vars);
    const buttonLabel = interpolate(
      String(context.node.data.buttonLabel ?? "View options"),
      context.vars
    );
    const sections = buildListSections(context.node.data.sections, context.vars);

    if (!sections.length) {
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
          type: "list",
          text,
          buttonLabel,
          sections
        })
      });
    } else {
      await context.sendReply({
        type: "list",
        text,
        buttonLabel,
        sections
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
    const sections = buildListSections(context.node.data.sections, context.vars);
    const choices = flattenListChoices(sections);
    if (!choices.length) {
      return {
        signal: "advance",
        nextHandleId: "out",
        variables: context.vars
      };
    }

    const choice = matchChoiceByMessage(context.message, choices);
    if (!choice) {
      await context.sendReply({
        type: "text",
        text: `Please choose one of:\n${buildChoicePrompt(choices)}`
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

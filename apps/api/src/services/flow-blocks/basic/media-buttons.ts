import {
  buildButtonOptions,
  buildChoicePrompt,
  getDefaultNextNodeId,
  interpolate,
  matchChoiceByMessage,
  summarizeAsText
} from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

export const mediaButtonsBlock: FlowBlockModule = {
  type: "mediaButtons",
  async execute(context) {
    const mediaType = String(context.node.data.mediaType ?? "image") as
      | "image"
      | "video"
      | "document";
    const url = String(context.node.data.url ?? "").trim();
    const caption = interpolate(String(context.node.data.caption ?? ""), context.vars);
    const buttons = buildButtonOptions(context.node.data.buttons, context.vars);

    if (!buttons.length) {
      if (url && context.channel !== "web") {
        await context.sendReply({
          type: "media",
          mediaType,
          url,
          caption
        });
      } else if (caption.trim()) {
        await context.sendReply({
          type: "text",
          text: url
            ? summarizeAsText({
                type: "media",
                mediaType,
                url,
                caption
              })
            : caption
        });
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

    if (context.channel !== "web" && url) {
      await context.sendReply({
        type: "media_buttons",
        mediaType,
        url,
        caption,
        buttons
      });
    } else if (context.channel !== "web") {
      await context.sendReply({
        type: "text_buttons",
        text: caption || "Please choose an option.",
        footer: "",
        buttons
      });
    } else {
      const fallbackText = url
        ? summarizeAsText({
            type: "media_buttons",
            mediaType,
            url,
            caption,
            buttons
          })
        : summarizeAsText({
            type: "text_buttons",
            text: caption || "Please choose an option.",
            footer: "",
            buttons
          });
      await context.sendReply({
        type: "text",
        text: fallbackText
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

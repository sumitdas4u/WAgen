import { buildButtonOptions, buildChoicePrompt, interpolate, matchChoiceByMessage } from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

/**
 * QR-channel image menu: sends an image whose caption contains numbered options.
 * User replies with 1, 2, 3… (or the option label).
 * Each option gets its own outgoing handle (by button id).
 */
export const sendImageMenuBlock: FlowBlockModule = {
  type: "sendImageMenu",

  async execute(context) {
    const url = interpolate(String(context.node.data.url ?? ""), context.vars);
    const intro = interpolate(String(context.node.data.intro ?? ""), context.vars);
    const options = buildButtonOptions(context.node.data.options, context.vars);

    if (!url.trim()) {
      // No image URL — fall back to text
      const numbered = options.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
      const text = intro.trim() ? `${intro}\n\n${numbered}` : numbered;
      if (text.trim()) await context.sendReply({ type: "text", text });

      if (!options.length) {
        const next = context.edges.filter((e) => e.source === context.node.id).map((e) => e.target)[0] ?? null;
        return { signal: "continue", nextNodeId: next, variables: context.vars };
      }
      return { signal: "wait", waitingFor: "message", waitingNodeId: context.node.id, variables: context.vars };
    }

    const numbered = options.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
    const caption = intro.trim()
      ? `${intro}\n\n${numbered}${options.length ? "\n\n👉 Reply with number" : ""}`
      : `${numbered}${options.length ? "\n\n👉 Reply with number" : ""}`;

    await context.sendReply({
      type: "media",
      mediaType: "image",
      url,
      caption: caption.trim() || undefined
    });

    if (!options.length) {
      const next = context.edges.filter((e) => e.source === context.node.id).map((e) => e.target)[0] ?? null;
      return { signal: "continue", nextNodeId: next, variables: context.vars };
    }

    return {
      signal: "wait",
      waitingFor: "message",
      waitingNodeId: context.node.id,
      variables: context.vars
    };
  },

  async resumeWait(context) {
    const options = buildButtonOptions(context.node.data.options, context.vars);
    if (!options.length) {
      return { signal: "advance", nextHandleId: null, variables: context.vars };
    }

    const choice = matchChoiceByMessage(
      context.message,
      options.map((o) => ({ id: o.id, label: o.label }))
    );

    if (!choice) {
      await context.sendReply({
        type: "text",
        text: `Please reply with a number:\n${buildChoicePrompt(
          options.map((o) => ({ id: o.id, label: o.label }))
        )}`
      });
      return { signal: "stay_waiting", variables: context.vars };
    }

    return { signal: "advance", nextHandleId: choice.id, variables: context.vars };
  }
};

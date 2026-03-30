import { buildButtonOptions, buildChoicePrompt, interpolate, matchChoiceByMessage } from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

/**
 * QR-channel menu: sends plain text with numbered options.
 * User replies with 1, 2, 3… (or the option label).
 * Each option gets its own outgoing handle (by button id).
 */
export const sendTextMenuBlock: FlowBlockModule = {
  type: "sendTextMenu",

  async execute(context) {
    const message = interpolate(String(context.node.data.message ?? ""), context.vars);
    const options = buildButtonOptions(context.node.data.options, context.vars);

    if (!options.length) {
      // No options — send text and continue
      if (message.trim()) {
        await context.sendReply({ type: "text", text: message });
      }
      const next =
        context.edges
          .filter((e) => e.source === context.node.id)
          .map((e) => e.target)[0] ?? null;
      return { signal: "continue", nextNodeId: next, variables: context.vars };
    }

    const numbered = options
      .map((opt, i) => `${i + 1}. ${opt.label}`)
      .join("\n");
    const full = message.trim() ? `${message}\n\n${numbered}` : numbered;

    await context.sendReply({ type: "text", text: full });

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

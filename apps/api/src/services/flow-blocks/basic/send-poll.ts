import {
  formatFlowPollValue,
  parseFlowPollInput
} from "../../flow-input-codec.js";
import {
  buildChoicePrompt,
  getDefaultNextNodeId,
  interpolate,
  matchChoiceByMessage
} from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

function buildPollChoices(options: string[]) {
  return options.map((option, index) => ({
    id: String(index + 1),
    label: option
  }));
}

function matchMultiplePollChoices(message: string, options: string[]): string[] {
  const choices = buildPollChoices(options);
  const rawParts = message
    .split(/\s*(?:,|\/|\n|(?:\band\b))\s*/iu)
    .map((part) => part.trim())
    .filter(Boolean);
  const candidates = rawParts.length ? rawParts : [message];
  const selected = new Set<string>();

  for (const candidate of candidates) {
    const match = matchChoiceByMessage(candidate, choices);
    if (match) {
      selected.add(match.label);
    }
  }

  if (selected.size === 0) {
    const wholeMessageMatch = matchChoiceByMessage(message, choices);
    if (wholeMessageMatch) {
      selected.add(wholeMessageMatch.label);
    }
  }

  return [...selected];
}

// QR (Baileys) only - Meta API falls back to text in delivery.
export const sendPollBlock: FlowBlockModule = {
  type: "sendPoll",
  async execute(context) {
    const question = interpolate(String(context.node.data.question ?? ""), context.vars);
    const rawOptions: unknown[] = Array.isArray(context.node.data.options)
      ? context.node.data.options
      : [];
    const options = rawOptions
      .map((opt) => interpolate(String(opt), context.vars).trim())
      .filter(Boolean);
    const allowMultiple = Boolean(context.node.data.allowMultiple);

    if (question.trim() && options.length >= 2) {
      await context.sendReply({
        type: "poll",
        question,
        options,
        allowMultiple
      });

      return {
        signal: "wait",
        waitingFor: "message",
        waitingNodeId: context.node.id,
        variables: context.vars
      };
    }

    return {
      signal: "continue",
      nextNodeId: getDefaultNextNodeId(context.nodes, context.edges, context.node.id),
      variables: context.vars
    };
  },
  async resumeWait(context) {
    const question = interpolate(String(context.node.data.question ?? ""), context.vars).trim();
    const rawOptions: unknown[] = Array.isArray(context.node.data.options)
      ? context.node.data.options
      : [];
    const options = rawOptions
      .map((opt) => interpolate(String(opt), context.vars).trim())
      .filter(Boolean);
    const allowMultiple = Boolean(context.node.data.allowMultiple);

    if (!question || options.length < 2) {
      return {
        signal: "advance",
        nextHandleId: "out",
        variables: context.vars
      };
    }

    const structuredPoll = parseFlowPollInput(context.message);
    let selectedOptions = structuredPoll?.selectedOptions ?? [];

    if (!selectedOptions.length) {
      if (allowMultiple) {
        selectedOptions = matchMultiplePollChoices(context.message, options);
      } else {
        const match = matchChoiceByMessage(context.message, buildPollChoices(options));
        if (match) {
          selectedOptions = [match.label];
        }
      }
    }

    if (!selectedOptions.length) {
      await context.sendReply({
        type: "text",
        text: `Please vote in the poll or reply with an option number:\n${buildChoicePrompt(
          buildPollChoices(options)
        )}`
      });
      return {
        signal: "stay_waiting",
        variables: context.vars
      };
    }

    const pollPayload = {
      question,
      selectedOptions,
      allowMultiple,
      source: structuredPoll?.source ?? ("text" as const)
    };
    const pollValue = formatFlowPollValue(pollPayload);

    return {
      signal: "advance",
      nextHandleId: "out",
      variables: {
        ...context.vars,
        poll_question: question,
        poll_answer: selectedOptions[0] ?? "",
        poll_answer_text: pollValue,
        poll_answers: selectedOptions,
        poll_selection_count: selectedOptions.length,
        poll_source: pollPayload.source,
        poll_payload: pollPayload
      }
    };
  }
};

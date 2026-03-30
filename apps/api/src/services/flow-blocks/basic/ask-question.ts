import { interpolate } from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

function normalizeAskQuestionInputType(value: unknown): "text" | "number" | "email" | "phone" {
  const normalized = String(value ?? "text").trim().toLowerCase();
  if (
    normalized === "text" ||
    normalized === "number" ||
    normalized === "email" ||
    normalized === "phone"
  ) {
    return normalized;
  }
  return "text";
}

function normalizeAskQuestionAnswer(
  inputType: "text" | "number" | "email" | "phone",
  message: string
): { ok: true; value: string } | { ok: false; errorText: string } {
  const trimmed = message.trim();
  if (!trimmed) {
    return {
      ok: false,
      errorText: "Please enter a response before continuing."
    };
  }

  if (inputType === "number") {
    const normalized = trimmed.replace(/,/g, "");
    if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
      return { ok: true, value: normalized };
    }
    return {
      ok: false,
      errorText: "Please enter a valid number."
    };
  }

  if (inputType === "email") {
    const normalized = trimmed.toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return { ok: true, value: normalized };
    }
    return {
      ok: false,
      errorText: "Please enter a valid email address."
    };
  }

  if (inputType === "phone") {
    const normalized = trimmed.replace(/\D/g, "");
    if (normalized.length >= 8 && normalized.length <= 15) {
      return { ok: true, value: normalized };
    }
    return {
      ok: false,
      errorText: "Please enter a valid phone number."
    };
  }

  return { ok: true, value: trimmed };
}

export const askQuestionBlock: FlowBlockModule = {
  type: "askQuestion",
  async execute(context) {
    const question = interpolate(
      String(context.node.data.question ?? ""),
      context.vars
    ).trim();

    if (question) {
      await context.sendReply({ type: "text", text: question });
    }

    return {
      signal: "wait",
      waitingFor: "message",
      waitingNodeId: context.node.id,
      variables: context.vars
    };
  },
  async resumeWait(context) {
    const variableName = String(context.node.data.variableName ?? "answer").trim() || "answer";
    const inputType = normalizeAskQuestionInputType(context.node.data.inputType);
    const normalizedAnswer = normalizeAskQuestionAnswer(inputType, context.message);
    if (!normalizedAnswer.ok) {
      await context.sendReply({
        type: "text",
        text: normalizedAnswer.errorText
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
        [variableName]: normalizedAnswer.value
      }
    };
  }
};

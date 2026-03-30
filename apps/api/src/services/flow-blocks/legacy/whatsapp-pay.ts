import { interpolate } from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

export const whatsappPayBlock: FlowBlockModule = {
  type: "whatsappPay",
  async execute(context) {
    const amount = String(context.node.data.amount ?? "0").trim() || "0";
    const currency = String(context.node.data.currency ?? "INR").trim() || "INR";
    const description = interpolate(
      String(context.node.data.description ?? "Payment"),
      context.vars
    ).trim();

    await context.sendReply({
      type: "text",
      text: `Payment request: *${description || "Payment"}*\nAmount: ${amount} ${currency}`
    });

    return {
      signal: "wait",
      waitingFor: "payment",
      waitingNodeId: context.node.id,
      variables: context.vars
    };
  },
  async resumeWait(context) {
    return {
      signal: "advance",
      nextHandleId: context.message.toLowerCase().includes("paid")
        ? "success"
        : "fail",
      variables: context.vars
    };
  }
};

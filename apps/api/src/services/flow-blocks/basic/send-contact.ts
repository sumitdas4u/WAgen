import { getDefaultNextNodeId, interpolate } from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

// QR (Baileys) only — Meta API doesn't support native polls but falls back to text in delivery.
export const sendContactBlock: FlowBlockModule = {
  type: "sendContact",
  async execute(context) {
    const name = interpolate(String(context.node.data.name ?? ""), context.vars);
    const phone = interpolate(String(context.node.data.phone ?? ""), context.vars);
    const org = interpolate(String(context.node.data.org ?? ""), context.vars);

    if (name.trim() && phone.trim()) {
      await context.sendReply({
        type: "contact_share",
        name,
        phone,
        ...(org.trim() ? { org } : {})
      });
    }

    return {
      signal: "continue",
      nextNodeId: getDefaultNextNodeId(context.nodes, context.edges, context.node.id),
      variables: context.vars
    };
  }
};

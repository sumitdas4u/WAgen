import { getDefaultNextNodeId, interpolate } from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

export const singleProductBlock: FlowBlockModule = {
  type: "singleProduct",
  async execute(context) {
    const bodyText = interpolate(
      String(context.node.data.bodyText ?? "Check out this product!"),
      context.vars
    ).trim();
    const catalogId = String(context.node.data.catalogId ?? "").trim();
    const productId = String(context.node.data.productId ?? "").trim();

    if (context.channel === "api_whatsapp" && catalogId && productId) {
      await context.sendReply({
        type: "product",
        catalogId,
        productId,
        bodyText
      });
    } else if (bodyText) {
      await context.sendReply({ type: "text", text: bodyText });
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
};

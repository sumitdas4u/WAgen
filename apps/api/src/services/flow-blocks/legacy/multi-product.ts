import { getDefaultNextNodeId, interpolate } from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

export const multiProductBlock: FlowBlockModule = {
  type: "multiProduct",
  async execute(context) {
    const bodyText = interpolate(
      String(context.node.data.bodyText ?? "Check out these products!"),
      context.vars
    ).trim();
    const catalogId = String(context.node.data.catalogId ?? "").trim();
    const sections = Array.isArray(context.node.data.sections)
      ? context.node.data.sections
          .map((rawSection) => {
            const section = (rawSection ?? {}) as {
              title?: unknown;
              productIds?: unknown[];
            };
            const productIds = Array.isArray(section.productIds)
              ? section.productIds
                  .map((productId) => String(productId ?? "").trim())
                  .filter(Boolean)
              : [];

            return {
              title: interpolate(String(section.title ?? ""), context.vars).trim(),
              productIds
            };
          })
          .filter((section) => section.productIds.length > 0)
      : [];

    if (context.channel === "api_whatsapp" && catalogId && sections.length > 0) {
      await context.sendReply({
        type: "product_list",
        catalogId,
        bodyText,
        sections
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

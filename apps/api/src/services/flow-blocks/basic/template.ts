import { getDefaultNextNodeId } from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

export const templateBlock: FlowBlockModule = {
  type: "template",
  async execute(context) {
    const templateName = String(context.node.data.templateName ?? "").trim();
    const language = String(context.node.data.language ?? "en").trim() || "en";

    const headerMediaUrl = String(context.node.data.headerMediaUrl ?? "").trim() || undefined;
    const headerMediaType = (context.node.data.headerMediaType as "image" | "video" | "document" | undefined) ?? "image";

    if (context.channel === "api_whatsapp" && templateName) {
      await context.sendReply({
        type: "template",
        templateName,
        language,
        ...(headerMediaUrl ? { headerMediaType, headerMediaUrl } : {})
      });
    } else {
      await context.sendReply({
        type: "text",
        text: templateName ? `[Template: ${templateName}]` : "[Template]"
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
};

import { updateContactFieldValueFromFlow } from "../../contacts-service.js";
import { getDefaultNextNodeId, interpolate } from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

function buildUpdatedVariables(
  currentVars: Record<string, unknown>,
  contact: Awaited<ReturnType<typeof updateContactFieldValueFromFlow>>
) {
  if (!contact) {
    return currentVars;
  }

  const custom = Object.fromEntries(
    (contact.custom_field_values ?? [])
      .filter((field) => field.field_name)
      .map((field) => [field.field_name, field.value ?? ""])
  );

  return {
    ...currentVars,
    name: contact.display_name ?? "",
    phone: contact.phone_number ?? "",
    email: contact.email ?? "",
    type: contact.contact_type ?? "",
    tags: Array.isArray(contact.tags) ? contact.tags.join(", ") : "",
    source: contact.source_type ?? "",
    source_id: contact.source_id ?? "",
    source_url: contact.source_url ?? "",
    custom,
    contact: {
      ...(typeof currentVars.contact === "object" && currentVars.contact ? currentVars.contact as Record<string, unknown> : {}),
      id: contact.id,
      name: contact.display_name ?? "",
      phone: contact.phone_number ?? "",
      email: contact.email ?? "",
      type: contact.contact_type ?? "",
      tags: contact.tags ?? [],
      source: contact.source_type ?? "",
      source_id: contact.source_id ?? "",
      source_url: contact.source_url ?? "",
      custom
    }
  };
}

export const updateContactFieldBlock: FlowBlockModule = {
  type: "updateContactField",
  async execute(context) {
    const fieldKey = String(context.node.data.fieldKey ?? "").trim();
    const rawValue = interpolate(String(context.node.data.value ?? ""), context.vars).trim();
    const operation = String(context.node.data.operation ?? "replace");
    const userId = context.userId ?? null;
    const conversationId = String((context.vars.conversation as { id?: unknown } | undefined)?.id ?? "").trim();
    const contactId = String((context.vars.contact as { id?: unknown } | undefined)?.id ?? "").trim();

    let nextVars = context.vars;

    if (userId && fieldKey) {
      const updatedContact = await updateContactFieldValueFromFlow({
        userId,
        fieldKey,
        value: rawValue,
        operation: operation === "append" || operation === "add_if_empty" ? operation : "replace",
        conversationId: conversationId || null,
        contactId: contactId || null
      });
      nextVars = buildUpdatedVariables(context.vars, updatedContact);
    }

    return {
      signal: "continue",
      nextNodeId: getDefaultNextNodeId(context.nodes, context.edges, context.node.id),
      variables: nextVars
    };
  }
};

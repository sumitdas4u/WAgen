import { describe, expect, it, vi } from "vitest";
import type { FlowBlockExecutionContext } from "../types.js";

const mocks = vi.hoisted(() => ({
  updateContactFieldValueFromFlowMock: vi.fn(async () => ({
    id: "contact-1",
    display_name: "Ada",
    phone_number: "919999999999",
    email: null,
    contact_type: "lead",
    tags: ["vip"],
    source_type: "api",
    source_id: null,
    source_url: null,
    custom_field_values: []
  }))
}));

vi.mock("../../contacts-service.js", () => ({
  updateContactFieldValueFromFlow: mocks.updateContactFieldValueFromFlowMock
}));

import { updateContactFieldBlock } from "./update-contact-field.js";

function makeContext(data: Record<string, unknown>): FlowBlockExecutionContext {
  return {
    node: { id: "update-tags", type: "updateContactField", data },
    nodes: [
      { id: "update-tags", type: "updateContactField", data },
      { id: "done", type: "sendText", data: {} }
    ],
    edges: [{ id: "edge-1", source: "update-tags", sourceHandle: "out", target: "done" }],
    vars: {
      conversation: { id: "conv-1" },
      contact: { id: "contact-1" }
    },
    sendReply: async () => {},
    channel: "api_whatsapp",
    userId: "user-1"
  };
}

describe("updateContactFieldBlock", () => {
  it("defaults tag updates to append for older nodes without an operation", async () => {
    await updateContactFieldBlock.execute(makeContext({
      fieldKey: "tags",
      value: "new lead"
    }));

    expect(mocks.updateContactFieldValueFromFlowMock).toHaveBeenCalledWith(expect.objectContaining({
      fieldKey: "tags",
      value: "new lead",
      operation: "append"
    }));
  });

  it("keeps explicit replace operations", async () => {
    await updateContactFieldBlock.execute(makeContext({
      fieldKey: "tags",
      value: "fresh",
      operation: "replace"
    }));

    expect(mocks.updateContactFieldValueFromFlowMock).toHaveBeenCalledWith(expect.objectContaining({
      fieldKey: "tags",
      value: "fresh",
      operation: "replace"
    }));
  });
});

/**
 * Tests for template-send optimistic message flow.
 *
 * When a template is sent:
 * 1. onSuccess adds optimistic msg: id="temp-<queuedId>", echo_id="<queuedId>", delivery_status="pending"
 * 2. WS message.created fires with the real msg: echo_id="<queuedId>" (worker stamps it)
 * 3. appendMessage via WS → mergeMessage finds optimistic by sameEcho and replaces it
 * 4. Store ends up with exactly one message (the real one)
 */

import { describe, expect, it, beforeEach } from "vitest";
import { useConvStore } from "./convStore";
import type { ConversationMessage } from "./convStore";

const CONV_ID = "conv-abc";
const QUEUED_ID = "outbound-msg-uuid-1234"; // outbound_messages.id = echo_id on conversation_message

function makeMsg(overrides: Partial<ConversationMessage>): ConversationMessage {
  return {
    id: "msg-default",
    conversation_id: CONV_ID,
    direction: "outbound",
    sender_name: null,
    message_text: "default",
    content_type: "text",
    is_private: false,
    in_reply_to_id: null,
    echo_id: null,
    delivery_status: "sent",
    error_code: null,
    error_message: null,
    retry_count: 0,
    payload_json: null,
    source_type: "manual",
    ai_model: null,
    total_tokens: null,
    created_at: new Date().toISOString(),
    ...overrides
  };
}

function optimisticTemplateMsg(): ConversationMessage {
  return makeMsg({
    id: `temp-${QUEUED_ID}`,
    message_text: "Hi {{1}}, Thank you for choosing FOOD STUDIO",
    content_type: "text",
    echo_id: QUEUED_ID,
    delivery_status: "pending"
  });
}

function wsTemplateMsg(): ConversationMessage {
  return makeMsg({
    id: "real-conversation-msg-uuid-5678",
    message_text: "Hi Sumit, Thank you for choosing FOOD STUDIO",
    content_type: "template",
    echo_id: QUEUED_ID,
    delivery_status: "sent",
    message_content: {
      type: "template",
      templateName: "feedback",
      previewText: "Hi Sumit, Thank you for choosing FOOD STUDIO"
    }
  });
}

beforeEach(() => {
  useConvStore.setState({
    messagesByConvId: {},
    notesByConvId: {},
    byId: {},
    ids: []
  });
});

describe("template send optimistic → WS replace", () => {
  it("replaces optimistic msg when WS message.created arrives with same echo_id", () => {
    const store = useConvStore.getState();

    // Step 1: onSuccess adds optimistic
    store.appendMessage(CONV_ID, optimisticTemplateMsg());

    let msgs = useConvStore.getState().messagesByConvId[CONV_ID];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe(`temp-${QUEUED_ID}`);
    expect(msgs[0].delivery_status).toBe("pending");

    // Step 2: WS message.created fires — appendMessage called by WS handler
    store.appendMessage(CONV_ID, wsTemplateMsg());

    msgs = useConvStore.getState().messagesByConvId[CONV_ID];
    expect(msgs).toHaveLength(1); // still ONE message, not two
    expect(msgs[0].id).toBe("real-conversation-msg-uuid-5678");
    expect(msgs[0].delivery_status).toBe("sent");
    expect(msgs[0].content_type).toBe("template");
    expect(msgs[0].message_text).toBe("Hi Sumit, Thank you for choosing FOOD STUDIO");
  });

  it("replaces optimistic msg via replaceOptimisticMessage (optimisticMap path)", () => {
    const store = useConvStore.getState();

    store.appendMessage(CONV_ID, optimisticTemplateMsg());

    const tempId = `temp-${QUEUED_ID}`;
    store.replaceOptimisticMessage(CONV_ID, tempId, wsTemplateMsg());

    const msgs = useConvStore.getState().messagesByConvId[CONV_ID];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe("real-conversation-msg-uuid-5678");
    expect(msgs[0].delivery_status).toBe("sent");
  });

  it("WS message arrives before optimistic — appended normally, no duplicate on re-append", () => {
    const store = useConvStore.getState();

    // WS fires first (worker was very fast)
    store.appendMessage(CONV_ID, wsTemplateMsg());

    let msgs = useConvStore.getState().messagesByConvId[CONV_ID];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe("real-conversation-msg-uuid-5678");

    // Then optimistic tries to add (late onSuccess) — same echo_id, merged/replaced
    store.appendMessage(CONV_ID, optimisticTemplateMsg());

    msgs = useConvStore.getState().messagesByConvId[CONV_ID];
    // mergeMessage finds sameEcho match → replaces with optimistic (pending)
    // This is acceptable — next WS update will flip delivery_status
    expect(msgs).toHaveLength(1);
  });

  it("does not duplicate if WS message.created fires twice", () => {
    const store = useConvStore.getState();

    store.appendMessage(CONV_ID, optimisticTemplateMsg());
    store.appendMessage(CONV_ID, wsTemplateMsg());
    store.appendMessage(CONV_ID, wsTemplateMsg()); // second WS (duplicate)

    const msgs = useConvStore.getState().messagesByConvId[CONV_ID];
    expect(msgs).toHaveLength(1);
  });

  it("patchMessageDelivery updates real msg after WS message.updated", () => {
    const store = useConvStore.getState();

    store.appendMessage(CONV_ID, optimisticTemplateMsg());
    store.appendMessage(CONV_ID, wsTemplateMsg()); // replace optimistic with real
    store.patchMessageDelivery(CONV_ID, "real-conversation-msg-uuid-5678", "delivered");

    const msgs = useConvStore.getState().messagesByConvId[CONV_ID];
    expect(msgs[0].delivery_status).toBe("delivered");
  });
});

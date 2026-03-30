import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, useNodePatch } from "../editor-shared";
import type { SendTextData, StudioFlowBlockDefinition } from "../types";

function SendTextNode({ id, data, selected }: NodeProps<SendTextData>) {
  const { patch, del } = useNodePatch<SendTextData>(id);

  return (
    <div className={`fn-node fn-node-sendText${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="💬" title="Send Text" onDelete={del} />
      <div className="fn-node-body">
        <textarea
          className="fn-node-textarea nodrag"
          value={data.text}
          onChange={(e) => patch({ text: e.target.value })}
          placeholder="Message text... use {{variable}}"
          rows={3}
        />
      </div>
      <Handle type="source" position={Position.Right} id="out" className="fn-handle-out" />
    </div>
  );
}

export const sendTextStudioBlock: StudioFlowBlockDefinition<SendTextData> = {
  kind: "sendText",
  channels: ["web", "qr", "api"],
  catalog: {
    kind: "sendText",
    icon: "💬",
    name: "Send Text",
    desc: "Send a plain text message",
    section: "Messages",
    availableInPalette: true,
    status: "active"
  },
  createDefaultData() {
    return { kind: "sendText", text: "Hello! How can I help you?" };
  },
  NodeComponent: SendTextNode
};

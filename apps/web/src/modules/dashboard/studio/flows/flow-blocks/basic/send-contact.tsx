import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, useNodePatch } from "../editor-shared";
import type { SendContactData, StudioFlowBlockDefinition } from "../types";

function SendContactNode({ id, data, selected }: NodeProps<SendContactData>) {
  const { patch, del } = useNodePatch<SendContactData>(id);

  return (
    <div className={`fn-node fn-node-sendContact${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="👤" title="Send Contact" onDelete={del} />
      <div className="fn-node-body">
        <div className="fn-node-field">
          <label className="fn-node-label">NAME</label>
          <input
            className="fn-node-input nodrag"
            value={data.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Contact name"
          />
        </div>
        <div className="fn-node-field">
          <label className="fn-node-label">PHONE</label>
          <input
            className="fn-node-input nodrag"
            value={data.phone}
            onChange={(e) => patch({ phone: e.target.value })}
            placeholder="+91 98765 43210"
          />
        </div>
        <div className="fn-node-field">
          <label className="fn-node-label">ORGANISATION</label>
          <input
            className="fn-node-input nodrag"
            value={data.org}
            onChange={(e) => patch({ org: e.target.value })}
            placeholder="Optional"
          />
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="out" className="fn-handle-out" />
    </div>
  );
}

export const sendContactStudioBlock: StudioFlowBlockDefinition<SendContactData> = {
  kind: "sendContact",
  channels: ["qr"],
  catalog: {
    kind: "sendContact",
    icon: "👤",
    name: "Send Contact",
    desc: "Share a contact card",
    section: "Messages",
    availableInPalette: true,
    status: "active"
  },
  createDefaultData() {
    return { kind: "sendContact", name: "", phone: "", org: "" };
  },
  NodeComponent: SendContactNode
};

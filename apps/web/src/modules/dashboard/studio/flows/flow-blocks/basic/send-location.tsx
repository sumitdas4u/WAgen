import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, useNodePatch } from "../editor-shared";
import type { SendLocationData, StudioFlowBlockDefinition } from "../types";

function SendLocationNode({ id, data, selected }: NodeProps<SendLocationData>) {
  const { patch, del } = useNodePatch<SendLocationData>(id);

  return (
    <div className={`fn-node fn-node-sendLocation${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="📍" title="Send Location" onDelete={del} />
      <div className="fn-node-body">
        <div className="fn-two">
          <div className="fn-node-field">
            <label className="fn-node-label">LATITUDE</label>
            <input
              className="fn-node-input nodrag"
              value={data.latitude}
              onChange={(e) => patch({ latitude: e.target.value })}
              placeholder="28.6139"
            />
          </div>
          <div className="fn-node-field">
            <label className="fn-node-label">LONGITUDE</label>
            <input
              className="fn-node-input nodrag"
              value={data.longitude}
              onChange={(e) => patch({ longitude: e.target.value })}
              placeholder="77.2090"
            />
          </div>
        </div>
        <div className="fn-node-field">
          <label className="fn-node-label">NAME</label>
          <input
            className="fn-node-input nodrag"
            value={data.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Location name..."
          />
        </div>
        <div className="fn-node-field">
          <label className="fn-node-label">ADDRESS</label>
          <input
            className="fn-node-input nodrag"
            value={data.address}
            onChange={(e) => patch({ address: e.target.value })}
            placeholder="Full address..."
          />
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="out" className="fn-handle-out" />
    </div>
  );
}

export const sendLocationStudioBlock: StudioFlowBlockDefinition<SendLocationData> = {
  kind: "sendLocation",
  channels: ["qr", "api"],
  catalog: {
    kind: "sendLocation",
    icon: "📍",
    name: "Send Location",
    desc: "Share a location pin",
    section: "Messages",
    availableInPalette: true,
    status: "active"
  },
  createDefaultData() {
    return { kind: "sendLocation", latitude: "", longitude: "", name: "", address: "" };
  },
  NodeComponent: SendLocationNode
};

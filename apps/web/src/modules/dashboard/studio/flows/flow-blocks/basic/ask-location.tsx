import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, useNodePatch } from "../editor-shared";
import type { AskLocationData, StudioFlowBlockDefinition } from "../types";

function AskLocationNode({ id, data, selected }: NodeProps<AskLocationData>) {
  const { patch, del } = useNodePatch<AskLocationData>(id);

  return (
    <div className={`fn-node fn-node-askLocation${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="🗺️" title="Ask Location" onDelete={del} />
      <div className="fn-node-body">
        <textarea
          className="fn-node-textarea nodrag"
          value={data.promptMessage}
          onChange={(event) => patch({ promptMessage: event.target.value })}
          placeholder="Please share your location..."
          rows={2}
        />
        <div className="fn-node-field">
          <label className="fn-node-label">SAVE TO VARIABLE</label>
          <input
            className="fn-node-input nodrag"
            value={data.variableName}
            onChange={(event) => patch({ variableName: event.target.value })}
            placeholder="location"
          />
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="out" className="fn-handle-out" />
    </div>
  );
}

export const askLocationStudioBlock: StudioFlowBlockDefinition<AskLocationData> = {
  kind: "askLocation",
  channels: ["qr", "api"],
  catalog: {
    kind: "askLocation",
    icon: "🗺️",
    name: "Ask Location",
    desc: "Request GPS location",
    section: "Collect",
    availableInPalette: true,
    status: "active"
  },
  createDefaultData() {
    return {
      kind: "askLocation",
      promptMessage: "Please share your location.",
      variableName: "location"
    };
  },
  NodeComponent: AskLocationNode
};

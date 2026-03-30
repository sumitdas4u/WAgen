import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, useNodePatch } from "../editor-shared";
import type { RequestInterventionData, StudioFlowBlockDefinition } from "../types";

function RequestInterventionNode({
  id,
  data,
  selected
}: NodeProps<RequestInterventionData>) {
  const { patch, del } = useNodePatch<RequestInterventionData>(id);

  return (
    <div className={`fn-node fn-node-requestIntervention${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="🙋" title="Human Handoff" onDelete={del} />
      <div className="fn-node-body">
        <textarea
          className="fn-node-textarea nodrag"
          value={data.message}
          onChange={(event) => patch({ message: event.target.value })}
          placeholder="Message to customer..."
          rows={2}
        />
        <div className="fn-two">
          <div className="fn-node-field">
            <label className="fn-node-label">TEAM ID</label>
            <input
              className="fn-node-input nodrag"
              value={data.teamId}
              onChange={(event) => patch({ teamId: event.target.value })}
              placeholder="team_id"
            />
          </div>
          <div className="fn-node-field">
            <label className="fn-node-label">TIMEOUT (s)</label>
            <input
              className="fn-node-input nodrag"
              type="number"
              value={data.timeout}
              onChange={(event) => patch({ timeout: Number(event.target.value) })}
              placeholder="300"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export const requestInterventionStudioBlock: StudioFlowBlockDefinition<RequestInterventionData> =
  {
    kind: "requestIntervention",
    channels: ["web", "qr", "api"],
    catalog: {
      kind: "requestIntervention",
      icon: "🙋",
      name: "Human Handoff",
      desc: "Transfer to agent",
      section: "Actions",
      availableInPalette: true,
      status: "active"
    },
    createDefaultData() {
      return {
        kind: "requestIntervention",
        message: "Connecting you with an agent...",
        teamId: "",
        timeout: 300
      };
    },
    NodeComponent: RequestInterventionNode
  };

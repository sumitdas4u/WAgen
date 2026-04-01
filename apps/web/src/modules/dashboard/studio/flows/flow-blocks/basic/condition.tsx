import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, useNodePatch } from "../editor-shared";
import type { ConditionData, StudioFlowBlockDefinition } from "../types";

function ConditionNode({ id, data, selected }: NodeProps<ConditionData>) {
  const { patch, del } = useNodePatch<ConditionData>(id);

  return (
    <div className={`fn-node fn-node-condition${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="⚡" title="Condition" onDelete={del} />
      <div className="fn-node-body">
        <div className="fn-node-field">
          <label className="fn-node-label">VARIABLE</label>
          <input
            className="fn-node-input nodrag"
            value={data.variable}
            onChange={(event) => patch({ variable: event.target.value })}
            placeholder="{{variable}}"
          />
        </div>
        <div className="fn-two">
          <div className="fn-node-field">
            <label className="fn-node-label">OPERATOR</label>
            <select
              className="fn-node-select nodrag"
              value={data.operator}
              onChange={(event) => patch({ operator: event.target.value })}
            >
              <option value="equals">= equals</option>
              <option value="not_equals">!= not equals</option>
              <option value="contains">contains</option>
              <option value="greater">&gt; greater</option>
              <option value="less">&lt; less</option>
              <option value="exists">exists</option>
              <option value="not_exists">not exists</option>
            </select>
          </div>
          <div className="fn-node-field">
            <label className="fn-node-label">VALUE</label>
            <input
              className="fn-node-input nodrag"
              value={data.value}
              onChange={(event) => patch({ value: event.target.value })}
              placeholder="value"
            />
          </div>
        </div>
        <div className="fn-cond-outputs">
          <div className="fn-cond-branch">
            <span className="fn-cond-dot fn-cond-dot-true" />
            <span>True</span>
            <Handle
              type="source"
              position={Position.Right}
              id="true"
              className="fn-handle-out fn-handle-true"
              style={{ position: "absolute", right: -8 }}
            />
          </div>
          <div className="fn-cond-branch">
            <span className="fn-cond-dot fn-cond-dot-false" />
            <span>False</span>
            <Handle
              type="source"
              position={Position.Right}
              id="false"
              className="fn-handle-out fn-handle-false"
              style={{ position: "absolute", right: -8 }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export const conditionStudioBlock: StudioFlowBlockDefinition<ConditionData> = {
  kind: "condition",
  channels: ["web", "qr", "api"],
  catalog: {
    kind: "condition",
    icon: "⚡",
    name: "Condition",
    desc: "Branch on variable",
    section: "Logic",
    availableInPalette: true,
    status: "active"
  },
  createDefaultData() {
    return {
      kind: "condition",
      variable: "{{answer}}",
      operator: "equals",
      value: ""
    };
  },
  NodeComponent: ConditionNode
};

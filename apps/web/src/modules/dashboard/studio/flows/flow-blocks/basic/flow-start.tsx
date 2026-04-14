import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, uid, useNodePatch } from "../editor-shared";
import type { FlowStartData, StudioFlowBlockDefinition, Trigger } from "../types";

function FlowStartNode({ id, data, selected }: NodeProps<FlowStartData>) {
  const { patch, del } = useNodePatch<FlowStartData>(id);

  const addTrigger = () =>
    patch({
      triggers: [...data.triggers, { id: uid(), type: "keyword", value: "" }]
    });

  const removeTrigger = (triggerId: string) =>
    patch({ triggers: data.triggers.filter((trigger) => trigger.id !== triggerId) });

  const patchTrigger = (triggerId: string, updates: Partial<Trigger>) =>
    patch({
      triggers: data.triggers.map((trigger) =>
        trigger.id === triggerId ? { ...trigger, ...updates } : trigger
      )
    });

  return (
    <div className={`fn-node fn-node-flowStart${selected ? " selected" : ""}`}>
      <NodeHeader icon="▶" title="Flow Start" onDelete={del} />
      <div className="fn-node-body">
        <div className="fn-node-field">
          <label className="fn-node-label">FLOW LABEL</label>
          <input
            className="fn-node-input nodrag"
            value={data.label}
            onChange={(event) => patch({ label: event.target.value })}
            placeholder="Flow name"
          />
        </div>
        <div className="fn-node-field">
          <label className="fn-node-label">WELCOME MESSAGE</label>
          <textarea
            className="fn-node-textarea nodrag"
            value={data.welcomeMessage}
            onChange={(event) => patch({ welcomeMessage: event.target.value })}
            placeholder="Optional greeting..."
            rows={2}
          />
        </div>
        <div className="fn-node-field">
          <label className="fn-node-label">TRIGGERS</label>
          {data.triggers.map((trigger) => (
            <div key={trigger.id} className="fn-btn-row" style={{ marginBottom: "0.2rem" }}>
              <select
                className="fn-node-select nodrag"
                style={{ flex: "0 0 90px" }}
                value={trigger.type}
                onChange={(event) =>
                  patchTrigger(trigger.id, {
                    type: event.target.value as Trigger["type"]
                  })
                }
              >
                <option value="keyword">Keyword</option>
                <option value="any_message">Any Msg</option>
                <option value="template_reply">TPL Reply</option>
                <option value="qr_start">QR Code</option>
                <option value="website_start">Widget</option>
              </select>
              <input
                className="fn-node-input nodrag"
                style={{ flex: 1 }}
                value={trigger.value}
                onChange={(event) => patchTrigger(trigger.id, { value: event.target.value })}
                placeholder="value..."
              />
              <button className="fn-icon-btn nodrag" onClick={() => removeTrigger(trigger.id)}>
                x
              </button>
            </div>
          ))}
          <button className="fn-add-btn nodrag" onClick={addTrigger}>
            + Add Trigger
          </button>
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="out" className="fn-handle-out" />
    </div>
  );
}

export const flowStartStudioBlock: StudioFlowBlockDefinition<FlowStartData> = {
  kind: "flowStart",
  channels: ["web", "qr", "api"],
  catalog: {
    kind: "flowStart",
    icon: "▶",
    name: "Flow Start",
    desc: "Entry trigger",
    section: "Triggers",
    availableInPalette: true,
    status: "active"
  },
  createDefaultData() {
    return {
      kind: "flowStart",
      label: "Flow Start",
      triggers: [],
      welcomeMessage: ""
    };
  },
  NodeComponent: FlowStartNode
};

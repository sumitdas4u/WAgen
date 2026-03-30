import { Handle, Position, type NodeProps } from "reactflow";
import { uid } from "../editor-shared";
import { NodeHeader, useNodePatch } from "../editor-shared";
import type { SendPollData, StudioFlowBlockDefinition } from "../types";

function SendPollNode({ id, data, selected }: NodeProps<SendPollData>) {
  const { patch, del } = useNodePatch<SendPollData>(id);

  const addOption = () => patch({ options: [...data.options, ""] });
  const removeOption = (index: number) =>
    patch({ options: data.options.filter((_, i) => i !== index) });
  const updateOption = (index: number, value: string) =>
    patch({ options: data.options.map((opt, i) => (i === index ? value : opt)) });

  return (
    <div className={`fn-node fn-node-sendPoll${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="📊" title="Send Poll" onDelete={del} />
      <div className="fn-node-body">
        <div className="fn-node-field">
          <label className="fn-node-label">QUESTION</label>
          <input
            className="fn-node-input nodrag"
            value={data.question}
            onChange={(e) => patch({ question: e.target.value })}
            placeholder="Poll question..."
          />
        </div>
        <div className="fn-node-field">
          <label className="fn-node-label">OPTIONS ({data.options.length}/12)</label>
          {data.options.map((opt, i) => (
            <div key={i} style={{ display: "flex", gap: "4px", marginBottom: "4px" }}>
              <input
                className="fn-node-input nodrag"
                value={opt}
                onChange={(e) => updateOption(i, e.target.value)}
                placeholder={`Option ${i + 1}`}
                style={{ flex: 1 }}
              />
              {data.options.length > 2 && (
                <button
                  type="button"
                  className="fn-icon-btn"
                  onClick={() => removeOption(i)}
                  style={{ flexShrink: 0 }}
                >
                  x
                </button>
              )}
            </div>
          ))}
          {data.options.length < 12 && (
            <button type="button" className="fn-btn" onClick={addOption} style={{ width: "100%", marginTop: "4px" }}>
              + Option
            </button>
          )}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.72rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={data.allowMultiple}
            onChange={(e) => patch({ allowMultiple: e.target.checked })}
          />
          Allow multiple selections
        </label>
      </div>
      <Handle type="source" position={Position.Right} id="out" className="fn-handle-out" />
    </div>
  );
}

export const sendPollStudioBlock: StudioFlowBlockDefinition<SendPollData> = {
  kind: "sendPoll",
  channels: ["qr"],
  catalog: {
    kind: "sendPoll",
    icon: "📊",
    name: "Send Poll",
    desc: "Native WhatsApp poll",
    section: "Messages",
    availableInPalette: true,
    status: "active"
  },
  createDefaultData() {
    return { kind: "sendPoll", question: "", options: ["", ""], allowMultiple: false };
  },
  NodeComponent: SendPollNode
};

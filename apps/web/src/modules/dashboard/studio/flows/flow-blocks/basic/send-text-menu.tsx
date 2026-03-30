import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, uid, useNodePatch } from "../editor-shared";
import type { SendTextMenuData, StudioFlowBlockDefinition } from "../types";

function SendTextMenuNode({ id, data, selected }: NodeProps<SendTextMenuData>) {
  const { patch, del } = useNodePatch<SendTextMenuData>(id);

  const addOption = () =>
    patch({ options: [...data.options, { id: uid(), label: "" }] });

  const removeOption = (optId: string) =>
    patch(
      { options: data.options.filter((o) => o.id !== optId) },
      { pruneInvalidEdges: true }
    );

  const patchLabel = (optId: string, label: string) =>
    patch({ options: data.options.map((o) => (o.id === optId ? { ...o, label } : o)) });

  return (
    <div className={`fn-node fn-node-sendTextMenu${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="🔢" title="Text Menu" onDelete={del} />
      <div className="fn-node-body">
        <textarea
          className="fn-node-textarea nodrag"
          value={data.message}
          onChange={(e) => patch({ message: e.target.value })}
          placeholder="Menu intro text..."
          rows={2}
        />
        <div className="fn-btn-rows">
          {data.options.map((opt, i) => (
            <div key={opt.id} className="fn-btn-row" style={{ position: "relative" }}>
              <span
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "var(--text-3)",
                  minWidth: "14px"
                }}
              >
                {i + 1}.
              </span>
              <input
                className="fn-btn-row-input nodrag"
                value={opt.label}
                onChange={(e) => patchLabel(opt.id, e.target.value)}
                placeholder={`Option ${i + 1}`}
              />
              <button
                className="fn-icon-btn nodrag"
                onClick={() => removeOption(opt.id)}
              >
                x
              </button>
              <Handle
                type="source"
                position={Position.Right}
                id={opt.id}
                className="fn-handle-out"
                style={{ position: "absolute", right: -7, top: "50%" }}
              />
            </div>
          ))}
        </div>
        <button className="fn-add-btn nodrag" onClick={addOption}>
          + Add Option ({data.options.length})
        </button>
        <div
          style={{
            fontSize: "0.65rem",
            color: "var(--text-3)",
            lineHeight: 1.4
          }}
        >
          Sends numbered list. User replies with 1, 2, 3…
        </div>
      </div>
    </div>
  );
}

export const sendTextMenuStudioBlock: StudioFlowBlockDefinition<SendTextMenuData> = {
  kind: "sendTextMenu",
  channels: ["qr"],
  catalog: {
    kind: "sendTextMenu",
    icon: "🔢",
    name: "Text Menu",
    desc: "Numbered text options",
    section: "Messages",
    availableInPalette: true,
    status: "active"
  },
  createDefaultData() {
    return {
      kind: "sendTextMenu",
      message: "Choose an option:",
      options: [
        { id: uid(), label: "Option 1" },
        { id: uid(), label: "Option 2" }
      ]
    };
  },
  NodeComponent: SendTextMenuNode
};

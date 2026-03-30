import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, uid, useNodePatch } from "../editor-shared";
import type { StudioFlowBlockDefinition, TextButtonsData } from "../types";

function TextButtonsNode({ id, data, selected }: NodeProps<TextButtonsData>) {
  const { patch, del } = useNodePatch<TextButtonsData>(id);

  const addButton = () => {
    if (data.buttons.length >= 3) {
      return;
    }
    patch({
      buttons: [
        ...data.buttons,
        { id: uid(), label: `Option ${data.buttons.length + 1}` }
      ]
    });
  };

  const removeButton = (buttonId: string) =>
    patch(
      { buttons: data.buttons.filter((button) => button.id !== buttonId) },
      { pruneInvalidEdges: true }
    );

  const patchButton = (buttonId: string, label: string) =>
    patch({
      buttons: data.buttons.map((button) =>
        button.id === buttonId ? { ...button, label } : button
      )
    });

  return (
    <div className={`fn-node fn-node-textButtons${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="🔘" title="Text + Buttons" onDelete={del} />
      <div className="fn-node-body">
        <textarea
          className="fn-node-textarea nodrag"
          value={data.message}
          onChange={(event) => patch({ message: event.target.value })}
          placeholder="Message text..."
          rows={3}
        />
        <input
          className="fn-node-input nodrag"
          value={data.footer}
          onChange={(event) => patch({ footer: event.target.value })}
          placeholder="Footer text (optional)"
        />
        <div className="fn-btn-rows">
          {data.buttons.map((button) => (
            <div key={button.id} className="fn-btn-row">
              <input
                className="fn-btn-row-input nodrag"
                value={button.label}
                onChange={(event) => patchButton(button.id, event.target.value)}
                placeholder="Button label"
              />
              <button className="fn-icon-btn nodrag" onClick={() => removeButton(button.id)}>
                x
              </button>
              <Handle
                type="source"
                position={Position.Right}
                id={button.id}
                className="fn-handle-out"
                style={{ position: "absolute", right: -7, top: "50%" }}
              />
            </div>
          ))}
          {data.buttons.length < 3 && (
            <button className="fn-add-btn nodrag" onClick={addButton}>
              + Add Button ({data.buttons.length}/3)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export const textButtonsStudioBlock: StudioFlowBlockDefinition<TextButtonsData> = {
  kind: "textButtons",
  channels: ["api"],
  catalog: {
    kind: "textButtons",
    icon: "🔘",
    name: "Text + Buttons",
    desc: "Text w/ up to 3 buttons",
    section: "Messages",
    availableInPalette: true,
    status: "active"
  },
  createDefaultData() {
    return {
      kind: "textButtons",
      message: "Hello! How can I help?",
      footer: "",
      buttons: [
        { id: uid(), label: "Option 1" },
        { id: uid(), label: "Option 2" }
      ]
    };
  },
  NodeComponent: TextButtonsNode
};

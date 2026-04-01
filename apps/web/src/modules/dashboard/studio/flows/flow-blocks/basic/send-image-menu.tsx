import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, uid, useNodePatch } from "../editor-shared";
import { MediaUpload } from "../media-upload";
import type { SendImageMenuData, StudioFlowBlockDefinition } from "../types";

function SendImageMenuNode({ id, data, selected }: NodeProps<SendImageMenuData>) {
  const { patch, del } = useNodePatch<SendImageMenuData>(id);

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
    <div className={`fn-node fn-node-sendImageMenu${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="🖼" title="Image Menu" onDelete={del} />
      <div className="fn-node-body">
        <div className="fn-node-field">
          <label className="fn-node-label">IMAGE</label>
          <MediaUpload
            mediaType="image"
            currentUrl={data.url}
            onUrl={(url) => patch({ url })}
          />
        </div>
        <div className="fn-node-field">
          <label className="fn-node-label">URL</label>
          <input
            className="fn-node-input nodrag"
            value={data.url}
            onChange={(e) => patch({ url: e.target.value })}
            placeholder="or paste URL..."
          />
        </div>
        <textarea
          className="fn-node-textarea nodrag"
          value={data.intro}
          onChange={(e) => patch({ intro: e.target.value })}
          placeholder="Caption / intro text above options..."
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
                style={{ position: "absolute", right: -8, top: "50%" }}
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
          Image + numbered caption. User replies with 1, 2, 3…
        </div>
      </div>
    </div>
  );
}

export const sendImageMenuStudioBlock: StudioFlowBlockDefinition<SendImageMenuData> = {
  kind: "sendImageMenu",
  channels: ["qr"],
  catalog: {
    kind: "sendImageMenu",
    icon: "🖼",
    name: "Image Menu",
    desc: "Image + numbered options",
    section: "Messages",
    availableInPalette: true,
    status: "active"
  },
  createDefaultData() {
    return {
      kind: "sendImageMenu",
      url: "",
      intro: "",
      options: [
        { id: uid(), label: "Option 1" },
        { id: uid(), label: "Option 2" }
      ]
    };
  },
  NodeComponent: SendImageMenuNode
};

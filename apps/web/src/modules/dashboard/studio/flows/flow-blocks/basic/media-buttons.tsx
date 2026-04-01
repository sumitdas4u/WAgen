import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, uid, useNodePatch } from "../editor-shared";
import { MediaUpload } from "../media-upload";
import type { MediaButtonsData, StudioFlowBlockDefinition } from "../types";

function MediaButtonsNode({ id, data, selected }: NodeProps<MediaButtonsData>) {
  const { patch, del } = useNodePatch<MediaButtonsData>(id);

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
    <div className={`fn-node fn-node-mediaButtons${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="🎞️" title="Media + Buttons" onDelete={del} />
      <div className="fn-node-body">
        <div className="fn-node-field">
          <label className="fn-node-label">TYPE</label>
          <select
            className="fn-node-select nodrag"
            value={data.mediaType}
            onChange={(event) =>
              patch({
                mediaType: event.target.value as MediaButtonsData["mediaType"]
              })
            }
          >
            <option value="image">Image</option>
            <option value="video">Video</option>
            <option value="document">Document</option>
          </select>
        </div>
        <div className="fn-node-field">
          <label className="fn-node-label">FILE</label>
          <MediaUpload
            mediaType={data.mediaType}
            currentUrl={data.url}
            onUrl={(url) => patch({ url })}
          />
        </div>
        <div className="fn-node-field">
          <label className="fn-node-label">URL</label>
          <input
            className="fn-node-input nodrag"
            value={data.url}
            onChange={(event) => patch({ url: event.target.value })}
            placeholder="or paste URL..."
          />
        </div>
        <textarea
          className="fn-node-textarea nodrag"
          value={data.caption}
          onChange={(event) => patch({ caption: event.target.value })}
          placeholder="Caption..."
          rows={2}
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
                style={{ position: "absolute", right: -8, top: "50%" }}
              />
            </div>
          ))}
          {data.buttons.length < 3 && (
            <button className="fn-add-btn nodrag" onClick={addButton}>
              + Add Button
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export const mediaButtonsStudioBlock: StudioFlowBlockDefinition<MediaButtonsData> = {
  kind: "mediaButtons",
  channels: ["api"],
  catalog: {
    kind: "mediaButtons",
    icon: "🎞️",
    name: "Media + Buttons",
    desc: "Image/video + buttons",
    section: "Messages",
    availableInPalette: true,
    status: "active"
  },
  createDefaultData() {
    return {
      kind: "mediaButtons",
      mediaType: "image",
      url: "",
      caption: "",
      buttons: [{ id: uid(), label: "Option 1" }]
    };
  },
  NodeComponent: MediaButtonsNode
};

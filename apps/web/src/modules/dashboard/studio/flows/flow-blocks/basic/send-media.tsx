import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, useNodePatch } from "../editor-shared";
import { MediaUpload } from "../media-upload";
import type { SendMediaData, StudioFlowBlockDefinition } from "../types";

function SendMediaNode({ id, data, selected }: NodeProps<SendMediaData>) {
  const { patch, del } = useNodePatch<SendMediaData>(id);

  return (
    <div className={`fn-node fn-node-sendMedia${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="🖼️" title="Send Media" onDelete={del} />
      <div className="fn-node-body">
        <div className="fn-node-field">
          <label className="fn-node-label">TYPE</label>
          <select
            className="fn-node-select nodrag"
            value={data.mediaType}
            onChange={(e) => patch({ mediaType: e.target.value as SendMediaData["mediaType"] })}
          >
            <option value="image">Image</option>
            <option value="video">Video</option>
            <option value="document">Document</option>
            <option value="audio">Audio</option>
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
            onChange={(e) => patch({ url: e.target.value })}
            placeholder="or paste URL..."
          />
        </div>
        {data.mediaType !== "audio" && (
          <div className="fn-node-field">
            <label className="fn-node-label">CAPTION</label>
            <input
              className="fn-node-input nodrag"
              value={data.caption}
              onChange={(e) => patch({ caption: e.target.value })}
              placeholder="Optional caption..."
            />
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="out" className="fn-handle-out" />
    </div>
  );
}

export const sendMediaStudioBlock: StudioFlowBlockDefinition<SendMediaData> = {
  kind: "sendMedia",
  channels: ["qr", "api"],
  catalog: {
    kind: "sendMedia",
    icon: "🖼️",
    name: "Send Media",
    desc: "Image, video, document or audio",
    section: "Messages",
    availableInPalette: true,
    status: "active"
  },
  createDefaultData() {
    return { kind: "sendMedia", mediaType: "image", url: "", caption: "" };
  },
  NodeComponent: SendMediaNode
};

import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, useNodePatch } from "../editor-shared";
import type { AiReplyData, StudioFlowBlockDefinition } from "../types";

function AiReplyNode({ id, data, selected }: NodeProps<AiReplyData>) {
  const { patch, del } = useNodePatch<AiReplyData>(id);
  const isOngoing = data.mode === "ongoing";

  return (
    <div className={`fn-node fn-node-aiReply${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="🤖" title="AI Reply" onDelete={del} />
      <div className="fn-node-body">
        <div className="fn-node-field">
          <label className="fn-node-label">MODE</label>
          <select
            className="fn-node-select nodrag"
            value={data.mode}
            onChange={(event) =>
              patch(
                { mode: event.target.value as AiReplyData["mode"] },
                { pruneInvalidEdges: true }
              )
            }
          >
            <option value="one_shot">One-shot - AI replies once, flow continues</option>
            <option value="ongoing">Ongoing - AI takes over permanently</option>
          </select>
        </div>
        <div className="fn-node-field">
          <label className="fn-node-label">CONTEXT NOTE (optional)</label>
          <textarea
            className="fn-node-textarea nodrag"
            value={data.contextNote}
            onChange={(event) => patch({ contextNote: event.target.value })}
            placeholder="Extra instructions for the AI at this point..."
            rows={2}
          />
        </div>
        <div
          style={{
            fontSize: "0.7rem",
            color: isOngoing ? "#7c3aed" : "var(--text-3)",
            background: isOngoing ? "var(--fn-violet-bg)" : "#f8fafc",
            border: `1px solid ${isOngoing ? "var(--fn-violet-bdr)" : "#e2e8f0"}`,
            borderRadius: 7,
            padding: "0.28rem 0.44rem",
            lineHeight: 1.4
          }}
        >
          {isOngoing
            ? "AI takes over. All future messages in this session go to AI."
            : "AI replies once, then the flow continues at the next node."}
        </div>
      </div>
      {!isOngoing && (
        <Handle type="source" position={Position.Right} id="out" className="fn-handle-out" />
      )}
    </div>
  );
}

export const aiReplyStudioBlock: StudioFlowBlockDefinition<AiReplyData> = {
  kind: "aiReply",
  channels: ["web", "qr", "api"],
  catalog: {
    kind: "aiReply",
    icon: "🤖",
    name: "AI Reply",
    desc: "Let AI handle response",
    section: "Actions",
    availableInPalette: true,
    status: "active"
  },
  createDefaultData() {
    return {
      kind: "aiReply",
      mode: "one_shot",
      contextNote: ""
    };
  },
  NodeComponent: AiReplyNode
};

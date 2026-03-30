import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, useNodePatch } from "../editor-shared";
import type { AskQuestionData, StudioFlowBlockDefinition } from "../types";

function AskQuestionNode({ id, data, selected }: NodeProps<AskQuestionData>) {
  const { patch, del } = useNodePatch<AskQuestionData>(id);

  return (
    <div className={`fn-node fn-node-askQuestion${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="❓" title="Ask Question" onDelete={del} />
      <div className="fn-node-body">
        <textarea
          className="fn-node-textarea nodrag"
          value={data.question}
          onChange={(event) => patch({ question: event.target.value })}
          placeholder="Your question..."
          rows={2}
        />
        <div className="fn-two">
          <div className="fn-node-field">
            <label className="fn-node-label">SAVE AS</label>
            <input
              className="fn-node-input nodrag"
              value={data.variableName}
              onChange={(event) => patch({ variableName: event.target.value })}
              placeholder="variable_name"
            />
          </div>
          <div className="fn-node-field">
            <label className="fn-node-label">INPUT TYPE</label>
            <select
              className="fn-node-select nodrag"
              value={data.inputType}
              onChange={(event) =>
                patch({
                  inputType: event.target.value as AskQuestionData["inputType"]
                })
              }
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="email">Email</option>
              <option value="phone">Phone</option>
            </select>
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="out" className="fn-handle-out" />
    </div>
  );
}

export const askQuestionStudioBlock: StudioFlowBlockDefinition<AskQuestionData> = {
  kind: "askQuestion",
  channels: ["web", "qr", "api"],
  catalog: {
    kind: "askQuestion",
    icon: "❓",
    name: "Ask Question",
    desc: "Ask & save answer",
    section: "Collect",
    availableInPalette: true,
    status: "active"
  },
  createDefaultData() {
    return {
      kind: "askQuestion",
      question: "What is your name?",
      variableName: "name",
      inputType: "text"
    };
  },
  NodeComponent: AskQuestionNode
};

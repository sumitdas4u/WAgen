import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, uid, useNodePatch } from "../editor-shared";
import type { AiAgentData, AiAgentMapping, StudioFlowBlockDefinition } from "../types";

function makeMapping(): AiAgentMapping {
  return { id: uid(), variableName: "", path: "" };
}

function AiAgentNode({ id, data, selected }: NodeProps<AiAgentData>) {
  const { patch, del } = useNodePatch<AiAgentData>(id);
  const isJson = data.outputMode === "json";

  return (
    <div className={`fn-node fn-node-aiAgent${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="AI" title="AI Agent" onDelete={del} />
      <div className="fn-node-body">
        <div className="fn-node-field">
          <label className="fn-node-label">OUTPUT MODE</label>
          <select
            className="fn-node-select nodrag"
            value={data.outputMode}
            onChange={(event) =>
              patch({ outputMode: event.target.value as AiAgentData["outputMode"] })
            }
          >
            <option value="text">Text output</option>
            <option value="json">JSON output</option>
          </select>
        </div>

        <div className="fn-node-field">
          <label className="fn-node-label">INSTRUCTIONS</label>
          <textarea
            className="fn-node-textarea nodrag"
            rows={4}
            value={data.instructions}
            onChange={(event) => patch({ instructions: event.target.value })}
            placeholder="Analyze the lead info and classify urgency, interest level, and next best action."
          />
        </div>

        <div className="fn-node-field">
          <label className="fn-node-label">INPUT DATA</label>
          <textarea
            className="fn-node-textarea nodrag"
            rows={4}
            value={data.inputTemplate}
            onChange={(event) => patch({ inputTemplate: event.target.value })}
            placeholder={"Name: {{name}}\nPhone: {{phone}}\nLast reply: {{answer}}"}
          />
        </div>

        <div className="fn-node-field">
          <label className="fn-node-label">SAVE AS</label>
          <input
            className="fn-node-input nodrag"
            value={data.saveAs}
            onChange={(event) => patch({ saveAs: event.target.value })}
            placeholder="ai_agent_result"
          />
          <div className="fn-api-hint" style={{ marginTop: "0.18rem" }}>
            Raw result is stored in <code style={{ fontSize: "0.65rem" }}>{`{{${data.saveAs || "ai_agent_result"}}}`}</code>.
          </div>
        </div>

        {isJson && (
          <div className="fn-node-field">
            <label className="fn-node-label">JSON FIELD MAPPINGS</label>
            <div className="fn-btn-rows">
              {data.responseMappings.length > 0 && (
                <div className="fn-api-row" style={{ opacity: 0.45, pointerEvents: "none" }}>
                  <span style={{ fontSize: "0.63rem", fontWeight: 700 }}>JSON path</span>
                  <span style={{ fontSize: "0.63rem", fontWeight: 700 }}>Variable</span>
                  <span />
                </div>
              )}
              {data.responseMappings.map((mapping) => (
                <div key={mapping.id} className="fn-api-row">
                  <input
                    className="fn-btn-row-input nodrag"
                    value={mapping.path}
                    onChange={(event) =>
                      patch({
                        responseMappings: data.responseMappings.map((item) =>
                          item.id === mapping.id ? { ...item, path: event.target.value } : item
                        )
                      })
                    }
                    placeholder="category.label"
                  />
                  <input
                    className="fn-btn-row-input nodrag"
                    value={mapping.variableName}
                    onChange={(event) =>
                      patch({
                        responseMappings: data.responseMappings.map((item) =>
                          item.id === mapping.id
                            ? { ...item, variableName: event.target.value }
                            : item
                        )
                      })
                    }
                    placeholder="lead_category"
                  />
                  <button
                    type="button"
                    className="fn-icon-btn nodrag"
                    onClick={() =>
                      patch({
                        responseMappings: data.responseMappings.filter(
                          (item) => item.id !== mapping.id
                        )
                      })
                    }
                  >
                    x
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="fn-add-btn nodrag"
                onClick={() =>
                  patch({ responseMappings: [...data.responseMappings, makeMapping()] })
                }
              >
                + Add Mapping
              </button>
            </div>
          </div>
        )}

        <div
          style={{
            fontSize: "0.7rem",
            color: "var(--text-3)",
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 7,
            padding: "0.28rem 0.44rem",
            lineHeight: 1.4
          }}
        >
          {isJson
            ? "Ask the model for a JSON object if you want to map multiple fields into later flow variables."
            : "Use text mode when you only need one computed value for later steps."}
        </div>

        <div className="fn-api-outputs">
          <div className="fn-api-branch">
            <span className="fn-cond-dot fn-cond-dot-true" />
            <span>Success</span>
            <Handle
              type="source"
              position={Position.Right}
              id="success"
              className="fn-handle-out fn-handle-success"
              style={{ position: "absolute", right: -8 }}
            />
          </div>
          <div className="fn-api-branch">
            <span className="fn-cond-dot fn-cond-dot-false" />
            <span>Fail</span>
            <Handle
              type="source"
              position={Position.Right}
              id="fail"
              className="fn-handle-out fn-handle-fail"
              style={{ position: "absolute", right: -8 }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export const aiAgentStudioBlock: StudioFlowBlockDefinition<AiAgentData> = {
  kind: "aiAgent",
  channels: ["web", "qr", "api"],
  catalog: {
    kind: "aiAgent",
    icon: "AI",
    name: "AI Agent",
    desc: "Process data and save variables",
    section: "Actions",
    availableInPalette: true,
    status: "active"
  },
  createDefaultData() {
    return {
      kind: "aiAgent",
      instructions:
        'Return useful structured output. Example JSON: {"summary":"...", "intent":"...", "score":"hot"}',
      inputTemplate: "",
      outputMode: "json",
      saveAs: "ai_agent_result",
      responseMappings: []
    };
  },
  NodeComponent: AiAgentNode
};

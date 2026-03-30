import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, useNodePatch } from "../editor-shared";
import type { StudioFlowBlockDefinition, TemplateData } from "../types";

function TemplateNode({ id, data, selected }: NodeProps<TemplateData>) {
  const { patch, del } = useNodePatch<TemplateData>(id);

  return (
    <div className={`fn-node fn-node-template${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="📄" title="Template" onDelete={del} />
      <div className="fn-node-body">
        <div className="fn-node-field">
          <label className="fn-node-label">TEMPLATE NAME</label>
          <input
            className="fn-node-input nodrag"
            value={data.templateName}
            onChange={(event) => patch({ templateName: event.target.value })}
            placeholder="my_template_name"
          />
        </div>
        <div className="fn-node-field">
          <label className="fn-node-label">LANGUAGE</label>
          <select
            className="fn-node-select nodrag"
            value={data.language}
            onChange={(event) => patch({ language: event.target.value })}
          >
            <option value="en">English (en)</option>
            <option value="en_US">English US</option>
            <option value="hi">Hindi (hi)</option>
            <option value="es">Spanish (es)</option>
            <option value="pt_BR">Portuguese (pt_BR)</option>
            <option value="ar">Arabic (ar)</option>
          </select>
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="out" className="fn-handle-out" />
    </div>
  );
}

export const templateStudioBlock: StudioFlowBlockDefinition<TemplateData> = {
  kind: "template",
  channels: ["api"],
  catalog: {
    kind: "template",
    icon: "📄",
    name: "Template",
    desc: "Send approved template",
    section: "Messages",
    availableInPalette: true,
    status: "active"
  },
  createDefaultData() {
    return {
      kind: "template",
      templateName: "",
      language: "en"
    };
  },
  NodeComponent: TemplateNode
};

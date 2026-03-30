import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, useNodePatch } from "../editor-shared";
import type { MultiProductData, StudioFlowBlockDefinition } from "../types";

function MultiProductNode({ id, data, selected }: NodeProps<MultiProductData>) {
  const { patch, del } = useNodePatch<MultiProductData>(id);

  return (
    <div className={`fn-node fn-node-multiProduct${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="CAT" title="Multi Product" onDelete={del} />
      <div className="fn-node-body">
        <div className="fn-node-field">
          <label className="fn-node-label">CATALOG ID</label>
          <input
            className="fn-node-input nodrag"
            value={data.catalogId}
            onChange={(event) => patch({ catalogId: event.target.value })}
            placeholder="catalog_id"
          />
        </div>
        <textarea
          className="fn-node-textarea nodrag"
          value={data.bodyText}
          onChange={(event) => patch({ bodyText: event.target.value })}
          placeholder="Body text..."
          rows={2}
        />
        <div className="fn-node-field">
          <label className="fn-node-label">SECTIONS ({data.sections.length})</label>
          {data.sections.map((section, index) => (
            <div
              key={`${section.title}-${index}`}
              style={{ fontSize: "0.73rem", color: "var(--text-2)", padding: "0.2rem 0" }}
            >
              {section.title}: {section.productIds.length} product(s)
            </div>
          ))}
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="out" className="fn-handle-out" />
    </div>
  );
}

export const multiProductStudioBlock: StudioFlowBlockDefinition<MultiProductData> = {
  kind: "multiProduct",
  channels: ["api"],
  catalog: {
    kind: "multiProduct",
    icon: "CAT",
    name: "Multi Product",
    desc: "Legacy commerce block",
    section: "Commerce",
    availableInPalette: false,
    status: "legacy"
  },
  createDefaultData() {
    return {
      kind: "multiProduct",
      catalogId: "",
      bodyText: "",
      sections: [{ title: "Products", productIds: [] }]
    };
  },
  NodeComponent: MultiProductNode
};

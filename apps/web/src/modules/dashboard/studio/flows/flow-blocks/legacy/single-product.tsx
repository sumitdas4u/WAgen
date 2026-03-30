import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, useNodePatch } from "../editor-shared";
import type { SingleProductData, StudioFlowBlockDefinition } from "../types";

function SingleProductNode({ id, data, selected }: NodeProps<SingleProductData>) {
  const { patch, del } = useNodePatch<SingleProductData>(id);

  return (
    <div className={`fn-node fn-node-singleProduct${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="SKU" title="Single Product" onDelete={del} />
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
        <div className="fn-node-field">
          <label className="fn-node-label">PRODUCT ID</label>
          <input
            className="fn-node-input nodrag"
            value={data.productId}
            onChange={(event) => patch({ productId: event.target.value })}
            placeholder="product_retailer_id"
          />
        </div>
        <textarea
          className="fn-node-textarea nodrag"
          value={data.bodyText}
          onChange={(event) => patch({ bodyText: event.target.value })}
          placeholder="Body text..."
          rows={2}
        />
      </div>
      <Handle type="source" position={Position.Right} id="out" className="fn-handle-out" />
    </div>
  );
}

export const singleProductStudioBlock: StudioFlowBlockDefinition<SingleProductData> = {
  kind: "singleProduct",
  channels: ["api"],
  catalog: {
    kind: "singleProduct",
    icon: "SKU",
    name: "Single Product",
    desc: "Legacy commerce block",
    section: "Commerce",
    availableInPalette: false,
    status: "legacy"
  },
  createDefaultData() {
    return {
      kind: "singleProduct",
      catalogId: "",
      productId: "",
      bodyText: ""
    };
  },
  NodeComponent: SingleProductNode
};

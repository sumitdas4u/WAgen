import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, useNodePatch } from "../editor-shared";
import type { StudioFlowBlockDefinition, WhatsappPayData } from "../types";

function WhatsappPayNode({ id, data, selected }: NodeProps<WhatsappPayData>) {
  const { patch, del } = useNodePatch<WhatsappPayData>(id);

  return (
    <div className={`fn-node fn-node-whatsappPay${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="PAY" title="WhatsApp Pay" onDelete={del} />
      <div className="fn-node-body">
        <div className="fn-two">
          <div className="fn-node-field">
            <label className="fn-node-label">AMOUNT</label>
            <input
              className="fn-node-input nodrag"
              value={data.amount}
              onChange={(event) => patch({ amount: event.target.value })}
              placeholder="100.00"
            />
          </div>
          <div className="fn-node-field">
            <label className="fn-node-label">CURRENCY</label>
            <select
              className="fn-node-select nodrag"
              value={data.currency}
              onChange={(event) => patch({ currency: event.target.value })}
            >
              <option value="INR">INR</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>
        <input
          className="fn-node-input nodrag"
          value={data.description}
          onChange={(event) => patch({ description: event.target.value })}
          placeholder="Payment description"
        />
        <div className="fn-pay-outputs">
          <div className="fn-pay-branch">
            <span className="fn-cond-dot fn-cond-dot-true" />
            <span>Success</span>
            <Handle
              type="source"
              position={Position.Right}
              id="success"
              className="fn-handle-out fn-handle-success"
              style={{ position: "absolute", right: -7 }}
            />
          </div>
          <div className="fn-pay-branch">
            <span className="fn-cond-dot fn-cond-dot-false" />
            <span>Failed</span>
            <Handle
              type="source"
              position={Position.Right}
              id="fail"
              className="fn-handle-out fn-handle-fail"
              style={{ position: "absolute", right: -7 }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export const whatsappPayStudioBlock: StudioFlowBlockDefinition<WhatsappPayData> = {
  kind: "whatsappPay",
  channels: ["api"],
  catalog: {
    kind: "whatsappPay",
    icon: "PAY",
    name: "WhatsApp Pay",
    desc: "Legacy commerce block",
    section: "Commerce",
    availableInPalette: false,
    status: "legacy"
  },
  createDefaultData() {
    return {
      kind: "whatsappPay",
      amount: "",
      description: "Payment",
      currency: "INR"
    };
  },
  NodeComponent: WhatsappPayNode
};

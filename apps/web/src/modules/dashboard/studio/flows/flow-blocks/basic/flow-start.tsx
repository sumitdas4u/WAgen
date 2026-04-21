import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, uid, useNodePatch } from "../editor-shared";
import type { FlowStartData, RouteConfig, StudioFlowBlockDefinition, Trigger } from "../types";

const ROUTE_COLORS = [
  { border: "#86efac", bg: "#f0fdf4", labelColor: "#166534", labelBorder: "#d1fae5" },
  { border: "#93c5fd", bg: "#eff6ff", labelColor: "#1e40af", labelBorder: "#bfdbfe" },
  { border: "#c4b5fd", bg: "#f5f3ff", labelColor: "#5b21b6", labelBorder: "#ddd6fe" },
  { border: "#fca5a5", bg: "#fef2f2", labelColor: "#991b1b", labelBorder: "#fecaca" },
] as const;

function FlowStartNode({ id, data, selected }: NodeProps<FlowStartData>) {
  const { patch, del } = useNodePatch<FlowStartData>(id);

  const addRoute = () =>
    patch({ routes: [...data.routes, { id: uid(), label: "Route", triggers: [] }] });

  const removeRoute = (routeId: string) =>
    patch({ routes: data.routes.filter((r) => r.id !== routeId) });

  const patchRoute = (routeId: string, updates: Partial<RouteConfig>) =>
    patch({ routes: data.routes.map((r) => (r.id === routeId ? { ...r, ...updates } : r)) });

  const addTriggerToRoute = (routeId: string) =>
    patchRoute(routeId, {
      triggers: [
        ...(data.routes.find((r) => r.id === routeId)?.triggers ?? []),
        { id: uid(), type: "keyword", value: "" }
      ]
    });

  const removeTriggerFromRoute = (routeId: string, triggerId: string) =>
    patchRoute(routeId, {
      triggers: (data.routes.find((r) => r.id === routeId)?.triggers ?? []).filter(
        (t) => t.id !== triggerId
      )
    });

  const patchTriggerInRoute = (routeId: string, triggerId: string, updates: Partial<Trigger>) =>
    patchRoute(routeId, {
      triggers: (data.routes.find((r) => r.id === routeId)?.triggers ?? []).map((t) =>
        t.id === triggerId ? { ...t, ...updates } : t
      )
    });

  const usesRoutes = data.routes.length > 0;

  return (
    <div className={`fn-node fn-node-flowStart${selected ? " selected" : ""}`}>
      <NodeHeader icon="▶" title="Flow Start" onDelete={del} />
      <div className="fn-node-body">

        <div className="fn-node-field">
          <label className="fn-node-label">FLOW LABEL</label>
          <input
            className="fn-node-input nodrag"
            value={data.label}
            onChange={(e) => patch({ label: e.target.value })}
            placeholder="Flow name"
          />
        </div>

        <div className="fn-node-field">
          <label className="fn-node-label">WELCOME MESSAGE</label>
          <textarea
            className="fn-node-textarea nodrag"
            value={data.welcomeMessage}
            onChange={(e) => patch({ welcomeMessage: e.target.value })}
            placeholder="Optional greeting..."
            rows={2}
          />
        </div>

        <div className="fn-node-field">
          <label className="fn-node-label">KEYWORD ROUTES</label>

          {data.routes.map((route, index) => {
            const colors = ROUTE_COLORS[index % ROUTE_COLORS.length];
            return (
              <div
                key={route.id}
                className="nodrag"
                style={{
                  border: `1px solid ${colors.border}`,
                  background: colors.bg,
                  borderRadius: 8,
                  padding: "8px 10px",
                  marginBottom: 6,
                  position: "relative"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <input
                    className="fn-node-input nodrag"
                    style={{ flex: 1, fontWeight: 600, color: colors.labelColor, borderColor: colors.labelBorder }}
                    value={route.label}
                    onChange={(e) => patchRoute(route.id, { label: e.target.value })}
                    placeholder="Route name"
                  />
                  <button className="fn-icon-btn nodrag" onClick={() => removeRoute(route.id)}>
                    ✕
                  </button>
                </div>

                {route.triggers.map((trigger) => (
                  <div key={trigger.id} className="fn-btn-row" style={{ marginBottom: "0.2rem" }}>
                    <select
                      className="fn-node-select nodrag"
                      style={{ flex: "0 0 90px" }}
                      value={trigger.type}
                      onChange={(e) =>
                        patchTriggerInRoute(route.id, trigger.id, {
                          type: e.target.value as Trigger["type"]
                        })
                      }
                    >
                      <option value="keyword">Keyword</option>
                      <option value="any_message">Any Msg</option>
                      <option value="template_reply">TPL Reply</option>
                      <option value="qr_start">QR Code</option>
                      <option value="website_start">Widget</option>
                    </select>
                    <input
                      className="fn-node-input nodrag"
                      style={{ flex: 1 }}
                      value={trigger.value}
                      onChange={(e) =>
                        patchTriggerInRoute(route.id, trigger.id, { value: e.target.value })
                      }
                      placeholder="value..."
                    />
                    <button
                      className="fn-icon-btn nodrag"
                      onClick={() => removeTriggerFromRoute(route.id, trigger.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}

                <button
                  className="fn-add-btn nodrag"
                  style={{ width: "100%", borderColor: colors.border, color: colors.labelColor }}
                  onClick={() => addTriggerToRoute(route.id)}
                >
                  + trigger
                </button>

                <Handle
                  type="source"
                  position={Position.Right}
                  id={route.id}
                  className="fn-handle-out"
                  style={{ position: "absolute", right: -8, top: "50%", transform: "translateY(-50%)" }}
                />
              </div>
            );
          })}

          <button className="fn-add-btn nodrag" onClick={addRoute}>
            + Add Route
          </button>
        </div>

        <div
          className="fn-node-field nodrag"
          style={{
            border: "1px dashed #fbbf24",
            background: "#fffbeb",
            borderRadius: 8,
            padding: "8px 10px",
            position: "relative",
            marginTop: 4
          }}
        >
          <div className="fn-node-label" style={{ marginBottom: 6 }}>
            {usesRoutes ? "DEFAULT (no route matched)" : "ANY MESSAGE (default)"}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 11 }}>
            <input
              type="checkbox"
              className="nodrag"
              checked={!!data.fallbackUseAi}
              onChange={(e) => patch({ fallbackUseAi: e.target.checked })}
            />
            {usesRoutes ? "Use AI when no route matches" : "Use AI to handle messages"}
          </label>

          {usesRoutes ? (
            <Handle
              type="source"
              position={Position.Right}
              id="default"
              className="fn-handle-out"
              style={{ position: "absolute", right: -8, top: "50%", transform: "translateY(-50%)" }}
            />
          ) : (
            <Handle
              type="source"
              position={Position.Right}
              id="out"
              className="fn-handle-out"
              style={{ position: "absolute", right: -8, top: "50%", transform: "translateY(-50%)" }}
            />
          )}
        </div>

      </div>
    </div>
  );
}

export const flowStartStudioBlock: StudioFlowBlockDefinition<FlowStartData> = {
  kind: "flowStart",
  channels: ["web", "qr", "api"],
  catalog: {
    kind: "flowStart",
    icon: "▶",
    name: "Flow Start",
    desc: "Entry trigger",
    section: "Triggers",
    availableInPalette: true,
    status: "active"
  },
  createDefaultData() {
    return {
      kind: "flowStart",
      label: "Flow Start",
      triggers: [],
      routes: [],
      welcomeMessage: "",
      fallbackUseAi: false
    };
  },
  NodeComponent: FlowStartNode
};

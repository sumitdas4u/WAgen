# Flow Start Keyword Route Branching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a single Flow Start node to route to different downstream nodes based on which keyword triggered the flow, using labeled route groups each with their own output handle.

**Architecture:** Add `routes: RouteConfig[]` to `FlowStartData`; each route has a label, triggers list, and a ReactFlow source handle. The engine's trigger-matching function is extended to return which specific trigger fired, injecting `__flow_trigger_id` into initial vars so the flow-start block can select the correct route handle at runtime. Legacy nodes with no routes fall back to the existing `out` handle.

**Tech Stack:** React + ReactFlow (web), TypeScript, Fastify API (flow engine, no test runner)

---

## Files

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `apps/web/src/modules/dashboard/studio/flows/flow-blocks/types.ts` | Add `RouteConfig`, extend `FlowStartData` |
| Modify | `apps/web/src/modules/dashboard/studio/flows/flow-blocks/basic/flow-start.tsx` | Route-card UI, per-route handles, default handle |
| Modify | `apps/web/src/modules/dashboard/studio/flows/flow-validation.ts` | Dynamic handle spec + labels for flowStart |
| Modify | `apps/api/src/services/flow-blocks/basic/flow-start.ts` | Route-aware next-node selection |
| Modify | `apps/api/src/services/flow-engine-service.ts` | `findMatchedTrigger`, inject `__flow_trigger_id`, flatten route triggers |

---

## Task 1: Add `RouteConfig` type and extend `FlowStartData`

**Files:**
- Modify: `apps/web/src/modules/dashboard/studio/flows/flow-blocks/types.ts`

- [ ] **Step 1: Add `RouteConfig` interface and `routes` field**

In `types.ts`, add after the `Trigger` interface (line 17) and update `FlowStartData`:

```ts
export interface RouteConfig {
  id: string;
  label: string;
  triggers: Trigger[];
}
```

Update `FlowStartData` (currently at line 42):

```ts
export interface FlowStartData {
  kind: "flowStart";
  label: string;
  triggers: Trigger[];       // legacy — kept for backward compat
  routes: RouteConfig[];     // new
  welcomeMessage: string;
  fallbackUseAi?: boolean;
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors related to `FlowStartData` or `RouteConfig`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/modules/dashboard/studio/flows/flow-blocks/types.ts
git commit -m "feat(types): add RouteConfig and routes[] to FlowStartData"
```

---

## Task 2: Update API flow-start block

**Files:**
- Modify: `apps/api/src/services/flow-blocks/basic/flow-start.ts`

- [ ] **Step 1: Rewrite `flow-start.ts` to route by matched trigger**

Replace the entire file content:

```ts
import { getDefaultNextNodeId, getNextNodeId, interpolate } from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

export const flowStartBlock: FlowBlockModule = {
  type: "flowStart",
  async execute(context) {
    const welcome = interpolate(
      String(context.node.data.welcomeMessage ?? ""),
      context.vars
    ).trim();

    if (welcome) {
      await context.sendReply({ type: "text", text: welcome });
    }

    const routes = Array.isArray(context.node.data.routes) ? context.node.data.routes : [];
    const triggerId = String(context.vars["__flow_trigger_id"] ?? "");

    if (routes.length > 0) {
      const matchedRoute = routes.find(
        (route: { id: string; triggers?: Array<{ id?: string }> }) =>
          Array.isArray(route.triggers) &&
          route.triggers.some((t: { id?: string }) => t.id === triggerId)
      );
      const handleId = matchedRoute ? String(matchedRoute.id) : "default";
      return {
        signal: "continue",
        nextNodeId: getNextNodeId(context.nodes, context.edges, context.node.id, handleId),
        variables: context.vars
      };
    }

    // Legacy: no routes defined — use single "out" handle
    return {
      signal: "continue",
      nextNodeId: getDefaultNextNodeId(context.nodes, context.edges, context.node.id),
      variables: context.vars
    };
  }
};
```

- [ ] **Step 2: Verify API compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors in `flow-start.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/flow-blocks/basic/flow-start.ts
git commit -m "feat(api): flow-start block routes by matched trigger id"
```

---

## Task 3: Update flow engine — trigger matching and variable injection

**Files:**
- Modify: `apps/api/src/services/flow-engine-service.ts`

- [ ] **Step 1: Add `__FLOW_TRIGGER_ID_KEY` constant**

Near the top of `flow-engine-service.ts`, after existing constants, add:

```ts
const __FLOW_TRIGGER_ID_KEY = "__flow_trigger_id";
```

- [ ] **Step 2: Update `getEffectiveTriggers` to flatten route triggers**

The function currently starts at around line 164. Update it to also read triggers from `routes`:

```ts
function getEffectiveTriggers(flow: FlowRow): { id?: string; type: string; value: string }[] {
  const flowLevel = Array.isArray(flow.triggers) ? flow.triggers : [];
  const { nodes } = getFlowGraph(flow);
  const startNode = nodes.find((node) => node.type === "flowStart");

  const nodeTriggers = Array.isArray(startNode?.data?.triggers)
    ? (startNode.data.triggers as Array<{ id?: string; type: string; value: string }>)
    : [];

  const routeTriggers = Array.isArray(startNode?.data?.routes)
    ? (startNode.data.routes as Array<{ triggers?: Array<{ id?: string; type: string; value: string }> }>)
        .flatMap((route) => route.triggers ?? [])
    : [];

  const merged = [...flowLevel];
  for (const trigger of [...nodeTriggers, ...routeTriggers]) {
    if (
      !merged.some(
        (candidate) =>
          candidate.type === trigger.type && candidate.value === trigger.value
      )
    ) {
      merged.push({
        id: trigger.id ?? trigger.type,
        type: trigger.type as FlowTrigger["type"],
        value: trigger.value
      });
    }
  }

  return merged;
}
```

- [ ] **Step 3: Add `findMatchedTrigger` function**

Add this function directly below `matchingFlow` (keep `matchingFlow` intact — it is still used in some paths and now delegates here):

```ts
function findMatchedTrigger(params: {
  message: string;
  flows: FlowRow[];
  channelType: FlowChannelType;
  isFirstInboundMessage: boolean;
}): { flow: FlowRow; triggerId: string } | null {
  const { message, flows, channelType, isFirstInboundMessage } = params;
  const lower = message.toLowerCase().trim();

  for (const flow of flows) {
    const triggers = getEffectiveTriggers(flow);
    const matched = triggers.find(
      (t) => t.type === "keyword" && t.value && lower.includes(t.value.toLowerCase())
    );
    if (matched) return { flow, triggerId: matched.id ?? matched.type };
  }

  for (const flow of flows) {
    const triggers = getEffectiveTriggers(flow);
    const matched = triggers.find(
      (t) => t.type === "template_reply" && matchesTemplateReply(message, t.value)
    );
    if (matched) return { flow, triggerId: matched.id ?? matched.type };
  }

  for (const flow of flows) {
    const triggers = getEffectiveTriggers(flow);
    const matched = triggers.find(
      (t) =>
        (t.type === "qr_start" || t.type === "website_start") &&
        matchesChannelStartTrigger({
          channelType,
          isFirstInboundMessage,
          lowerMessage: lower,
          trigger: t
        })
    );
    if (matched) return { flow, triggerId: matched.id ?? matched.type };
  }

  for (const flow of flows) {
    const triggers = getEffectiveTriggers(flow);
    const matched = triggers.find((t) => t.type === "any_message");
    if (matched) return { flow, triggerId: matched.id ?? matched.type };
  }

  const fallback = flows.find((flow) => getEffectiveTriggers(flow).length === 0);
  return fallback ? { flow: fallback, triggerId: "" } : null;
}
```

- [ ] **Step 4: Inject `__flow_trigger_id` before starting a new session**

Find the block in the function that handles new flow sessions (around line 1055-1063). It currently looks like:

```ts
const initialVars = await buildConversationFlowVariables({
  userId,
  conversationId
});
const session = await createFlowSession(matchedFlow.id, conversationId, initialVars);
```

Replace the `matchingFlow` call (around line 960) and this `initialVars` block as follows.

First, replace:
```ts
const matchedFlow = matchingFlow({
  message,
  flows: nonDefaultFlows,
  channelType,
  isFirstInboundMessage: firstInbound
});
```

With:
```ts
const matchResult = findMatchedTrigger({
  message,
  flows: nonDefaultFlows,
  channelType,
  isFirstInboundMessage: firstInbound
});
const matchedFlow = matchResult?.flow ?? null;
const matchedTriggerId = matchResult?.triggerId ?? "";
```

Then, replace the `initialVars` block for the new matched-flow session:
```ts
const initialVars = {
  ...await buildConversationFlowVariables({ userId, conversationId }),
  [__FLOW_TRIGGER_ID_KEY]: matchedTriggerId
};
const session = await createFlowSession(matchedFlow.id, conversationId, initialVars);
```

- [ ] **Step 5: Verify API compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no type errors in `flow-engine-service.ts`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/flow-engine-service.ts
git commit -m "feat(engine): inject matched trigger id into flow session vars"
```

---

## Task 4: Update flow-validation for dynamic flowStart handles

**Files:**
- Modify: `apps/web/src/modules/dashboard/studio/flows/flow-validation.ts`

- [ ] **Step 1: Update `getDynamicSourceHandles` to handle `flowStart`**

In the `getDynamicSourceHandles` function (around line 71), add a `flowStart` case before `default`:

```ts
case "flowStart": {
  if (!Array.isArray(data.routes) || data.routes.length === 0) {
    return ["out"];
  }
  return [...data.routes.map((r: { id: string }) => r.id), "default"];
}
```

- [ ] **Step 2: Update `getNodeHandleSpec` for `flowStart`**

Replace the `flowStart` case (line 88-89) and the fallback at lines 119-121:

```ts
case "flowStart":
  return toSpec(getDynamicSourceHandles(data), []);
```

Remove the duplicate fallback block at lines 119-121:
```ts
// DELETE these lines:
if (nodeType === "flowStart") {
  return toSpec(["out"], []);
}
```

- [ ] **Step 3: Update `getHandleLabel` to label route handles**

Add a `flowStart` case in `getHandleLabel` (before the `default` at line 169):

```ts
case "flowStart": {
  if (handleId === "default") return "Default";
  if (handleId === "out") return "Next";
  const route = Array.isArray(node.data.routes)
    ? (node.data.routes as Array<{ id: string; label: string }>).find((r) => r.id === handleId)
    : undefined;
  return route?.label?.trim() || null;
}
```

- [ ] **Step 4: Verify web compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors in `flow-validation.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/modules/dashboard/studio/flows/flow-validation.ts
git commit -m "feat(validation): dynamic handle spec and labels for flowStart routes"
```

---

## Task 5: Rewrite FlowStartNode UI component

**Files:**
- Modify: `apps/web/src/modules/dashboard/studio/flows/flow-blocks/basic/flow-start.tsx`

- [ ] **Step 1: Replace the entire file with the route-card UI**

```tsx
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
    patch({
      routes: [
        ...data.routes,
        { id: uid(), label: "Route", triggers: [] }
      ]
    });

  const removeRoute = (routeId: string) =>
    patch({ routes: data.routes.filter((r) => r.id !== routeId) });

  const patchRoute = (routeId: string, updates: Partial<RouteConfig>) =>
    patch({
      routes: data.routes.map((r) => (r.id === routeId ? { ...r, ...updates } : r))
    });

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
                {/* Route label + remove */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <input
                    className="fn-node-input nodrag"
                    style={{
                      flex: 1,
                      fontWeight: 600,
                      color: colors.labelColor,
                      borderColor: colors.labelBorder
                    }}
                    value={route.label}
                    onChange={(e) => patchRoute(route.id, { label: e.target.value })}
                    placeholder="Route name"
                  />
                  <button
                    className="fn-icon-btn nodrag"
                    onClick={() => removeRoute(route.id)}
                  >
                    ✕
                  </button>
                </div>

                {/* Triggers */}
                {route.triggers.map((trigger) => (
                  <div
                    key={trigger.id}
                    className="fn-btn-row"
                    style={{ marginBottom: "0.2rem" }}
                  >
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

                {/* Per-route output handle */}
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

        {/* Default / fallback section */}
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
          <div className="fn-node-label" style={{ marginBottom: 6 }}>DEFAULT (no match)</div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 11 }}>
            <input
              type="checkbox"
              className="nodrag"
              checked={!!data.fallbackUseAi}
              onChange={(e) => patch({ fallbackUseAi: e.target.checked })}
            />
            Use AI when no route matches
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
            /* Legacy single-output handle when no routes are defined */
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
```

- [ ] **Step 2: Verify web compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors in `flow-start.tsx`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/modules/dashboard/studio/flows/flow-blocks/basic/flow-start.tsx
git commit -m "feat(ui): flow-start node with labeled keyword route cards and per-route handles"
```

---

## Task 6: End-to-end verification

- [ ] **Step 1: Start dev servers**

```bash
cd /path/to/wgen/WAgen && npm run dev
```

- [ ] **Step 2: Verify new flow with routes**

1. Open the flow editor and place a new Flow Start node.
2. Click "+ Add Route", name it "Greeting", add keyword trigger `hello`.
3. Click "+ Add Route", name it "Orders", add keyword trigger `order`.
4. Connect "Greeting" handle → a Send Text node with text "Hello!".
5. Connect "Orders" handle → a Send Text node with text "Order received".
6. Connect "Default" handle → a Send Text node with text "I didn't understand".
7. Publish the flow.
8. Send `hello` → should receive "Hello!".
9. Send `order` → should receive "Order received".
10. Send `xyz` → should receive "I didn't understand".

- [ ] **Step 3: Verify AI fallback**

1. On the Default section, tick "Use AI when no route matches".
2. Send an unmatched message → AI reply should fire (not the default text node).

- [ ] **Step 4: Verify legacy flow unchanged**

1. Open an existing flow that has the old flat `triggers[]` and no routes.
2. Confirm the node renders a single output handle (the `out` handle at the bottom of the default section).
3. Trigger the flow with its existing keyword — confirm it still routes to the single connected node.

- [ ] **Step 5: Run web type check one final time**

```bash
cd apps/web && npx tsc --noEmit && echo "✓ web types clean"
cd apps/api && npx tsc --noEmit && echo "✓ api types clean"
```

- [ ] **Step 6: Final commit**

```bash
git add -p
git commit -m "feat: flow-start keyword route branching — routes, engine, validation, ui"
```
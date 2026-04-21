# Flow Start — Keyword Route Branching

**Date:** 2026-04-20

## Context

The Flow Start node currently has a single output handle. All triggers (keywords, QR, widget, etc.) lead to the same next node. Users need the same Flow Start to branch to different nodes depending on which keyword triggered the flow — e.g. "hello" → greeting flow, "order" → order flow, unmatched → fallback or AI.

## Data Model

Add `RouteConfig` and a `routes` field to `FlowStartData`. Existing `triggers[]` is kept untouched for backward compatibility — legacy nodes with no `routes` continue working unchanged.

```ts
// apps/web/src/modules/dashboard/studio/flows/flow-blocks/types.ts

interface RouteConfig {
  id: string;
  label: string;       // user-defined, shown on the handle
  triggers: Trigger[]; // same Trigger type as before
}

interface FlowStartData {
  kind: "flowStart";
  label: string;
  triggers: Trigger[];       // legacy — not removed
  routes: RouteConfig[];     // new
  welcomeMessage: string;
  fallbackUseAi?: boolean;   // existing — drives the default handle's AI checkbox
}
```

Each route's `id` becomes the ReactFlow `sourceHandle` id on edges. The default/fallback handle uses `id="default"`. The legacy `id="out"` handle is rendered only when `routes` is empty.

## UI Changes

**File:** `apps/web/src/modules/dashboard/studio/flows/flow-blocks/basic/flow-start.tsx`

- Replace flat triggers list with route cards.
- Each card: editable label input, flat trigger rows (select + value + remove), `+ trigger` button, remove-route `✕`, and a `<Handle type="source" id={route.id} />` on the right edge.
- Route card border/background colors cycle by index (green, blue, purple…).
- Below route cards: `+ Add Route` button.
- Default section at bottom: `Use AI when no route matches` checkbox bound to `fallbackUseAi`, plus `<Handle type="source" id="default" />`.
- When `routes` is empty, render legacy `<Handle type="source" id="out" />` for backward compat.

New helpers on `FlowStartNode`:
- `addRoute()` — appends `{ id: uid(), label: "Route", triggers: [] }`
- `removeRoute(routeId)`
- `patchRoute(routeId, updates: Partial<RouteConfig>)`
- `addTriggerToRoute(routeId)` / `removeTriggerFromRoute(routeId, triggerId)` / `patchTriggerInRoute(routeId, triggerId, updates)`

`createDefaultData()` returns `routes: []` for new nodes.

## API — flow-start block

**File:** `apps/api/src/services/flow-blocks/basic/flow-start.ts`

- Read `context.vars["__flow_trigger_id"]` (string | undefined).
- If `routes` is non-empty: find the route whose `triggers` array contains a trigger with `id === __flow_trigger_id`. Return `getNextNodeId(nodes, edges, node.id, route.id)`.
- If no route matches: return `getNextNodeId(nodes, edges, node.id, "default")`.
- If `routes` is empty (legacy): fall back to `getDefaultNextNodeId(nodes, edges, node.id)`.

## Engine Changes

**File:** `apps/api/src/services/flow-engine-service.ts`

### `getEffectiveTriggers` — updated to read from routes

Flatten triggers from all routes in addition to the legacy `triggers` field:

```ts
const routeTriggers = (startNode?.data?.routes ?? [])
  .flatMap((r) => r.triggers ?? []);
// merge with flowLevel and legacy nodeTriggers as before
```

### New: `findMatchedTrigger`

Replace `matchingFlow` with `findMatchedTrigger` which returns `{ flow: FlowRow; triggerId: string } | null`. Internally uses the same priority order (keyword → templateReply → channelStart → anyMessage → no-trigger), but also returns the id of the specific trigger that matched.

For trigger types that don't have a meaningful id (e.g. `any_message`), return `trigger.id ?? trigger.type` as the triggerId.

### Inject into initial vars

Before calling `runChain` on a new session:

```ts
initialVars["__flow_trigger_id"] = triggerId;
```

## Verification

1. **New flow with routes:** create a Flow Start with two routes ("Greeting" → keywords "hello"/"hi", "Orders" → keyword "order") and a default. Connect each handle to a different Send Text node. Send "hello" → goes to greeting node. Send "order" → goes to orders node. Send "xyz" → goes to default node.
2. **AI fallback:** tick "Use AI" on default, send unmatched message → AI reply fires.
3. **Legacy flow:** open an existing flow with the old flat `triggers[]` and no `routes`. Confirm it still routes to the single next node unchanged.
4. **No routes, new node:** a freshly placed Flow Start with no routes added → single legacy `out` handle, existing behavior.
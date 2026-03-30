# Flow Block Development Guide

This guide is the contract for developing a single flow content block as an isolated feature unit.

The rule is simple:

- one block owns its saved input shape
- one block owns its editor node UI
- one block owns its 3-channel runtime output behavior
- the registries only wire blocks together

If a developer needs to add or improve a block, they should be able to do it by touching that block's files plus the registries, not by editing the entire flow system.

## 1. Block ownership model

Each block is split across two sides.

### Frontend studio side

The studio block module lives under:

- `apps/web/src/modules/dashboard/studio/flows/flow-blocks/basic/`
- `apps/web/src/modules/dashboard/studio/flows/flow-blocks/legacy/`

Each frontend block module owns:

- catalog metadata
- default saved input data
- ReactFlow node UI
- saved input fields used by the editor

The shared frontend types live in:

- `apps/web/src/modules/dashboard/studio/flows/flow-blocks/types.ts`

The shared frontend node helpers live in:

- `apps/web/src/modules/dashboard/studio/flows/flow-blocks/editor-shared.tsx`

The frontend registry lives in:

- `apps/web/src/modules/dashboard/studio/flows/flow-blocks/registry.tsx`

### Backend runtime side

The runtime block module lives under:

- `apps/api/src/services/flow-blocks/basic/`
- `apps/api/src/services/flow-blocks/legacy/`

Each backend block module owns:

- `execute(...)`
- optional `resumeWait(...)`
- channel-specific output decisions for `baileys`, `api_whatsapp`, and `web`

The shared backend types live in:

- `apps/api/src/services/flow-blocks/types.ts`

The shared backend helpers live in:

- `apps/api/src/services/flow-blocks/helpers.ts`

The backend registry lives in:

- `apps/api/src/services/flow-blocks/registry.ts`

## 2. What "done" means for one block

A block is only complete when all of these exist:

1. saved input type in the frontend block types
2. default editor data
3. editor node component
4. frontend registry entry
5. backend runtime module
6. backend registry entry
7. channel output behavior defined for `baileys`, `api_whatsapp`, and `web`
8. reply/resume behavior defined if the block waits for input
9. delivery support updated if a new payload type is introduced
10. documentation updated

## 3. Standard file pattern

For an active block named `exampleBlock`, use:

### Frontend

- `apps/web/src/modules/dashboard/studio/flows/flow-blocks/basic/example-block.tsx`

The module should export a `StudioFlowBlockDefinition`.

It should define:

- `kind`
- `catalog`
- `createDefaultData()`
- `NodeComponent`

### Backend

- `apps/api/src/services/flow-blocks/basic/example-block.ts`

The module should export a `FlowBlockModule`.

It should define:

- `type`
- `execute(...)`
- `resumeWait(...)` if needed

## 4. Channel output checklist

Every block must explicitly think through these three outputs.

### `baileys`

Used by QR / WhatsApp Web sessions.

Questions:

- does Baileys support the native structure?
- do button/list IDs come back in a format the engine can resume from?
- if native output is weak or limited, is the fallback still readable?

### `api_whatsapp`

Used by Meta WhatsApp Cloud API.

Questions:

- is there a native Meta interactive or template payload for this block?
- are the field limits respected?
- are IDs stable and resumable?

### `web`

Used by the browser widget.

Questions:

- can the widget render the block natively today?
- if not, does the block degrade to clear readable text?
- does the response still preserve the flow meaning for the visitor?

## 5. Saved input checklist

The saved input shape should live in the frontend type system and be reflected in the node UI.

For each new field ask:

- is this field actually used at runtime?
- is it channel-specific or global?
- is it safe to save directly into `nodes[].data`?
- does it need validation before publish?

Avoid adding UI-only fields unless there is a clear near-term use.

## 6. Registry rules

### Frontend registry

Register the block in:

- `apps/web/src/modules/dashboard/studio/flows/flow-blocks/registry.tsx`

If the block should be available for new flows:

- set `availableInPalette: true`

If it is compatibility-only:

- set `availableInPalette: false`
- set `status: "legacy"`

### Backend registry

Register the block in:

- `apps/api/src/services/flow-blocks/registry.ts`

If the block is not in the backend registry, the engine cannot execute it.

## 7. When to use `legacy`

Use `legacy` when:

- the block still needs to render old saved flows
- the studio should not allow new flows to add it
- the runtime should keep compatibility without advertising active development

Current examples:

- `singleProduct`
- `multiProduct`
- `whatsappPay`

## 8. Development sequence for a new block

Use this order.

1. Define the saved input type in frontend types.
2. Build the frontend node UI module.
3. Register the frontend block.
4. Define or reuse the outbound payload model.
5. Build the backend runtime module.
6. Register the backend block.
7. Update channel senders if a new payload type is needed.
8. Test the wait/resume path if the block collects input.
9. Update `docs/FLOW_MODULE.md` and this guide if the architecture changes.

## 9. Existing active block map

| Block | Frontend module | Backend module |
| --- | --- | --- |
| `flowStart` | `flow-blocks/basic/flow-start.tsx` | `flow-blocks/basic/flow-start.ts` |
| `textButtons` | `flow-blocks/basic/text-buttons.tsx` | `flow-blocks/basic/text-buttons.ts` |
| `mediaButtons` | `flow-blocks/basic/media-buttons.tsx` | `flow-blocks/basic/media-buttons.ts` |
| `list` | `flow-blocks/basic/list.tsx` | `flow-blocks/basic/list.ts` |
| `template` | `flow-blocks/basic/template.tsx` | `flow-blocks/basic/template.ts` |
| `askQuestion` | `flow-blocks/basic/ask-question.tsx` | `flow-blocks/basic/ask-question.ts` |
| `askLocation` | `flow-blocks/basic/ask-location.tsx` | `flow-blocks/basic/ask-location.ts` |
| `condition` | `flow-blocks/basic/condition.tsx` | `flow-blocks/basic/condition.ts` |
| `requestIntervention` | `flow-blocks/basic/request-intervention.tsx` | `flow-blocks/basic/request-intervention.ts` |
| `apiRequest` | `flow-blocks/basic/api-request.tsx` | `flow-blocks/basic/api-request.ts` |
| `googleCalendarBooking` | `flow-blocks/basic/google-calendar.tsx` | `flow-blocks/basic/google-calendar-booking.ts` |
| `googleSheetsAddRow` | `flow-blocks/basic/google-sheets.tsx` | `flow-blocks/basic/google-sheets-add-row.ts` |
| `googleSheetsUpdateRow` | `flow-blocks/basic/google-sheets.tsx` | `flow-blocks/basic/google-sheets-update-row.ts` |
| `googleSheetsFetchRow` | `flow-blocks/basic/google-sheets.tsx` | `flow-blocks/basic/google-sheets-fetch-row.ts` |
| `googleSheetsFetchRows` | `flow-blocks/basic/google-sheets.tsx` | `flow-blocks/basic/google-sheets-fetch-rows.ts` |
| `aiReply` | `flow-blocks/basic/ai-reply.tsx` | `flow-blocks/basic/ai-reply.ts` |

## 10. Review questions for any block PR

Before merging, ask:

- does the block own all of its saved inputs in one place?
- does the editor node match the runtime behavior?
- are all three channels handled explicitly?
- if the block waits, can it reliably resume from real inbound payloads?
- did we avoid adding block-specific logic back into the main engine or route file?

If the answer to the last question is no, the block should be refactored before merge.

# Flow Module README

This document describes the current flow feature as a channel-aware system.
It focuses on the architecture we now use in code, the message pipeline from first inbound event to final outbound reply, and the process for building new content blocks safely.

Detailed block-by-block development guidance lives in:

- `docs/FLOW_BLOCK_DEVELOPMENT.md`

## 1. Goal of the feature

The flow feature is one product feature with four clear layers:

1. Studio editor
2. Flow API and persistence
3. Runtime orchestration
4. Channel delivery

The key design rule is:

- the engine manages sessions, trigger matching, waiting, and AI handoff
- each content block module owns its own behavior and channel-specific output

That keeps the pipeline smooth for all three channels:

- `qr` -> `baileys`
- `api` -> `api_whatsapp`
- `web` -> `web`

## 2. Main file layout

### Editor

- `apps/web/src/modules/dashboard/studio/flows/route.tsx`
- `apps/web/src/modules/dashboard/studio/flows/flows.css`
- `apps/web/src/modules/dashboard/studio/flows/flow-blocks/types.ts`
- `apps/web/src/modules/dashboard/studio/flows/flow-blocks/editor-shared.tsx`
- `apps/web/src/modules/dashboard/studio/flows/flow-blocks/registry.tsx`
- `apps/web/src/modules/dashboard/studio/flows/flow-blocks/basic/*`
- `apps/web/src/modules/dashboard/studio/flows/flow-blocks/legacy/*`

### API and persistence

- `apps/api/src/routes/flows.ts`
- `apps/api/src/services/flow-service.ts`
- `infra/migrations/0009_flow_engine.sql`
- `infra/migrations/0010_flow_ai_mode.sql`

### Runtime orchestration

- `apps/api/src/services/message-router-service.ts`
- `apps/api/src/services/flow-engine-service.ts`

### Block feature layer

- `apps/api/src/services/flow-blocks/types.ts`
- `apps/api/src/services/flow-blocks/helpers.ts`
- `apps/api/src/services/flow-blocks/registry.ts`
- `apps/api/src/services/flow-blocks/basic/*`
- `apps/api/src/services/flow-blocks/legacy/*`

### Channel delivery

- `apps/api/src/services/channel-outbound-service.ts`
- `apps/api/src/services/outbound-message-types.ts`
- `apps/api/src/services/whatsapp-session-manager.ts`
- `apps/api/src/services/meta-whatsapp-service.ts`
- `apps/api/src/services/widget-chat-gateway-service.ts`

## 3. Channel model

The flow engine receives a conversation `channel_type`, then resolves it to an output channel for the block runtime:

| Conversation channel | Block output channel | Delivery path |
| --- | --- | --- |
| `qr` | `baileys` | Baileys / WhatsApp Web session |
| `api` | `api_whatsapp` | Meta WhatsApp Cloud API |
| `web` | `web` | Widget chat gateway |

This mapping is centralized in:

- `apps/api/src/services/flow-blocks/types.ts`

The important consequence is that a block module can make a clean decision like:

- send native `text_buttons` for WhatsApp channels
- send plain text fallback for web

without teaching the engine anything about block-specific rendering.

## 4. End-to-end message process

### 4.1 Inbound entry points

Inbound messages enter from three adapters:

- `apps/api/src/services/whatsapp-session-manager.ts` for QR / Baileys
- `apps/api/src/services/meta-whatsapp-service.ts` for Meta Cloud API
- `apps/api/src/services/widget-chat-gateway-service.ts` for web chat

Each one ends up in:

- `processIncomingMessage(...)` in `apps/api/src/services/message-router-service.ts`

### 4.2 Shared router pipeline

The router does the common work first:

1. normalize inbound text
2. persist inbound message and update conversation state
3. run manual-takeover, AI-pause, credit, and loop-guard checks
4. call `handleFlowMessage(...)`

### 4.3 Flow engine pipeline

`handleFlowMessage(...)` in `apps/api/src/services/flow-engine-service.ts` does the flow-specific orchestration:

1. resume an active session if one exists
2. otherwise load published flows
3. match triggers in deterministic priority order
4. create a `flow_sessions` row when a new flow starts
5. call `runChain(...)`

`runChain(...)` is intentionally small. It only:

- loads the right block module from the registry
- executes it with the resolved channel
- persists `waiting`, `ai_mode`, or `completed` session state
- continues to the next node until the chain stops

### 4.4 Block execution

Each block module decides what payload should be emitted for:

- `baileys`
- `api_whatsapp`
- `web`

Examples:

- `textButtons` sends native button payloads for WhatsApp and numbered text for web
- `list` sends native interactive lists for WhatsApp and numbered text for web
- `template` sends a real template only for `api_whatsapp` and a text fallback elsewhere
- `mediaButtons` can send native media, native media+buttons, or a text fallback depending on channel and config

### 4.5 Outbound delivery

Flow blocks call the shared send callback.
That callback goes through:

- `sendConversationFlowMessage(...)` in `apps/api/src/services/channel-outbound-service.ts`

That service:

1. loads the conversation
2. dispatches to the correct channel adapter
3. tracks the outbound message in conversation history
4. returns a summary text for realtime updates and inbox state

### 4.6 Waiting and resume

When a block returns `wait`, the session stores:

- `status = waiting`
- `waiting_for`
- `waiting_node_id`

On the next inbound message:

- the engine finds the waiting node
- the block module handles its own reply parsing through `resumeWait(...)` when needed
- the engine follows the chosen handle and continues the chain

This keeps reply parsing close to the block that created the prompt.

### 4.7 AI handoff

`aiReply` is still controlled by the flow engine, but the block module decides whether it is:

- `one_shot`
- `ongoing`

The router then runs the normal AI path.
For one-shot AI, the session waits on `ai_reply` and `advanceFlowAfterAiReply(...)` resumes the next node after the AI response is sent.

### 4.8 Human handoff

`requestIntervention` sends the handoff message and the engine now marks the conversation for manual takeover and AI pause before ending the session.

## 5. Block architecture

Each content block module implements a shared contract from:

- `apps/api/src/services/flow-blocks/types.ts`

The contract has two responsibilities:

- `execute(...)`
- optional `resumeWait(...)`

That means a block owns:

- how it renders for each channel
- whether it waits
- how it parses the next inbound reply

The engine no longer contains the block-specific switch statement that used to mix all of this together.

## 6. Current block segmentation

### 6.1 Basic blocks

These are the active blocks we are building around:

- `flowStart`
- `textButtons`
- `mediaButtons`
- `list`
- `template`
- `askQuestion`
- `askLocation`
- `condition`
- `requestIntervention`
- `apiRequest`
- `googleCalendarBooking`
- `googleSheetsAddRow`
- `googleSheetsUpdateRow`
- `googleSheetsFetchRow`
- `googleSheetsFetchRows`
- `aiReply`

### 6.2 Legacy commerce compatibility

Commerce is paused in the studio palette for now.
New flows should not be built with commerce blocks until that layer gets its own rebuild.

For compatibility, old saved flows can still execute these legacy modules:

- `singleProduct`
- `multiProduct`
- `whatsappPay`

Those modules live in:

- `apps/api/src/services/flow-blocks/legacy/*`

The intent is:

- keep existing flows from breaking
- stop expanding commerce behavior in the main build path
- keep the basic block architecture clean first

## 7. Studio behavior

The editor still renders old nodes if a saved flow already contains them, but the left block catalog now focuses on the supported basic block set.

That makes the frontend match the backend direction:

- basic blocks are the supported surface
- commerce is compatibility-only for now

## 8. Output payload model

Shared outbound payloads live in:

- `apps/api/src/services/outbound-message-types.ts`

Current payload types include:

- `text`
- `media`
- `text_buttons`
- `media_buttons`
- `list`
- `template`
- `product`
- `product_list`

Rule of thumb:

- if a payload is natively supported by a channel, send the native payload
- if not, the block should emit or fall back to readable text
- web should always stay readable even when native WhatsApp interactivity is not available

## 9. Process for building a new content block

This is the recommended process for new development.

### Step 1. Define the user-facing behavior first

Write down:

- what the block sends
- whether it waits
- what reply shape it expects next
- which handles it exposes

Do this before touching the engine.

### Step 2. Add or reuse a shared payload type

Check:

- `apps/api/src/services/outbound-message-types.ts`

If the block can use an existing payload, reuse it.
If not, add a new payload type there first, then teach the channel senders how to deliver it.

### Step 3. Build the backend block module

Create a new file under:

- `apps/api/src/services/flow-blocks/basic/`

Implement:

- `execute(...)`
- `resumeWait(...)` if the block pauses for input

Keep channel branching inside the block module.
Do not add channel-specific rendering logic to `flow-engine-service.ts`.

### Step 4. Register the block

Add it to:

- `apps/api/src/services/flow-blocks/registry.ts`

If it is not registered, the engine will not execute it.

### Step 5. Add the studio node

Update:

- `apps/web/src/modules/dashboard/studio/flows/route.tsx`

That includes:

- node data type
- default data
- node component
- node registry
- block catalog entry if it should be available for new flows

### Step 6. Make channel delivery real

If the new payload is native for WhatsApp, update:

- `apps/api/src/services/meta-whatsapp-service.ts`
- `apps/api/src/services/whatsapp-session-manager.ts`

If web cannot render it natively, make sure the block still produces a readable fallback.

### Step 7. Verify the reply path

Check the full loop:

1. block sends output
2. channel receives it in the expected format
3. user replies
4. inbound adapter extracts the right value
5. `resumeWait(...)` routes to the correct handle

### Step 8. Document the block

Update this README when:

- a new block is added
- a legacy block becomes active again
- a payload type changes

## 10. What should not go into the engine anymore

Do not keep growing `flow-engine-service.ts` with:

- per-block rendering branches
- per-channel payload formatting
- per-block reply parsing

Those belong in the block module layer.
The engine should stay focused on:

- sessions
- trigger matching
- waiting state
- AI/human handoff
- chain progression

## 11. Short summary

The flow feature is now segmented so it can scale:

- the studio builds graph data
- the engine manages flow state
- block modules own behavior
- channel adapters own delivery

That gives us a cleaner path for adding new content blocks one by one without turning the engine back into a monolith.

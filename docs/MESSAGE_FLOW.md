# Message Flow — Complete Technical Reference

This document covers the full lifecycle of every message in the Typo platform: inbound and outbound, across all three channels (QR / API / Web), through the router, into storage, and out to the chat UI.

---

## Table of Contents

1. [Three Channels](#1-three-channels)
2. [Inbound Flow — Per Channel](#2-inbound-flow--per-channel)
   - [QR Channel (Baileys / WhatsApp Web)](#qr-channel-baileys--whatsapp-web)
   - [API Channel (Meta Cloud API)](#api-channel-meta-cloud-api)
   - [Web Channel (Widget WebSocket)](#web-channel-widget-websocket)
3. [Outbound Flow — Per Channel](#3-outbound-flow--per-channel)
4. [processIncomingMessage — The Central Router](#4-processincomingmessage--the-central-router)
5. [Payload Types — What Can Be Sent](#5-payload-types--what-can-be-sent)
6. [Database Storage](#6-database-storage)
7. [Frontend Rendering Pipeline](#7-frontend-rendering-pipeline)
8. [End-to-End Example — User Selects a List Option](#8-end-to-end-example--user-selects-a-list-option)

---

## 1. Three Channels

| Channel | Code value | Transport | Notes |
|---|---|---|---|
| **QR** | `qr` | Baileys WebSocket (WhatsApp Web protocol) | Scan QR in Settings to connect |
| **API** | `api` | Meta Cloud API — webhook + Graph API | Requires Meta Business verification |
| **Web** | `web` | WebSocket (`/ws/widget`) | Embedded chat widget for websites |

Each channel has its own transport for receiving and sending messages, but all three converge on the same central router (`processIncomingMessage`) for classification, flow execution, and AI replies.

---

## 2. Inbound Flow — Per Channel

### QR Channel (Baileys / WhatsApp Web)

```
User sends a WhatsApp message
        │
        ▼
socket.ev "messages.upsert"  [WhatsAppSessionManager]
        │
        ├── Skip: message.key.fromMe = true  (own echo)
        ├── Skip: not a direct 1-to-1 JID  (groups, broadcasts)
        │
        ▼
extractInboundText(message)
        │
        │   Priority order:
        ├── 1. locationMessage / liveLocationMessage
        │       → displayText = "📍 name, address"
        │       → flowText    = encoded location for flow engine
        │
        ├── 2. pollUpdateMessage (vote on a poll)
        │       → encoded poll vote text
        │
        ├── 3. interactiveResponseMessage  ← modern WhatsApp list/button reply
        │       body.text           → displayText  (shown in chat history)
        │       paramsJson → "id"   → flowId       (used by flow engine, never displayed)
        │       returns { displayText: "Book a Demo", flowText: "Book a Demo r1_demo" }
        │
        ├── 4. listResponseMessage  (legacy)
        │       title             → displayText
        │       selectedRowId     → flowId
        │
        ├── 5. buttonsResponseMessage  (legacy)
        │       selectedDisplayText → displayText
        │       selectedButtonId    → flowId
        │
        ├── 6. templateButtonReplyMessage
        │       selectedDisplayText → displayText
        │       selectedId          → flowId
        │
        └── 7. getMessageText() plain fallback
                conversation / extendedText / caption
                No text but has media:
                  imageMessage   → "[Image received]"
                  videoMessage   → "[Video received]"
                  audioMessage   → "[Audio message received]"
                  documentMessage → "[Document received: filename]"
        │
        ▼
extractInboundMediaText(socket, message, userId)
        │
        ├── imageMessage
        │       Download buffer → storeMediaInUploads() → /api/media/{uuid}
        │       OpenAI OCR → "[Extracted image text]: ..."
        │       returns { text, mediaUrl: "/api/media/{uuid}" }
        │
        ├── videoMessage
        │       Download buffer → storeMediaInUploads() → /api/media/{uuid}
        │       returns { text: "[Video received]", mediaUrl }
        │
        ├── audioMessage
        │       Download buffer → storeMediaInUploads() → /api/media/{uuid}
        │       returns { text: "[Audio message received]", mediaUrl }
        │
        ├── documentMessage (PDF)
        │       Download buffer → pdf-parse → "[Extracted document text]: ..."
        │       returns { text, mediaUrl: null }
        │
        └── documentMessage (text/*, json, csv, xml)
                Raw UTF-8 decode → "[Extracted document text]: ..."
                returns { text, mediaUrl: null }
        │
        ▼
Merge text + mediaResult
        ├── If base text is a generic fallback ("[Image received]" etc.)
        │   AND mediaResult.text exists  →  REPLACE with mediaResult.text
        └── Else if both have content    →  APPEND "${text}\n${mediaResult.text}"
        │
        ▼
enqueueInboundMessage({ userId, phoneNumber, text, flowText, mediaUrl })
        │
        ▼
processQueue(key)  — per-JID FIFO queue, serialised one message at a time
        │
        ▼
processQueuedMessage(job)
        │
        ▼
processIncomingMessage(...)  ← see §4
        sendReply callback → simulate typing → socket.sendMessage(jid, { text })
```

---

### API Channel (Meta Cloud API)

```
Meta Graph API  POST /webhook
        │
        ▼
verifyMetaWebhookSignature()
        HMAC-SHA256(rawBody, META_APP_SECRET)
        Timing-safe comparison against x-hub-signature-256 header
        │
        ▼
handleMetaWebhookPayload(payload)
        │
        ▼
buildWebhookTasks()  — parse webhook JSON entries
        │
        │   extractMessageInput() priority:
        ├── 1. message.text.body        → plain text
        ├── 2. message.button.text      → button reply text
        ├── 3. interactive.button_reply → title + id
        ├── 4. interactive.list_reply   → title + description + id
        ├── 5. location                 → lat / lng / name / address / url
        └── 6. media caption
        │
        ▼
processWebhookTask(task)
        │
        ├── Resolve Meta connection by phoneNumberId
        ├── Skip if sender phone = own number
        │
        ▼
processIncomingMessage(...)  ← see §4
        sendReply callback → POST /{phoneNumberId}/messages
                             { messaging_product:"whatsapp", type:"text", text:{body} }
```

---

### Web Channel (Widget WebSocket)

```
Browser widget   WS /ws/widget?wid=<workspaceId>&visitorId=<id>
        │
        ▼
validateWorkspace(wid)  →  send { type: "ready" }
        │
        ├── { type: "lead_profile", name, phone, email }
        │       persistWidgetLeadProfile()
        │         → upsert conversation  (phone_number = "web:{visitorId}")
        │         → syncConversationContact()
        │         → INSERT inbound message with lead details
        │       Remember profile in-memory for this WS connection
        │       Send { type: "system", text: "Profile saved" }
        │
        └── { type: "message", message: "Hello" }
                │
                ▼
        processIncomingMessage(...)  ← see §4
                sendReply callback → send { type: "message", text } back over WebSocket
                                     (sent to all open sockets for this user+visitorId)
```

---

## 3. Outbound Flow — Per Channel

### Entry Points

| Trigger | Function called |
|---|---|
| Agent types in inbox | `sendManualConversationMessage()` |
| Flow block fires | `sendConversationFlowMessage()` directly |
| AI auto-reply | `sendReply()` callback inside `processIncomingMessage` |

### `sendManualConversationMessage` — build payload

```
sendManualConversationMessage({ userId, conversationId, text, mediaUrl, mediaMimeType })
        │
        ▼
Build FlowMessagePayload:
        ├── mediaUrl + image/*    → { type:"media", mediaType:"image", url, caption:text }
        ├── mediaUrl + video/*    → { type:"media", mediaType:"video", url, caption:text }
        ├── mediaUrl + audio/*    → { type:"media", mediaType:"audio", url }
        ├── mediaUrl + other      → { type:"media", mediaType:"document", url, caption:text }
        └── no media              → { type:"text", text }
        │
        ▼
sendConversationFlowMessage(...)
        │
        ▼
setConversationManualAndPaused()  — marks manual_takeover + ai_paused = TRUE
```

### `sendConversationFlowMessage` — dispatch by channel

```
sendConversationFlowMessage({ userId, conversationId, payload, mediaUrl, displayText, senderName })
        │
        ├── getConversationById()  — verify conversation belongs to userId
        │
        ├── summaryText = displayText ?? summarizeFlowMessage(payload)
        │
        ├── channel_type = "api"
        │       sendMetaFlowMessageDirect()
        │         buildMetaFlowRequestBody(payload) → Meta Graph API JSON
        │         POST /{phoneNumberId}/messages
        │
        ├── channel_type = "qr"
        │       whatsappSessionManager.sendFlowMessage()
        │         buildQrFlowMessageContent(payload) → Baileys content object
        │         socket.sendMessage(chatJid, content)
        │
        └── channel_type = "web"
                sendWidgetConversationMessage()
                  Find all open WS connections for user + visitorId
                  Send { type:"message", text: summaryText }
        │
        ▼
trackOutboundMessage(conversationId, summaryText, { senderName }, mediaUrl, payload)
        │
        ├── payloadToMessageType(payload) → message_type  (e.g. "image", "list", "buttons")
        ├── JSON.stringify(payload)        → message_content JSONB
        └── INSERT conversation_messages (direction='outbound')
            UPDATE conversations.last_message / score / stage
```

### `summarizeFlowMessage` — text summary of any payload

| Payload type | Produced summary |
|---|---|
| `text` | The text itself |
| `media` (image/video/doc) | `[IMAGE]\n\ncaption` / `[VIDEO]\n\ncaption` |
| `text_buttons` | `body\n\n1. Btn A\n2. Btn B` |
| `media_buttons` | `[IMAGE]\n\ncaption\n\n1. Btn A` |
| `list` | `title\n\nSection\n1. Item - desc\n2. Item` |
| `template` | `[Template: name]` |
| `location_share` | `[LOCATION]\nname\naddress\nlat,lng` |
| `contact_share` | `[CONTACT]\nname\nphone` |
| `poll` | `[POLL]\nquestion\n1. option\n2. option` |

This summary is always stored in `message_text` and is the fallback for display when `message_content` is absent.

---

## 4. `processIncomingMessage` — The Central Router

All three channels converge here. Located in `apps/api/src/services/message-router-service.ts`.

```
processIncomingMessage({
  userId, channelType, channelLinkedNumber,
  customerIdentifier, messageText, flowMessageText,
  senderName, shouldAutoReply, mediaUrl, sendReply
})
        │
        Gate 1 — Agent loop protection
        │  Own outbound echo detected → return (skip)
        │
        Gate 2 — shouldAutoReply = false
        │  → trackInboundMessage only, no reply
        │
        ▼
trackInboundMessage(userId, phoneNumber, messageText, senderName, { channelType, mediaUrl })
        │
        ├── resolveAgentProfileForChannel()  — get bot persona for this channel
        ├── upsert conversations row         — create or get existing conversation
        ├── classifyInboundMessage()         — lead / feedback / complaint / other
        ├── scoreMessageBase(text)           — intent signals (buy/price/demo = +12 each)
        ├── scoreKnowledgeIntent(userId,text)— KB full-text search hits (+4/+8/+14)
        ├── UPDATE conversations.score + stage (cold ≤ 30 / warm ≤ 70 / hot > 70)
        ├── INSERT conversation_messages (direction='inbound', media_url)
        └── syncConversationContact()        — auto-extract phone/email from message text
        │
        Gate 3 — Credits insufficient → return
        │
        Gate 4 — External bot detected
        │  setConversationManualAndPaused() → return
        │
        ▼
Flow engine  ← runs regardless of manual_takeover or ai_paused
        handleFlowMessage(flowMessageText, conversation)
          → match flow trigger (exact text / keyword / regex / ID token)
          → execute flow blocks in sequence
          → each block calls sendConversationFlowMessage()
        If flow matched and handled → return (no AI)
        │
        Gate 5 — manual_takeover = true → skip AI
        Gate 6 — ai_paused = true       → skip AI
        Gate 7 — AI not enabled on agent profile → skip
        Gate 8 — AI reply cooldown not elapsed → skip
        │
        ▼
buildSalesReply()  [ai-reply-service.ts]
        ├── Search knowledge base (RAG — full-text + vector)
        ├── Build prompt: system persona + conversation history + KB chunks
        ├── OpenAI completion (model from agent profile)
        ├── sendReply({ text: aiReply })  ← channel callback
        └── trackOutboundMessage(..., { markAsAiReply:true, retrievalChunks, tokens, aiModel })
```

---

## 5. Payload Types — What Can Be Sent

| `FlowMessagePayload.type` | `message_type` stored | Rendered as |
|---|---|---|
| `text` | `text` | Plain text bubble |
| `media` — image | `image` | Full photo + caption |
| `media` — video | `video` | `<video>` player + caption |
| `media` — audio | `audio` | `<audio>` player |
| `media` — document | `file` | 📄 Download link |
| `text_buttons` | `buttons` | Body text + ↩ action rows |
| `media_buttons` | `buttons` | Full-bleed image + body + ↩ action rows |
| `list` | `list` | Title + centred option rows with separators |
| `template` | `template` | 📋 Template name + optional action rows |
| `product` | `template` | Product body + "View Product" button |
| `product_list` | `list` | Product sections as list rows |
| `location_share` | `location` | 📍 name / address / coords + Google Maps link |
| `contact_share` | `contact` | Avatar initial + name / org / phone |
| `poll` | `poll` | 📊 Question + option list |

---

## 6. Database Storage

### `conversation_messages` table

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `conversation_id` | UUID | FK → conversations |
| `direction` | TEXT | `inbound` or `outbound` |
| `message_text` | TEXT | Plain-text summary — always present |
| `media_url` | TEXT | `/api/media/{uuid}` or absolute URL (nullable) |
| `message_type` | TEXT | `text` / `image` / `video` / `audio` / `file` / `buttons` / `list` / `template` / `location` / `contact` / `poll` |
| `message_content` | JSONB | Full `FlowMessagePayload` for outbound; NULL for inbound |
| `sender_name` | TEXT | Agent or bot display name (nullable) |
| `ai_model` | TEXT | OpenAI model string if AI-generated |
| `total_tokens` | INT | Token usage for cost tracking |
| `retrieval_chunks` | INT | KB chunks used in RAG |
| `created_at` | TIMESTAMPTZ | Message timestamp |

### `media_uploads` table (inbound media from users)

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key — used in `/api/media/:id` |
| `user_id` | UUID | Workspace owner |
| `mime_type` | TEXT | e.g. `image/jpeg`, `video/mp4` |
| `filename` | TEXT | `inbound-image` / `inbound-video` / `inbound-audio` |
| `data` | TEXT | Base64-encoded buffer |
| `size_bytes` | INT | Raw byte size |
| `created_at` | TIMESTAMPTZ | Upload timestamp |

### Schema compatibility

`listConversationMessages` uses a three-tier try/catch to handle deployments that have not yet run all migrations:

| Tier | Columns selected | When used |
|---|---|---|
| 1 (current) | All columns including `message_type` + `message_content` + `media_url` | Migration 0016 applied |
| 2 (partial) | `media_url` present, `message_type` = `'text'::text`, `message_content` = NULL | Migration 0015 applied, 0016 not yet |
| 3 (legacy) | `media_url` = NULL, `message_type` = `'text'::text`, `message_content` = NULL | Pre-0015 |

---

## 7. Frontend Rendering Pipeline

Located in `apps/web/src/modules/dashboard/inbox/message-renderer.tsx`.

```
ConversationMessage  (API response from GET /api/conversations/:id/messages)
        │
        ▼
normalizeMessage(msg)  →  UniversalMessage
        │
        ├── direction:    "inbound" (msg.direction="inbound") | "outgoing" (msg.direction="outbound")
        ├── sender_type:  "user" | "ai" (has ai_model + outbound) | "agent"
        │
        ├── Type detection:
        │     if msg.message_content exists  →  use msg.message_type directly
        │     else detectTypeFromText(message_text, media_url, stored_type):
        │
        │       URL extension check (takes priority over text patterns):
        │         .jpg/.png/.gif/.webp    →  "image"
        │         .mp4/.mov/.webm         →  "video"
        │         .mp3/.ogg/.wav/.opus    →  "audio"
        │         .pdf/.doc/.zip etc.     →  "file"
        │
        │       Text pattern check:
        │         "[Extracted image text]:"           →  "image"
        │         "[Image received]"                  →  "image"
        │         "[Image received with no readable text]"  →  "image"
        │         "[Video received]"                  →  "video"
        │         "[Audio message received]"          →  "audio"
        │         "[Document received…]"              →  "file"
        │         "[Extracted document text]:"        →  "file"
        │         "[PDF received…]"                   →  "file"
        │         "[LOCATION]"                        →  "location"
        │         "[CONTACT]"                         →  "contact"
        │         "[POLL]"                            →  "poll"
        │         "[Template:…]"                      →  "template"
        │         "\n\n" + numbered items:
        │           first item starts with digit      →  "buttons"
        │           non-numbered header line first    →  "list"
        │         extension-less media_url + no match →  "file"
        │
        ├── Content building:
        │     if message_content JSONB → contentFromPayload()
        │           Reads full structured payload into typed UniversalMessage content
        │     else → contentFromText()
        │           Reverse-parses plain text summary back into typed content object
        │
        └── UniversalMessage { id, direction, type, content, sender_type, is_ai, sender_name, … }
        │
        ▼
renderMessage(msg)
        │
        ▼
MessageRendererRegistry[msg.type]  →  React component
```

### Component registry

| Type | Component | What it renders |
|---|---|---|
| `text` | `TextMessage` | Paragraph with clickable URL and inline image detection |
| `image` | `ImageMessage` | `<img>` + optional caption; placeholder if no URL |
| `video` | `VideoMessage` | `<video controls>` + caption; placeholder if no URL |
| `audio` | `AudioMessage` | `<audio controls>`; placeholder if no URL |
| `file` | `FileMessage` | 📄 Download link with filename |
| `buttons` | `ButtonsMessage` | Body text + full-bleed image (optional) + ↩ action rows |
| `list` | `ListMessage` | Title + centred option rows with separators |
| `template` | `TemplateMessage` | Header image (optional) + body text + ↩ action rows |
| `location` | `LocationMessage` | 📍 name / address / coords + "View on map →" link |
| `contact` | `ContactMessage` | Avatar initial + name / org / phone |
| `poll` | `PollMessage` | 📊 Question + option rows |
| `unsupported` | `UnsupportedMessage` | ⚠ Fallback with type name |

### CSS bubble layout for interactive types

```
.bubble { overflow: hidden }
  ↑ clips action rows to bubble rounded corners

.msg-bleed-image-link { margin: -0.55rem -0.72rem 0.55rem }
  ↑ image bleeds full width flush to bubble edges

.msg-action-rows { margin: 0.45rem -0.72rem -0.55rem; border-top: 1px solid rgba(255,255,255,0.22) }
  ↑ action rows bleed to bottom and sides

.msg-action-row:last-child { border-radius: 0 0 16px 16px }
  ↑ bottom corners of last row match bubble corners

.bubble.inbound .msg-action-row-label { color: #1b7fc4 }
  ↑ blue text on inbound (white) bubbles
```

---

## 8. End-to-End Example — User Selects a List Option

The user taps **"Book a Demo"** in a WhatsApp list message sent from the QR channel.

```
Step 1 — WhatsApp sends interactiveResponseMessage
  body.text = "Book a Demo"
  nativeFlowResponseMessage.paramsJson = '{"id":"r1_demo","title":"Book a Demo"}'

Step 2 — handleInboundMessage → extractInboundText()
  label  = "Book a Demo"        ← stored in message_text, shown in chat
  flowId = "r1_demo"            ← used by flow engine, never displayed
  returns {
    displayText: "Book a Demo",
    flowText:    "Book a Demo r1_demo"
  }

Step 3 — enqueueInboundMessage → processQueue → processQueuedMessage

Step 4 — processIncomingMessage(
    messageText:     "Book a Demo",
    flowMessageText: "Book a Demo r1_demo"
  )

Step 5 — trackInboundMessage()
  INSERT conversation_messages:
    direction    = 'inbound'
    message_text = "Book a Demo"
    message_type = 'text'
    media_url    = NULL

Step 6 — handleFlowMessage("Book a Demo r1_demo")
  → matches flow trigger containing token "r1_demo"
  → executes flow block: { type:"text", text:"Great! I'll connect you with our team." }

Step 7 — sendConversationFlowMessage()
  channel = "qr"
  → socket.sendMessage(jid, { text: "Great! I'll connect you with our team." })

Step 8 — trackOutboundMessage()
  INSERT conversation_messages:
    direction       = 'outbound'
    message_text    = "Great! I'll connect you with our team."
    message_type    = 'text'
    message_content = '{"type":"text","text":"Great! I'll connect you with our team."}'

Step 9 — Frontend GET /api/conversations/:id/messages
  → listConversationMessages() returns both rows

Step 10 — normalizeMessage(inbound row)
  type = "text"
  direction = "incoming"
  sender_type = "user"
  content = { text: "Book a Demo" }

Step 11 — normalizeMessage(outbound row)
  type = "text"
  direction = "outgoing"
  sender_type = "agent"
  content = { text: "Great! I'll connect you with our team." }

Step 12 — renderMessage() → TextMessage bubble for each row
```

---

## Key Service Files

| File | Responsibility |
|---|---|
| `apps/api/src/services/whatsapp-session-manager.ts` | QR channel — Baileys socket, inbound queue, `extractInboundText` |
| `apps/api/src/services/meta-whatsapp-service.ts` | API channel — webhook parsing, Meta Graph API sends |
| `apps/api/src/services/widget-chat-gateway-service.ts` | Web channel — WebSocket gateway for embedded widget |
| `apps/api/src/services/message-router-service.ts` | Central router — all gates, flow engine, AI trigger |
| `apps/api/src/services/conversation-service.ts` | DB tracking — `trackInboundMessage`, `trackOutboundMessage`, `listConversationMessages` |
| `apps/api/src/services/channel-outbound-service.ts` | Outbound dispatch — `sendConversationFlowMessage`, `sendManualConversationMessage` |
| `apps/api/src/services/inbound-media-service.ts` | Media download, OCR, `media_uploads` storage |
| `apps/api/src/services/outbound-message-types.ts` | `FlowMessagePayload` type union + `summarizeFlowMessage` |
| `apps/web/src/modules/dashboard/inbox/message-renderer.tsx` | Frontend normaliser + all UI components |

Evolution API vs WAgen — WhatsApp Business API Architecture
Implementation status (2026-04-23)

This comparison started as a gap-analysis document. The major WAgen WhatsApp Business API gaps called out below have now been implemented in the current codebase on the SQL pool architecture:

- delivery status webhook ingestion and persistence
- template status webhook handling
- richer inbound normalization for text, buttons, lists, location, image, video, audio, document, sticker, contact, and reaction messages
- inbound Meta media download to `media_uploads` with internal `/api/media/:id` URLs
- generic outbound Meta send route using the full `FlowMessagePayload` dispatcher
- outbound persistence through conversation tracking and event fanout
- inbound contact syncing through the shared conversation/contact pipeline

Read the rest of this document as architectural background and implementation notes, not as a list of still-missing items.

Onboarding Flow
Evolution API — Manual token setup:


POST /instance/create {
  integration: "WHATSAPP-BUSINESS",
  token: "<permanent_system_user_token>",   // you get this from Meta dashboard
  number: "<phone_number_id>",
  businessId: "<waba_id>"
}
→ returns { webhookWaBusiness: "https://server/webhook/meta",
            accessTokenWaBusiness: "<verify_token>" }
→ user manually pastes both into Meta dashboard App → Webhooks
→ Meta does GET /webhook/meta?hub.verify_token=... (challenge-response)
→ done, state = "open" immediately, no QR
WAgen — Facebook Embedded Signup (OAuth):


Frontend opens Meta's OAuth popup → user logs in to Facebook
→ popup sends authorization code to WAgen callback
POST /meta/complete-signup { code, redirectUri, wabaId?, phoneNumberId? }
→ WAgen does 3-step token exchange:
    1. code → short-lived token  (graph.facebook.com/oauth/access_token)
    2. short-lived → long-lived token (fb_exchange_token)
    3. discoverMetaAssets() → calls /me/businesses, /{businessId}/owned_whatsapp_business_accounts,
       /{wabaId}/phone_numbers to auto-discover WABA + phone IDs
→ registerPhoneNumber() + subscribeAppToWabaWebhook() (programmatic — no manual Meta dashboard step)
→ optional: attach partner credit line (shared billing)
→ upsertConnection() stores encrypted token (AES-256-GCM)
→ state = "connected" or "pending"
Key architectural difference: Evolution requires the user to manually copy/paste webhook + verify-token into Meta's dashboard. WAgen automates everything via Embedded Signup OAuth — user just clicks "Connect with Meta," no dashboard configuration needed.

Webhook Ingestion
Step	Evolution API	WAgen
Route	GET/POST /webhook/meta	GET/POST /webhook/meta
Verify (GET)	Returns hub.challenge	Returns hub.challenge (HMAC-verified)
Auth	Verify token matches WA_BUSINESS.TOKEN_WEBHOOK	HMAC-SHA256 X-Hub-Signature-256 header
Routing	MetaController.receiveWebhook() → find instance by phone_number_id → instance.connectToWhatsapp(data)	handleMetaWebhookPayload() → buildWebhookTasks() → processWebhookTask() per message
Template status	Routes to per-template webhookUrl via axios.post	NOT IMPLEMENTED
Message types	text, image, video, audio, document, sticker, location, contacts, interactive, button, reaction	text, image (caption), document (caption), location, button, interactive (button/list reply)
Status updates	Persists to messageUpdate table	NOT IMPLEMENTED
WAgen missing vs Evolution:

message_template_status_update webhook routing (template approval/rejection events)
Delivery status webhook persistence (sent/delivered/read/failed)
Reaction, sticker, contact message inbound handling
Outbound Message Sending
Evolution API (sendMessageWithTyping):

Handles: text, location, contacts, media (image/video/audio/document), buttons (interactive), list, template, reaction
Media upload: URL→fetch→FormData upload to /{phoneNumberId}/media → get media ID → send with ID
Base64 media: convert to buffer → upload same way
Always persists sent message to Prisma Message table with webhookUrl per-message field
sendDataWebhook() fires event fanout after send
WAgen (sendMetaMessage / graphPost):

Handles: text, template, and basic media (URL-only, no upload)
Missing: button messages, list messages, reaction messages, contact messages
Missing: media upload flow (can only send media by URL, not base64)
Does NOT persist outbound messages to DB
Connection State Model
Evolution API:

stateConnection = { state: 'open' } hardcoded on init — Meta connections are always "open"
Instance stored in waMonitor.waInstances[name] in-memory + DB
No session auth encryption (token stored as plain string in DB)
Reconnect: not needed (token is permanent until revoked)
WAgen:


whatsapp_business_connections table:
  - access_token_encrypted (AES-256-GCM, key from META_TOKEN_ENCRYPTION_KEY)
  - status: 'pending' | 'connected' | 'restricted' | 'disconnected'
  - billing_mode, billing_status (partner credit line support)
  - metadata_json (webhook subscription details, registration result)
  - subscriptionStatus tracked separately
refreshConnectionStatusFromMeta() — polls Graph API to check phone quality, WABA review status, code verification
Token expiry tracking + renewal flow
Multi-connection per user (up to plan limit)
Billing attachment: partner shares credit line with customer WABA
Media Handling
Evolution API full flow:


1. getIdMedia(mediaMessage):
   - URL → axios.get(url, arraybuffer) → FormData
   - base64 → Buffer → FormData  
   - POST /{phoneNumberId}/media → returns { id }
2. sendMessageWithTyping({ media, id, type: 'id' })
   → POST /{phoneNumberId}/messages { [mediaType]: { id: mediaId } }

Inbound media download:
   GET /{mediaId} → { url } → GET url (with token) → arraybuffer
   → optionally upload to S3/MinIO
   → optional base64 in webhook payload (if webhookBase64 = true)
   → optional OpenAI speech-to-text for audio
WAgen: only sends media by URL (link type). No upload, no inbound media download, no S3.

Business Profile
Both implemented:

GET /{phoneNumberId}/whatsapp_business_profile → fetch about/address/description/email/websites/vertical
POST /{phoneNumberId}/whatsapp_business_profile → update
WAgen has it at getMetaBusinessProfile() / updateMetaBusinessProfile(). Evolution has setWhatsappBusinessProfile().

Summary: What WAgen Has That Evolution Doesn't
Embedded Signup OAuth — fully automated onboarding, no manual Meta dashboard steps
Token encryption at rest — AES-256-GCM
Multi-WABA billing — partner credit line attachment
Status/health sync — polls Meta for phone quality, WABA review, verification status
Plan limit enforcement — max API numbers per subscription tier
HMAC webhook signature verification — Evolution only checks verify token string match
Summary: What Evolution Has That WAgen Doesn't
Delivery status webhooks — sent/delivered/read persisted to DB
Template status webhook — routes message_template_status_update to per-template callback URL
Full message type inbound — reaction, sticker, contacts, interactive
Media upload — base64 → upload → send with ID
Inbound media download — fetch from Meta, upload to S3, optional base64 in payload
Button/list/reaction outbound — interactive messages not in WAgen
Message persistence — all sent/received messages stored to DB
Per-message webhookUrl — each sent message can have its own delivery callback

🧠 Goal Shift
Current WAgen:
User → AI → Reply
Target (Infra Platform):
Webhook → Normalize → Store → Emit → Consumers (AI / API / Webhooks / UI)

👉 This shift is everything.

🧱 CORE THINGS YOU MUST BUILD
🔴 1. Inbound Message Normalization Layer (MANDATORY)
Why:

Right now WAgen directly processes Meta payload → AI

👉 You need a universal message model

Build:
type InternalMessage = {
  userId: string
  remoteJid: string
  messageId: string
  type: "text" | "image" | "audio" | "video" | "document" | "location" | "contact"
  text?: string
  mediaUrl?: string
  mimeType?: string
  metadata?: any
  timestamp: Date
}
Flow:
Meta Webhook
   ↓
Normalize (convert Meta → InternalMessage)
   ↓
Everything else uses this

👉 This makes your system:

Provider-agnostic (Meta today, others tomorrow)
Clean & extensible
🔴 2. Inbound Media Pipeline (BIGGEST MISSING PIECE)
Build this exactly:
Media ID
   ↓
Download from Meta API
   ↓
Store (S3 / local / CDN)
   ↓
Attach to message
Minimal version (fast):
Skip S3 → store URL
Save in DB:
{
  mediaUrl,
  mimeType,
  fileSize
}

👉 Without this, you are NOT an API platform

🔴 3. Event System (CORE OF PLATFORM)

Right now WAgen:

call service → process → done
You need:
emitEvent(userId, "message.upsert", payload)
emitEvent(userId, "message.update", payload)
emitEvent(userId, "contact.update", payload)
Build:

Central service:

fanoutEvent(userId, event, payload)
Outputs:
WebSocket (UI)
Webhooks (external users)
Queue (future)

👉 This converts WAgen into a platform

🔴 4. Public API Layer (Developer Access)

Right now:

Internal APIs only
Add:
GET /api/messages
POST /api/send-message
GET /api/contacts
GET /api/chats

👉 With API keys per user

Add auth:
Authorization: Bearer <api_key>

👉 Now external devs can use WAgen

🔴 5. Outbound Message Engine (Full Coverage)
Support:
Text
Image
Audio
Document
Buttons
Lists
Location
Contacts
Build unified function:
sendMessage({
  type: "image",
  to: "...",
  url: "...",
  caption: "..."
})

👉 Normalize outbound too

🟠 6. Status Tracking System
Track:
status: "queued" | "sent" | "delivered" | "read" | "failed"
Store + emit:
message.update

👉 Needed for:

Analytics
Billing
Reliability
🟠 7. Contact & Chat Model (CRM Layer)
Add:
Contact {
  phone
  name
  lastSeen
}

Chat {
  remoteJid
  lastMessage
  unreadCount
}

👉 Makes your API usable for real apps

🟡 8. Webhook System (External Integration)
Let users register:
POST /api/webhooks
Trigger:
{
  "event": "message.upsert",
  "data": {...}
}

👉 Now WAgen integrates with:

CRMs
ERPs
Zapier-like tools
🟡 9. Queue / Async Layer (Optional First)

Start simple:

In-memory or DB queue

Later:

RabbitMQ / Kafka

👉 Needed for:

High scale
Retry
reliability
🟡 10. Provider Abstraction (Future-proof)

Right now:

Only Meta
Add layer:
provider.sendMessage()
provider.downloadMedia()
provider.parseWebhook()

👉 Later you can plug:

WhatsApp Business Cloud
Baileys
SMS
Instagram
🧭 FINAL ARCHITECTURE (TARGET)
                ┌──────────────┐
                │ Meta Webhook │
                └──────┬───────┘
                       ↓
            ┌────────────────────┐
            │ Normalization Layer │
            └────────┬───────────┘
                     ↓
            ┌────────────────────┐
            │ Media Processor     │
            └────────┬───────────┘
                     ↓
            ┌────────────────────┐
            │ Event System        │
            └────────┬───────────┘
                     ↓
   ┌────────────┬──────────────┬──────────────┐
   ↓            ↓              ↓              ↓
 DB Storage   AI Router   Webhooks       Public API

Pattern Gaps: Evolution → WAgen
1. Message Type Dispatcher (WAgen is missing this entirely)
Evolution: Each message type has its own normalizer method:


private messageTextJson(received)      // text → { conversation }
private messageMediaJson(received)     // image/video/doc → { imageMessage: {...} }
private messageAudioJson(received)     // audio → { audioMessage: { ptt } }
private messageReactionJson(received)  // → { reactionMessage: { key, text } }
private messageLocationJson(received)  // → { locationMessage: { lat, lng } }
private messageContactsJson(received)  // → vCard format
private messageInteractiveJson(received) // button/list reply → { conversation }
private messageButtonJson(received)    // button → { conversation }
Then one router:


private eventHandler(content) {
  if (message.type === 'text' || 'image' || 'audio' ...) {
    this.messageHandle(content, database, settings)
  }
}
WAgen: buildWebhookTasks() only handles text/button/interactive/location/image caption. No dedicated per-type method. Everything inlined.

Copy: Per-type normalizer methods pattern.

2. renderMessageType() — String → Enum Map
Evolution:


private renderMessageType(type: string) {
  switch (type) {
    case 'text':     return 'conversation';
    case 'image':    return 'imageMessage';
    case 'audio':    return 'audioMessage';
    case 'document': return 'documentMessage';
    case 'template': return 'conversation';
    case 'location': return 'locationMessage';
    case 'sticker':  return 'stickerMessage';
    default:         return 'conversation';
  }
}
WAgen: No equivalent. Type string used raw or ignored.

Copy: This lookup table.

3. Unified Outbound Dispatcher (sendMessageWithTyping)
Evolution: One function, dispatches by message shape:


if (message['reactionMessage']) → post reaction
if (message['locationMessage']) → post location
if (message['conversation'])    → post text
if (message['media'])           → post media by id
if (message['buttons'])         → post interactive/button
if (message['listMessage'])     → post interactive/list
if (message['template'])        → post template
Persists result + fires webhook in same function.

WAgen: Only sendAutoReplyViaMetaApi() — text only, no persistence, no webhook fire.

Copy: Full dispatcher pattern + persistence after send.

4. getIdMedia() — 2-Step Media Upload
Evolution:


private async getIdMedia(mediaMessage, isFile = false) {
  // URL → fetch arraybuffer → FormData
  // base64 → Buffer → FormData
  // POST /{phoneNumberId}/media → return res.data.id
}
Then prepareMediaMessage() calls it:


if (isURL(media)) {
  prepareMedia.type = 'link';   // send by URL directly
} else {
  const id = await this.getIdMedia(prepareMedia);
  prepareMedia.type = 'id';     // upload first, then send by ID
}
WAgen: No media upload. Can only send by URL. Base64 input not supported.

Copy: getIdMedia() + prepareMediaMessage() pattern exactly.

5. Status Webhook Handler
Evolution (inside messageHandle):


if (received.statuses) {
  for await (const item of received.statuses) {
    const findMessage = await prisma.message.findFirst({ where: { key: { id } } })
    // DELETED → create messageUpdate { status: 'DELETED' }
    // else    → create messageUpdate { status: item.status.toUpperCase() }
    // if findMessage.webhookUrl → axios.post(webhookUrl, message)
  }
}
WAgen: Status webhooks completely ignored — buildWebhookTasks() only processes change.field === "messages".

Copy: Status branch + messageUpdate persistence + per-message webhookUrl callback.

6. Per-Message webhookUrl Field
Evolution: Every sent message stores webhookUrl on the message row:


const messageRaw = {
  key: { fromMe: true, id: messageSent.messages[0].id, remoteJid },
  message: ...,
  webhookUrl,   // ← stored per message
  status: status[1],
}
await prismaRepository.message.create({ data: messageRaw })
// Later, when status update arrives:
if (findMessage.webhookUrl) await axios.post(findMessage.webhookUrl, statusUpdate)
WAgen: No webhookUrl on message rows. No per-message delivery callback.

Copy: Add webhook_url column to messages table, store on send, call on status update.

7. Contact Upsert on Every Inbound
Evolution: After every inbound message:


const contact = await prisma.contact.findFirst({ where: { instanceId, remoteJid } })
if (contact) {
  await prisma.contact.updateMany({ where: { remoteJid }, data: contactRaw })
  sendDataWebhook(Events.CONTACTS_UPDATE, contactRaw)
} else {
  prisma.contact.create({ data: contactRaw })
  sendDataWebhook(Events.CONTACTS_UPSERT, contactRaw)
}
WAgen: No contact table updates on inbound. Contacts not maintained.

Copy: Contact upsert pattern on inbound message processing.

Summary Table
Pattern	Evolution	WAgen	Copy?
Per-type message normalizers	✅ 8 dedicated methods	❌ inline partial	✅ 
renderMessageType() map	✅	❌	✅
Unified outbound dispatcher	✅ all types	❌ text only	✅
getIdMedia() 2-step upload	✅	❌	✅
Status webhook handler	✅	❌	✅
Per-message webhookUrl	✅	❌	✅
Contact upsert on inbound	✅	❌	✅
HMAC signature verify	❌	✅	—
Token encryption (AES-GCM)	❌	✅	—
Embedded Signup OAuth	❌	✅	—
Bottom 3 rows: WAgen is ahead. Top 7: copy from Evolution.

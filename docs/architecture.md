# Architecture Notes

## Multi-Session WhatsApp Manager

- Runtime map: `userId -> socket`
- Persistent auth/keys in PostgreSQL JSONB (`whatsapp_sessions.session_auth_json`)
- Per-user connection events streamed to UI websocket

## Realtime Channel

- Endpoint: `/ws?token=<jwt>`
- Event types:
  - `whatsapp.qr`
  - `whatsapp.status`
  - `conversation.updated`
  - `agent.status`

## RAG Pipeline

1. Ingest source content (website/PDF/manual)
2. Chunk text (`900` chars with overlap)
3. Generate embeddings (OpenAI)
4. Store in `knowledge_base` with `vector(1536)`
5. Retrieve top-k with cosine distance (`<=>`)

## Message Processing

1. Receive inbound message from Baileys
2. Persist message + update score/stage
3. Apply safety gates
4. Retrieve conversation history + knowledge chunks
5. Prompt LLM with business profile + personality
6. Delay 2-5s and send reply via same session
7. Persist outbound message and emit realtime update
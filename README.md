# Typo - WhatsApp AI Sales Agent (Baileys + RAG)

A SaaS-ready foundation for a QR-based WhatsApp AI sales assistant with:

- Multi-session WhatsApp Web connections via Baileys
- JWT-auth web onboarding + dashboard
- RAG knowledge ingestion (website, PDF, manual FAQ)
- PostgreSQL + `pgvector` retrieval
- Lead scoring, manual takeover, AI pause, and anti-ban safety delays
- Realtime websocket updates for QR, session status, and conversation events

## Monorepo Structure

- `apps/api`: Fastify + Baileys backend
- `apps/web`: React + Vite frontend
- `infra/schema.sql`: PostgreSQL schema
- `infra/docker-compose.yml`: Postgres (`pgvector`) + Redis

## Prerequisites

- Node.js 20+
- Docker (recommended for local DB)

## Quick Start

1. Start infrastructure:
   ```bash
   docker compose -f infra/docker-compose.yml up -d
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure environment files:
   - Copy `apps/api/.env.example` to `apps/api/.env`
   - Copy `apps/web/.env.example` to `apps/web/.env`
4. Run migration:
   ```bash
   npm run db:migrate
   ```
5. Start app:
   ```bash
   npm run dev
   ```
6. Open `http://localhost:5173`

## Docker Full Stack

Run everything (`api`, `web`, `postgres`, `redis`) in containers:

```bash
docker compose -f infra/docker-compose.full.yml up -d --build
```

- Web: `http://localhost:8080`
- API: `http://localhost:4000`

Stop:

```bash
docker compose -f infra/docker-compose.full.yml down
```

## Backend Flow

1. User signs up.
2. User triggers WhatsApp connect -> Baileys starts auth handshake.
3. QR events stream over websocket (`/ws`).
4. Session auth state is persisted in DB (`whatsapp_sessions.session_auth_json`).
5. Incoming WhatsApp messages:
   - Inbound only filter
   - Conversation + lead score updates
   - Cooldown + random delay rules
   - RAG retrieval + LLM response
   - Reply through same Baileys session

## API Highlights

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/whatsapp/connect`
- `GET /api/whatsapp/status`
- `POST /api/onboarding/business`
- `POST /api/knowledge/ingest/website`
- `POST /api/knowledge/ingest/pdf`
- `POST /api/knowledge/ingest/manual`
- `POST /api/onboarding/personality`
- `POST /api/onboarding/activate`
- `GET /api/dashboard/overview`
- `GET /api/conversations`
- `GET /api/conversations/:conversationId/messages`
- `PATCH /api/conversations/:conversationId/manual-takeover`
- `PATCH /api/conversations/:conversationId/pause`

## Safety Rules Implemented

- Random reply delay (`REPLY_DELAY_MIN_MS`, `REPLY_DELAY_MAX_MS`)
- Replies only to inbound direct messages
- Contact cooldown (`CONTACT_COOLDOWN_SECONDS`)
- Manual takeover and AI pause at conversation level

## Notes

- OpenAI key is required for embeddings + full LLM responses.
- Without OpenAI key, fallback responses work but knowledge retrieval is disabled.
- Redis is provisioned but optional in this base implementation.

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
- `infra/schema.sql`: baseline PostgreSQL schema
- `infra/migrations`: versioned incremental migrations
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
4. Run migrations:
   ```bash
   npm run db:migrate
   ```
5. Start app:
   ```bash
   npm run dev
   ```
6. Open `http://localhost:8080`

## Production-safe DB Migrations

Use these commands during deploys so schema changes are explicit and tracked, without runtime auto-DDL in app startup.

```bash
npm run db:migrate
npm run db:migrate:status
```

Recommended deploy order:

1. Build new API image/release.
2. Run `npm run db:migrate` against production DB.
3. Start/roll out new API version.

Local cleanup (dev only):

```bash
ALLOW_DB_RESET=true npm run db:reset:dev -- --force
```

`db:reset:dev` is blocked in `NODE_ENV=production` and requires explicit `ALLOW_DB_RESET=true` + `--force`.

## Docker Full Stack

Run everything (`api`, `web`, `postgres`, `redis`) in containers:

```bash
npm run dev:full
```

- Web: `http://localhost:8080`
- API: `http://localhost:4000`

`dev:full` now runs in `--watch` mode by default (auto rebuild on file changes).
Run once without watch:

```bash
npm run dev:full:once
```

Manual rebuild only `web` container (forced no-cache, if UI updates are not reflecting):

```bash
npm run dev:full:rebuild:web
```

After rebuild, hard refresh the browser on `http://localhost:8080/dashboard` (`Ctrl+Shift+R`).

Stop:

```bash
npm run dev:full:down
```

## Production Reverse Proxy (Required for Websocket)

If you put another Nginx in front of the `web` container (for TLS/domain routing), it must forward websocket upgrade headers.
Use [`infra/nginx/host-default.conf`](infra/nginx/host-default.conf) as the base host config.

Quick validation from any machine that can reach production:

```bash
curl --http1.1 -i \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "https://wagenai.com/ws?token=<jwt>"
```

Expected response starts with `HTTP/1.1 101 Switching Protocols`.

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

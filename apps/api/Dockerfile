FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm ci

COPY . .
RUN npm --workspace apps/api run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/infra/schema.sql ./infra/schema.sql

EXPOSE 4000

CMD ["sh", "-c", "node apps/api/dist/scripts/migrate.js && node apps/api/dist/server.js"]

#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(pwd)}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
DEPLOY_COMPOSE_FILE="${DEPLOY_COMPOSE_FILE:-infra/docker-compose.deploy.yml}"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-infra/.deploy-images.env}"
DEPLOY_SERVICES="${DEPLOY_SERVICES:-api web}"
RUN_DB_MIGRATE="${RUN_DB_MIGRATE:-1}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://localhost:4000/api/health}"
HEALTHCHECK_ATTEMPTS="${HEALTHCHECK_ATTEMPTS:-30}"
HEALTHCHECK_INTERVAL_SECONDS="${HEALTHCHECK_INTERVAL_SECONDS:-2}"
SKIP_GIT_SYNC="${SKIP_GIT_SYNC:-0}"
REGISTRY_HOST="${REGISTRY_HOST:-ghcr.io}"
REGISTRY_USERNAME="${REGISTRY_USERNAME:-}"
REGISTRY_PASSWORD="${REGISTRY_PASSWORD:-}"

API_IMAGE="${API_IMAGE:-}"
WEB_IMAGE="${WEB_IMAGE:-}"

echo "[deploy] APP_DIR=$APP_DIR"
echo "[deploy] DEPLOY_BRANCH=$DEPLOY_BRANCH"
echo "[deploy] DEPLOY_COMPOSE_FILE=$DEPLOY_COMPOSE_FILE"
echo "[deploy] DEPLOY_ENV_FILE=$DEPLOY_ENV_FILE"
echo "[deploy] DEPLOY_SERVICES=$DEPLOY_SERVICES"

if [[ ! -d "$APP_DIR" ]]; then
  echo "[deploy] APP_DIR does not exist: $APP_DIR"
  exit 1
fi

if [[ -z "$API_IMAGE" || -z "$WEB_IMAGE" ]]; then
  echo "[deploy] API_IMAGE and WEB_IMAGE are required"
  exit 1
fi

cd "$APP_DIR"

if [[ "$SKIP_GIT_SYNC" != "1" ]]; then
  git fetch origin --prune
  git checkout "$DEPLOY_BRANCH"
  git pull --ff-only origin "$DEPLOY_BRANCH"
fi

if [[ ! -f "$DEPLOY_COMPOSE_FILE" ]]; then
  echo "[deploy] Missing compose file: $DEPLOY_COMPOSE_FILE"
  exit 1
fi

if [[ -n "$REGISTRY_USERNAME" && -n "$REGISTRY_PASSWORD" ]]; then
  echo "$REGISTRY_PASSWORD" | docker login "$REGISTRY_HOST" -u "$REGISTRY_USERNAME" --password-stdin
fi

mkdir -p "$(dirname "$DEPLOY_ENV_FILE")"

TMP_ENV_FILE="$(mktemp)"
PREV_ENV_FILE=""
if [[ -f "$DEPLOY_ENV_FILE" ]]; then
  PREV_ENV_FILE="$(mktemp)"
  cp "$DEPLOY_ENV_FILE" "$PREV_ENV_FILE"
fi

cat >"$TMP_ENV_FILE" <<EOF
API_IMAGE=$API_IMAGE
WEB_IMAGE=$WEB_IMAGE
EOF

cp "$TMP_ENV_FILE" "$DEPLOY_ENV_FILE"

cleanup() {
  rm -f "$TMP_ENV_FILE"
  if [[ -n "$PREV_ENV_FILE" ]]; then
    rm -f "$PREV_ENV_FILE"
  fi
}

rollback() {
  if [[ -z "$PREV_ENV_FILE" ]]; then
    echo "[deploy] No previous image set available for rollback"
    return
  fi
  echo "[deploy] Rolling back to previous image set"
  cp "$PREV_ENV_FILE" "$DEPLOY_ENV_FILE"
  docker compose -f "$DEPLOY_COMPOSE_FILE" --env-file "$DEPLOY_ENV_FILE" up -d $DEPLOY_SERVICES
}

trap cleanup EXIT

if [[ "$RUN_DB_MIGRATE" == "1" ]]; then
  docker compose -f "$DEPLOY_COMPOSE_FILE" --env-file "$DEPLOY_ENV_FILE" up -d postgres redis
fi

docker compose -f "$DEPLOY_COMPOSE_FILE" --env-file "$DEPLOY_ENV_FILE" pull api web

if [[ "$RUN_DB_MIGRATE" == "1" ]]; then
  docker compose -f "$DEPLOY_COMPOSE_FILE" --env-file "$DEPLOY_ENV_FILE" run --rm api node apps/api/dist/scripts/migrate.js
fi

docker compose -f "$DEPLOY_COMPOSE_FILE" --env-file "$DEPLOY_ENV_FILE" up -d $DEPLOY_SERVICES
docker compose -f "$DEPLOY_COMPOSE_FILE" --env-file "$DEPLOY_ENV_FILE" ps

if ! command -v curl >/dev/null 2>&1; then
  echo "[deploy] curl not found, skipping health check"
  echo "[deploy] Completed successfully"
  exit 0
fi

for attempt in $(seq 1 "$HEALTHCHECK_ATTEMPTS"); do
  if curl -fsS "$HEALTHCHECK_URL" >/dev/null; then
    echo "[deploy] Health check passed: $HEALTHCHECK_URL"
    echo "[deploy] Completed successfully"
    exit 0
  fi
  echo "[deploy] Health check attempt $attempt/$HEALTHCHECK_ATTEMPTS failed"
  sleep "$HEALTHCHECK_INTERVAL_SECONDS"
done

echo "[deploy] Health check failed, starting rollback"
rollback
exit 1

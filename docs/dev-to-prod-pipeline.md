# Dev to Production Pipeline (All Updates)

This repository now uses an industry-style promotion channel for all changes:

- `feature/*` -> development work
- `develop` -> staging auto-deploy
- `main` -> production auto-deploy

The same pipeline handles API, web dashboard, and DB migrations.

## One-Time Bootstrap

If `develop` does not exist yet, create it once:

1. `git checkout main`
2. `git pull origin main`
3. `git checkout -b develop`
4. `git push -u origin develop`

## Pipeline Files

- Workflow: `.github/workflows/pipeline.yml`
- Remote deploy script: `tools/deploy/remote-deploy.sh`
- Deploy compose (image-based): `infra/docker-compose.deploy.yml`

## What the Pipeline Does

### 1) CI gates (PR + push)

- Installs root dependencies
- Lints and builds root workspaces (`apps/api`, `apps/web`)
- Validates migrations on a real Postgres+pgvector service:
  - `npm run db:migrate`
  - `npm run db:migrate:status`

### 2) Build once, push immutable images

On `develop` and `main` pushes (or manual deploy trigger):

- Builds Docker images for `api` and `web`
- Pushes to GHCR
- Uses immutable image digests (`image@sha256:...`) for deployment

### 3) Auto deploy without manual server steps

- Push to `develop` -> auto deploy to staging
- Push to `main` -> auto deploy to production
- `workflow_dispatch` supports manual redeploy to staging/production when needed

Deploy script behavior:

1. Pulls latest target branch on server
2. Logs into registry (GHCR)
3. Pulls exact image digests
4. Runs DB migration with new API image
5. Brings up `api` and `web` using `infra/docker-compose.deploy.yml`
6. Runs health check on `/api/health`
7. If health check fails, automatically rolls back to previous image set

## Required GitHub Secrets

### Staging deploy job

- `STAGING_HOST`
- `STAGING_PORT`
- `STAGING_USER`
- `STAGING_SSH_KEY`
- `STAGING_APP_DIR`
- `STAGING_REGISTRY_USERNAME`
- `STAGING_REGISTRY_PASSWORD`

### Production deploy job

- `PROD_HOST`
- `PROD_PORT`
- `PROD_USER`
- `PROD_SSH_KEY`
- `PROD_APP_DIR`
- `PROD_REGISTRY_USERNAME`
- `PROD_REGISTRY_PASSWORD`

For GHCR private image pull, registry credentials should have `read:packages`.

## Server Prerequisites (Staging/Production)

Each server must already have:

- Git
- Docker + Docker Compose plugin (`docker compose`)
- Repo checked out at `<APP_DIR>`
- Valid `apps/api/.env` file on server

## Daily Workflow (No Manual Deploy Commands)

1. Create branch from `develop`: `feature/<name>`
2. Push and open PR to `develop`
3. Merge to `develop` -> staging deploy runs automatically
4. Validate staging
5. Open PR `develop -> main`
6. Merge to `main` -> production deploy runs automatically

## Recommended Branch Protection

1. Protect `develop`:
   - Require PR
   - Require CI check: `CI Gates`
2. Protect `main`:
   - Require PR
   - Require CI check: `CI Gates`

If you want zero manual approvals, do not add required reviewers on deployment environments.

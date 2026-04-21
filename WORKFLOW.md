# Git & Deployment Workflow

## Branch Strategy

```
feature/... ──┐
              ↓
           develop  ──[PR]──→  main
              ↓                  ↓
           Staging           Production
    wagenai.com/staging/    wagenai.com
```

| Branch | Environment | URL |
|--------|-------------|-----|
| `develop` | Staging | https://wagenai.com/staging/ |
| `main` | Production | https://wagenai.com/ |

---

## Day-to-Day Development

```bash
# 1. Always work off develop
git checkout develop
git pull origin develop

# 2. Create a feature branch (optional but recommended)
git checkout -b feature/my-feature

# 3. Push to develop when ready — auto-deploys to staging
git push origin develop

# 4. Test at https://wagenai.com/staging/

# 5. Open a PR: develop → main on GitHub
# Merge the PR → auto-deploys to production
```

---

## CI/CD Pipeline

Every push to `develop` or `main` runs three stages in order:

### 1. Lint
- Runs ESLint across all workspaces (`apps/api`, `apps/web`)
- Fails fast if there are any lint errors

### 2. CI Gates
- Spins up real Postgres (`pgvector/pgvector:pg16`) and Redis (`redis:7-alpine`)
- Builds the full monorepo
- Runs all database migrations
- Checks migration status

### 3. Deploy
Only runs if CI Gates passes.

| Trigger | Deploys to |
|---------|------------|
| Push to `develop` | Staging |
| Push / merge to `main` | Production |
| Manual dispatch → choose target | Staging or Production |

---

## Manual Deploy

Go to **GitHub → Actions → Pipeline → Run workflow**, pick `staging` or `production`.

---

## Server Architecture

Both staging and production live on the same server (`64.227.182.4`), separated by ports and Docker Compose projects.

### Staging (`-p staging`)
| Service | Container port | Host port |
|---------|---------------|-----------|
| API | 4000 | **4001** |
| Web | 8080 | **8081** |
| Postgres | 5432 | (internal) |
| Redis | 6379 | (internal) |

- Directory: `/root/WAgen-staging`
- Git branch: `develop`
- Database: `typo_staging`
- Env file: `apps/api/.env.staging`

### Production
| Service | Container port | Host port |
|---------|---------------|-----------|
| API | 4000 | **4000** |
| Web | 8080 | **8080** |
| Postgres | 5432 | (internal) |
| Redis | 6379 | (internal) |

- Directory: `/root/WAgen`
- Git branch: `main`
- Database: `typo`
- Env file: `apps/api/.env`

### nginx routing (host)
```
https://wagenai.com/staging/api/  →  127.0.0.1:4001/api/
https://wagenai.com/staging/      →  127.0.0.1:8081/
https://wagenai.com/api/          →  127.0.0.1:4000/api/
https://wagenai.com/              →  127.0.0.1:8080/
```

---

## GitHub Secrets

Stored under **Settings → Environments**.

### `staging` environment
| Secret | Value |
|--------|-------|
| `STAGING_HOST` | `64.227.182.4` |
| `STAGING_USER` | `root` |
| `STAGING_PORT` | `22` |
| `STAGING_SSH_KEY` | private SSH key |

### `production` environment
| Secret | Value |
|--------|-------|
| `PROD_HOST` | `64.227.182.4` |
| `PROD_USER` | `root` |
| `PROD_PORT` | `22` |
| `PROD_SSH_KEY` | private SSH key |

---

## Staging Limitations

| Feature | Staging | Notes |
|---------|---------|-------|
| UI / API logic | ✅ Works | Full stack running |
| Outbound WhatsApp messages | ✅ Works | Same Meta credentials |
| Incoming webhooks | ❌ Won't work | Meta only sends to production URL |
| Meta OAuth / Embedded Signup | ❌ Won't work | Redirect URI not registered for staging |
| Emails (Brevo) | ✅ Works | Same API key |
| Payments (Razorpay) | ✅ Works | Using test keys |

---

## Deploy Script Summary

**Staging deploy steps (on server):**
1. `git reset --hard origin/develop` — clean sync, no merge conflicts
2. Copy nginx config → `/etc/nginx/sites-enabled/default` → reload nginx
3. `docker compose -p staging build --no-cache api web worker`
4. `docker compose -p staging run --rm api node .../migrate.js`
5. `docker compose -p staging up -d --wait api web worker`
6. Smoke test: `curl http://localhost:4001/api/health`

**Production deploy steps (on server):**
1. `git reset --hard origin/main`
2. `docker compose build api web worker`
3. `docker compose run --rm api node .../migrate.js`
4. `docker compose up -d --wait api web worker`
5. Smoke test: `curl http://localhost:4000/api/health`

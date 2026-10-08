# Deploying Thoudang on Railway (PostgreSQL)

The local demo stays on **SQLite** (`npm run demo`, no network needed). On Railway the same code runs
on **PostgreSQL** with `DB_DRIVER=postgres`. Behaviour and UI are the same on both drivers.

```
Railway project
├── Postgres  (plugin)                    → DATABASE_URL (private network)
└── thoudang  (this repo, Dockerfile.railway)
      API + built web UI on $PORT (SERVE_WEB=1)
      volume mounted at /data             → uploads, audio, templates, audit anchor, logs
```

## 1. Create the services

1. **New project → Deploy from GitHub repo** (this repo). `railway.json` selects
   `Dockerfile.railway` and the `/api/health` health check.
2. **+ New → Database → PostgreSQL** (the Postgres plugin).
3. On the `thoudang` service: **Settings → Volumes → Add volume**, mount path **`/data`**.
   Railway allows one volume per service, so every file path points into it (already set in
   `Dockerfile.railway`). You still need it with Postgres: uploaded images, notice audio, the
   reviewed notice templates, the audit-chain anchor and the logs are files, not rows.
4. **Settings → Networking → Generate domain.**

## 2. Variables (service `thoudang` → Variables)

| Variable             | Value                                       | Notes                                                                                                  |
| -------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `DB_DRIVER`          | `postgres`                                  | Also the image default; set it so it is visible.                                                       |
| `DATABASE_URL`       | `${{Postgres.DATABASE_URL}}`                | Reference variable → private host `postgres.railway.internal`, no SSL needed (detected automatically). |
| `PG_POOL_MAX`        | `5`                                         | Connection-pool size (default 5).                                                                      |
| `ANTHROPIC_API_KEY`  | `sk-ant-…`                                  | Claude extraction. `AI_PROVIDER` defaults to `anthropic`.                                              |
| `DEMO_MODE`          | `cache_first` (stage) or `live`             | `cache_first` replays primed extractions instantly.                                                    |
| `SESSION_SECRET`     | `openssl rand -hex 32`                      | Signs officer session cookies. Without it officers re-login after every deploy.                        |
| `OFFICER_PINS`       | `dswo-imphal-west:NNNN,da-imphal-west:NNNN` | Do not use the demo PINs on a public URL.                                                              |
| `AUDIT_CHAIN_KEY`    | `openssl rand -hex 32`                      | HMAC key of the audit hash chain. Keep it stable.                                                      |
| `STATUS_LINK_SECRET` | `openssl rand -hex 32`                      | Signs citizen status links. Rotating it invalidates printed QR codes.                                  |
| `PUBLIC_BASE_URL`    | `https://${{RAILWAY_PUBLIC_DOMAIN}}`        | Used for the phone-upload QR and the notice status QR.                                                 |
| `CORS_ORIGINS`       | `https://${{RAILWAY_PUBLIC_DOMAIN}}`        | Same-origin requests already pass; this keeps a custom domain working too (comma-separate several).    |
| `AUTH_MODE`          | `session`                                   | Default.                                                                                               |
| `REQUIRE_SIGN_IN`    | `1`                                         | Data reads need a signed-in officer on a public URL.                                                   |
| `GEMINI_API_KEY`     | optional                                    | Manipuri notice audio. Unset → "Audio unavailable".                                                    |
| `RETENTION_DAYS`     | optional, default `30`                      | Image retention for approved cases. The server runs this job at start-up and every 24 h.               |

**Do not set `PORT`.** Railway injects it and the server listens on `$PORT`.
`DB_PATH=/data/thoudang.db` is preset. On Postgres it only places the audit-anchor file
(`/data/thoudang.db.audit-anchor.json`) on the volume.

SSL: `DATABASE_SSL` = `disable | require | verify`. The default turns SSL off for localhost and
`*.railway.internal`, and uses `require` everywhere else. `require` encrypts the connection but
accepts Railway's self-signed proxy certificate. Only the **public** URL (`DATABASE_PUBLIC_URL`,
`*.proxy.rlwy.net`) needs SSL. The default already handles it, and you can also set
`DATABASE_SSL=require` explicitly.

`SERVE_WEB=1` (single service, no nginx) makes `POST /api/demo/reset` (Ctrl+Shift+R) available.
It wipes live cases and keeps the cache, audio, templates and history. That is useful on stage.
Keep `REQUIRE_SIGN_IN=1` and real PINs.

## 3. Migrations

The migrations run **automatically on every boot**. `openDb()` applies `apps/api/drizzle/pg/*`
under a Postgres advisory lock, so overlapping deploys are safe. That set holds the tables and the
append-only triggers on `audit_log` (UPDATE/DELETE/TRUNCATE raise). The `audit_chain` hash-chain
tables (also append-only) are created by the server on first boot, exactly as on SQLite. The
entrypoint then upserts the name gazetteer, which is idempotent (`SKIP_SEED=1` to skip).

Manual / CI:

```bash
# against Railway from your laptop (public URL from the Postgres plugin's Variables tab)
DB_DRIVER=postgres DATABASE_URL='<DATABASE_PUBLIC_URL>' DATABASE_SSL=require \
  npm run db:migrate -w @thoudang/api

# after editing apps/api/src/db/schema.sqlite.ts AND schema.pg.ts (keep them identical):
npm run db:generate -w @thoudang/api                      # → drizzle/sqlite
DB_DRIVER=postgres npm run db:generate -w @thoudang/api   # → drizzle/pg
```

## 4. One-off commands

Database-only commands can run from your laptop against the public URL:

```bash
export DB_DRIVER=postgres DATABASE_URL='<DATABASE_PUBLIC_URL>' DATABASE_SSL=require
npm run seed            # migrate + gazetteer
npm run seed:dashboard  # ~400 synthetic historical cases for /dashboard
npm run demo:prime -- --dir ./demo-packets   # real Claude → extraction cache in Postgres (no --with-cases)
```

Commands that read or write **files on the `/data` volume** must run inside the container
(`railway ssh`):

```bash
railway ssh            # opens a shell in the running thoudang service
tsx apps/api/src/demo/prime-notices.ts      # notices:prime — audio goes to /data/audio
tsx apps/api/src/security/audit-verify.ts   # audit:verify — chain + the anchor on /data
tsx apps/api/src/security/retention-cli.ts --dry-run   # retention (also runs every 24 h)
```

- `demo:prime --with-cases` stores packet images in the local `UPLOADS_DIR`. Run from a laptop,
  those images never reach the volume. Create demo cases through the deployed UI, or prime the
  cache only.
- `audit:verify` from a laptop still checks the whole hash chain. It just can't see the anchor
  file, which lives on the volume.

## 5. Local check before deploying

```bash
THOUDANG_DB_DRIVER=postgres docker compose --profile postgres up -d --build
npm run e2e:pg                                    # Playwright suite on an embedded Postgres
```

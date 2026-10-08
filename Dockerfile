# syntax=docker/dockerfile:1.7
# Thoudang — on-prem images, both non-root:
#   target `api` (default) : Node 20 + tsx running apps/api, SQLite on a volume (or DB_DRIVER=postgres
#                            + DATABASE_URL), SERVE_WEB=0
#   target `web`           : unprivileged nginx serving apps/web/dist and proxying /api → api
# Build:  docker compose build        Run: docker compose up -d
# Docs:   docs/deploy/SDC-DEPLOYMENT.md

ARG NODE_IMAGE=node:20-bookworm-slim
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27-alpine
ARG TSX_VERSION=4.23.15

# ---- 1. all dependencies (needed to build the web app) --------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# Toolchain only as a fallback for native modules (better-sqlite3, sharp normally use prebuilds).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN npm ci --no-audit --no-fund

# ---- 2. build the web UI (tsc + vite → apps/web/dist) ---------------------------------------
FROM deps AS web-build
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/web apps/web
RUN npm run build -w @thoudang/web

# ---- 3. production dependencies for api + core only -----------------------------------------
FROM deps AS prod-deps
RUN rm -rf node_modules apps/*/node_modules packages/*/node_modules \
 && npm ci --omit=dev --no-audit --no-fund \
      -w @thoudang/api -w @thoudang/core --include-workspace-root=false

# ---- 4. web: static UI + reverse proxy (listens on 8080 as uid 101) --------------------------
FROM ${NGINX_IMAGE} AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080

# ---- 5. api runtime (last stage = default target) -------------------------------------------
FROM ${NODE_IMAGE} AS api
ARG TSX_VERSION
ENV NODE_ENV=production \
    PORT=3001 \
    WEB_PORT=8080 \
    SERVE_WEB=0 \
    DEMO_MODE=live \
    DB_PATH=/app/apps/api/data/thoudang.db \
    UPLOADS_DIR=/app/apps/api/uploads \
    LOG_FILE=/app/apps/api/logs/api.log \
    AUDIO_DIR=/app/apps/api/data/audio \
    TEMPLATES_PATH=/app/apps/api/data/templates/templates.json
# The API runs TypeScript source through tsx (the project has no server build step).
RUN npm install -g --no-audit --no-fund "tsx@${TSX_VERSION}" \
 && npm cache clean --force \
 && apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.base.json ./
COPY --chown=node:node packages/core/package.json packages/core/tsconfig.json packages/core/
COPY --chown=node:node packages/core/src packages/core/src
COPY --chown=node:node packages/core/config packages/core/config
COPY --chown=node:node packages/core/data packages/core/data
COPY --chown=node:node packages/core/notices packages/core/notices
COPY --chown=node:node apps/api/package.json apps/api/tsconfig.json apps/api/
COPY --chown=node:node apps/api/src apps/api/src
# Migrations for both drivers: drizzle/sqlite (default) and drizzle/pg (DB_DRIVER=postgres).
COPY --chown=node:node apps/api/drizzle apps/api/drizzle
COPY --chown=node:node --chmod=755 deploy/docker-entrypoint.sh /usr/local/bin/thoudang-entrypoint
# Volume mount points owned by the unprivileged user so named volumes inherit the ownership.
RUN mkdir -p apps/api/data/templates apps/api/data/audio apps/api/uploads apps/api/logs \
 && chown -R node:node apps/api/data apps/api/uploads apps/api/logs
USER node
EXPOSE 3001
VOLUME ["/app/apps/api/data", "/app/apps/api/uploads", "/app/apps/api/logs"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "thoudang-entrypoint"]
CMD ["tsx", "apps/api/src/server.ts"]

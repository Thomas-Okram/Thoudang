#!/bin/sh
# Container entrypoint: prepare the persistent volume, migrate + seed (idempotent), then exec CMD.
set -eu
cd /app

# With DB_DRIVER=postgres the data dir still holds the audit-chain anchor file
# (<DB_PATH>.audit-anchor.json), notice templates and cached audio — keep it on a volume.
DATA_DIR="$(dirname "${DB_PATH:-/app/apps/api/data/thoudang.db}")"
mkdir -p "$DATA_DIR" "${UPLOADS_DIR:-/app/apps/api/uploads}" "$(dirname "${LOG_FILE:-/app/apps/api/logs/api.log}")"

# Notice templates are edited by reviewers on /admin/templates. Keep the live copy on the data
# volume so edits survive image upgrades; seed it from the image the first time only.
if [ -n "${TEMPLATES_PATH:-}" ] && [ ! -f "$TEMPLATES_PATH" ]; then
  mkdir -p "$(dirname "$TEMPLATES_PATH")"
  cp packages/core/notices/templates.json "$TEMPLATES_PATH"
  echo "thoudang: seeded notice templates at $TEMPLATES_PATH"
fi

if [ "${STATUS_LINK_SECRET:-}" = "" ] || [ "${STATUS_LINK_SECRET:-}" = "change-me" ]; then
  echo "thoudang: WARNING — STATUS_LINK_SECRET is not set; citizen status links use the prototype default." >&2
fi

# openDb() runs the Drizzle migrations for the active driver (drizzle/sqlite or drizzle/pg; on
# Postgres under an advisory lock, so parallel boots are safe); the gazetteer upsert is idempotent.
if [ "${DB_DRIVER:-sqlite}" = "postgres" ] && [ -z "${DATABASE_URL:-}" ]; then
  echo "thoudang: ERROR — DB_DRIVER=postgres but DATABASE_URL is not set." >&2
  exit 1
fi
if [ "${SKIP_SEED:-0}" != "1" ]; then
  tsx apps/api/src/seed.ts
fi

exec "$@"

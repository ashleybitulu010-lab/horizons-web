#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ashledger}"
APP_PORT="${APP_PORT:-3000}"
BRANCH="${BRANCH:-master}"

export PATH="/usr/local/bin:/usr/bin:$HOME/.npm-global/bin:$PATH"

cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" || true
git fetch origin
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

if [ -z "${VITE_SUPABASE_ANON_KEY:-}" ]; then
  echo "ERROR: VITE_SUPABASE_ANON_KEY is required for the production build." >&2
  exit 1
fi

npm install
node tools/generate-llms.js || true

BUILD_DIR="$(mktemp -d "$APP_DIR/.dist-build-XXXXXX")"
BACKUP_DIR="$APP_DIR/.dist-backup-$(date +%s)"
trap 'rm -rf "${BUILD_DIR:-}" 2>/dev/null || true' EXIT

npx vite build --outDir "$BUILD_DIR"
chmod -R u=rwX,go=rX "$BUILD_DIR"

if [ -d "$APP_DIR/dist" ]; then
  mv "$APP_DIR/dist" "$BACKUP_DIR"
fi

if ! mv "$BUILD_DIR" "$APP_DIR/dist"; then
  [ -d "$BACKUP_DIR" ] && mv "$BACKUP_DIR" "$APP_DIR/dist"
  exit 1
fi

BUILD_DIR=""
rm -rf "$BACKUP_DIR" 2>/dev/null || echo "WARN: previous dist could not be removed"

if command -v nginx >/dev/null 2>&1; then
  nginx -t && systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || true
fi

if ! curl -fsS "http://127.0.0.1:${APP_PORT}/hcgi/platform/api/health" >/dev/null 2>&1; then
  if command -v pm2 >/dev/null 2>&1; then
    if pm2 describe ashledger >/dev/null 2>&1; then
      pm2 restart ashledger
    else
      pm2 start npx --name ashledger -- vite preview --outDir dist --host 0.0.0.0 --port "$APP_PORT"
    fi
    pm2 save
  fi
fi

if command -v systemctl >/dev/null 2>&1; then
  for service in actions.runner.*.service github-actions-runner.service; do
    if systemctl list-units --type=service --all 2>/dev/null | rg -q "$service"; then
      systemctl restart "$service" 2>/dev/null || true
    fi
  done
fi

sleep 2
HTTP_CODE="$(curl -sS -o /tmp/ashledger_health_body -w '%{http_code}' "http://127.0.0.1:${APP_PORT}/")"
echo "HTTP_CODE=${HTTP_CODE}"
head -c 200 /tmp/ashledger_health_body || true
echo
test "$HTTP_CODE" = "200"

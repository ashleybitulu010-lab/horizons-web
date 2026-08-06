#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ashledger}"
APP_PORT="${APP_PORT:-3000}"
BRANCH="${BRANCH:-master}"

export PATH="/usr/local/bin:/usr/bin:$HOME/.npm-global/bin:$PATH"

if [ -d "$APP_DIR/dist" ] && [ ! -r "$APP_DIR/dist/index.html" ]; then
  chmod -R u=rwX,go=rX "$APP_DIR/dist" 2>/dev/null || true
fi

cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" || true
git fetch origin
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

DEFAULT_SUPABASE_URL='https://knrwplidgvuvjnuqqmrt.supabase.co'
export VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-$DEFAULT_SUPABASE_URL}"
if [ -z "${VITE_SUPABASE_URL}" ]; then
  export VITE_SUPABASE_URL="$DEFAULT_SUPABASE_URL"
fi

if [ -z "${VITE_SUPABASE_ANON_KEY:-}" ]; then
  echo "ERROR: VITE_SUPABASE_ANON_KEY is required for the production build." >&2
  exit 1
fi

# Persist Vite Supabase env for future rebuilds (do not print secret values).
python3 - <<'PY'
import os
from pathlib import Path
env_path = Path('/opt/ashledger/.env')
lines = env_path.read_text().splitlines() if env_path.exists() else []
data = {}
order = []
for line in lines:
    if not line.strip() or line.strip().startswith('#') or '=' not in line:
        order.append(('raw', line))
        continue
    k, _, v = line.partition('=')
    data[k] = v
    order.append(('kv', k))
data['VITE_SUPABASE_URL'] = os.environ['VITE_SUPABASE_URL']
data['VITE_SUPABASE_ANON_KEY'] = os.environ['VITE_SUPABASE_ANON_KEY']
out = []
seen = set()
for kind, val in order:
    if kind == 'raw':
        out.append(val)
    else:
        out.append(f'{val}={data[val]}')
        seen.add(val)
for k, v in data.items():
    if k not in seen:
        out.append(f'{k}={v}')
env_path.write_text('\n'.join(out) + '\n')
env_path.chmod(0o600)
print('Persisted VITE_SUPABASE_URL len', len(data['VITE_SUPABASE_URL']))
print('Persisted VITE_SUPABASE_ANON_KEY len', len(data['VITE_SUPABASE_ANON_KEY']))
PY

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
chmod -R u=rwX,go=rX "$APP_DIR/dist"
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

# Do not restart the GitHub Actions runner from inside a deploy job — that
# kills the current run and leaves the runner in a stuck "session exists" state.

sleep 2
HTTP_CODE="$(curl -sS -o /tmp/ashledger_health_body -w '%{http_code}' "http://127.0.0.1:${APP_PORT}/")"
echo "HTTP_CODE=${HTTP_CODE}"
head -c 200 /tmp/ashledger_health_body || true
echo
test "$HTTP_CODE" = "200"

# Confirm Supabase publishable/anon key was embedded in the client bundle.
python3 - <<'PY'
from pathlib import Path
import re
assets = list(Path('/opt/ashledger/dist/assets').glob('index-*.js'))
assert assets, 'missing dist assets'
text = assets[0].read_text(errors='ignore')
assert 'knrwplidgvuvjnuqqmrt' in text, 'VITE_SUPABASE_URL missing from bundle'
has_legacy_jwt = bool(re.search(r'eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+', text))
has_publishable = 'sb_publishable_' in text
print('bundle', assets[0].name, 'jwt', has_legacy_jwt, 'publishable', has_publishable)
assert has_legacy_jwt or has_publishable, 'VITE_SUPABASE_ANON_KEY missing from production bundle'
PY

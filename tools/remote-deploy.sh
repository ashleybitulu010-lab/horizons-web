#!/usr/bin/env bash
set -euo pipefail

HOST="${VPS_HOST:-187.124.187.13}"
USER="${VPS_USER:-root}"
PORT="${VPS_PORT:-22}"
APP_DIR="${APP_DIR:-/opt/ashledger}"

if [ -z "${VPS_SSH_KEY:-}" ] && [ -z "${SSH_AUTH_SOCK:-}" ]; then
  echo "ERROR: set VPS_SSH_KEY or SSH_AUTH_SOCK for authentication." >&2
  exit 1
fi

SSH_OPTS=(-p "$PORT" -o StrictHostKeyChecking=no -o BatchMode=yes)
if [ -n "${VPS_SSH_KEY:-}" ]; then
  KEY_FILE="$(mktemp)"
  trap 'rm -f "$KEY_FILE"' EXIT
  printf '%s\n' "$VPS_SSH_KEY" > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  SSH_OPTS+=(-i "$KEY_FILE")
fi

ENV_EXPORTS="export VITE_SUPABASE_URL='${VITE_SUPABASE_URL:-https://knrwplidgvuvjnuqqmrt.supabase.co}'"
ENV_EXPORTS+="; export VITE_SUPABASE_ANON_KEY='${VITE_SUPABASE_ANON_KEY:-}'"

echo "Deploying on ${USER}@${HOST}:${PORT} ..."
ssh "${SSH_OPTS[@]}" "${USER}@${HOST}" "cd '$APP_DIR' && $ENV_EXPORTS && bash tools/deploy-vps.sh"

REMOTE_HASH="$(ssh "${SSH_OPTS[@]}" "${USER}@${HOST}" "grep -o 'assets/index-[^\\\"]*\\.js' '$APP_DIR/dist/index.html' | head -1")"
LOCAL_CHECK="$(curl -sS "https://ashledger.tech/" | rg -o 'assets/index-[^\"]+\\.js' | head -1)"

echo "Remote dist bundle: ${REMOTE_HASH:-unknown}"
echo "Live site bundle:   ${LOCAL_CHECK:-unknown}"

if [ -n "${REMOTE_HASH:-}" ] && [ -n "${LOCAL_CHECK:-}" ] && [ "$REMOTE_HASH" = "$LOCAL_CHECK" ]; then
  echo "SUCCESS: production serves the new bundle."
else
  echo "WARN: bundle hash mismatch — check nginx cache or DNS propagation."
fi

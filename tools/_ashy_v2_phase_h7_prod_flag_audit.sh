#!/usr/bin/env bash
# H7 — Safe production V2 flag audit (SET/ABS only — never prints values).
set -euo pipefail

echo "=== H7 V2 FLAG PRESENCE (production VPS) ==="
for v in \
  ASHY_INTELLIGENCE_V2 \
  ASHY_INTELLIGENCE_V2_HTTP \
  ASHY_INTELLIGENCE_V2_PRIMARY \
  ASHY_INTELLIGENCE_V2_ACTIONS \
  ASHY_INTELLIGENCE_V2_HTTP_CONFIRM \
  ASHY_INTELLIGENCE_V2_SHADOW \
  ASHY_V2_CUTOVER_MODE \
  ASHY_V2_PRIMARY_SAFE_FALLBACK
do
  found=0
  for f in /docker/ash-ledger-api-v2/.env /docker/ash-ledger-api/.env; do
    if [ -f "$f" ] && grep -q "^${v}=" "$f" 2>/dev/null; then
      val=$(grep "^${v}=" "$f" | cut -d= -f2- | tr '[:upper:]' '[:lower:]' | tr -d '\r\n ')
      if [ -z "$val" ] || [ "$val" = "false" ] || [ "$val" = "0" ]; then
        echo "OFF:${v}:in:${f}"
      else
        echo "ON:${v}:in:${f}"
      fi
      found=1
      break
    fi
  done
  if [ "$found" -eq 0 ]; then
    echo "ABS:${v} (defaults to OFF in code)"
  fi
done

echo "=== EXPECTED FOR H7 ==="
echo "All V2 flags OFF or ABSENT"

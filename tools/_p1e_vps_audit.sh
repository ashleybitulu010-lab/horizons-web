#!/usr/bin/env bash
set -euo pipefail

echo "=== ENV PRESENCE ==="
for v in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL SUPABASE_DB_HOST SUPABASE_DB_PASSWORD AGENT_SESSION_TRANSACTIONAL_CONFIRM AGENT_SESSION_IDEMPOTENT_CONFIRM AGENT_SESSION_WRITE_DB_FIRST AGENT_SESSION_PENDING_DB_REQUIRED POCKETBASE_URL N8N_WEBHOOK_URL N8N_CHAT_WEBHOOK; do
  found=0
  for f in /docker/ash-ledger-api-v2/.env /docker/ash-ledger-api/.env /opt/ashledger/.env; do
    if [ -f "$f" ] && grep -q "^${v}=" "$f" 2>/dev/null; then
      n=$(grep "^${v}=" "$f" | cut -d= -f2- | wc -c)
      if [ "$n" -gt 1 ]; then echo "SET:${v}:in:${f}"; found=1; break; fi
    fi
  done
  if [ "$found" -eq 0 ]; then echo "ABS:${v}"; fi
done

echo "=== AGENT FLAGS v2 ==="
grep -E '^AGENT_SESSION_' /docker/ash-ledger-api-v2/.env | sed 's/=.*/=***/'

echo "=== P1-E FILES ==="
for f in conversation-service.js activity-reference-resolver.js activity-scope.js history-loader.js; do
  if [ -f "/opt/ashledger/apps/api/src/services/$f" ]; then echo "HAS:$f"; else echo "MISSING:$f"; fi
done

echo "=== MIGRATION FILE ==="
if [ -f "/opt/ashledger/supabase/migrations/20260910195000_p1e_conversation_activity_scope.sql" ]; then echo "HAS_MIGRATION"; else echo "MISSING_MIGRATION"; fi

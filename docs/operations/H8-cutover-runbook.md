# H8 Cutover Runbook

**Phase:** H8.0 — Cutover architecture & safety gate (preparation only)  
**Date:** 2026-09-17  
**Commit baseline:** `9a66610`  
**Rollback ref:** `6097852`

> **H8.0 does NOT activate V2.** This runbook defines how a future cutover phase would be executed safely.

---

## 1. Current state

| Item | Value |
|------|-------|
| Production cutover mode | `LEGACY_ONLY` |
| V2 | OFF |
| V2 HTTP | OFF |
| V2 PRIMARY | OFF |
| V2 ACTIONS | OFF |
| V2 CONFIRM | OFF |
| V2 SHADOW | OFF |
| n8n | Intact (primary user path via `/chat`) |
| VPS container | H7.8 code present |
| Test baseline | 1254 PASS / 0 FAIL / 10 SKIP |
| H7.7 perf baseline | p50 ≈ 543 ms, p95 ≈ 903 ms |
| Financial delta | 0 |

---

## 2. Preconditions

Before any cutover activation (future phase):

1. All H8 safety gates in `H8-cutover-safety-gates.md` show **PASS** with evidence.
2. Full test suite passes with zero regressions vs baseline.
3. Docker container healthy (`Up (healthy)`), `/api/health` returns 200.
4. PocketBase auth and activity scope verified (403 on foreign activity).
5. Supabase RPC `confirm_and_create_*` idempotence verified in staging.
6. Rollback image/commit `6097852` available on VPS.
7. On-call operator has access to VPS env files and nginx (read-only until cutover phase).

---

## 3. Flags

### Environment variables (production `.env`)

| Flag | Cutover role |
|------|--------------|
| `ASHY_V2_CUTOVER_MODE` | Explicit mode override (wins over flag bundle) |
| `ASHY_INTELLIGENCE_V2` | Master V2 enable |
| `ASHY_INTELLIGENCE_V2_HTTP` | HTTP handler on `/api/ashy/chat` |
| `ASHY_INTELLIGENCE_V2_PRIMARY` | Block legacy passthrough after V2 HTTP |
| `ASHY_V2_PRIMARY_SAFE_FALLBACK` | Allow READ-only n8n fallback on V2 errors |
| `ASHY_INTELLIGENCE_V2_SHADOW` | Observe legacy without serving V2 |
| `ASHY_INTELLIGENCE_V2_ACTIONS` | V2 action proposals |
| `ASHY_INTELLIGENCE_V2_HTTP_CONFIRM` | F4-B2 commits via V2 HTTP |
| `AGENT_SESSION_TRANSACTIONAL_CONFIRM` | F4-B2 transactional RPC |
| `AGENT_SESSION_IDEMPOTENT_CONFIRM` | operation_id + request_hash idempotence |

### Cutover modes (implemented)

| Mode | V2 HTTP | Legacy/n8n | Shadow |
|------|---------|------------|--------|
| `LEGACY_ONLY` | Off | Primary | Off |
| `V2_SHADOW` | Off | Primary | Observes |
| `V2_PRIMARY` | Primary | Blocked on unhandled | Off |
| `V2_PRIMARY_SAFE_FALLBACK` | Primary | READ fallback only | Off |

---

## 4. Activation sequence

**Recommended first cutover:** `V2_PRIMARY_SAFE_FALLBACK` (READ only, no ACTIONS/CONFIRM).

> **Canary:** NOT_AVAILABLE — no per-user allowlist exists. Cutover is binary global only.

### Step 0 — Freeze writes test window

Schedule a low-traffic window. Notify operators. No financial writes during initial READ cutover.

### Step 1 — Enable shadow observation (optional, pre-primary)

```env
ASHY_INTELLIGENCE_V2=true
ASHY_INTELLIGENCE_V2_SHADOW=true
ASHY_V2_CUTOVER_MODE=V2_SHADOW
```

Restart API container. Verify shadow diagnostics in logs. **No user-facing change.**

### Step 2 — Enable V2 HTTP READ primary with safe fallback

```env
ASHY_V2_CUTOVER_MODE=V2_PRIMARY_SAFE_FALLBACK
ASHY_INTELLIGENCE_V2=true
ASHY_INTELLIGENCE_V2_HTTP=true
ASHY_INTELLIGENCE_V2_PRIMARY=true
ASHY_V2_PRIMARY_SAFE_FALLBACK=true
ASHY_INTELLIGENCE_V2_ACTIONS=false
ASHY_INTELLIGENCE_V2_HTTP_CONFIRM=false
```

Restart API. Frontend Ashy route (`/api/ashy/chat`) becomes primary; n8n fallback allowed **READ only**.

### Step 3 — Monitor (minimum 30 minutes)

See §5. Compare latency and error rates to H7.7 baseline.

### Step 4 — Enable ACTIONS (proposal only, no confirm)

```env
ASHY_INTELLIGENCE_V2_ACTIONS=true
ASHY_INTELLIGENCE_V2_HTTP_CONFIRM=false
```

Verify proposals persist pending state. Confirm **NO** financial writes occur.

### Step 5 — Enable CONFIRM (F4-B2)

```env
ASHY_INTELLIGENCE_V2_HTTP_CONFIRM=true
AGENT_SESSION_TRANSACTIONAL_CONFIRM=true
AGENT_SESSION_IDEMPOTENT_CONFIRM=true
```

Only after Gates 1–4 (Financial) pass in staging.

### Step 6 — Tighten fallback (optional)

Switch from `V2_PRIMARY_SAFE_FALLBACK` to `V2_PRIMARY` when READ error rate is acceptable without n8n fallback.

---

## 5. Monitoring

### Logs

| Source | What to watch |
|--------|---------------|
| Docker `ash-ledger-api` | `transactional_write_committed`, `idempotent_replay`, `idempotent_replay_blocked` |
| Docker | `v2_fallback_blocked`, `action_confirm_*`, `transactional_confirm_fallback_blocked` |
| Frontend console | `[chat-transport] v2_read_fallback_n8n` vs `v2_fallback_blocked` |

### Database

| Table / RPC | Metric |
|-------------|--------|
| `agent_write_operations` | `completed`, `processing`, `error` counts |
| `agent_sessions` pending | Orphan pending rows |
| Supabase RPC | `ALREADY_COMPLETED` replay rate |

### HTTP health

- `GET /api/health` → 200
- Authenticated `POST /api/ashy/chat` READ sample → 200, `fallbackPolicy: SAFE_FALLBACK`
- `GET /api/me` → 200 with scoped activity

### Performance baselines (H7.7)

| Metric | Baseline | Stop threshold |
|--------|----------|----------------|
| p50 latency | 543 ms | > 2× baseline sustained |
| p95 latency | 903 ms | > 2× baseline sustained |
| Error rate | ~0% internal | > 5% over 5 min |
| Timeout rate | ~0% internal | > 2% over 5 min |

---

## 6. Financial safety

### Invariants (must never violate)

1. **Maximum 1 financial write per user intention** — enforced by `operation_id` + `request_hash` in F4-B2.
2. **COMMITTED ≠ retry write** — `ALREADY_COMPLETED` replays result; never re-executes RPC.
3. **No double-write V2 + n8n** — ACTION paths set `noN8nFallback: true`; frontend blocks n8n on action/network error.
4. **Scope from server only** — `client_id`, `activity_id`, `operation_id` never accepted from model output.

### Critical anomalies (immediate rollback)

- Duplicate `agent_write_operations` for same `operation_id`
- `request_hash` mismatch with successful write
- Unexpected n8n financial write after V2 confirmation
- Scope violation (foreign activity write)

---

## 7. Fallback rules

| Situation | Policy | n8n allowed? |
|-----------|--------|--------------|
| READ success | SAFE_FALLBACK | No (V2 answered) |
| READ NO_DATA | NO_FALLBACK | No |
| READ error (PRIMARY) | NO_FALLBACK | No |
| READ error (SAFE_FALLBACK) | SAFE_FALLBACK | Yes (READ only) |
| ACTION proposal | NO_FALLBACK | No |
| ACTION clarification | NO_FALLBACK | No |
| ACTION confirmation | NO_FALLBACK | No |
| ACTION committed | NO_FALLBACK | No |
| Post-commit HTTP error | NO_FALLBACK / AMBIGUOUS_WRITE | No |
| Frontend network error on confirm | AMBIGUOUS_WRITE | No |

Implementation: `v2-fallback-policy.js` (server) + `ashyFallbackPolicy.js` (client).

---

## 8. Rollback

### Functional rollback (no DB migration)

Set env to LEGACY_ONLY and restart:

```env
ASHY_V2_CUTOVER_MODE=LEGACY_ONLY
ASHY_INTELLIGENCE_V2=false
ASHY_INTELLIGENCE_V2_HTTP=false
ASHY_INTELLIGENCE_V2_PRIMARY=false
ASHY_V2_PRIMARY_SAFE_FALLBACK=false
ASHY_INTELLIGENCE_V2_ACTIONS=false
ASHY_INTELLIGENCE_V2_HTTP_CONFIRM=false
ASHY_INTELLIGENCE_V2_SHADOW=false
```

Legacy `/chat` → n8n resumes immediately. **No data rollback required.**

### Code rollback (if needed)

Redeploy commit `6097852` via existing SCP/docker rebuild procedure.

---

## 9. Stop conditions

### CRITICAL — rollback immediately

- Financial duplicate detected
- Unauthorized write / scope violation
- Unexpected n8n write after V2 confirm
- Corrupted pending state causing duplicate proposals

### HIGH — rollback within 15 minutes if not resolved

- Error rate > 5% sustained 5 min
- Repeated ACTION timeouts
- Classifier regression (ACTION misclassified as READ causing writes)
- Response validation failure spike

### MEDIUM — investigate, may defer cutover

- Latency p95 > 1800 ms sustained
- NO_DATA rate anomaly vs baseline

---

## 10. Post-cutover verification

After each activation step:

1. `npm test` in CI/local — 0 FAIL
2. Authenticated READ smoke (sales, expenses, stock, products, debts, profit)
3. Legacy `/chat` still 200 (n8n intact until PRIMARY blocks unhandled)
4. Financial delta query → 0 unexpected writes
5. Check `agent_write_operations` for orphan `processing` rows
6. Verify frontend shows Ashy replies (not silent n8n fallback on READ success)

---

## 11. Emergency rollback

1. SSH VPS → edit `/opt/ashledger/.env` (or container env)
2. Set all V2 flags `false`, `ASHY_V2_CUTOVER_MODE=LEGACY_ONLY`
3. `docker compose restart ash-ledger-api`
4. Verify `/api/health` 200
5. Test Legacy `/chat` with known READ query
6. Confirm financial delta 0
7. Document incident in operations log

**Do not** run Supabase migrations or delete `agent_write_operations` during emergency rollback.

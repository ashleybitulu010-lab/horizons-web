# H8 Cutover Safety Gates

**Phase:** H8.0 — Preparation audit (no activation)  
**Date:** 2026-09-17  
**Baseline commit:** `9a66610`

Each gate requires **evidence**, not assumption. Status reflects H8.0 audit only.

---

## Summary

| Gate | Status | Blocker |
|------|--------|---------|
| GATE 1 — Infrastructure | **PASS** | — |
| GATE 2 — Security | **PASS** | — |
| GATE 3 — Functional | **PASS** | — |
| GATE 4 — Financial | **PASS** | — |
| GATE 5 — Performance | **PASS** | — |
| GATE 6 — Fallback | **PASS** | — |
| GATE 7 — Rollback | **PASS** | — |
| GATE 8 — Canary | **NOT_AVAILABLE** | No per-user targeting |
| GATE 9 — Staging simulation | **NOT_SIMULATED** | No dedicated staging env |

**Overall H8.0 verdict:** READY_FOR_CUTOVER_EXECUTION (architecture only — **do not activate**)

---

## GATE 1 — Infrastructure

| Requirement | Evidence | Status |
|-------------|----------|--------|
| Docker healthy | H7.8 git-sync: `Up (healthy)`, port 3002 | PASS |
| health 200 | H7.8 production smoke | PASS |
| nginx OK | H7.6/H7.7: unchanged, no V2 routing | PASS |
| Supabase OK | F4-B2 tests + staging RPC tests pass | PASS |
| PocketBase OK | H7.8 auth `/api/me` 200 | PASS |

---

## GATE 2 — Security

| Requirement | Evidence | Status |
|-------------|----------|--------|
| auth PASS | H7.8 smoke, `auth.test.js` | PASS |
| client scope PASS | `requireClientScope`, F4-B2 tests | PASS |
| activity scope PASS | `activity-scope-p1c.test.js`, H7.8 foreign 403 | PASS |
| foreign activity 403 | H7.7/H7.8 production smoke | PASS |
| forged IDs rejected | `INTERNAL_ACTION_KEYS` stripped from user-facing proposals; scope from `req.user` only | PASS |

---

## GATE 3 — Functional

| Requirement | Evidence | Status |
|-------------|----------|--------|
| products PASS | H7.8 classifier gap fix, 1254 tests | PASS |
| sales PASS | `get-sales.test.js`, orchestrator tests | PASS |
| expenses PASS | `get-expenses.test.js`, create-expense tests | PASS |
| stock PASS | `get-stock.test.js` | PASS |
| debts PASS | `get-debts.test.js` | PASS |
| profit PASS | H7.8 analyzer + templates | PASS |
| compare PASS | orchestrator compare tests | PASS |
| NO_DATA PASS | H7.8 `RESPONSE_STATUS.NO_DATA` | PASS |

---

## GATE 4 — Financial

| Requirement | Evidence | Status |
|-------------|----------|--------|
| F4-B2 PASS | `agent-session-confirm-f4-b2-*.test.js` | PASS |
| idempotence PASS | `agent-operation-idempotency.test.js`, F4-B2-C replay | PASS |
| concurrent confirmation PASS | F4-B2-D/E staging tests | PASS |
| zero duplicate | Idempotent RPC `ALREADY_COMPLETED` path | PASS |
| request hash PASS | Hash mismatch → `REQUEST_HASH_MISMATCH`, no write | PASS |
| post-commit NO_FALLBACK | `f4Committed` / `f4Status: COMMITTED` → NO_FALLBACK | PASS |

---

## GATE 5 — Performance

| Requirement | Evidence | Status |
|-------------|----------|--------|
| V2 HTTP VPS benchmark | H7.7: p50 543 ms, p95 903 ms | PASS |
| H7.8 rebenchmark | p50 594 ms, p95 923 ms (within ~10%) | PASS |
| error rate | 0% on internal READ benchmark | PASS |
| timeout rate | 0% on internal READ benchmark | PASS |

**Note:** GO_WITH_PERFORMANCE_WARNING from H7.8 — p95 slightly above H7.7 but acceptable for cutover prep.

---

## GATE 6 — Fallback

| Requirement | Evidence | Status |
|-------------|----------|--------|
| read fallback controlled | `v2-fallback-policy.js`: READ success → SAFE_FALLBACK; NO_DATA → NO_FALLBACK | PASS |
| action NO_FALLBACK | All ACTION statuses in `NO_FALLBACK_ACTION_STATUSES` | PASS |
| post-commit NO_FALLBACK | `f4Committed`, `COMMITTED`, `ALREADY_COMPLETED` | PASS |
| client-side enforcement | `ashyFallbackPolicy.test.js` (19 tests) | PASS |
| primary blocks legacy | `shouldBlockLegacyPassthrough` for V2_PRIMARY modes | PASS |

---

## GATE 7 — Rollback

| Requirement | Evidence | Status |
|-------------|----------|--------|
| LEGACY_ONLY available | `mapFlagsForCutoverMode(LEGACY_ONLY)` clears all V2 flags | PASS |
| rollback procedure documented | `H8-cutover-runbook.md` §8, §11 | PASS |
| previous deployment available | Rollback ref `6097852` on VPS | PASS |
| config safety validation | `validateCutoverConfigSafety()` prevents orphan PRIMARY | PASS |

---

## GATE 8 — Canary

| Requirement | Evidence | Status |
|-------------|----------|--------|
| Per-user allowlist | Code search: no allowlist/canary/header routing in `apps/api/src` | **NOT_AVAILABLE** |
| Internal test user routing | Not implemented | **NOT_AVAILABLE** |
| Feature flag per user | Not implemented | **NOT_AVAILABLE** |

**Decision:** Binary global cutover only. First cutover = `V2_PRIMARY_SAFE_FALLBACK` READ-only, all users.

---

## GATE 9 — Staging simulation

| Scenario | Status | Notes |
|----------|--------|-------|
| LEGACY_ONLY | NOT_SIMULATED | No dedicated staging env |
| V2_SHADOW | NOT_SIMULATED | — |
| V2_PRIMARY READ | NOT_SIMULATED | H7.7 used SAFE_INTERNAL_V2_HTTP on prod container loopback |
| ACTION proposal | NOT_SIMULATED | H6 staging gate scripts exist but not re-run in H8 |
| ACTION confirmation | NOT_SIMULATED | — |
| duplicate confirmation | Covered by unit tests F4-B2-C | PASS (unit) |
| rollback LEGACY_ONLY | NOT_SIMULATED | Flag mapping verified in unit tests |

---

## Blockers before live cutover (future phase)

1. **No canary** — first activation affects all Ashy users immediately.
2. **Staging NOT_SIMULATED** — recommend H7-style internal loopback gate before Step 2 activation.
3. **Performance warning** — monitor p95 closely during first 30 min of PRIMARY mode.

---

## Test evidence (H8.0)

| Suite | Result |
|-------|--------|
| Baseline | 1254 PASS / 0 FAIL / 10 SKIP |
| New `intelligence-v2-cutover-safety.test.js` | 39 tests |
| `ashyFallbackPolicy.test.js` | 19 tests |
| Full suite post-H8 | **1299 PASS / 0 FAIL / 10 SKIP** |

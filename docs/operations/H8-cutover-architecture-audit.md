# H8 Cutover Architecture Audit

**Phase:** H8.0 — Cutover architecture & safety gate  
**Date:** 2026-09-17  
**Commit:** `9a66610` (pre-H8 docs/tests)  
**Auditor:** Automated code trace + unit tests

---

## Verdict

**READY_FOR_CUTOVER_EXECUTION**

Architecture for controlled, observable, reversible V2 cutover is demonstrated in code and tests. **V2 was NOT activated during H8.0.** Verdict means the system is ready for cutover execution in a **future phase** only.

Warnings: no canary (binary global cutover), staging not simulated, H7.8 performance slightly above H7.7 p95.

---

## Current production state

| Item | Value |
|------|-------|
| GitHub / local HEAD | `9a66610` |
| VPS container code | H7.8 present |
| VPS git checkout | `83cc16e` (SCP deploy) |
| Rollback ref | `6097852` |
| Cutover mode | `LEGACY_ONLY` |
| V2 / HTTP / PRIMARY / ACTIONS / CONFIRM / SHADOW | all OFF |
| n8n | Intact |
| Financial delta | 0 |
| Legacy path | PASS |

---

## Cutover modes

Implemented in `v2-cutover-policy.js`. Resolved via `ASHY_V2_CUTOVER_MODE` (explicit wins) or flag bundle.

| Mode | V2 called | Legacy called | n8n possible | Actions execute | Timeout fallback | Error fallback | Response persisted |
|------|-----------|---------------|--------------|-----------------|------------------|----------------|-------------------|
| **LEGACY_ONLY** | No (HTTP off) | Yes | Yes (via `/chat`) | Legacy path | N/A | N/A | Yes (legacy) |
| **V2_SHADOW** | Shadow observe only | Yes | Yes | Legacy only | N/A | N/A | Yes (legacy) |
| **V2_PRIMARY** | Yes (HTTP primary) | Blocked if unhandled | No on unhandled | V2 if ACTIONS+CONFIRM | READ: NO_FALLBACK | READ: NO_FALLBACK | Yes (V2) |
| **V2_PRIMARY_SAFE_FALLBACK** | Yes | Blocked if unhandled | READ fallback on V2 READ errors | V2 if ACTIONS+CONFIRM | READ: SAFE_FALLBACK | READ: SAFE_FALLBACK | Yes (V2) |

Key functions:
- `shouldBlockLegacyPassthrough()` → true for V2_PRIMARY modes
- `shouldRunShadowObservation()` → true only V2_SHADOW, not when HTTP handled
- `buildV2PrimaryUnhandledAgentResponse()` → blocks n8n for ACTION, allows READ fallback in SAFE_FALLBACK mode

---

## Routing matrix

| Situation | V2 | Legacy/n8n | Fallback |
|-----------|----|------------|----------|
| READ success | Serves answer | Not called | SAFE_FALLBACK (no n8n needed) |
| READ no data | NO_DATA response | Not called | NO_FALLBACK |
| READ error | Error response | SAFE_FALLBACK mode only | SAFE_FALLBACK or NO_FALLBACK |
| ANALYSIS success | Serves analysis | Not called | SAFE_FALLBACK |
| ACTION proposal | Pending persisted | Not called | NO_FALLBACK |
| ACTION clarification | Partial pending | Not called | NO_FALLBACK |
| ACTION confirmation | F4-B2 RPC | Not called | NO_FALLBACK |
| ACTION committed | Result returned | Not called | NO_FALLBACK |
| ACTION timeout | Ambiguous reply | Not called | NO_FALLBACK / AMBIGUOUS_WRITE (client) |
| ACTION ambiguous | Unhandled primary | Blocked | NO_FALLBACK |
| ACTION execution error | FAILED status | Not called | NO_FALLBACK |

**Critical rule verified:** No financially ambiguous situation auto-routes to n8n. ACTION paths always set `noN8nFallback: true`.

Sources: `v2-fallback-policy.js`, `ashyFallbackPolicy.js`, `chatTransport.js`.

---

## Fallback policy

### SAFE_FALLBACK (allowed n8n for READ only)

- V2 READ success path (policy set but n8n not invoked when V2 OK)
- V2 READ timeout/error in `V2_PRIMARY_SAFE_FALLBACK` mode
- Primary unhandled READ in SAFE_FALLBACK mode
- Legacy path when V2 HTTP not handled (`handled: false`)
- Ashy-chat 500 catch block defaults to SAFE_FALLBACK (READ context)

### NO_FALLBACK (n8n blocked)

- All ACTION states (proposal, clarification, confirmation, committed, failed)
- READ NO_DATA, PARTIAL
- READ errors in V2_PRIMARY (non-safe mode)
- `f4Committed`, `f4Status: COMMITTED|ALREADY_COMPLETED`
- `MISSING_SCOPE`
- Primary unhandled ACTION
- Server `noN8nFallback: true`

### AMBIGUOUS_WRITE (client only)

- Network error during pending confirmation — user told to check history, no n8n retry

---

## Double-write analysis

Paths audited:

| Path | Double-write risk | Mitigation |
|------|-------------------|------------|
| A. V2 success | None | Single F4-B2 commit |
| B. V2 timeout before commit | None | No RPC called; pending intact |
| C. V2 timeout after commit | Low | `f4Committed` → NO_FALLBACK; client AMBIGUOUS_WRITE |
| D. V2 HTTP 500 after commit | Low | Same as C; idempotent replay on retry |
| E. Frontend retry | None | Same `operation_id` → ALREADY_COMPLETED replay |
| F. Duplicate confirmation | None | F4-B2 idempotence + VERSION_MISMATCH |

**No path found:** `HTTP error → n8n → re-execute write` after V2 confirmation.

Legacy transactional path also blocks non-F4 fallback when `AGENT_SESSION_TRANSACTIONAL_CONFIRM=true` (`TRANSACTIONAL_FALLBACK_BLOCKED_REPLY`).

---

## Idempotency

Table: `agent_write_operations` (via Supabase RPC)

| Field | Role |
|-------|------|
| `operation_id` | Backend UUID minted at pending persist |
| `request_hash` | SHA-256 of canonical client+payload |
| `status` | processing / completed / error |
| `result_id` | Financial record ID on commit |
| `attempt_count` | Retry tracking |

Rules verified:
- Same `operation_id` + same `request_hash` → `ALREADY_COMPLETED` replay (no second write)
- Same `operation_id` + different `request_hash` → `REQUEST_HASH_MISMATCH` reject
- Missing `operation_id` on confirm → blocked (`OPERATION_ID_MISSING`)
- Concurrent confirmations → version/token guards

Tests: `agent-operation-idempotency.test.js`, `agent-session-confirm-f4-b2-c.test.js`, F4-B2-D/E.

---

## Confirmation safety

Flow: ACTION → proposal → pending (token, version, operation_id) → confirmation → F4-B2 → COMPLETED

Verified:
- `pendingConsumeToken`, `pendingSessionVersion`, `pendingOperationId` stored server-side
- `INTERNAL_ACTION_KEYS` never exposed in user-facing proposals
- Scope (`client_id`, `activity_id`) from authenticated `req.user`, not model
- Model cannot supply authority IDs as write source

V2 HTTP path: `action-orchestrator.js` → `executeActionConfirmationViaF4B2` when `ASHY_INTELLIGENCE_V2_HTTP_CONFIRM=true`.

---

## Scope safety

- HTTP handler rejects missing scope (`MISSING_SCOPE` → NO_FALLBACK)
- Activity reference resolver clarifies ambiguous activity names
- Foreign activity header → 403 (H7.8 smoke)
- F4-B2 RPC scoped by `client_id` from session

---

## Observability

| Signal | Location |
|--------|----------|
| Cutover diagnostics | `getCutoverDiagnostics()` |
| Action metrics | `action-observability.js` counters |
| Transactional metrics | `agent-transactional-write-service.js` |
| Idempotent replay | `agent-idempotent-replay-service.js` logs |
| Fallback decisions | Frontend `[chat-transport]` console.info |
| Health | `GET /api/health` |
| Docker logs | Container stdout |

Sensitive data not logged: JWT, passwords, service role keys, full user messages (sanitized proposals only).

---

## Performance baseline

| Source | p50 | p95 |
|--------|-----|-----|
| H7.7 VPS internal | 543 ms | 903 ms |
| H7.8 VPS rebenchmark | 594 ms | 923 ms |

Acceptable for cutover prep with monitoring. Stop if p95 > 1800 ms sustained.

---

## Financial safety

Critical signals (immediate rollback):

| Signal | Detection |
|--------|-----------|
| Duplicate operation | `agent_write_operations` duplicate `operation_id` completed |
| Unexpected write | Financial delta monitor |
| Operation mismatch | `REQUEST_HASH_MISMATCH` spike |
| Scope violation | 403 bypass or cross-client write |
| Foreign activity write | Activity scope audit |
| Unexpected n8n write | n8n webhook logs after V2 confirm |

All CRITICAL anomalies treated as rollback triggers.

---

## Rollback

Functional rollback via env only — no DB migration:

`V2_PRIMARY*` → `LEGACY_ONLY` (all V2 flags false, restart container)

Code rollback: redeploy `6097852`.

Verified in unit tests: `mapFlagsForCutoverMode(LEGACY_ONLY)`, `shouldBlockLegacyPassthrough` false after rollback.

---

## Canary capability

**CANARY = NOT_AVAILABLE**

No per-user allowlist, internal header routing, or feature-flag-by-user in codebase. Cutover is **binary global only**.

Do not simulate canary via frontend logic.

Recommended first cutover: `V2_PRIMARY_SAFE_FALLBACK` with ACTIONS/CONFIRM still OFF (READ only).

---

## Staging simulation

**NOT_SIMULATED** — no dedicated staging environment.

Partial coverage:
- H7.7 SAFE_INTERNAL_V2_HTTP on production container loopback (READ only)
- Unit/integration tests for fallback, idempotence, confirmation
- H6 staging gate scripts exist (`tools/_ashy_v2_phase_h6_staging_gate.mjs`) but not re-executed in H8

---

## Tests

| Metric | Result |
|--------|--------|
| Baseline (pre-H8) | 1254 PASS / 0 FAIL / 10 SKIP |
| New cutover safety tests | 39 tests |
| Full suite (post-H8) | **1299 PASS / 0 FAIL / 10 SKIP** |

Test file: `apps/api/tests/intelligence-v2-cutover-safety.test.js`

Coverage: modes, fallback matrix, primary unhandled, config safety, rollback flags, double-write signals, HTTP gate.

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Binary global cutover (no canary) | HIGH | Start READ-only SAFE_FALLBACK; monitor 30 min |
| Staging not simulated | MEDIUM | Run internal loopback gate before activation |
| p95 latency ~923 ms | MEDIUM | H7.7 baseline monitoring, stop conditions |
| ashy-chat 500 defaults SAFE_FALLBACK | LOW | Acceptable for READ; ACTION blocked client-side |
| VPS git out of sync with container | LOW | Container has H7.8; document SCP deploy path |

---

## NOT SIMULATED

- Full staging cutover A→G sequence
- Live production flag toggle (by design — H8.0 forbids)
- n8n cutover/routing change
- Canary deployment

---

## Required actions before activation

1. Run H7-style internal loopback gate with H8 test suite green
2. Schedule low-traffic window for first READ PRIMARY activation
3. Confirm on-call has rollback runbook (`H8-cutover-runbook.md`)
4. Enable monitoring dashboards/log tail for transactional + fallback events
5. Accept binary global cutover (no canary) or implement allowlist in future phase

---

## Final decision

**READY_FOR_CUTOVER_EXECUTION** — with warnings (no canary, staging not simulated, performance watch).

**MUST NOT ACTIVATE V2 in H8.0.** Proceed to H8.1+ for controlled execution when operator ready.

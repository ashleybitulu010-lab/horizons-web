# H11 — Observability Gap Report

**Date:** 2026-09-17  
**Phase:** H11 — Stabilization & Observability Gate  
**Artifact:** `%TEMP%/h11_report.json`  
**Gate script:** `tools/_h11_stabilization_gate.mjs`

---

## 1. Summary

Production V2 is **operationally observable** via structured logs and in-process counters, but **lacks a unified metrics export surface** and **per-phase HTTP latency instrumentation**. H11 did not add external observability platforms (per gate constraints).

---

## 2. Metrics — Existing (in-process)

| Metric family | Location | Export |
|---------------|----------|--------|
| `action_proposal_created`, `action_confirm_success`, `action_rejected`, etc. | `action-observability.js` | In-process only; `getActionMetricsForTests()` |
| `transactional_write_success/failure/rollback/conflict` | `agent-transactional-write-service.js` | In-process only; test helper |
| `write_db_success`, `pending_persistence_*`, `writer_db_primary_fallback` | `agent-session-writer.js` | In-process only; test helper |
| Shadow divergence counters | `shadow-metrics.js` | In-process only (SHADOW currently OFF) |

---

## 3. Metrics — Normalized H11 Taxonomy (mapping)

| H11 metric | Current source | Status |
|------------|------------------|--------|
| `REQUEST_TOTAL` | Not aggregated | **ABSENT** |
| `V2_HANDLED` | `primaryPath=V2_HTTP` in response | Per-request only |
| `V2_READ` / `V2_ANALYSIS` / `V2_ACTION` | `v2Http.goalType` in response/logs | Per-request only |
| `V2_CONFIRMATION` | `ashy_v2_action` log events | Log-derived |
| `ACTION_PROPOSAL_TOTAL` | `action_proposal_created` counter | In-process |
| `ACTION_CONFIRMATION_TOTAL` | `action_confirm_success` | In-process |
| `ACTION_REJECT_TOTAL` | `action_rejected` | In-process |
| `ACTION_CLARIFICATION_TOTAL` | `action_clarification_requested` | In-process |
| `WRITE_COMMITTED` | `transactional_write_committed` log | Log-derived |
| `WRITE_ALREADY_COMPLETED` | F4 replay path | Log + response `f4Replay` |
| `WRITE_REQUEST_HASH_MISMATCH` | confirmation handler | Response field |
| `WRITE_VERSION_MISMATCH` | confirmation handler | Response field |
| `WRITE_TOKEN_MISMATCH` | RPC rejection | Response / log |
| `WRITE_EXECUTION_ERROR` | `transactional_write_failure` | In-process |
| `N8N_FALLBACK_TOTAL` | Legacy `/chat` + frontend fallback | **NOT centrally counted** |
| `N8N_READ_FALLBACK_TOTAL` | `fallbackPolicy=SAFE_FALLBACK` on READ | Per-response only |
| `N8N_ACTION_FALLBACK_TOTAL` | Expected **0** (`noN8nFallback=true`) | Verified H11 |
| `V2_ERROR_TOTAL` | `[ashy-chat] agent.run failed` | Log-derived |
| `V2_TIMEOUT_TOTAL` | Shadow timeout only | SHADOW OFF |
| `NO_DATA_TOTAL` | `executionCode=NO_DATA` | Per-response |
| `PARTIAL_ANALYSIS_TOTAL` | `executionCode=PARTIAL` | Per-response |

---

## 4. Critical Safety Metrics

| Metric | H11 observation | Expected |
|--------|-----------------|----------|
| `ACTION_TO_N8N_FALLBACK` | **0** (smoke + log sample) | 0 |
| `WRITE_AFTER_ERROR` | Not auto-detected globally | Detectable via op status audit |
| `DUPLICATE_WRITE` | **0** (idempotency validated H10.2) | 0 |
| `SCOPE_VIOLATION` | **0** (403 on foreign activity) | 0 |
| `CONFIRM_WITHOUT_PENDING` | **0** successful rogue writes | 0 |

---

## 5. Logs Available

| Log key | File / emitter | Content |
|---------|----------------|---------|
| `ashy_v2_action` | `action-observability.js` | Event type, tool, sanitized proposal metadata |
| `transactional_write_expense` / `_sale` | `agent-transactional-write-service.js` | COMMITTED / rollback status |
| `transactional_write_committed` | `agent-idempotent-replay-service.js` | Replay / idempotency |
| `ashy_intelligence_v2_shadow` | `shadow-mode.js` | Shadow divergences (inactive) |
| `n8n response status` | `chat.js` | Legacy path only |
| `n8n history status` | `n8n-history.js` | History merge fallback |

**24h production sample (H11 gate):** 26 relevant lines — 21 `ashy_v2_action`, 4 `transactional_write`, 1 `n8n history` (READ history merge, not ACTION fallback).

---

## 6. Logs Missing / Gaps

| Gap | Impact |
|-----|--------|
| No `REQUEST_TOTAL` / per-phase timing log | Cannot decompose READ ~1037 ms p50 |
| No centralized fallback counter | Must infer from response fields |
| No HTTP metrics endpoint | Ops cannot scrape Prometheus/Datadog without new code |
| No persistent metrics store | Counters reset on process restart |
| Classifier decision not logged at INFO | Hard to audit misclassification in prod |
| `goalType`/`goalDomain` only in HTTP response | Lost unless chat persisted |

---

## 7. Latency Instrumentation

| Phase | Status |
|-------|--------|
| End-to-end READ (HTTP) | **AVAILABLE** — H11 smoke measured |
| Classifier | **NOT_INSTRUMENTED** in prod logs |
| Plan build | **NOT_INSTRUMENTED** |
| Tool execution | **NOT_INSTRUMENTED** |
| Analysis | **NOT_INSTRUMENTED** |
| Response generation | **NOT_INSTRUMENTED** |
| ACTION proposal | **NOT_INSTRUMENTED** (H10.2 external timing only) |
| CONFIRMATION | **NOT_INSTRUMENTED** |
| POST_WRITE_READ | **NOT_INSTRUMENTED** |

---

## 8. Fallback Instrumentation

| Path | Instrumented | Notes |
|------|--------------|-------|
| READ → V2 SUCCESS | Response `v2Http` + `executionCode` | Yes |
| READ → SAFE_FALLBACK | `fallbackPolicy`, `noN8nFallback=false` | Per-response |
| READ → NO_FALLBACK | `noN8nFallback=true` | Per-response |
| ACTION → V2 | `noN8nFallback=true` enforced | Policy in `v2-fallback-policy.js` |
| ACTION → n8n | Would appear in n8n webhook logs | **0 observed** |

---

## 9. Write Instrumentation

| Check | Source |
|-------|--------|
| Confirmation required | `action-proposal-contract.js` |
| Pending token / state version | `agent_sessions` + confirmation handler |
| `operation_id` / `request_hash` | `agent_write_operations` table |
| F4-B2 RPC | `transactional_write_*` logs |
| Idempotency replay | `transactional_write_committed` log |

---

## 10. Reconciliation Instrumentation

| Check | H11 result |
|-------|------------|
| `agent_write_operations` ↔ `depenses` | 12 ops / 11 depenses — 1 historical orphan explained |
| Stale `processing` ops | 2 found — audit artifact, no new write |
| Financial delta on READ smoke | **0** on financial tables |

---

## 11. Recommendations (observability only — no H12 auto-launch)

1. Add structured `ashy_v2_request` log with `goalType`, `latencyMs`, `fallbackPolicy`, `cutoverMode` (no secrets).
2. Expose in-process counters via internal `/api/health/v2-metrics` (auth-gated) before Legacy removal.
3. Add optional phase timers in `v2-http-handler.js` behind `ASHY_V2_DEBUG_TIMING=true`.
4. Persist classifier output in `chat_messages` metadata for H12 audit trail.

**STOP** — do not implement in H11; document only.

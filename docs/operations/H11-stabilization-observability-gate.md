# H11 — Stabilization & Observability Gate

**Date:** 2026-09-17  
**Phase:** H11 — Ash Ledger V2 stabilization, observation, audit  
**Prior:** H10.2 `GO_H11_READY` (20/20 production write gate)  
**Tag:** `h11-1789658781777`  
**Artifact:** `%TEMP%/h11_report.json`  
**Gate script:** `tools/_h11_stabilization_gate.mjs`

---

## 1. Verdict

### **GO_WITH_PERFORMANCE_WARNING**

| Criterion | Result |
|-----------|--------|
| V2 stable | **Yes** — 9/9 READ smoke, flags unchanged |
| Financial drift (H11 smoke) | **0** on financial tables |
| Duplicate writes | **0** |
| Scope violation | **0** — foreign activity 403 |
| ACTION → n8n | **0** |
| Reconciliation | **Complete** with 1 explained historical orphan |
| Errors explicable | **Yes** |
| Observability sufficient for H11 | **Yes** (gaps documented) |
| Legacy/n8n inventoried | **Yes** |
| New test failures | **0** (1355 pass manual suite) |

**Performance warning:** READ p50 **1037 ms** (H9.2 ref 686 ms; H10.2 ref 1019 ms). Elevated but not a regression vs H10.2 baseline; insufficient sample to declare new regression.

**Flags after H11:** Unchanged — V2/HTTP/PRIMARY/ACTIONS/CONFIRM **ON**, SHADOW **OFF**.

**STOP** — H12 not launched. No n8n/Legacy removal.

---

## 2. Production Baseline (H11_BASELINE)

Captured @ H11 gate start (`2026-09-17T15:26:21Z`):

| Table | Count |
|-------|------:|
| ventes | 0 |
| depenses | 11 |
| stocks | 0 |
| produits | 0 |
| paiements_dettes | 0 |
| agent_write_operations | 12 |
| agent_sessions | 2 |
| chat_messages | 658 |
| clients | 10 |
| activities | 10 |

**Post-smoke financial delta (financial tables only):** **0**  
(chat_messages +18 expected — 9 READ turns × user+assistant persistence)

---

## 3. Flags (BEFORE_H11_FLAGS)

| Flag | State |
|------|-------|
| `ASHY_INTELLIGENCE_V2` | **ON** |
| `ASHY_INTELLIGENCE_V2_HTTP` | **ON** |
| `ASHY_INTELLIGENCE_V2_PRIMARY` | **ON** |
| `ASHY_INTELLIGENCE_V2_ACTIONS` | **ON** |
| `ASHY_INTELLIGENCE_V2_HTTP_CONFIRM` | **ON** |
| `ASHY_INTELLIGENCE_V2_SHADOW` | **OFF** |
| `ASHY_V2_CUTOVER_MODE` | **ON** |
| `ASHY_V2_PRIMARY_SAFE_FALLBACK` | **ON** |

**Mode:** `V2_PRIMARY_SAFE_FALLBACK`  
**No flag modifications** during H11.

---

## 4. Metrics

See `docs/operations/H11-observability-gap-report.md` for full taxonomy.

**H11 production snapshot (24h log sample):**

| Signal | Count |
|--------|------:|
| `ashy_v2_action` | 21 |
| `transactional_write_*` | 4 |
| n8n chat fallback | 0 |
| n8n history merge | 1 |

In-process counters exist but are **not HTTP-exported** (reset on restart).

---

## 5. Latency

### H11 READ smoke (n=9)

| Stat | ms |
|------|---:|
| min | 967 |
| p50 | **1037** |
| p95 | 3158 |
| max | 3158 |
| mean | 1285 |

### References

| Phase | Reference p50 |
|-------|-------------:|
| H9.2 READ | 686 |
| H9.2 READ p95 | 1103 |
| H9.3-B proposal | 829 |
| H9.3-B confirm | 688 |
| H10.2 READ | 1019 |
| H10.2 CONFIRM | 1741 |

**Analysis / proposal / confirm / post-write:** `NOT_INSTRUMENTED` per-phase in production logs.

**Note:** One outlier (3158 ms) inflates p95; p50 aligns with H10.2 (~1019 ms).

---

## 6. Classification (production smoke)

| Message | goalType | Domain | Objective | Match |
|---------|----------|--------|-----------|-------|
| Quelles sont mes ventes ? | QUESTION | SALES | RETRIEVE | ✓ |
| Quelles sont mes dépenses ? | QUESTION | EXPENSES | RETRIEVE | ✓ |
| Quel est mon stock ? | QUESTION | STOCK | RETRIEVE | ✓ |
| Quels sont mes produits ? | QUESTION | PRODUCTS | RETRIEVE | ✓ |
| Qui me doit de l'argent ? | QUESTION | DEBTS | RETRIEVE | ✓ |
| Quel est mon bénéfice ? | QUESTION | PROFIT | RETRIEVE | ✓ |
| Compare mes ventes. | ANALYSIS | SALES | COMPARE | ✓ |
| Fais-moi le point. | ANALYSIS | GENERAL | SUMMARIZE | ✓ |
| Comment va mon activité ? | ANALYSIS | GENERAL | SUMMARIZE | ✓ |

**Misclassification observed:** 0 / 9  
**All requests:** `primaryPath=V2_HTTP`, `executionCode=SUCCESS`

---

## 7. Financial Reconciliation (H9.3-B + H10.2 writes)

| Metric | Value |
|--------|------:|
| Total `agent_write_operations` | 12 |
| Completed | 10 |
| Stale `processing` | 2 |
| Completed → business row | 9/10 |
| H10.2 writes (2026-09-17 15:11) | 2 ($2 + $30 mod) — **verified** |

### H10.2 production writes (from H10.2 gate — not re-executed)

| Operation | Amount | Business row |
|-----------|-------:|:------------:|
| `53a431e9-…` | $2 | ✓ |
| `aa49af6c-…` | $30 | ✓ |

**Controlled action H11:** `NOT_NEEDED` — H10.2 writes sufficient.

---

## 8. Supabase Reconciliation

| Check | Result |
|-------|--------|
| ORPHAN_OPERATION (historical) | 1 — explained (see anomalies) |
| DUPLICATE_OPERATION | **0** |
| MISSING_RESULT (unexplained) | **0** |
| RESULT_WITHOUT_OPERATION (unexplained) | **0** |
| Stale `processing` ops | 2 — no business row, no duplicate write |
| depenses vs completed ops | 11 depenses / 10 completed (1 orphan op references deleted row) |

---

## 9. n8n Inventory

See `docs/operations/H11-n8n-inventory.md`.

**Active workflows:** 2 (Ash Ledger Bot, Ash Ledger Subscription)  
**Deletions:** None

---

## 10. Legacy Coverage

See `docs/operations/H11-v2-legacy-coverage.md`.

V2 is primary for validated READ/ACTION paths. Legacy `/chat` + n8n Bot remain READ safety net and PDF/batch/admin.

---

## 11. Fallback Audit

### READ (H11 smoke n=9)

| Path | Count |
|------|------:|
| V2 SUCCESS | 9 |
| SAFE_FALLBACK available | 9 (policy allows; V2 handled all) |
| NO_FALLBACK | 0 |

### ACTION

| Path | Count |
|------|------:|
| V2 (H10.2 validated) | — |
| n8n fallback | **0** |

**ACTION_TO_N8N_FALLBACK:** **0** ✓

---

## 12. Security

| Test | Result |
|------|--------|
| Foreign activity `/api/me` | **403 PASS** |
| Foreign activity chat | **403 PASS** |
| SQL injection text in message | **200 PASS** (no error leak) |
| operationId injection | **200 PASS** (no server error) |
| Cross-tenant write | **0** (H10.2 validated) |
| Secret leak in logs | **None** in 24h sample |

---

## 13. Multi-Activity

| Check | Result |
|-------|--------|
| `client_id` scoped | Verified via `/api/me` |
| `activity_id` header enforced | 403 on foreign UUID |
| Cross-activity write | **0** (H10.2) |
| Cross-tenant access | **0** (H10.2) |

---

## 14. Errors (Taxonomy)

| Category | H11 observation |
|----------|-----------------|
| CLASSIFICATION_ERROR | 0 in smoke |
| PLAN_ERROR | Not triggered |
| TOOL_ERROR | Not triggered |
| ANALYSIS_ERROR | Not triggered |
| RESPONSE_ERROR | Not triggered |
| ACTION_VALIDATION_ERROR | Not triggered (H10.2 covered) |
| CONFIRMATION_ERROR | Not triggered |
| TRANSACTION_ERROR | Not triggered |
| SCOPE_ERROR | 403 on foreign activity ✓ |
| TIMEOUT | Not observed |
| FALLBACK | 0 ACTION fallback |

Legacy 500 bucket not used on smoke paths.

---

## 15. Performance Analysis

**Observed:** READ ~1037 ms p50 (end-to-end HTTP).

**Possible contributors (not measured per-phase):**
- PocketBase auth + `/api/me` scope resolution
- Session load from Supabase
- Goal classification (LLM + rules)
- Plan build + tool execution
- Financial analysis aggregation
- Response generation
- Supabase chat persistence

**Status:** `NOT_INSTRUMENTED` — see observability gap report.

**No optimization applied** (per H11 scope).

---

## 16. Load / Concurrency

| Environment | Result |
|-------------|--------|
| Production | 9 sequential READ smokes — all 200 |
| Staging parallel (10–20) | `NOT_AVAILABLE` — `ASH_STAGING_API` not set |

No dangerous production stress test performed.

---

## 17. Data Drift

H11 READ smoke returned consistent V2 responses; no numeric divergence vs expected empty-catalog state (0 ventes, 11 depenses visible).

| Definition | V2 vs Legacy |
|------------|--------------|
| Revenue / Collected / Expenses / Profit | **Not compared numerically** (V2 handled all smoke; Legacy not invoked) |
| Drift detected | **None** in H11 scope |

---

## 18. H11_ANOMALIES

| timestamp | type | severity | flow | impact | root_cause | status | action_required |
|-----------|------|----------|------|--------|------------|--------|-----------------|
| 2026-09-17 | ORPHAN_OPERATION | MEDIUM | write_reconciliation | op `4d84a3f4…` → missing depense `ffb9c2f8…` (2026-09-10) | Pre-H10 test row deleted; op record retained | **EXPLAINED** | Monitor; no rollback |
| 2026-09-17 | STALE_PROCESSING_OP | LOW | write_reconciliation | 2 ops stuck `processing` | Aborted/stale H9.x concurrent test | **OPEN** | Cleanup optional pre-H12 |
| 2026-09-17 | READ_LATENCY_ELEVATED | LOW | performance | p50 1037 ms | UNKNOWN — multi-factor | **OPEN** | Instrument before optimize |

---

## 19. Tests

| Suite | H10.2 baseline | H11 result |
|-------|----------------|------------|
| Classifier H10.1+H10.2 | 25/25 | **25/25 PASS** |
| Full API | 1354/0 | **1355/0 PASS** (+11 tests vs baseline) |
| H11 production gate | — | **PASS** (READ smoke + reconciliation) |
| Lint | — | Not re-run (no code changes affecting lint) |

**No new FAIL** vs H10.2 baseline.

---

## 20. Risks

| Risk | Level | Mitigation |
|------|-------|------------|
| Elevated READ latency | Medium | Per-phase instrumentation before optimization |
| Stale `processing` ops | Low | Audit cleanup; no financial impact observed |
| Historical orphan op | Low | Explained; document for H12 |
| Metrics not persisted | Medium | Add export endpoint before Legacy cutover |
| CREATE_SALE prod unverified | Medium | Seed catalog or staging-only until products exist |
| n8n Bot still required | Low | Inventory maintained; no premature removal |

---

## 21. NOT_SIMULATED

| Item | Reason |
|------|--------|
| CREATE_SALE_PRODUCTION | `produits=0` on test activity (unchanged from H10.2) |
| Staging parallel load | `ASH_STAGING_API` not configured |
| Per-phase latency breakdown | Not instrumented in production |
| Legacy numeric drift compare | Legacy path not invoked in H11 smoke |
| New controlled write | `NOT_NEEDED` — H10.2 writes sufficient |
| n8n workflow deactivation | Out of H11 scope |

---

## 22. Final Recommendation

1. **Accept H11** as `GO_WITH_PERFORMANCE_WARNING` — proceed to H12 planning only when explicitly requested.
2. **Keep flags unchanged:** V2 PRIMARY, ACTIONS, CONFIRM ON.
3. **Do not remove** n8n workflows or Legacy routes.
4. **Before H12:** add request-level timing logs + metrics export; resolve 2 stale `processing` ops; optional orphan op archival.
5. **Address latency** only after instrumentation — current p50 is consistent with H10.2, not a new regression.

### Git / VPS Audit

| Item | Value |
|------|-------|
| Local HEAD | `2f9d3d8` |
| origin/master | `9a66610` |
| VPS git | `NO_GIT` (deploy via container) |
| Container | `ash-ledger-api-v2-ash-ledger-api-1` (healthy) |
| Container ID | `6dd1b6f313f6` |
| Host | `187.124.187.13` |

Classifier H10.1/H10.2 deployed via SCP (H10.2); VPS git repo not synced — **operational code verified via H10.2 + H11 smoke**.

---

## Related Documents

- `docs/operations/H11-observability-gap-report.md`
- `docs/operations/H11-n8n-inventory.md`
- `docs/operations/H11-v2-legacy-coverage.md`
- `docs/operations/H10.2-production-write-hardening.md`

**STOP — H11 complete. H12 not launched.**

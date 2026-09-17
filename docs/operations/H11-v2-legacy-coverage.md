# H11 — V2 / Legacy Coverage Matrix

**Date:** 2026-09-17  
**Phase:** H11 — Stabilization & Observability Gate  
**Mode:** `V2_PRIMARY_SAFE_FALLBACK`

---

## V2_COVERAGE_MATRIX

| Capability | Legacy (n8n / `/chat`) | V2 (`/api/ashy/chat`) | Production verified | Notes |
|------------|:----------------------:|:---------------------:|:-------------------:|-------|
| READ sales | Yes | Yes | **Yes** — H11 smoke | V2 primary; n8n fallback available |
| READ expenses | Yes | Yes | **Yes** | |
| READ stock | Yes | Yes | **Yes** | |
| READ products | Yes | Yes | **Yes** | |
| READ debts | Yes | Yes | **Yes** | |
| REPORT / summarize | Yes | Yes | **Yes** — "Fais-moi le point" | |
| PROFIT | Yes | Yes | **Yes** | |
| COMPARE | Yes | Yes | **Yes** — "Compare mes ventes" | |
| ANALYSIS | Yes | Yes | **Yes** | |
| CREATE_EXPENSE | Yes | Yes | **Yes** — H10.2 prod | F4-B2 + confirmation |
| CREATE_SALE | Yes | Yes | **Staging only** | Prod `produits=0` → NOT_SIMULATED |
| UPDATE_EXPENSE | Yes | Partial | **Staging** | Modification flow H10.2 |
| UPDATE_SALE | Yes | Partial | **Not verified prod** | |
| ADJUST_STOCK | Yes | Partial | **Staging** | Sale path only |
| PDF | Yes (HTML→PDF nodes) | No | **Legacy only** | n8n Bot |
| HISTORY | Yes (n8n + Supabase merge) | Yes (Supabase primary) | **Yes** | Cross-source merge in API |
| MULTI-TURN | Yes | Yes | **Yes** — H10.2 | Clarification + confirm |
| MULTI-ACTIVITY | Yes | Yes | **Yes** — H10.2 isolation | 403 foreign activity H11 |
| FALLBACK READ | Yes | SAFE_FALLBACK policy | **Yes** | `noN8nFallback=false` on success |
| FALLBACK ACTION | Yes (blocked) | NO_FALLBACK | **Yes** — ACTION→n8n=0 | |
| ERROR HANDLING | n8n Error Trigger | V2 typed codes | **Partial** | Taxonomy in H11 main report |

---

## Legacy Route Inventory

| Route | Service | V2 replaces? | Still used? |
|-------|---------|:------------:|:-----------:|
| `POST /chat` | `chat.js` → n8n proxy | Partial (READ fallback) | **Yes** — fallback |
| `POST /history` | n8n history action | Partial | **Yes** — merge |
| `GET /thread/:userId` | Supabase thread | No | **Yes** |
| `POST /thread/message` | Supabase persist | No | **Yes** |
| `POST /api/ashy/chat` | V2 agent | **Primary** | **Yes** — production primary |
| `GET /api/me` | Scope resolution | V2 depends on it | **Yes** |

---

## Legacy Service / Tool Inventory

| Component | Location | V2 replaces? | Status |
|-----------|----------|:------------:|--------|
| n8n chat proxy | `utils/n8n-proxy.js` | Partial | Active fallback |
| n8n history | `utils/n8n-history.js` | Partial | Active merge |
| n8n persistence | `services/n8n-chat-persistence.js` | No | Legacy path |
| Goal classifier | `intelligence-v2/goal-classifier-rules.js` | **Yes** | Production |
| Plan builder | `intelligence-v2/plan-builder.js` | **Yes** | Production |
| F4-B2 writes | `agent-transactional-write-service.js` | **Yes** | Production |
| Shadow runner | `intelligence-v2/shadow/` | Diagnostic | OFF |
| Intent resolver (Legacy) | n8n Routeur Intention | Partial | n8n only |

---

## Coverage Gaps (not blocking H11)

1. **PDF generation** — Legacy/n8n only.
2. **CREATE_SALE production** — blocked by empty catalog (NOT_SIMULATED).
3. **Batch admin RPC** — n8n Bot only.
4. **Per-phase latency** — not instrumented in V2.

---

## Recommendation

V2 is **production-primary** for all chat paths validated in H10.2 + H11. Legacy/n8n remains **required** for PDF, subscription webhook, READ safety net, and unmigrated admin/batch flows. No Legacy removal in H11/H12 without re-inventory.

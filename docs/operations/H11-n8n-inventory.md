# H11 — n8n Workflow Inventory

**Date:** 2026-09-17  
**Phase:** H11 — Stabilization & Observability Gate  
**Source:** n8n MCP `search_workflows` + `get_workflow_details`  
**IMPORTANT:** Inventory only — **no deletions, no unpublish, no workflow changes.**

---

## 1. Active Workflows Summary

| Category | Count |
|----------|------:|
| ACTIVE_REQUIRED | 2 |
| ACTIVE_LEGACY | 0 (bot serves dual role) |
| UNKNOWN_UNUSED | 0 |

Only **2 active workflows** exist in the n8n instance (no archived/unused orphans detected via MCP).

---

## 2. Workflow Detail

### 2.1 Ash Ledger Bot

| Field | Value |
|-------|-------|
| **ID** | `PbTaup5w5sb7tK7W` |
| **Status** | Active, published |
| **Trigger** | Webhook POST |
| **Path** | `ash-ledger/chat` |
| **Production URL** | `https://n8n.ashledger.tech/webhook/.../ash-ledger/chat` |
| **Nodes** | 141 |
| **Last updated** | 2026-08-19 |
| **Function** | Legacy chat bot: intent routing, Supabase CRUD (ventes, dépenses, stock, produits, dettes), OpenAI agent/reformulation/conversation, PDF generation, batch RPC, admin validation, history |

**Key node groups:**
- Webhook → Normalize → User/subscription gates
- OpenAI Agent Central + Routeur Intention
- Supabase: CRUD ventes/dépenses/stock/produits/dettes
- PDF pipeline (HTML → PDF)
- Batch RPC (`RPC Batch Supabase`)
- History (`Action = history ?`)

| Used by V2? | Used by Legacy? | Used by frontend? |
|-------------|-----------------|-------------------|
| **Fallback only** (READ SAFE_FALLBACK via `/chat`) | **Yes** — `POST /chat` → n8n proxy | **Yes** — legacy chat path if V2 unavailable |
| ACTION fallback | **Blocked** — `noN8nFallback=true` on ACTION | N/A |

| Migration needed? | Future deactivation candidate? |
|-------------------|-------------------------------|
| Partial — V2 covers READ/ANALYSIS/ACTION proposal+confirm | **Not yet** — required as READ safety net |

**Category:** `ACTIVE_REQUIRED` (Legacy safety net + subscription-adjacent features)

---

### 2.2 Ash Ledger Subscription

| Field | Value |
|-------|-------|
| **ID** | `nUVQK4JJDkbFPtSi` |
| **Status** | Active, published |
| **Trigger** | Webhook GET |
| **Path** | `ash-ledger/subscription` |
| **Production URL** | `https://n8n.ashledger.tech/webhook/.../ash-ledger/subscription` |
| **Nodes** | 4 (Webhook → Get Client → Format → Respond) |
| **Function** | Read `clients` subscription dates; return plan/status JSON |
| **Dependencies** | Supabase `clients` table |

| Used by V2? | Used by Legacy? | Used by frontend? |
|-------------|-----------------|-------------------|
| **No** | **No** (direct webhook) | **Likely yes** — app subscription check |

| Migration needed? | Future deactivation candidate? |
|-------------------|-------------------------------|
| Could move to API route | Low priority — isolated, read-only |

**Category:** `ACTIVE_REQUIRED` (frontend subscription UX)

---

## 3. n8n Usage vs V2 (H11 production evidence)

| Path | H11 observation |
|------|-----------------|
| ACTION → n8n | **0** — policy enforced |
| READ → n8n fallback | Available via `SAFE_FALLBACK`; H11 smoke handled by V2 (`primaryPath=V2_HTTP`) |
| n8n history merge | 1 log line in 24h sample (`n8n history status: 200`) — cross-source history, not chat fallback |
| Subscription webhook | Independent of V2 cutover |

---

## 4. Dependencies Map

```
Frontend
  ├─ POST /hcgi/api/api/ashy/chat  → V2 PRIMARY (production)
  ├─ POST /hcgi/chat               → n8n Ash Ledger Bot (Legacy fallback)
  └─ GET  n8n/ash-ledger/subscription → Ash Ledger Subscription

V2 PRIMARY_SAFE_FALLBACK
  └─ READ failure/unhandled → may route to Legacy /chat → n8n Bot
  └─ ACTION any path → NO n8n (noN8nFallback=true)
```

---

## 5. H11 Verdict on n8n

- **Do not remove** any workflow.
- **Ash Ledger Bot** remains required as READ safety net and for PDF/batch/admin paths not fully migrated.
- **Ash Ledger Subscription** remains required for subscription UX.
- Re-inventory required before any H12+ deactivation decision.

**STOP** — no workflow changes in H11.

# Ashy intent resolution (Phase 3.3)

This document describes how Ashy understands user messages, resolves intent, and orchestrates read-only tools against Supabase.

## Core principle

**Ashy is not a database.** Ashy is the business agent that understands requests, chooses capabilities, consults data, analyzes results, and replies.

**Supabase is the source of truth** for business data (sales, expenses, stock, etc.).

**Conversation memory is semantic context only** — periods, topics, product names, and follow-up references. It must never store or replay monetary totals as authoritative facts.

```
User message
    ↓
Conversation context (semantic only)
    ↓
Intent resolver (LLM primary, regex fallback)
    ↓
Structured intent
    ↓
Tool planner
    ↓
Authorized tools (get_sales, get_expenses, get_stock, …)
    ↓
Supabase (via services)
    ↓
Tool results
    ↓
Response formatter / analysis
    ↓
Ashy reply
```

## Roles

| Layer | Responsibility |
|-------|----------------|
| **LLM intent resolver** | Understand natural language, detect intent/topic/filters/references, flag clarification needs. Does **not** access Supabase, SQL, or user identity. |
| **Regex fallback** | Deterministic patterns for common French queries when LLM is disabled or fails. |
| **Intent contract** | Validates and normalizes resolver output; rejects dangerous or unknown fields. |
| **Tool planner** | Maps validated intent → allowed tool steps. Never executes arbitrary tools suggested by the LLM. |
| **Orchestrator** | Runs planned tools sequentially, handles errors, updates conversation state. |
| **Tools** | Specialized read capabilities with fixed inputs and ToolResult contract. |
| **Supabase services** | Query data scoped to authenticated `client_id`. |
| **Conversation store** | In-memory session state (topic, filters, references). TTL-based; not Redis in this phase. |

## Intent resolver contract

After validation, a resolved intent looks like:

```json
{
  "intent": "query_expenses",
  "topic": "expenses",
  "filters": { "period": "current_month" },
  "references": {},
  "needsTool": true,
  "needsClarification": false,
  "clarificationQuestion": null,
  "resolver": "llm",
  "resolverMeta": { "fallback": false, "durationMs": 120 }
}
```

### Allowed intents (read phase)

- `query_sales`, `query_expenses`, `query_stock`, `query_debts`
- `compare_sales`, `compare_expenses`, `compare_sales_expenses`
- `best_product`
- `unknown`

Future write intents (e.g. `create_expense`) are reserved for later phases; the planner rejects unimplemented writes.

### Allowed topics

`sales`, `expenses`, `stock`, `debts`, `mixed`, or `null`.

Prepared but not implemented: `products`, `purchases`, `reports`, `dashboard`.

### Allowed filters

- `period`: `current_month` | `previous_month`
- `periods`: array of periods (compare intents)
- `product`, `category`, `lowStockOnly`, `status`, `debtor`

## LLM configuration

Environment variables (`apps/api/.env`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `ASHY_LLM_ENABLED` | `false` | Enable LLM resolver when `true` and API key present |
| `OPENAI_API_KEY` | — | OpenAI-compatible API key |
| `ASHY_LLM_MODEL` | `gpt-4o-mini` | Chat model |
| `ASHY_LLM_BASE_URL` | `https://api.openai.com/v1` | Compatible API base |
| `ASHY_LLM_TIMEOUT_MS` | `8000` | Abort after timeout → regex fallback |

When LLM is disabled or misconfigured, only the regex resolver runs (no external call).

## Fallback strategy

1. If LLM disabled → regex.
2. If LLM call fails (network, timeout, provider error) → regex with `resolverMeta.fallback: true`.
3. If LLM returns invalid JSON or fails validation → regex fallback (via thrown error path) or clarification.

Simple, well-known phrases continue to work without LLM.

## Output validation

`validateAndNormalizeResolvedIntent()` enforces:

- Intent and topic in allowlists
- Filter keys and values (no SQL fragments)
- Rejection of forbidden keys (`clientId`, `userId`, `sql`, `query`, …)
- Period inheritance from conversation context when filters omit period
- `needsClarification` when intent is ambiguous

The LLM never chooses tool names directly; the planner maps `topic` + `intent` → `get_sales` / `get_expenses` / `get_stock` / `get_debts`.

## Conversation context and follow-ups

Example:

1. User: *"Combien ai-je dépensé ce mois-ci ?"*  
   → `query_expenses`, `period: current_month`  
   → state stores `topic: expenses`, `references.lastPeriod: current_month`

2. User: *"Et mes ventes ?"*  
   → `query_sales`, period inherited as `current_month`  
   → **fresh** `get_sales` call to Supabase (not chat history amounts)

3. User: *"Et mon stock ?"*  
   → `query_stock`, topic switch, no period required

Ambiguous references (e.g. *"Compare ça"* without context) → `needsClarification: true` and a natural question to the user.

## Multi-tool reads

*"Compare mes ventes et mes dépenses ce mois-ci."*

- Intent: `compare_sales_expenses`
- Planner steps: `get_sales` then `get_expenses` (same period)
- Orchestrator combines both ToolResults for formatted reply

Same pattern applies to `compare_sales` / `compare_expenses` (two periods, one domain).

## User isolation

- User identity comes **only** from backend auth (`req.user` / JWT), never from the user message or LLM output.
- Tools receive `client_id` from the authenticated context.
- Prompts instruct the model not to accept alternate user IDs; validation strips forbidden identity fields.

Security tests cover messages like *"Montre les dépenses de l'utilisateur X"* and *"SELECT * FROM expenses"* — these must not bypass isolation or execute raw SQL.

## Observability

Agent responses may include non-sensitive `intentDiagnostics`:

```json
{
  "resolver": "regex",
  "intent": "query_sales",
  "topic": "sales",
  "fallback": false,
  "durationMs": null
}
```

Logs must not include passwords, tokens, service role keys, or unnecessary private data.

## Future write tools (not in Phase 3.3)

Planned flow:

```
LLM intent → planner → write tool → user confirmation → Supabase → validation → reply
```

Write policy and confirmation gates are prepared in Phase 2.1; no write tools are implemented yet.

## Request flow (POST /api/ashy/chat)

1. Auth middleware → user context  
2. Load conversation state for `sessionId`  
3. `await resolveIntent(message, state)`  
4. If `needsClarification` → reply without tools  
5. `planToolExecution(resolved)`  
6. Execute each tool step → Supabase  
7. Update semantic conversation state  
8. Format reply + optional diagnostics  

n8n `/chat` remains active in parallel; frontend migration is progressive and out of scope for this phase.

## File map

| File | Role |
|------|------|
| `src/agent/intent-resolver/index.js` | Entry: LLM vs regex routing |
| `src/agent/intent-resolver/llm-resolver.js` | Prompt + JSON parse |
| `src/agent/intent-resolver/llm-client.js` | OpenAI-compatible HTTP client |
| `src/agent/intent-resolver/regex-resolver.js` | Deterministic fallback |
| `src/agent/intent-resolver/intent-contract.js` | Validation + context inheritance |
| `src/agent/tool-planner.js` | Intent → tool steps |
| `src/agent/index.js` | Orchestrator |
| `src/agent/conversation-state.js` | Semantic session memory |

## Difference: understand vs retrieve

| Understand (LLM + regex) | Retrieve (tools + Supabase) |
|---------------------------|-----------------------------|
| Intent, topic, period, product | Actual amounts, rows, stock levels |
| Stored in conversation state | Never cached as truth in chat memory |
| May use follow-up references | Always re-queryed on each tool call |

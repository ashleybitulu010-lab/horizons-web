# P1-C — Activity scope follow-ups (P1-D+)

P1-C adds `activity_id` to business tables and backfills default activities.
Backend, Ashy, frontend, and n8n still operate at `client_id` scope only.

| File | Function / area | Table | Issue | Planned change (P1-D+) |
|------|-----------------|-------|-------|------------------------|
| `apps/api/src/services/supabase-scoped.js` | `requireClientScope` | all | No activity validation yet | Add `requireActivityScope(user, activityId)` |
| `apps/api/src/tools/create-expense.js` | `runCreateExpense` | depenses | Writes `client_id` only | Pass default or active `activity_id` |
| `apps/api/src/tools/create-sale.js` | sale write | ventes | Same | Active activity from context |
| `apps/api/src/services/expenses-write-service.js` | RPC calls | depenses | RPCs use `p_client_id` | Add `p_activity_id` nullable then required |
| `apps/api/src/services/sales-write-service.js` | RPC calls | ventes | Same | Same |
| `apps/api/src/agent/index.js` | Ashy orchestrator | sessions | Pending scoped by client | Add `activeActivityId` to context |
| `apps/api/src/agent/conversation-state.js` | RAM/DB sessions | agent_sessions | UNIQUE(client_id, state_type) | Migrate to (client_id, activity_id, state_type) |
| `apps/api/src/routes/api/ashy-chat.js` | chat route | chat_messages | client scope only | Validate optional activity header |
| `apps/api/src/services/agent-transactional-write-service.js` | confirm RPCs | agent_write_operations | Tenant scope idempotence | Add nullable `activity_id` column |
| `src/lib/supabaseRest.js` | dashboard reads | all | Filters by client_id | Filter by active activity when UI switcher exists |
| `supabase/migrations/*` | `synthese_mensuelle` view | view | Aggregates all activities per client | P1-D: activity-scoped view + tenant rollup |
| n8n workflows | batch/chat | all | `recordId` = client | Optional `activity_id` in payloads |

**RLS (P1-D):** extend policies with `ash_owns_activity(activity_id)` once dashboard sends active activity.
**Stock/product coherence:** P1-C backfills same default activity per client; future inserts must enforce `stock.activity_id = produit.activity_id` when linked.

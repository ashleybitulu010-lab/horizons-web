# P1-E — Conversation + report activity scope

## Completed in P1-E

| Area | Change |
|------|--------|
| `chat_messages` | `activity_id NOT NULL`, FK, unique `(client_id, activity_id, sequence)` |
| `chat_message_counters` | PK `(client_id, activity_id)` |
| `allocate_chat_message_sequence` | `(p_client_id, p_activity_id default null)` |
| `conversation-service` | Uses `getBusinessScope` for append/list |
| RAM conversation store | Key `userId:activityId:sessionId` |
| `activity-reference-resolver` | Name → UUID within tenant only |
| `synthese_mensuelle_by_activity` | New view; legacy view unchanged |
| Intent | `activityReference` in allowed references; read misclassification guard |

## Deferred — Ashy Intelligence 2.0

| Area | Reason |
|------|--------|
| Full LLM intent refactor | P1-E prepares context only |
| n8n history `activity_id` payload | Coexistence: default activity when absent |
| `agent_write_operations.activity_id` column | Optional; pending gate is activity-scoped |
| Dashboard snapshot activity filter | Frontend unchanged; uses legacy rollup |
| Activity selector UI | Separate phase |

## agent_write_operations decision

Keep `UNIQUE(client_id, operation_id)`. Pending consumption and session rows are activity-scoped (P1-D). Cross-activity replay blocked at pending row lookup. `request_hash` unchanged in P1-E.

## Intent regression note

Production observed LLM classifying read queries as `create_expense`. P1-E adds `reconcileMisclassifiedReadIntent` when regex detects a read intent. Full fix deferred to Ashy Intelligence 2.0.

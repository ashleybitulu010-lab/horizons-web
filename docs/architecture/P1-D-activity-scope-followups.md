# P1-D — Activity scope backend follow-ups

## Deferred to P1-D.1 (conversation)

| Area | Current state | Planned |
|------|---------------|---------|
| `chat_messages.activity_id` | Not migrated | Backfill to default activity per client |
| `chat_message_counters.activity_id` | Not migrated | Composite key with activity |
| RAM conversation key | `userId:sessionId` | `userId:activityId:sessionId` optional |

Existing chat history remains valid: all rows map to the client's default activity.

## Deferred to P1-E (reporting)

| Area | Current state | Planned |
|------|---------------|---------|
| `synthese_mensuelle` view | Client-scoped aggregation | Activity-scoped view + optional tenant rollup |
| Named activity in Ashy ("rapport Ketura Boutique") | Not implemented | Resolve activity by name then validate |

P1-D reports use direct activity-scoped table queries via read services — not `synthese_mensuelle`.

## Idempotence note

`agent_write_operations` keeps `UNIQUE(client_id, operation_id)`.

Rationale: pending sessions are activity-scoped; operation replay in another activity fails at pending consumption (no matching row). Adding `activity_id` to the unique key is optional in P1-E if cross-activity operation_id collision becomes a concern.

## n8n coexistence

When n8n calls backend without `X-Activity-Id`, the server resolves the client's default activity after auth. n8n cannot bypass client scope; activity is never taken from LLM/tool payloads.

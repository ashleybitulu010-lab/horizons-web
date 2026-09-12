-- Phase 5.8-F4-B2-B — Durable idempotency ledger (schema only).
-- Ashy backend service_role writes; no runtime integration in this phase.
-- result_id is intentionally NOT a polymorphic FK (depenses | ventes) — see table comment.

begin;

-- ---------------------------------------------------------------------------
-- public.agent_write_operations
-- ---------------------------------------------------------------------------
create table if not exists public.agent_write_operations (
  id uuid primary key default gen_random_uuid(),

  operation_id uuid not null,
  client_id uuid not null
    references public.clients(id) on delete cascade,

  tool text not null,
  status text not null,
  request_hash text not null,

  result_id uuid null,
  error_code text null,
  attempt_count integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,

  metadata jsonb null,

  constraint agent_write_operations_client_operation_uidx
    unique (client_id, operation_id),

  constraint agent_write_operations_tool_format_check
    check (
      length(trim(tool)) > 0
      and tool ~ '^[a-z][a-z0-9_]*$'
    ),

  constraint agent_write_operations_status_check
    check (status in ('processing', 'completed')),

  constraint agent_write_operations_request_hash_nonempty_check
    check (length(trim(request_hash)) > 0),

  constraint agent_write_operations_attempt_count_nonneg_check
    check (attempt_count >= 0),

  constraint agent_write_operations_completed_at_check
    check (status <> 'completed' or completed_at is not null),

  constraint agent_write_operations_metadata_object_check
    check (
      metadata is null
      or jsonb_typeof(metadata) = 'object'
    ),

  constraint agent_write_operations_metadata_size_check
    check (
      metadata is null
      or pg_column_size(metadata) <= 4096
    )
);

comment on table public.agent_write_operations is
  'F4-B2 durable idempotency ledger for Ashy confirmed business writes. RLS enabled, no authenticated policies — service_role backend only.';

comment on column public.agent_write_operations.operation_id is
  'Stable business operation identity (scoped by client_id). Distinct from pendingConsumeToken.';

comment on column public.agent_write_operations.request_hash is
  'Canonical hash of business payload — computed by Node in B2-C. NOT NULL placeholder allowed in B2-B tests.';

comment on column public.agent_write_operations.result_id is
  'Business row id (e.g. depenses.id or ventes.id). Intentionally no polymorphic FK — tool disambiguates.';

comment on column public.agent_write_operations.metadata is
  'Tool-specific replay metadata (e.g. stockRemaining for sales). Never substitute for operation_id/request_hash.';

comment on column public.agent_write_operations.status is
  'processing = in-flight reservation; completed = committed business write. No failed status in B2-B.';

-- ---------------------------------------------------------------------------
-- updated_at trigger (same pattern as agent_sessions)
-- ---------------------------------------------------------------------------
create or replace function public.agent_write_operations_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_agent_write_operations_updated_at on public.agent_write_operations;
create trigger trg_agent_write_operations_updated_at
before update on public.agent_write_operations
for each row
execute function public.agent_write_operations_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — enabled, no authenticated/anon policies (service_role bypasses RLS)
-- ---------------------------------------------------------------------------
alter table public.agent_write_operations enable row level security;

-- ---------------------------------------------------------------------------
-- Grants — minimal surface
-- ---------------------------------------------------------------------------
revoke all on public.agent_write_operations from public;
revoke all on public.agent_write_operations from anon;
revoke all on public.agent_write_operations from authenticated;

grant all on public.agent_write_operations to service_role;

notify pgrst, 'reload schema';

commit;

-- Ash Ledger Phase 5.2 — Conversation persistence foundation.
-- chat_messages, agent_sessions, chat_message_counters + sequence allocator.
-- Does NOT touch clients.thread_id or migrate legacy data.

begin;

-- ---------------------------------------------------------------------------
-- chat_message_counters — concurrency-safe sequence allocation per client
-- ---------------------------------------------------------------------------
create table if not exists public.chat_message_counters (
  client_id uuid primary key
    references public.clients(id) on delete cascade,
  next_sequence bigint not null default 1,

  constraint chat_message_counters_next_sequence_positive
    check (next_sequence >= 1)
);

alter table public.chat_message_counters enable row level security;

-- ---------------------------------------------------------------------------
-- chat_messages — append-only conversational history (backend-authoritative writes)
-- ---------------------------------------------------------------------------
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null
    references public.clients(id) on delete cascade,
  role text not null,
  content text not null,
  sequence bigint not null,
  created_at timestamptz null,
  source text not null default 'backend',
  metadata jsonb not null default '{}'::jsonb,
  content_hash text null,

  constraint chat_messages_role_check
    check (role in ('user', 'assistant')),

  constraint chat_messages_content_nonempty_check
    check (length(trim(content)) > 0),

  constraint chat_messages_content_length_check
    check (length(content) <= 16000),

  constraint chat_messages_metadata_size_check
    check (pg_column_size(metadata) <= 4096),

  constraint chat_messages_source_check
    check (source in ('backend', 'n8n', 'migration', 'frontend')),

  constraint chat_messages_legacy_timestamp_check
    check (
      (source = 'migration' and created_at is null)
      or (source <> 'migration' and created_at is not null)
    ),

  constraint chat_messages_client_sequence_uidx
    unique (client_id, sequence)
);

create index if not exists chat_messages_client_created_at_idx
  on public.chat_messages (client_id, created_at desc nulls last);

comment on column public.chat_messages.sequence is
  'Canonical message order. Always use ORDER BY sequence ASC for history.';
comment on column public.chat_messages.created_at is
  'Real event time for new messages. NULL for legacy migration (unknown event time).';
comment on column public.chat_messages.metadata is
  'UI metadata only (e.g. pdf filename/mime). Never store pdf base64, tokens, or secrets here.';

-- ---------------------------------------------------------------------------
-- agent_sessions — n8n legacy transactional state (draft / pending).
-- Does NOT store backend Ashy pendingWrite (conversation-store in-memory).
-- ---------------------------------------------------------------------------
create table if not exists public.agent_sessions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null
    references public.clients(id) on delete cascade,
  state_type text not null,
  payload jsonb not null,
  intention text null,
  awaiting text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agent_sessions_state_type_check
    check (state_type in ('draft', 'pending')),

  constraint agent_sessions_payload_object_check
    check (jsonb_typeof(payload) = 'object'),

  constraint agent_sessions_payload_size_check
    check (pg_column_size(payload) <= 65536),

  constraint agent_sessions_awaiting_check
    check (awaiting is null or awaiting in ('slots', 'confirm', 'price_choice')),

  constraint agent_sessions_client_state_uidx
    unique (client_id, state_type)
);

create index if not exists agent_sessions_client_id_idx
  on public.agent_sessions (client_id);

comment on column public.agent_sessions.payload is
  'n8n legacy draft/pending JSON. Not backend pendingWrite (see conversation-store.js).';

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create or replace function public.agent_sessions_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_agent_sessions_updated_at on public.agent_sessions;
create trigger trg_agent_sessions_updated_at
before update on public.agent_sessions
for each row
execute function public.agent_sessions_set_updated_at();

-- ---------------------------------------------------------------------------
-- Sequence allocator — service_role ONLY.
-- Caller must pass client_id from authenticated backend context only.
-- ---------------------------------------------------------------------------
create or replace function public.allocate_chat_message_sequence(p_client_id uuid)
returns bigint
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_seq bigint;
begin
  if p_client_id is null then
    raise exception 'client_id required';
  end if;

  if not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception 'client not found';
  end if;

  insert into public.chat_message_counters as ctr (client_id, next_sequence)
  values (p_client_id, 2)
  on conflict (client_id) do update
    set next_sequence = ctr.next_sequence + 1
  returning ctr.next_sequence - 1 into v_seq;

  return v_seq;
end;
$$;

comment on function public.allocate_chat_message_sequence(uuid) is
  'Caller must pass client_id from authenticated backend context only.';

revoke all on function public.allocate_chat_message_sequence(uuid) from public;
revoke all on function public.allocate_chat_message_sequence(uuid) from authenticated;
revoke all on function public.allocate_chat_message_sequence(uuid) from anon;
grant execute on function public.allocate_chat_message_sequence(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.chat_messages enable row level security;
alter table public.agent_sessions enable row level security;

drop policy if exists ash_dashboard_chat_message_select on public.chat_messages;
create policy ash_dashboard_chat_message_select
  on public.chat_messages
  for select
  to authenticated
  using (public.ash_owns_client(client_id));

drop policy if exists ash_dashboard_agent_session_select on public.agent_sessions;
create policy ash_dashboard_agent_session_select
  on public.agent_sessions
  for select
  to authenticated
  using (public.ash_owns_client(client_id));

-- chat_message_counters: RLS enabled, no authenticated/anon policies.

-- ---------------------------------------------------------------------------
-- Grants — minimal surface
-- ---------------------------------------------------------------------------
grant select on public.chat_messages to authenticated;
grant select on public.agent_sessions to authenticated;

grant all on public.chat_messages,
            public.agent_sessions,
            public.chat_message_counters
  to service_role;

revoke all on public.chat_messages from anon;
revoke all on public.agent_sessions from anon;
revoke all on public.chat_message_counters from anon;

notify pgrst, 'reload schema';

commit;

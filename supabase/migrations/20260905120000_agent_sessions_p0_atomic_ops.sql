-- Phase 5.8-P0 — Atomic agent_sessions transitions + optimistic concurrency.
-- P0-1: draft + pending mirror in one transaction.
-- P0-2: conditional pending clear by state_version.
-- P0-3: atomic consume_agent_pending for confirmation idempotence.

begin;

alter table public.agent_sessions
  add column if not exists state_version bigint not null default 1;

comment on column public.agent_sessions.state_version is
  'Monotonic row version for optimistic concurrency (pending clear / consume).';

-- ---------------------------------------------------------------------------
-- mirror_agent_sessions_atomic — single transaction draft + pending upsert/clear
-- ---------------------------------------------------------------------------
create or replace function public.mirror_agent_sessions_atomic(
  p_client_id uuid,
  p_draft_payload jsonb,
  p_pending_payload jsonb default null,
  p_pending_awaiting text default null,
  p_pending_intention text default null,
  p_clear_pending_version bigint default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_draft_version bigint;
  v_pending_version bigint;
  v_deleted integer := 0;
begin
  if p_client_id is null then
    raise exception 'client_id required';
  end if;

  if not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception 'client not found';
  end if;

  if p_draft_payload is null or jsonb_typeof(p_draft_payload) <> 'object' then
    raise exception 'draft payload must be a json object';
  end if;

  insert into public.agent_sessions as s (
    client_id,
    state_type,
    payload,
    intention,
    awaiting,
    state_version
  )
  values (
    p_client_id,
    'draft',
    p_draft_payload,
    null,
    null,
    1
  )
  on conflict (client_id, state_type) do update
    set payload = excluded.payload,
        state_version = s.state_version + 1,
        updated_at = now()
  returning state_version into v_draft_version;

  if p_pending_payload is not null then
    if jsonb_typeof(p_pending_payload) <> 'object' then
      raise exception 'pending payload must be a json object';
    end if;

    insert into public.agent_sessions as s (
      client_id,
      state_type,
      payload,
      intention,
      awaiting,
      state_version
    )
    values (
      p_client_id,
      'pending',
      p_pending_payload,
      p_pending_intention,
      p_pending_awaiting,
      1
    )
    on conflict (client_id, state_type) do update
      set payload = excluded.payload,
          intention = excluded.intention,
          awaiting = excluded.awaiting,
          state_version = s.state_version + 1,
          updated_at = now()
    returning state_version into v_pending_version;
  else
    if p_clear_pending_version is not null then
      delete from public.agent_sessions
      where client_id = p_client_id
        and state_type = 'pending'
        and state_version = p_clear_pending_version;
      get diagnostics v_deleted = row_count;
    else
      delete from public.agent_sessions
      where client_id = p_client_id
        and state_type = 'pending';
      get diagnostics v_deleted = row_count;
    end if;
    v_pending_version := null;
  end if;

  return jsonb_build_object(
    'draftVersion', v_draft_version,
    'pendingVersion', v_pending_version,
    'pendingCleared', v_deleted
  );
end;
$$;

comment on function public.mirror_agent_sessions_atomic(uuid, jsonb, jsonb, text, text, bigint) is
  'Atomically mirror draft and pending rows. Conditional clear uses state_version.';

revoke all on function public.mirror_agent_sessions_atomic(uuid, jsonb, jsonb, text, text, bigint) from public;
revoke all on function public.mirror_agent_sessions_atomic(uuid, jsonb, jsonb, text, text, bigint) from authenticated;
revoke all on function public.mirror_agent_sessions_atomic(uuid, jsonb, jsonb, text, text, bigint) from anon;
grant execute on function public.mirror_agent_sessions_atomic(uuid, jsonb, jsonb, text, text, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- consume_agent_pending — atomic confirmation consumption (P0-3)
-- ---------------------------------------------------------------------------
create or replace function public.consume_agent_pending(
  p_client_id uuid,
  p_expected_version bigint default null,
  p_consume_token text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_intention text;
  v_version bigint;
begin
  if p_client_id is null then
    raise exception 'client_id required';
  end if;

  if p_expected_version is null and (p_consume_token is null or length(trim(p_consume_token)) = 0) then
    raise exception 'expected_version or consume_token required';
  end if;

  delete from public.agent_sessions
  where client_id = p_client_id
    and state_type = 'pending'
    and (
      (p_expected_version is not null and state_version = p_expected_version)
      or (
        p_consume_token is not null
        and length(trim(p_consume_token)) > 0
        and payload->>'consumeToken' = p_consume_token
      )
    )
  returning payload, intention, state_version
  into v_payload, v_intention, v_version;

  if found then
    return jsonb_build_object(
      'status', 'CONSUMED',
      'payload', v_payload,
      'intention', v_intention,
      'version', v_version
    );
  end if;

  if exists (
    select 1 from public.agent_sessions
    where client_id = p_client_id and state_type = 'pending'
  ) then
    return jsonb_build_object('status', 'VERSION_MISMATCH');
  end if;

  return jsonb_build_object('status', 'ALREADY_CONSUMED');
end;
$$;

comment on function public.consume_agent_pending(uuid, bigint, text) is
  'Atomically consume a pending confirmation. Prevents double business writes.';

revoke all on function public.consume_agent_pending(uuid, bigint, text) from public;
revoke all on function public.consume_agent_pending(uuid, bigint, text) from authenticated;
revoke all on function public.consume_agent_pending(uuid, bigint, text) from anon;
grant execute on function public.consume_agent_pending(uuid, bigint, text) to service_role;

notify pgrst, 'reload schema';

commit;

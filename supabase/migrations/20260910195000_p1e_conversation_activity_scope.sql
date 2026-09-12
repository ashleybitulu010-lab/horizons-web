-- P1-E — Conversation + counters activity scope; activity-scoped synthesis view.
-- Requires P1-B (activities), P1-C (business activity_id), P1-D (agent_sessions activity scope).

begin;

-- ---------------------------------------------------------------------------
-- Dry run — must return zero ambiguous/orphan rows before apply in production
-- ---------------------------------------------------------------------------
create or replace function public.p1e_chat_backfill_dry_run()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total bigint;
  v_no_default bigint;
  v_orphan bigint;
begin
  select count(*) into v_total from public.chat_messages;

  select count(*) into v_no_default
  from public.chat_messages m
  where public.ash_resolve_default_activity(m.client_id) is null;

  select count(*) into v_orphan
  from public.chat_messages m
  left join public.clients c on c.id = m.client_id
  where c.id is null;

  return jsonb_build_object(
    'total_messages', v_total,
    'messages_without_resolvable_default', v_no_default,
    'orphaned_messages', v_orphan,
    'ambiguous', 0,
    'resolvable', v_total - v_no_default - v_orphan
  );
end;
$$;

revoke all on function public.p1e_chat_backfill_dry_run() from public, anon, authenticated;
grant execute on function public.p1e_chat_backfill_dry_run() to service_role;

-- ---------------------------------------------------------------------------
-- chat_messages.activity_id
-- ---------------------------------------------------------------------------
alter table public.chat_messages
  add column if not exists activity_id uuid null;

update public.chat_messages m
set activity_id = public.ash_resolve_default_activity(m.client_id)
where m.activity_id is null;

do $$
declare
  v_missing bigint;
begin
  select count(*) into v_missing from public.chat_messages where activity_id is null;
  if v_missing > 0 then
    raise exception 'P1-E chat_messages backfill incomplete: % rows without activity_id', v_missing;
  end if;
end;
$$;

alter table public.chat_messages
  alter column activity_id set not null;

alter table public.chat_messages
  drop constraint if exists chat_messages_client_sequence_uidx;

alter table public.chat_messages
  add constraint chat_messages_client_activity_sequence_uidx
    unique (client_id, activity_id, sequence);

alter table public.chat_messages
  drop constraint if exists chat_messages_activity_client_fkey;

alter table public.chat_messages
  add constraint chat_messages_activity_client_fkey
    foreign key (client_id, activity_id)
    references public.activities (client_id, id)
    on delete restrict;

create index if not exists chat_messages_client_activity_sequence_idx
  on public.chat_messages (client_id, activity_id, sequence asc);

-- ---------------------------------------------------------------------------
-- chat_message_counters — composite (client_id, activity_id)
-- ---------------------------------------------------------------------------
alter table public.chat_message_counters
  add column if not exists activity_id uuid null;

update public.chat_message_counters ctr
set activity_id = public.ash_resolve_default_activity(ctr.client_id)
where ctr.activity_id is null;

do $$
declare
  v_missing bigint;
begin
  select count(*) into v_missing from public.chat_message_counters where activity_id is null;
  if v_missing > 0 then
    raise exception 'P1-E chat_message_counters backfill incomplete: % rows without activity_id', v_missing;
  end if;
end;
$$;

alter table public.chat_message_counters
  alter column activity_id set not null;

alter table public.chat_message_counters
  drop constraint if exists chat_message_counters_pkey;

alter table public.chat_message_counters
  add constraint chat_message_counters_pkey
    primary key (client_id, activity_id);

alter table public.chat_message_counters
  drop constraint if exists chat_message_counters_activity_client_fkey;

alter table public.chat_message_counters
  add constraint chat_message_counters_activity_client_fkey
    foreign key (client_id, activity_id)
    references public.activities (client_id, id)
    on delete cascade;

-- ---------------------------------------------------------------------------
-- Sequence allocator — activity-aware (backward-compatible 1-arg overload)
-- ---------------------------------------------------------------------------
create or replace function public.allocate_chat_message_sequence(
  p_client_id uuid,
  p_activity_id uuid default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_activity_id uuid;
  v_seq bigint;
begin
  if p_client_id is null then
    raise exception 'client_id required';
  end if;

  if not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception 'client not found';
  end if;

  v_activity_id := coalesce(p_activity_id, public.ash_resolve_default_activity(p_client_id));
  if v_activity_id is null then
    raise exception 'default activity missing for client';
  end if;

  perform public.ash_validate_activity_for_client(p_client_id, v_activity_id);

  insert into public.chat_message_counters as ctr (client_id, activity_id, next_sequence)
  values (p_client_id, v_activity_id, 2)
  on conflict (client_id, activity_id) do update
    set next_sequence = ctr.next_sequence + 1
  returning ctr.next_sequence - 1 into v_seq;

  return v_seq;
end;
$$;

comment on function public.allocate_chat_message_sequence(uuid, uuid) is
  'Activity-scoped message sequence. p_activity_id null → client default activity.';

revoke all on function public.allocate_chat_message_sequence(uuid, uuid) from public, anon, authenticated;
grant execute on function public.allocate_chat_message_sequence(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- RLS — chat_messages activity-aware for authenticated reads
-- ---------------------------------------------------------------------------
drop policy if exists ash_dashboard_chat_message_select on public.chat_messages;
create policy ash_dashboard_chat_message_select
  on public.chat_messages
  for select
  to authenticated
  using (
    public.ash_owns_client(client_id)
    and public.ash_owns_activity(activity_id)
  );

-- ---------------------------------------------------------------------------
-- synthese_mensuelle_by_activity — new view; legacy synthese_mensuelle unchanged
-- ---------------------------------------------------------------------------
create or replace view public.synthese_mensuelle_by_activity
with (security_invoker = true)
as
with months as (
  select
    v.client_id,
    v.activity_id,
    date_trunc('month', v.date)::date as mois,
    coalesce(sum(v.montant_paye), 0)::numeric as total_recettes,
    coalesce(sum(greatest((v.quantite * v.prix_unitaire) - v.montant_paye, 0)), 0)::numeric as dette_client
  from public.ventes v
  group by v.client_id, v.activity_id, date_trunc('month', v.date)::date

  union all

  select
    d.client_id,
    d.activity_id,
    date_trunc('month', d.date)::date as mois,
    0::numeric as total_recettes,
    0::numeric as dette_client
  from public.depenses d
  group by d.client_id, d.activity_id, date_trunc('month', d.date)::date
),
expense_months as (
  select
    d.client_id,
    d.activity_id,
    date_trunc('month', d.date)::date as mois,
    coalesce(sum(d.montant_depense), 0)::numeric as total_depenses
  from public.depenses d
  group by d.client_id, d.activity_id, date_trunc('month', d.date)::date
),
combined as (
  select
    m.client_id,
    m.activity_id,
    m.mois,
    sum(m.total_recettes) as total_recettes,
    sum(m.dette_client) as dette_client
  from months m
  group by m.client_id, m.activity_id, m.mois
)
select
  c.client_id,
  c.activity_id,
  c.mois,
  c.total_recettes,
  coalesce(e.total_depenses, 0)::numeric as total_depenses,
  (c.total_recettes - coalesce(e.total_depenses, 0))::numeric as benefice_net,
  c.dette_client
from combined c
left join expense_months e
  on e.client_id = c.client_id
 and e.activity_id = c.activity_id
 and e.mois = c.mois;

grant select on public.synthese_mensuelle_by_activity to authenticated, service_role;
revoke all on public.synthese_mensuelle_by_activity from anon;

notify pgrst, 'reload schema';

commit;

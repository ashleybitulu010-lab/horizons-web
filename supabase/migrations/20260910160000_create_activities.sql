-- P1-B — Activities foundation (multi-activity architecture Phase 1).
-- Creates public.activities, backfills one default activity per existing client.
-- Does NOT add activity_id to business tables (P1-B scope).

begin;

-- ---------------------------------------------------------------------------
-- public.activities
-- ---------------------------------------------------------------------------
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),

  client_id uuid not null
    references public.clients(id) on delete cascade,

  name text not null,
  type text not null,
  is_default boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint activities_name_nonempty_check
    check (length(trim(name)) > 0),

  constraint activities_type_check
    check (type in ('commerce', 'service', 'production', 'autre'))
);

comment on table public.activities is
  'P1-B tenant child: one client (tenant) may have many activities. Legacy clients.type_activite / nom_activite are deprecated in favour of this table.';

comment on column public.activities.client_id is
  'Tenant scope — must match authenticated user client via ash_owns_client.';

comment on column public.activities.is_default is
  'Exactly one default activity per client (partial unique index). Used as implicit active activity until multi-activity UI.';

comment on column public.activities.type is
  'Activity kind: commerce | service | production | autre (aligned with legacy clients.type_activite).';

-- ---------------------------------------------------------------------------
-- Indexes & constraints
-- ---------------------------------------------------------------------------
create index if not exists activities_client_id_idx
  on public.activities (client_id);

create unique index if not exists activities_one_default_per_client_uidx
  on public.activities (client_id)
  where is_default = true;

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.activities_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_activities_updated_at on public.activities;
create trigger trg_activities_updated_at
before update on public.activities
for each row
execute function public.activities_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — tenant isolation via ash_owns_client(client_id)
-- ---------------------------------------------------------------------------
alter table public.activities enable row level security;

drop policy if exists ash_dashboard_activity_select on public.activities;
create policy ash_dashboard_activity_select
  on public.activities
  for select
  to authenticated
  using (public.ash_owns_client(client_id));

-- Writes: service_role backend only in P1-B (backfill below uses migration session).

revoke all on table public.activities from anon;
grant select on table public.activities to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: exactly one default activity per existing client (deterministic)
-- Mapping rules (P1-B):
--   type  = type_activite when in allowed set, else 'commerce'
--   name  = nom_activite when non-empty, else nom_client, else 'Activité principale'
-- ---------------------------------------------------------------------------
insert into public.activities (client_id, name, type, is_default)
select
  c.id,
  coalesce(
    nullif(trim(c.nom_activite), ''),
    nullif(trim(c.nom_client), ''),
    'Activité principale'
  ),
  coalesce(
    case
      when c.type_activite in ('commerce', 'service', 'production', 'autre')
        then c.type_activite
      else null
    end,
    'commerce'
  ),
  true
from public.clients c
where not exists (
  select 1
  from public.activities a
  where a.client_id = c.id
);

notify pgrst, 'reload schema';

commit;

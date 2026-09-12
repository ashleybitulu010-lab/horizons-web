-- P1-C — Activity scope on business tables.
-- Adds activity_id, backfills from default activity per client, enforces tenant/activity coherence.
-- Does NOT modify synthese_mensuelle, chat, agent_sessions, or backend behaviour.

begin;

-- ---------------------------------------------------------------------------
-- Anchor for composite FK: activity must belong to the same client row
-- ---------------------------------------------------------------------------
create unique index if not exists activities_client_id_id_uidx
  on public.activities (client_id, id);

comment on index public.activities_client_id_id_uidx is
  'P1-C composite FK anchor: business tables reference (client_id, activity_id).';

-- ---------------------------------------------------------------------------
-- 1. Add nullable activity_id columns
-- ---------------------------------------------------------------------------
alter table public.ventes add column if not exists activity_id uuid;
alter table public.depenses add column if not exists activity_id uuid;
alter table public.produits add column if not exists activity_id uuid;
alter table public.stocks add column if not exists activity_id uuid;
alter table public.paiements_dettes add column if not exists activity_id uuid;

comment on column public.ventes.activity_id is 'P1-C activity scope — default backfilled from activities.is_default.';
comment on column public.depenses.activity_id is 'P1-C activity scope — default backfilled from activities.is_default.';
comment on column public.produits.activity_id is 'P1-C activity scope — default backfilled from activities.is_default.';
comment on column public.stocks.activity_id is 'P1-C activity scope — stock is activity-scoped, not shared across activities.';
comment on column public.paiements_dettes.activity_id is 'P1-C activity scope — debt payments inherit activity from sale context.';

-- ---------------------------------------------------------------------------
-- 2. Deterministic backfill: default activity per client only
-- ---------------------------------------------------------------------------
update public.ventes v
set activity_id = a.id
from public.activities a
where v.activity_id is null
  and a.client_id = v.client_id
  and a.is_default = true;

update public.depenses d
set activity_id = a.id
from public.activities a
where d.activity_id is null
  and a.client_id = d.client_id
  and a.is_default = true;

update public.produits p
set activity_id = a.id
from public.activities a
where p.activity_id is null
  and a.client_id = p.client_id
  and a.is_default = true;

update public.stocks s
set activity_id = a.id
from public.activities a
where s.activity_id is null
  and a.client_id = s.client_id
  and a.is_default = true;

update public.paiements_dettes pd
set activity_id = a.id
from public.activities a
where pd.activity_id is null
  and a.client_id = pd.client_id
  and a.is_default = true;

-- ---------------------------------------------------------------------------
-- 3. Guard: abort if any row could not be resolved
-- ---------------------------------------------------------------------------
do $$
declare
  tbl text;
  missing bigint;
begin
  foreach tbl in array array['ventes', 'depenses', 'produits', 'stocks', 'paiements_dettes']
  loop
    execute format('select count(*) from public.%I where activity_id is null', tbl) into missing;
    if missing > 0 then
      raise exception 'P1-C backfill incomplete on %: % rows without activity_id', tbl, missing;
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. FK activity_id → activities(id) ON DELETE RESTRICT (protect financial history)
-- 5. Composite FK (client_id, activity_id) → activities(client_id, id)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ventes_activity_id_fkey') then
    alter table public.ventes
      add constraint ventes_activity_id_fkey
      foreign key (activity_id) references public.activities(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ventes_client_activity_fkey') then
    alter table public.ventes
      add constraint ventes_client_activity_fkey
      foreign key (client_id, activity_id) references public.activities(client_id, id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'depenses_activity_id_fkey') then
    alter table public.depenses
      add constraint depenses_activity_id_fkey
      foreign key (activity_id) references public.activities(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'depenses_client_activity_fkey') then
    alter table public.depenses
      add constraint depenses_client_activity_fkey
      foreign key (client_id, activity_id) references public.activities(client_id, id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'produits_activity_id_fkey') then
    alter table public.produits
      add constraint produits_activity_id_fkey
      foreign key (activity_id) references public.activities(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'produits_client_activity_fkey') then
    alter table public.produits
      add constraint produits_client_activity_fkey
      foreign key (client_id, activity_id) references public.activities(client_id, id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'stocks_activity_id_fkey') then
    alter table public.stocks
      add constraint stocks_activity_id_fkey
      foreign key (activity_id) references public.activities(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stocks_client_activity_fkey') then
    alter table public.stocks
      add constraint stocks_client_activity_fkey
      foreign key (client_id, activity_id) references public.activities(client_id, id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'paiements_dettes_activity_id_fkey') then
    alter table public.paiements_dettes
      add constraint paiements_dettes_activity_id_fkey
      foreign key (activity_id) references public.activities(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'paiements_dettes_client_activity_fkey') then
    alter table public.paiements_dettes
      add constraint paiements_dettes_client_activity_fkey
      foreign key (client_id, activity_id) references public.activities(client_id, id);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. NOT NULL after successful backfill
-- ---------------------------------------------------------------------------
alter table public.ventes alter column activity_id set not null;
alter table public.depenses alter column activity_id set not null;
alter table public.produits alter column activity_id set not null;
alter table public.stocks alter column activity_id set not null;
alter table public.paiements_dettes alter column activity_id set not null;

-- ---------------------------------------------------------------------------
-- 7. Scope indexes (client_id, activity_id) — skip if redundant with client-only idx
-- ---------------------------------------------------------------------------
create index if not exists ventes_client_activity_id_idx
  on public.ventes (client_id, activity_id);

create index if not exists depenses_client_activity_id_idx
  on public.depenses (client_id, activity_id);

create index if not exists produits_client_activity_id_idx
  on public.produits (client_id, activity_id);

create index if not exists stocks_client_activity_id_idx
  on public.stocks (client_id, activity_id);

create index if not exists paiements_dettes_client_activity_id_idx
  on public.paiements_dettes (client_id, activity_id);

notify pgrst, 'reload schema';

commit;

-- Fix clients defaults (avoid null subscription end / empty thread)
-- Sync paiements_dettes.montant from ventes.reste_a_payer (0 when soldé)

begin;

-- 1) Clients: fill nulls + defaults on insert/update
update public.clients
set date_fin_abonnement = coalesce(date_inscription, created_at, now()) + interval '30 days'
where date_fin_abonnement is null;

update public.clients
set thread_id = '[]'
where thread_id is null or trim(thread_id) = '';

update public.clients
set nom_client = coalesce(nullif(trim(nom_client), ''), 'Client')
where nom_client is null or trim(nom_client) = '';

create or replace function public.clients_autofill_defaults()
returns trigger
language plpgsql
as $$
begin
  if new.date_inscription is null then
    new.date_inscription := coalesce(new.created_at, now());
  end if;

  if new.date_fin_abonnement is null then
    new.date_fin_abonnement := new.date_inscription + interval '30 days';
  end if;

  if new.thread_id is null or trim(new.thread_id) = '' then
    new.thread_id := '[]';
  end if;

  if new.nom_client is null or trim(new.nom_client) = '' then
    new.nom_client := 'Client';
  end if;

  if new.onboarding_status is null or trim(new.onboarding_status) = '' then
    new.onboarding_status := 'pending';
  end if;

  if new.onboarding_step is null then
    new.onboarding_step := 0;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_clients_autofill_defaults on public.clients;
create trigger trg_clients_autofill_defaults
before insert or update of date_inscription, date_fin_abonnement, thread_id, nom_client, onboarding_status, onboarding_step
on public.clients
for each row
execute function public.clients_autofill_defaults();

-- 2) paiements_dettes: one row per vente, montant = reste_a_payer (0 when settled)
alter table public.paiements_dettes
  drop constraint if exists paiements_dettes_montant_check;

alter table public.paiements_dettes
  add constraint paiements_dettes_montant_check check (montant >= 0);

-- Collapse duplicates: keep newest row per vente_id
delete from public.paiements_dettes pd
using public.paiements_dettes newer
where pd.vente_id = newer.vente_id
  and pd.created_at < newer.created_at;

create unique index if not exists paiements_dettes_vente_id_uidx
  on public.paiements_dettes (vente_id);

-- Sync outstanding debt from vente
create or replace function public.sync_paiement_dette_from_vente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining numeric := 0;
begin
  -- reste_a_payer is generated; available on NEW in AFTER triggers
  remaining := greatest(coalesce(new.reste_a_payer, 0), 0);

  insert into public.paiements_dettes as pd (
    client_id,
    vente_id,
    montant,
    paid_at
  ) values (
    new.client_id,
    new.id,
    remaining,
    coalesce(new.date, new.created_at, now())
  )
  on conflict (vente_id) do update
  set
    client_id = excluded.client_id,
    montant = excluded.montant,
    paid_at = case
      when excluded.montant is distinct from pd.montant then coalesce(new.date, now())
      else pd.paid_at
    end;

  return new;
end;
$$;

drop trigger if exists ventes_record_debt_payment on public.ventes;
drop function if exists public.record_debt_payment();

drop trigger if exists ventes_sync_paiement_dette on public.ventes;
create trigger ventes_sync_paiement_dette
after insert or update of client_id, quantite, prix_unitaire, montant_paye
on public.ventes
for each row
execute function public.sync_paiement_dette_from_vente();

-- Backfill / resync all existing sales
insert into public.paiements_dettes (client_id, vente_id, montant, paid_at)
select
  v.client_id,
  v.id,
  greatest(coalesce(v.reste_a_payer, 0), 0),
  coalesce(v.date, v.created_at, now())
from public.ventes v
on conflict (vente_id) do update
set
  client_id = excluded.client_id,
  montant = excluded.montant,
  paid_at = case
    when excluded.montant is distinct from public.paiements_dettes.montant then excluded.paid_at
    else public.paiements_dettes.paid_at
  end;

notify pgrst, 'reload schema';

commit;

-- Initial activity configuration fields on clients (source of truth for setup wizard).

begin;

alter table public.clients
  add column if not exists nom_activite text,
  add column if not exists type_activite text,
  add column if not exists gestion_stock boolean not null default false,
  add column if not exists suivi_dettes boolean not null default false,
  add column if not exists configuration_completed boolean not null default false;

comment on column public.clients.nom_activite is 'Business / activity display name from setup wizard.';
comment on column public.clients.type_activite is 'commerce | service | production | autre';
comment on column public.clients.gestion_stock is 'Whether stock tracking is enabled for this account.';
comment on column public.clients.suivi_dettes is 'Whether client debt/credit tracking is enabled.';
comment on column public.clients.configuration_completed is 'True after the post-signup activity setup wizard is finished.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_type_activite_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_type_activite_check
      check (type_activite is null or type_activite in ('commerce', 'service', 'production', 'autre'));
  end if;
end
$$;

-- Existing accounts keep access without being forced through the new wizard.
update public.clients
set configuration_completed = true
where configuration_completed = false;

revoke update on public.clients from authenticated;
grant update (
  currency_preference,
  ledger_currency,
  usd_cdf_rate,
  nom_activite,
  type_activite,
  gestion_stock,
  suivi_dettes,
  configuration_completed,
  onboarding_status,
  onboarding_step
) on public.clients to authenticated;

notify pgrst, 'reload schema';

commit;

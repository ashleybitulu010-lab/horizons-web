begin;

alter table public.clients
  add column if not exists currency_preference text not null default 'USD';

alter table public.clients
  add column if not exists ledger_currency text;

-- All rows present before this migration contain amounts entered in CDF.
update public.clients
set ledger_currency = 'CDF'
where ledger_currency is null;

alter table public.clients
  alter column ledger_currency set default 'USD',
  alter column ledger_currency set not null;

alter table public.clients
  add column if not exists usd_cdf_rate numeric not null default 2295;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_currency_preference_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_currency_preference_check
      check (currency_preference in ('USD', 'CDF'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_ledger_currency_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_ledger_currency_check
      check (ledger_currency in ('USD', 'CDF'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_usd_cdf_rate_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_usd_cdf_rate_check
      check (usd_cdf_rate > 0);
  end if;
end
$$;

drop policy if exists ash_dashboard_client_currency_update on public.clients;
create policy ash_dashboard_client_currency_update
  on public.clients
  for update
  to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

revoke update on public.clients from authenticated;
grant update (currency_preference, usd_cdf_rate) on public.clients to authenticated;

commit;

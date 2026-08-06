begin;

create table if not exists public.paiements_dettes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  vente_id uuid not null references public.ventes(id) on delete cascade,
  montant numeric not null check (montant > 0),
  paid_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now()
);

create index if not exists paiements_dettes_client_id_idx
  on public.paiements_dettes (client_id);
create index if not exists paiements_dettes_vente_id_idx
  on public.paiements_dettes (vente_id);
create index if not exists paiements_dettes_paid_at_idx
  on public.paiements_dettes (paid_at desc);

alter table public.paiements_dettes enable row level security;
alter table public.paiements_dettes replica identity full;

drop policy if exists ash_dashboard_debt_payment_select on public.paiements_dettes;
create policy ash_dashboard_debt_payment_select
  on public.paiements_dettes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.clients
      where clients.id = paiements_dettes.client_id
        and clients.auth_user_id = auth.uid()
    )
  );

grant select on public.paiements_dettes to authenticated;
grant all on public.paiements_dettes to service_role;

insert into public.paiements_dettes (client_id, vente_id, montant, paid_at)
select
  ventes.client_id,
  ventes.id,
  ventes.montant_paye,
  coalesce(ventes.date, ventes.created_at, now())
from public.ventes
where ventes.montant_paye > 0
  and not exists (
    select 1
    from public.paiements_dettes
    where paiements_dettes.vente_id = ventes.id
  );

create or replace function public.record_debt_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_amount numeric := 0;
  payment_delta numeric := 0;
  payment_date timestamp with time zone := now();
begin
  if tg_op = 'UPDATE' then
    previous_amount := coalesce(old.montant_paye, 0);
  else
    payment_date := coalesce(new.date, new.created_at, now());
  end if;

  payment_delta := coalesce(new.montant_paye, 0) - previous_amount;
  if payment_delta > 0 then
    insert into public.paiements_dettes (
      client_id,
      vente_id,
      montant,
      paid_at
    ) values (
      new.client_id,
      new.id,
      payment_delta,
      payment_date
    );
  end if;

  return new;
end;
$$;

drop trigger if exists ventes_record_debt_payment on public.ventes;
create trigger ventes_record_debt_payment
after insert or update of montant_paye
on public.ventes
for each row
execute function public.record_debt_payment();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'paiements_dettes'
  ) then
    alter publication supabase_realtime add table public.paiements_dettes;
  end if;
end
$$;

create or replace function public.get_dashboard_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with current_client as (
    select
      clients.id,
      clients.currency_preference,
      clients.ledger_currency,
      clients.usd_cdf_rate
    from public.clients
    where clients.auth_user_id = auth.uid()
    limit 1
  )
  select jsonb_build_object(
    'client',
      coalesce(
        (
          select jsonb_build_object(
            'id', current_client.id,
            'currency_preference', current_client.currency_preference,
            'ledger_currency', current_client.ledger_currency,
            'usd_cdf_rate', current_client.usd_cdf_rate
          )
          from current_client
        ),
        '{}'::jsonb
      ),
    'produits',
      coalesce(
        (
          select jsonb_agg(to_jsonb(produits) order by produits.created_at)
          from public.produits
          where produits.client_id = (select id from current_client)
        ),
        '[]'::jsonb
      ),
    'stocks',
      coalesce(
        (
          select jsonb_agg(to_jsonb(stocks) order by stocks.created_at)
          from public.stocks
          where stocks.client_id = (select id from current_client)
        ),
        '[]'::jsonb
      ),
    'ventes',
      coalesce(
        (
          select jsonb_agg(to_jsonb(ventes) order by ventes.date)
          from public.ventes
          where ventes.client_id = (select id from current_client)
        ),
        '[]'::jsonb
      ),
    'depenses',
      coalesce(
        (
          select jsonb_agg(to_jsonb(depenses) order by depenses.date)
          from public.depenses
          where depenses.client_id = (select id from current_client)
        ),
        '[]'::jsonb
      ),
    'paiements_dettes',
      coalesce(
        (
          select jsonb_agg(to_jsonb(paiements_dettes) order by paiements_dettes.paid_at)
          from public.paiements_dettes
          where paiements_dettes.client_id = (select id from current_client)
        ),
        '[]'::jsonb
      )
  );
$$;

grant execute on function public.get_dashboard_snapshot() to authenticated;

notify pgrst, 'reload schema';

commit;

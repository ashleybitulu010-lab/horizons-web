begin;

alter table public.clients
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

create unique index if not exists clients_auth_user_id_key
  on public.clients (auth_user_id)
  where auth_user_id is not null;

create index if not exists produits_client_id_idx on public.produits (client_id);
create index if not exists stocks_client_id_idx on public.stocks (client_id);
create index if not exists ventes_client_id_idx on public.ventes (client_id);
create index if not exists depenses_client_id_idx on public.depenses (client_id);

alter table public.clients enable row level security;
alter table public.produits enable row level security;
alter table public.stocks enable row level security;
alter table public.ventes enable row level security;
alter table public.depenses enable row level security;

drop policy if exists ash_dashboard_client_select on public.clients;
create policy ash_dashboard_client_select
  on public.clients
  for select
  to authenticated
  using (auth_user_id = auth.uid());

drop policy if exists ash_dashboard_product_select on public.produits;
create policy ash_dashboard_product_select
  on public.produits
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.clients
      where clients.id = produits.client_id
        and clients.auth_user_id = auth.uid()
    )
  );

drop policy if exists ash_dashboard_stock_select on public.stocks;
create policy ash_dashboard_stock_select
  on public.stocks
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.clients
      where clients.id = stocks.client_id
        and clients.auth_user_id = auth.uid()
    )
  );

drop policy if exists ash_dashboard_sale_select on public.ventes;
create policy ash_dashboard_sale_select
  on public.ventes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.clients
      where clients.id = ventes.client_id
        and clients.auth_user_id = auth.uid()
    )
  );

drop policy if exists ash_dashboard_expense_select on public.depenses;
create policy ash_dashboard_expense_select
  on public.depenses
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.clients
      where clients.id = depenses.client_id
        and clients.auth_user_id = auth.uid()
    )
  );

grant usage on schema public to authenticated;
grant select on public.clients, public.produits, public.stocks, public.ventes, public.depenses to authenticated;

alter table public.produits replica identity full;
alter table public.stocks replica identity full;
alter table public.ventes replica identity full;
alter table public.depenses replica identity full;

do $$
declare
  dashboard_table text;
begin
  foreach dashboard_table in array array['produits', 'stocks', 'ventes', 'depenses']
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = dashboard_table
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        dashboard_table
      );
    end if;
  end loop;
end
$$;

commit;

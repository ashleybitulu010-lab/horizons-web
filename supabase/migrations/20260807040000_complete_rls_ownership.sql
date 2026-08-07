-- Complete RLS for Ash Ledger production tables.
-- Ownership: clients.auth_user_id = auth.uid()
-- Child tables: access only when client_id belongs to that client.
-- synthese_mensuelle is a VIEW (security_invoker=on) over ventes/depenses —
--   it inherits base-table RLS; no RLS can be enabled on the view itself.
-- service_role continues to bypass RLS (n8n / edge functions / API).

begin;

-- ---------------------------------------------------------------------------
-- Helper: does the current authenticated user own this client row?
-- ---------------------------------------------------------------------------
create or replace function public.ash_owns_client(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.clients
    where clients.id = target_client_id
      and clients.auth_user_id = auth.uid()
  );
$$;

revoke all on function public.ash_owns_client(uuid) from public;
grant execute on function public.ash_owns_client(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS on all production base tables
-- ---------------------------------------------------------------------------
alter table public.clients enable row level security;
alter table public.produits enable row level security;
alter table public.stocks enable row level security;
alter table public.ventes enable row level security;
alter table public.depenses enable row level security;
alter table public.paiements_dettes enable row level security;

-- Ensure monthly synthesis view evaluates with invoker privileges + RLS
do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'synthese_mensuelle'
      and c.relkind = 'v'
  ) then
    execute 'alter view public.synthese_mensuelle set (security_invoker = true)';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- clients: SELECT/UPDATE already exist; add INSERT for own row only
-- (no DELETE for authenticated — account lifecycle stays on service_role)
-- ---------------------------------------------------------------------------
drop policy if exists ash_dashboard_client_select on public.clients;
create policy ash_dashboard_client_select
  on public.clients
  for select
  to authenticated
  using (auth_user_id = auth.uid());

drop policy if exists ash_dashboard_client_insert on public.clients;
create policy ash_dashboard_client_insert
  on public.clients
  for insert
  to authenticated
  with check (auth_user_id = auth.uid());

drop policy if exists ash_dashboard_client_currency_update on public.clients;
create policy ash_dashboard_client_currency_update
  on public.clients
  for update
  to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- produits
-- ---------------------------------------------------------------------------
drop policy if exists ash_dashboard_product_select on public.produits;
create policy ash_dashboard_product_select
  on public.produits
  for select
  to authenticated
  using (public.ash_owns_client(client_id));

drop policy if exists ash_dashboard_product_insert on public.produits;
create policy ash_dashboard_product_insert
  on public.produits
  for insert
  to authenticated
  with check (public.ash_owns_client(client_id));

drop policy if exists ash_dashboard_product_update on public.produits;
create policy ash_dashboard_product_update
  on public.produits
  for update
  to authenticated
  using (public.ash_owns_client(client_id))
  with check (public.ash_owns_client(client_id));

drop policy if exists ash_dashboard_product_delete on public.produits;
create policy ash_dashboard_product_delete
  on public.produits
  for delete
  to authenticated
  using (public.ash_owns_client(client_id));

-- ---------------------------------------------------------------------------
-- stocks
-- ---------------------------------------------------------------------------
drop policy if exists ash_dashboard_stock_select on public.stocks;
create policy ash_dashboard_stock_select
  on public.stocks
  for select
  to authenticated
  using (public.ash_owns_client(client_id));

drop policy if exists ash_dashboard_stock_insert on public.stocks;
create policy ash_dashboard_stock_insert
  on public.stocks
  for insert
  to authenticated
  with check (public.ash_owns_client(client_id));

drop policy if exists ash_dashboard_stock_update on public.stocks;
create policy ash_dashboard_stock_update
  on public.stocks
  for update
  to authenticated
  using (public.ash_owns_client(client_id))
  with check (public.ash_owns_client(client_id));

drop policy if exists ash_dashboard_stock_delete on public.stocks;
create policy ash_dashboard_stock_delete
  on public.stocks
  for delete
  to authenticated
  using (public.ash_owns_client(client_id));

-- ---------------------------------------------------------------------------
-- ventes
-- ---------------------------------------------------------------------------
drop policy if exists ash_dashboard_sale_select on public.ventes;
create policy ash_dashboard_sale_select
  on public.ventes
  for select
  to authenticated
  using (public.ash_owns_client(client_id));

drop policy if exists ash_dashboard_sale_insert on public.ventes;
create policy ash_dashboard_sale_insert
  on public.ventes
  for insert
  to authenticated
  with check (public.ash_owns_client(client_id));

drop policy if exists ash_dashboard_sale_update on public.ventes;
create policy ash_dashboard_sale_update
  on public.ventes
  for update
  to authenticated
  using (public.ash_owns_client(client_id))
  with check (public.ash_owns_client(client_id));

drop policy if exists ash_dashboard_sale_delete on public.ventes;
create policy ash_dashboard_sale_delete
  on public.ventes
  for delete
  to authenticated
  using (public.ash_owns_client(client_id));

-- ---------------------------------------------------------------------------
-- depenses
-- ---------------------------------------------------------------------------
drop policy if exists ash_dashboard_expense_select on public.depenses;
create policy ash_dashboard_expense_select
  on public.depenses
  for select
  to authenticated
  using (public.ash_owns_client(client_id));

drop policy if exists ash_dashboard_expense_insert on public.depenses;
create policy ash_dashboard_expense_insert
  on public.depenses
  for insert
  to authenticated
  with check (public.ash_owns_client(client_id));

drop policy if exists ash_dashboard_expense_update on public.depenses;
create policy ash_dashboard_expense_update
  on public.depenses
  for update
  to authenticated
  using (public.ash_owns_client(client_id))
  with check (public.ash_owns_client(client_id));

drop policy if exists ash_dashboard_expense_delete on public.depenses;
create policy ash_dashboard_expense_delete
  on public.depenses
  for delete
  to authenticated
  using (public.ash_owns_client(client_id));

-- ---------------------------------------------------------------------------
-- paiements_dettes
-- ---------------------------------------------------------------------------
drop policy if exists ash_dashboard_debt_payment_select on public.paiements_dettes;
create policy ash_dashboard_debt_payment_select
  on public.paiements_dettes
  for select
  to authenticated
  using (public.ash_owns_client(client_id));

drop policy if exists ash_dashboard_debt_payment_insert on public.paiements_dettes;
create policy ash_dashboard_debt_payment_insert
  on public.paiements_dettes
  for insert
  to authenticated
  with check (public.ash_owns_client(client_id));

drop policy if exists ash_dashboard_debt_payment_update on public.paiements_dettes;
create policy ash_dashboard_debt_payment_update
  on public.paiements_dettes
  for update
  to authenticated
  using (public.ash_owns_client(client_id))
  with check (public.ash_owns_client(client_id));

drop policy if exists ash_dashboard_debt_payment_delete on public.paiements_dettes;
create policy ash_dashboard_debt_payment_delete
  on public.paiements_dettes
  for delete
  to authenticated
  using (public.ash_owns_client(client_id));

-- ---------------------------------------------------------------------------
-- Grants: authenticated CRUD on base tables; SELECT on synthesis view
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete
  on public.clients,
     public.produits,
     public.stocks,
     public.ventes,
     public.depenses,
     public.paiements_dettes
  to authenticated;

grant select on public.synthese_mensuelle to authenticated;

grant select, insert, update, delete
  on public.clients,
     public.produits,
     public.stocks,
     public.ventes,
     public.depenses,
     public.paiements_dettes
  to service_role;

grant select on public.synthese_mensuelle to service_role;

-- Defense in depth: revoke anon DML/SELECT on production data
revoke all on table public.clients from anon;
revoke all on table public.produits from anon;
revoke all on table public.stocks from anon;
revoke all on table public.ventes from anon;
revoke all on table public.depenses from anon;
revoke all on table public.paiements_dettes from anon;
revoke all on table public.synthese_mensuelle from anon;

commit;

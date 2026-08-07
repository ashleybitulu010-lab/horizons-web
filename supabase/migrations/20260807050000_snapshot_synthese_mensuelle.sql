-- Include synthese_mensuelle in the dashboard snapshot so KPI cards
-- (CA, dépenses, bénéfice, dettes) can read the view columns directly.

begin;

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
      ),
    'synthese_mensuelle',
      coalesce(
        (
          select jsonb_agg(to_jsonb(synthese_mensuelle) order by synthese_mensuelle.mois)
          from public.synthese_mensuelle
          where synthese_mensuelle.client_id = (select id from current_client)
        ),
        '[]'::jsonb
      )
  );
$$;

grant execute on function public.get_dashboard_snapshot() to authenticated;

notify pgrst, 'reload schema';

commit;

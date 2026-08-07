-- Keep stocks.stock_actuel always consistent: initial + entrees - sorties
-- Also backfill sorties from linked ventes when missing.

begin;

-- Convert stock_actuel to a generated column
alter table public.stocks
  alter column stock_actuel drop default;

alter table public.stocks
  drop column if exists stock_actuel;

alter table public.stocks
  add column stock_actuel numeric
  generated always as (
    coalesce(stock_initial, 0) + coalesce(entrees, 0) - coalesce(sorties, 0)
  ) stored;

-- Backfill sorties from linked vente quantities when sorties is still 0
-- but vente_ids already reference sold quantities.
with vente_qty as (
  select
    s.numero,
    coalesce(sum(v.quantite), 0) as qty
  from public.stocks s
  left join lateral (
    select (jsonb_array_elements_text(
      case
        when jsonb_typeof(s.vente_ids) = 'array' then s.vente_ids
        when jsonb_typeof(s.vente_ids) = 'string' then coalesce((s.vente_ids #>> '{}')::jsonb, '[]'::jsonb)
        when s.vente_ids is null then '[]'::jsonb
        else '[]'::jsonb
      end
    ))::uuid as vente_id
  ) ids on true
  left join public.ventes v on v.id = ids.vente_id
  group by s.numero
)
update public.stocks s
set sorties = greatest(coalesce(s.sorties, 0), vq.qty)
from vente_qty vq
where s.numero = vq.numero
  and vq.qty > coalesce(s.sorties, 0);

notify pgrst, 'reload schema';

commit;

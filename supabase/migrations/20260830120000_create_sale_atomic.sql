-- Atomic create_sale for Ashy backend (Phase 3.8).
-- Mirrors n8n vente + stock gate + stocks.sorties update in one transaction.

begin;

create or replace function public.create_sale_atomic(
  p_client_id uuid,
  p_product text,
  p_quantity numeric,
  p_unit_price numeric,
  p_amount_paid numeric
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_produit_id uuid;
  v_produit_nom text;
  v_stock_numero integer;
  v_dispo numeric;
  v_sorties numeric;
  v_total numeric;
  v_paye numeric;
  v_vente_id uuid;
  v_seuil numeric;
  v_remaining numeric;
begin
  if p_client_id is null then
    raise exception 'client_id required';
  end if;

  v_produit_nom := trim(coalesce(p_product, ''));
  if v_produit_nom = '' then
    raise exception 'product required';
  end if;

  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'quantity must be positive';
  end if;

  if coalesce(p_unit_price, 0) <= 0 then
    raise exception 'unit_price must be positive';
  end if;

  if p_amount_paid is null then
    raise exception 'amount_paid required';
  end if;

  if not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception 'client not found';
  end if;

  v_produit_id := public.resolve_produit_id(p_client_id, v_produit_nom, null);
  if v_produit_id is null then
    raise exception 'vente product not found: %', v_produit_nom;
  end if;

  select coalesce(s.entrees, 0) - coalesce(s.sorties, 0), s.numero, coalesce(s.seuil_alerte, 0)
  into v_dispo, v_stock_numero, v_seuil
  from public.stocks s
  where s.client_id = p_client_id
    and (s.produit_id = v_produit_id or lower(trim(s.nom_article)) = lower(trim(v_produit_nom)))
  order by s.created_at desc nulls last
  limit 1;

  if v_stock_numero is null or coalesce(v_dispo, 0) < p_quantity then
    raise exception 'stock insuffisant pour vente % (% < %)', v_produit_nom, coalesce(v_dispo, 0), p_quantity;
  end if;

  v_total := p_quantity * p_unit_price;
  v_paye := coalesce(p_amount_paid, 0);
  if v_paye > v_total then
    v_paye := v_total;
  end if;

  insert into public.ventes (client_id, libelle, quantite, prix_unitaire, montant_paye, date, statut, produit_id)
  values (
    p_client_id,
    v_produit_nom,
    p_quantity,
    p_unit_price,
    v_paye,
    now(),
    case
      when v_paye <= 0 then 'Impayé'
      when v_paye < v_total then 'Partiel'
      else 'Payé'
    end,
    v_produit_id
  )
  returning id into v_vente_id;

  select coalesce(s.sorties, 0), coalesce(s.seuil_alerte, 0)
  into v_sorties, v_seuil
  from public.stocks s
  where s.numero = v_stock_numero;

  if v_seuil <= 0 then
    v_seuil := 5;
  end if;

  update public.stocks s
  set sorties = coalesce(v_sorties, 0) + p_quantity,
      vente_ids = coalesce(s.vente_ids, '[]'::jsonb) || to_jsonb(v_vente_id::text)
  where s.numero = v_stock_numero;

  v_remaining := coalesce(v_dispo, 0) - p_quantity;

  return jsonb_build_object(
    'ok', true,
    'saleId', v_vente_id,
    'product', v_produit_nom,
    'productId', v_produit_id,
    'quantity', p_quantity,
    'unitPrice', p_unit_price,
    'amountPaid', v_paye,
    'total', v_total,
    'stockNumero', v_stock_numero,
    'stockRemaining', v_remaining,
    'stockThreshold', v_seuil
  );
exception
  when others then
    raise;
end;
$$;

commit;

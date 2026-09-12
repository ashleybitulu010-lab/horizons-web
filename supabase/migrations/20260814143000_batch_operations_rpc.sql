-- Atomic multi-operation writes for Ashy batch mode (produit → stock → vente → depense).

begin;

create or replace function public.execute_batch_operations(
  p_client_id uuid,
  p_operations jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  op jsonb;
  op_kind text;
  op_action text;
  v_produit_id uuid;
  v_produit_nom text;
  v_stock_numero integer;
  v_vente_id uuid;
  v_entrees numeric;
  v_sorties numeric;
  v_qte numeric;
  v_pu numeric;
  v_mp numeric;
  v_total numeric;
  v_results jsonb := '[]'::jsonb;
begin
  if p_client_id is null then
    raise exception 'client_id required';
  end if;
  if p_operations is null or jsonb_typeof(p_operations) <> 'array' or jsonb_array_length(p_operations) = 0 then
    raise exception 'operations array required';
  end if;

  if not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception 'client not found';
  end if;

  for op in select value from jsonb_array_elements(p_operations) loop
    op_kind := lower(coalesce(op->>'kind', op->>'intention', ''));
    op_action := lower(coalesce(op->>'action', 'ajouter'));

    if op_kind = 'produit' and op_action in ('ajouter', 'create', '') then
      v_produit_nom := trim(coalesce(op->>'nom', op->>'produit', ''));
      if v_produit_nom = '' then
        raise exception 'produit.nom required';
      end if;
      if coalesce((op->>'prix_achat')::numeric, 0) <= 0 or coalesce((op->>'prix_vente')::numeric, 0) <= 0 then
        raise exception 'produit prices required for %', v_produit_nom;
      end if;

      v_produit_id := public.resolve_produit_id(p_client_id, v_produit_nom, null);
      if v_produit_id is null then
        insert into public.produits (client_id, nom_produit, categorie, prix_achat_unitaire, prix_vente_unitaire)
        values (
          p_client_id,
          v_produit_nom,
          nullif(trim(coalesce(op->>'categorie', '')), ''),
          (op->>'prix_achat')::numeric,
          (op->>'prix_vente')::numeric
        )
        returning id into v_produit_id;
      end if;

      v_results := v_results || jsonb_build_array(jsonb_build_object('kind', 'produit', 'id', v_produit_id, 'nom', v_produit_nom));

    elsif op_kind = 'stock' and op_action in ('ajouter', 'add', '') then
      v_produit_nom := trim(coalesce(op->>'produit', op->>'nom', ''));
      v_qte := coalesce((op->>'quantite')::numeric, 0);
      if v_produit_nom = '' or v_qte <= 0 then
        raise exception 'stock.produit and stock.quantite required';
      end if;

      v_produit_id := public.resolve_produit_id(p_client_id, v_produit_nom, null);
      if v_produit_id is null then
        raise exception 'stock product not found: %', v_produit_nom;
      end if;

      select s.numero into v_stock_numero
      from public.stocks s
      where s.client_id = p_client_id
        and (
          s.produit_id = v_produit_id
          or lower(trim(s.nom_article)) = lower(trim(v_produit_nom))
        )
      order by s.created_at desc nulls last
      limit 1;

      if v_stock_numero is null then
        insert into public.stocks (client_id, produit_id, nom_article, stock_initial, entrees, sorties, seuil_alerte)
        values (
          p_client_id,
          v_produit_id,
          v_produit_nom,
          0,
          v_qte,
          0,
          nullif((op->>'seuil')::numeric, 0)
        )
        returning numero into v_stock_numero;
      else
        update public.stocks s
        set entrees = coalesce(s.entrees, 0) + v_qte,
            nom_article = coalesce(nullif(trim(s.nom_article), ''), v_produit_nom),
            produit_id = coalesce(s.produit_id, v_produit_id)
        where s.numero = v_stock_numero;
      end if;

      v_results := v_results || jsonb_build_array(jsonb_build_object('kind', 'stock', 'numero', v_stock_numero, 'produit', v_produit_nom, 'quantite', v_qte));

    elsif op_kind = 'vente' and op_action in ('ajouter', 'create', '') then
      v_produit_nom := trim(coalesce(op->>'produit', op->>'nom', ''));
      v_qte := coalesce((op->>'quantite')::numeric, 0);
      v_pu := coalesce((op->>'prix_unitaire')::numeric, 0);
      v_mp := coalesce((op->>'montant_paye')::numeric, 0);
      if v_produit_nom = '' or v_qte <= 0 or v_pu <= 0 then
        raise exception 'vente fields required';
      end if;

      v_produit_id := public.resolve_produit_id(p_client_id, v_produit_nom, null);
      if v_produit_id is null then
        raise exception 'vente product not found: %', v_produit_nom;
      end if;

      select coalesce(s.entrees, 0) - coalesce(s.sorties, 0), s.numero
      into v_entrees, v_stock_numero
      from public.stocks s
      where s.client_id = p_client_id
        and (s.produit_id = v_produit_id or lower(trim(s.nom_article)) = lower(trim(v_produit_nom)))
      order by s.created_at desc nulls last
      limit 1;

      if v_stock_numero is null or coalesce(v_entrees, 0) < v_qte then
        raise exception 'stock insuffisant pour vente % (% < %)', v_produit_nom, coalesce(v_entrees, 0), v_qte;
      end if;

      v_total := v_qte * v_pu;
      if v_mp > v_total then v_mp := v_total; end if;

      insert into public.ventes (client_id, libelle, quantite, prix_unitaire, montant_paye, date, statut, produit_id)
      values (
        p_client_id,
        v_produit_nom,
        v_qte,
        v_pu,
        v_mp,
        now(),
        case
          when v_mp <= 0 then 'Impayé'
          when v_mp < v_total then 'Partiel'
          else 'Payé'
        end,
        v_produit_id
      )
      returning id into v_vente_id;

      select coalesce(s.sorties, 0) into v_sorties from public.stocks s where s.numero = v_stock_numero;
      update public.stocks s
      set sorties = coalesce(v_sorties, 0) + v_qte,
          vente_ids = coalesce(s.vente_ids, '[]'::jsonb) || to_jsonb(v_vente_id::text)
      where s.numero = v_stock_numero;

      v_results := v_results || jsonb_build_array(jsonb_build_object('kind', 'vente', 'id', v_vente_id, 'produit', v_produit_nom, 'quantite', v_qte));

    elsif op_kind = 'depense' and op_action in ('ajouter', 'create', '') then
      if coalesce((op->>'montant_total')::numeric, 0) <= 0 then
        raise exception 'depense.montant_total required';
      end if;
      if trim(coalesce(op->>'libelle', '')) = '' then
        raise exception 'depense.libelle required';
      end if;

      insert into public.depenses (client_id, libelle_depense, type_depense, montant_depense, date)
      values (
        p_client_id,
        trim(op->>'libelle'),
        trim(op->>'libelle'),
        (op->>'montant_total')::numeric,
        now()
      )
      returning id into v_vente_id;

      v_results := v_results || jsonb_build_array(jsonb_build_object('kind', 'depense', 'id', v_vente_id, 'libelle', op->>'libelle'));

    else
      raise exception 'unsupported operation: %/%', op_kind, op_action;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'results', v_results);
exception
  when others then
    raise;
end;
$$;

revoke all on function public.execute_batch_operations(uuid, jsonb) from public;
grant execute on function public.execute_batch_operations(uuid, jsonb) to service_role;

commit;

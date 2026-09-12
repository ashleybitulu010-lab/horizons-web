-- Phase 5.8-F4-B1 — Atomic pending confirmation + business write.
-- Keeps consume_agent_pending, create_expense_atomic, create_sale_atomic unchanged.
-- Business logic is inlined (not nested RPC calls) to preserve a single PostgreSQL transaction.

begin;

-- ---------------------------------------------------------------------------
-- confirm_and_create_expense — lock pending, validate, insert depense, consume
-- ---------------------------------------------------------------------------
create or replace function public.confirm_and_create_expense(
  p_client_id uuid,
  p_expected_version bigint default null,
  p_consume_token text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_payload jsonb;
  v_version bigint;
  v_pending jsonb;
  v_tool text;
  v_label text;
  v_amount numeric;
  v_expense_id uuid;
begin
  if p_client_id is null then
    raise exception 'client_id required';
  end if;

  if p_expected_version is null and (p_consume_token is null or length(trim(p_consume_token)) = 0) then
    raise exception 'expected_version or consume_token required';
  end if;

  if not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception 'client not found';
  end if;

  select s.id, s.payload, s.state_version
  into v_session_id, v_payload, v_version
  from public.agent_sessions s
  where s.client_id = p_client_id
    and s.state_type = 'pending'
  for update;

  if v_session_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 'ALREADY_CONSUMED',
      'operation', 'create_expense',
      'pending_consumed', false
    );
  end if;

  if not (
    (p_expected_version is not null and v_version = p_expected_version)
    or (
      p_consume_token is not null
      and length(trim(p_consume_token)) > 0
      and v_payload->>'consumeToken' = p_consume_token
    )
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 'VERSION_MISMATCH',
      'operation', 'create_expense',
      'pending_consumed', false
    );
  end if;

  v_pending := v_payload->'pendingWrite';
  if v_pending is null or jsonb_typeof(v_pending) <> 'object' then
    raise exception 'pendingWrite missing or invalid';
  end if;

  v_tool := v_pending->>'tool';
  if v_tool is distinct from 'create_expense' then
    raise exception 'pending tool mismatch: expected create_expense, got %', coalesce(v_tool, 'null');
  end if;

  v_label := trim(coalesce(v_pending->>'label', ''));
  if v_label = '' then
    raise exception 'label required';
  end if;

  v_amount := (v_pending->>'amount')::numeric;
  if coalesce(v_amount, 0) <= 0 then
    raise exception 'amount must be positive';
  end if;

  insert into public.depenses (client_id, libelle_depense, type_depense, montant_depense, date)
  values (
    p_client_id,
    v_label,
    v_label,
    v_amount,
    now()
  )
  returning id into v_expense_id;

  delete from public.agent_sessions
  where id = v_session_id;

  return jsonb_build_object(
    'success', true,
    'status', 'COMMITTED',
    'operation', 'create_expense',
    'result_id', v_expense_id,
    'pending_consumed', true,
    'label', v_label,
    'amount', v_amount
  );
exception
  when others then
    raise;
end;
$$;

comment on function public.confirm_and_create_expense(uuid, bigint, text) is
  'F4-B1: atomically consume pending confirmation and create expense. Rolls back on business failure.';

revoke all on function public.confirm_and_create_expense(uuid, bigint, text) from public;
revoke all on function public.confirm_and_create_expense(uuid, bigint, text) from authenticated;
revoke all on function public.confirm_and_create_expense(uuid, bigint, text) from anon;
grant execute on function public.confirm_and_create_expense(uuid, bigint, text) to service_role;

-- ---------------------------------------------------------------------------
-- confirm_and_create_sale — lock pending, validate, insert vente + stock, consume
-- ---------------------------------------------------------------------------
create or replace function public.confirm_and_create_sale(
  p_client_id uuid,
  p_expected_version bigint default null,
  p_consume_token text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_payload jsonb;
  v_version bigint;
  v_pending jsonb;
  v_tool text;
  v_produit_nom text;
  v_quantity numeric;
  v_unit_price numeric;
  v_amount_paid numeric;
  v_produit_id uuid;
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

  if p_expected_version is null and (p_consume_token is null or length(trim(p_consume_token)) = 0) then
    raise exception 'expected_version or consume_token required';
  end if;

  if not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception 'client not found';
  end if;

  select s.id, s.payload, s.state_version
  into v_session_id, v_payload, v_version
  from public.agent_sessions s
  where s.client_id = p_client_id
    and s.state_type = 'pending'
  for update;

  if v_session_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 'ALREADY_CONSUMED',
      'operation', 'create_sale',
      'pending_consumed', false
    );
  end if;

  if not (
    (p_expected_version is not null and v_version = p_expected_version)
    or (
      p_consume_token is not null
      and length(trim(p_consume_token)) > 0
      and v_payload->>'consumeToken' = p_consume_token
    )
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 'VERSION_MISMATCH',
      'operation', 'create_sale',
      'pending_consumed', false
    );
  end if;

  v_pending := v_payload->'pendingWrite';
  if v_pending is null or jsonb_typeof(v_pending) <> 'object' then
    raise exception 'pendingWrite missing or invalid';
  end if;

  v_tool := v_pending->>'tool';
  if v_tool is distinct from 'create_sale' then
    raise exception 'pending tool mismatch: expected create_sale, got %', coalesce(v_tool, 'null');
  end if;

  v_produit_nom := trim(coalesce(v_pending->>'product', ''));
  if v_produit_nom = '' then
    raise exception 'product required';
  end if;

  v_quantity := (v_pending->>'quantity')::numeric;
  if coalesce(v_quantity, 0) <= 0 then
    raise exception 'quantity must be positive';
  end if;

  v_unit_price := (v_pending->>'unitPrice')::numeric;
  if coalesce(v_unit_price, 0) <= 0 then
    raise exception 'unit_price must be positive';
  end if;

  if v_pending->>'amountPaid' is null then
    raise exception 'amount_paid required';
  end if;
  v_amount_paid := (v_pending->>'amountPaid')::numeric;

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

  if v_stock_numero is null or coalesce(v_dispo, 0) < v_quantity then
    raise exception 'stock insuffisant pour vente % (% < %)', v_produit_nom, coalesce(v_dispo, 0), v_quantity;
  end if;

  v_total := v_quantity * v_unit_price;
  v_paye := coalesce(v_amount_paid, 0);
  if v_paye > v_total then
    v_paye := v_total;
  end if;

  insert into public.ventes (client_id, libelle, quantite, prix_unitaire, montant_paye, date, statut, produit_id)
  values (
    p_client_id,
    v_produit_nom,
    v_quantity,
    v_unit_price,
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
  set sorties = coalesce(v_sorties, 0) + v_quantity,
      vente_ids = coalesce(s.vente_ids, '[]'::jsonb) || to_jsonb(v_vente_id::text)
  where s.numero = v_stock_numero;

  v_remaining := coalesce(v_dispo, 0) - v_quantity;

  delete from public.agent_sessions
  where id = v_session_id;

  return jsonb_build_object(
    'success', true,
    'status', 'COMMITTED',
    'operation', 'create_sale',
    'result_id', v_vente_id,
    'pending_consumed', true,
    'product', v_produit_nom,
    'productId', v_produit_id,
    'quantity', v_quantity,
    'unitPrice', v_unit_price,
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

comment on function public.confirm_and_create_sale(uuid, bigint, text) is
  'F4-B1: atomically consume pending confirmation and create sale. Rolls back on business failure.';

revoke all on function public.confirm_and_create_sale(uuid, bigint, text) from public;
revoke all on function public.confirm_and_create_sale(uuid, bigint, text) from authenticated;
revoke all on function public.confirm_and_create_sale(uuid, bigint, text) from anon;
grant execute on function public.confirm_and_create_sale(uuid, bigint, text) to service_role;

notify pgrst, 'reload schema';

commit;

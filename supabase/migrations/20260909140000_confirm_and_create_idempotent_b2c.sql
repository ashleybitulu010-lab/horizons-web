-- Phase 5.8-F4-B2-C — Durable idempotency for confirm_and_create_* RPCs.
-- Extends F4-B1 RPCs with optional operation_id + request_hash (agent_write_operations).
-- When p_operation_id IS NULL: F4-B1 behavior unchanged (no ledger).
-- When p_operation_id IS NOT NULL: claim/replay via agent_write_operations in same transaction.

begin;

-- ---------------------------------------------------------------------------
-- claim_or_replay_agent_write_operation — NULL = proceed; jsonb = early return
-- ---------------------------------------------------------------------------
create or replace function public.claim_or_replay_agent_write_operation(
  p_client_id uuid,
  p_operation_id uuid,
  p_request_hash text,
  p_tool text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_op public.agent_write_operations%rowtype;
begin
  if p_operation_id is null then
    return null;
  end if;

  if p_request_hash is null or length(trim(p_request_hash)) = 0 then
    raise exception 'request_hash required with operation_id';
  end if;

  insert into public.agent_write_operations (
    operation_id,
    client_id,
    tool,
    status,
    request_hash,
    attempt_count
  )
  values (
    p_operation_id,
    p_client_id,
    p_tool,
    'processing',
    p_request_hash,
    1
  )
  on conflict (client_id, operation_id) do nothing;

  select *
  into v_op
  from public.agent_write_operations o
  where o.client_id = p_client_id
    and o.operation_id = p_operation_id
  for update;

  if v_op.status = 'completed' then
    if v_op.request_hash = p_request_hash then
      if p_tool = 'create_expense' then
        return jsonb_build_object(
          'success', true,
          'status', 'ALREADY_COMPLETED',
          'operation', 'create_expense',
          'result_id', v_op.result_id,
          'pending_consumed', true,
          'label', v_op.metadata->>'label',
          'amount', (v_op.metadata->>'amount')::numeric
        );
      end if;

      if p_tool = 'create_sale' then
        return jsonb_build_object(
          'success', true,
          'status', 'ALREADY_COMPLETED',
          'operation', 'create_sale',
          'result_id', v_op.result_id,
          'pending_consumed', true,
          'product', v_op.metadata->>'product',
          'productId', nullif(v_op.metadata->>'productId', '')::uuid,
          'quantity', (v_op.metadata->>'quantity')::numeric,
          'unitPrice', (v_op.metadata->>'unitPrice')::numeric,
          'amountPaid', (v_op.metadata->>'amountPaid')::numeric,
          'total', (v_op.metadata->>'total')::numeric,
          'stockNumero', (v_op.metadata->>'stockNumero')::integer,
          'stockRemaining', (v_op.metadata->>'stockRemaining')::numeric,
          'stockThreshold', (v_op.metadata->>'stockThreshold')::numeric
        );
      end if;

      return jsonb_build_object(
        'success', true,
        'status', 'ALREADY_COMPLETED',
        'operation', p_tool,
        'result_id', v_op.result_id,
        'pending_consumed', true
      );
    end if;

    return jsonb_build_object(
      'success', false,
      'status', 'REQUEST_HASH_MISMATCH',
      'operation', p_tool,
      'pending_consumed', false
    );
  end if;

  if v_op.request_hash <> p_request_hash then
    return jsonb_build_object(
      'success', false,
      'status', 'REQUEST_HASH_MISMATCH',
      'operation', p_tool,
      'pending_consumed', false
    );
  end if;

  update public.agent_write_operations
  set attempt_count = v_op.attempt_count + 1
  where id = v_op.id;

  return null;
end;
$$;

comment on function public.claim_or_replay_agent_write_operation(uuid, uuid, text, text) is
  'F4-B2-C: reserve or replay agent_write_operations row. NULL = caller proceeds with business write.';

revoke all on function public.claim_or_replay_agent_write_operation(uuid, uuid, text, text) from public;
revoke all on function public.claim_or_replay_agent_write_operation(uuid, uuid, text, text) from authenticated;
revoke all on function public.claim_or_replay_agent_write_operation(uuid, uuid, text, text) from anon;
grant execute on function public.claim_or_replay_agent_write_operation(uuid, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- confirm_and_create_expense — F4-B1 + optional B2-C idempotency
-- ---------------------------------------------------------------------------
drop function if exists public.confirm_and_create_expense(uuid, bigint, text);

create or replace function public.confirm_and_create_expense(
  p_client_id uuid,
  p_expected_version bigint default null,
  p_consume_token text default null,
  p_operation_id uuid default null,
  p_request_hash text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_idempotency jsonb;
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

  v_idempotency := public.claim_or_replay_agent_write_operation(
    p_client_id,
    p_operation_id,
    p_request_hash,
    'create_expense'
  );
  if v_idempotency is not null then
    return v_idempotency;
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

  if p_operation_id is not null then
    update public.agent_write_operations
    set
      status = 'completed',
      result_id = v_expense_id,
      completed_at = now(),
      metadata = jsonb_build_object(
        'label', v_label,
        'amount', v_amount
      )
    where client_id = p_client_id
      and operation_id = p_operation_id;
  end if;

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

comment on function public.confirm_and_create_expense(uuid, bigint, text, uuid, text) is
  'F4-B1 + B2-C: atomically consume pending and create expense; optional durable idempotency ledger.';

revoke all on function public.confirm_and_create_expense(uuid, bigint, text, uuid, text) from public;
revoke all on function public.confirm_and_create_expense(uuid, bigint, text, uuid, text) from authenticated;
revoke all on function public.confirm_and_create_expense(uuid, bigint, text, uuid, text) from anon;
grant execute on function public.confirm_and_create_expense(uuid, bigint, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- confirm_and_create_sale — F4-B1 + optional B2-C idempotency
-- ---------------------------------------------------------------------------
drop function if exists public.confirm_and_create_sale(uuid, bigint, text);

create or replace function public.confirm_and_create_sale(
  p_client_id uuid,
  p_expected_version bigint default null,
  p_consume_token text default null,
  p_operation_id uuid default null,
  p_request_hash text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_idempotency jsonb;
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

  v_idempotency := public.claim_or_replay_agent_write_operation(
    p_client_id,
    p_operation_id,
    p_request_hash,
    'create_sale'
  );
  if v_idempotency is not null then
    return v_idempotency;
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

  if p_operation_id is not null then
    update public.agent_write_operations
    set
      status = 'completed',
      result_id = v_vente_id,
      completed_at = now(),
      metadata = jsonb_build_object(
        'product', v_produit_nom,
        'productId', v_produit_id,
        'quantity', v_quantity,
        'unitPrice', v_unit_price,
        'amountPaid', v_paye,
        'total', v_total,
        'stockNumero', v_stock_numero,
        'stockRemaining', v_remaining,
        'stockThreshold', v_seuil
      )
    where client_id = p_client_id
      and operation_id = p_operation_id;
  end if;

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

comment on function public.confirm_and_create_sale(uuid, bigint, text, uuid, text) is
  'F4-B1 + B2-C: atomically consume pending and create sale; optional durable idempotency ledger.';

revoke all on function public.confirm_and_create_sale(uuid, bigint, text, uuid, text) from public;
revoke all on function public.confirm_and_create_sale(uuid, bigint, text, uuid, text) from authenticated;
revoke all on function public.confirm_and_create_sale(uuid, bigint, text, uuid, text) from anon;
grant execute on function public.confirm_and_create_sale(uuid, bigint, text, uuid, text) to service_role;

notify pgrst, 'reload schema';

commit;

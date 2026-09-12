-- P1-D — Activity scope backend: agent_sessions isolation + activity-aware RPCs + RLS helper.
-- Requires P1-B (activities) and P1-C (business table activity_id) applied.

begin;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.ash_resolve_default_activity(p_client_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.id
  from public.activities a
  where a.client_id = p_client_id
    and a.is_default = true
  limit 1;
$$;

create or replace function public.ash_validate_activity_for_client(
  p_client_id uuid,
  p_activity_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_client_id is null then
    raise exception 'client_id required';
  end if;
  if p_activity_id is null then
    raise exception 'activity_id required';
  end if;
  if not exists (
    select 1 from public.activities a
    where a.id = p_activity_id and a.client_id = p_client_id
  ) then
    raise exception 'activity does not belong to client';
  end if;
end;
$$;

create or replace function public.resolve_produit_id_for_activity(
  p_client_id uuid,
  p_activity_id uuid,
  p_label text,
  p_existing uuid default null
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  matched uuid;
begin
  if p_existing is not null then
    return p_existing;
  end if;
  perform public.ash_validate_activity_for_client(p_client_id, p_activity_id);

  if p_label is not null and trim(p_label) <> '' then
    select p.id into matched
    from public.produits p
    where p.client_id = p_client_id
      and p.activity_id = p_activity_id
      and (
        lower(trim(p.nom_produit)) = lower(trim(p_label))
        or lower(trim(p_label)) like '%' || lower(trim(p.nom_produit)) || '%'
        or lower(trim(p.nom_produit)) like '%' || lower(trim(p_label)) || '%'
      )
    order by p.created_at desc nulls last
    limit 1;
    if matched is not null then
      return matched;
    end if;
  end if;

  if (
    select count(*) from public.produits p
    where p.client_id = p_client_id and p.activity_id = p_activity_id
  ) = 1 then
    select p.id into matched
    from public.produits p
    where p.client_id = p_client_id and p.activity_id = p_activity_id
    limit 1;
  end if;

  return matched;
end;
$$;

create or replace function public.ash_owns_activity(p_activity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.activities a
    join public.clients c on c.id = a.client_id
    where a.id = p_activity_id
      and (
        c.user_id = auth.uid()::text
        or c.auth_user_id = auth.uid()
      )
  );
$$;

revoke all on function public.ash_resolve_default_activity(uuid) from public, anon, authenticated;
grant execute on function public.ash_resolve_default_activity(uuid) to service_role;

revoke all on function public.ash_validate_activity_for_client(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ash_validate_activity_for_client(uuid, uuid) to service_role;

revoke all on function public.resolve_produit_id_for_activity(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.resolve_produit_id_for_activity(uuid, uuid, text, uuid) to service_role;

revoke all on function public.ash_owns_activity(uuid) from public, anon, authenticated;
grant execute on function public.ash_owns_activity(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- agent_sessions — activity-scoped unique key
-- ---------------------------------------------------------------------------
alter table public.agent_sessions
  add column if not exists activity_id uuid;

update public.agent_sessions s
set activity_id = a.id
from public.activities a
where s.activity_id is null
  and a.client_id = s.client_id
  and a.is_default = true;

alter table public.agent_sessions
  alter column activity_id set not null;

alter table public.agent_sessions
  drop constraint if exists agent_sessions_client_state_uidx;

alter table public.agent_sessions
  add constraint agent_sessions_client_activity_state_uidx
  unique (client_id, activity_id, state_type);

alter table public.agent_sessions
  drop constraint if exists agent_sessions_activity_client_fkey;

alter table public.agent_sessions
  add constraint agent_sessions_activity_client_fkey
  foreign key (client_id, activity_id)
  references public.activities (client_id, id)
  on delete restrict;

create index if not exists agent_sessions_client_activity_idx
  on public.agent_sessions (client_id, activity_id);

-- ---------------------------------------------------------------------------
-- mirror_agent_sessions_atomic — activity-scoped
-- ---------------------------------------------------------------------------
drop function if exists public.mirror_agent_sessions_atomic(uuid, jsonb, jsonb, text, text, bigint);

create or replace function public.mirror_agent_sessions_atomic(
  p_client_id uuid,
  p_activity_id uuid,
  p_draft_payload jsonb,
  p_pending_payload jsonb default null,
  p_pending_awaiting text default null,
  p_pending_intention text default null,
  p_clear_pending_version bigint default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_activity_id uuid;
  v_draft_version bigint;
  v_pending_version bigint;
  v_deleted integer := 0;
begin
  if p_client_id is null then
    raise exception 'client_id required';
  end if;

  v_activity_id := coalesce(p_activity_id, public.ash_resolve_default_activity(p_client_id));
  perform public.ash_validate_activity_for_client(p_client_id, v_activity_id);

  if p_draft_payload is null or jsonb_typeof(p_draft_payload) <> 'object' then
    raise exception 'draft payload must be a json object';
  end if;

  insert into public.agent_sessions as s (
    client_id, activity_id, state_type, payload, intention, awaiting, state_version
  )
  values (
    p_client_id, v_activity_id, 'draft', p_draft_payload, null, null, 1
  )
  on conflict (client_id, activity_id, state_type) do update
    set payload = excluded.payload,
        state_version = s.state_version + 1,
        updated_at = now()
  returning state_version into v_draft_version;

  if p_pending_payload is not null then
    if jsonb_typeof(p_pending_payload) <> 'object' then
      raise exception 'pending payload must be a json object';
    end if;

    insert into public.agent_sessions as s (
      client_id, activity_id, state_type, payload, intention, awaiting, state_version
    )
    values (
      p_client_id, v_activity_id, 'pending', p_pending_payload,
      p_pending_intention, p_pending_awaiting, 1
    )
    on conflict (client_id, activity_id, state_type) do update
      set payload = excluded.payload,
          intention = excluded.intention,
          awaiting = excluded.awaiting,
          state_version = s.state_version + 1,
          updated_at = now()
    returning state_version into v_pending_version;
  else
    if p_clear_pending_version is not null then
      delete from public.agent_sessions
      where client_id = p_client_id
        and activity_id = v_activity_id
        and state_type = 'pending'
        and state_version = p_clear_pending_version;
      get diagnostics v_deleted = row_count;
    else
      delete from public.agent_sessions
      where client_id = p_client_id
        and activity_id = v_activity_id
        and state_type = 'pending';
      get diagnostics v_deleted = row_count;
    end if;
    v_pending_version := null;
  end if;

  return jsonb_build_object(
    'draftVersion', v_draft_version,
    'pendingVersion', v_pending_version,
    'pendingCleared', v_deleted,
    'activityId', v_activity_id
  );
end;
$$;

revoke all on function public.mirror_agent_sessions_atomic(uuid, uuid, jsonb, jsonb, text, text, bigint) from public, anon, authenticated;
grant execute on function public.mirror_agent_sessions_atomic(uuid, uuid, jsonb, jsonb, text, text, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- consume_agent_pending — activity-scoped
-- ---------------------------------------------------------------------------
drop function if exists public.consume_agent_pending(uuid, bigint, text);

create or replace function public.consume_agent_pending(
  p_client_id uuid,
  p_activity_id uuid,
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
  v_activity_id uuid;
  v_payload jsonb;
  v_intention text;
  v_version bigint;
begin
  if p_client_id is null then
    raise exception 'client_id required';
  end if;

  v_activity_id := coalesce(p_activity_id, public.ash_resolve_default_activity(p_client_id));
  perform public.ash_validate_activity_for_client(p_client_id, v_activity_id);

  if p_expected_version is null and (p_consume_token is null or length(trim(p_consume_token)) = 0) then
    raise exception 'expected_version or consume_token required';
  end if;

  delete from public.agent_sessions
  where client_id = p_client_id
    and activity_id = v_activity_id
    and state_type = 'pending'
    and (
      (p_expected_version is not null and state_version = p_expected_version)
      or (
        p_consume_token is not null
        and length(trim(p_consume_token)) > 0
        and payload->>'consumeToken' = p_consume_token
      )
    )
  returning payload, intention, state_version
  into v_payload, v_intention, v_version;

  if found then
    return jsonb_build_object(
      'status', 'CONSUMED',
      'payload', v_payload,
      'intention', v_intention,
      'version', v_version,
      'activityId', v_activity_id
    );
  end if;

  if exists (
    select 1 from public.agent_sessions
    where client_id = p_client_id
      and activity_id = v_activity_id
      and state_type = 'pending'
  ) then
    return jsonb_build_object('status', 'VERSION_MISMATCH', 'activityId', v_activity_id);
  end if;

  return jsonb_build_object('status', 'ALREADY_CONSUMED', 'activityId', v_activity_id);
end;
$$;

revoke all on function public.consume_agent_pending(uuid, uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.consume_agent_pending(uuid, uuid, bigint, text) to service_role;

-- ---------------------------------------------------------------------------
-- create_expense_atomic — activity-scoped insert
-- ---------------------------------------------------------------------------
drop function if exists public.create_expense_atomic(uuid, text, numeric);

create or replace function public.create_expense_atomic(
  p_client_id uuid,
  p_activity_id uuid,
  p_label text,
  p_amount numeric
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_activity_id uuid;
  v_label text;
  v_expense_id uuid;
begin
  if p_client_id is null then
    raise exception 'client_id required';
  end if;

  v_activity_id := coalesce(p_activity_id, public.ash_resolve_default_activity(p_client_id));
  perform public.ash_validate_activity_for_client(p_client_id, v_activity_id);

  v_label := trim(coalesce(p_label, ''));
  if v_label = '' then
    raise exception 'label required';
  end if;

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'amount must be positive';
  end if;

  insert into public.depenses (client_id, activity_id, libelle_depense, type_depense, montant_depense, date)
  values (p_client_id, v_activity_id, v_label, v_label, p_amount, now())
  returning id into v_expense_id;

  return jsonb_build_object(
    'ok', true,
    'expenseId', v_expense_id,
    'label', v_label,
    'amount', p_amount,
    'activityId', v_activity_id
  );
end;
$$;

revoke all on function public.create_expense_atomic(uuid, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.create_expense_atomic(uuid, uuid, text, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- create_sale_atomic — activity-scoped product/stock/vente
-- ---------------------------------------------------------------------------
drop function if exists public.create_sale_atomic(uuid, text, numeric, numeric, numeric);

create or replace function public.create_sale_atomic(
  p_client_id uuid,
  p_activity_id uuid,
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
  v_activity_id uuid;
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

  v_activity_id := coalesce(p_activity_id, public.ash_resolve_default_activity(p_client_id));
  perform public.ash_validate_activity_for_client(p_client_id, v_activity_id);

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

  v_produit_id := public.resolve_produit_id_for_activity(p_client_id, v_activity_id, v_produit_nom, null);
  if v_produit_id is null then
    raise exception 'vente product not found: %', v_produit_nom;
  end if;

  select coalesce(s.entrees, 0) - coalesce(s.sorties, 0), s.numero, coalesce(s.seuil_alerte, 0)
  into v_dispo, v_stock_numero, v_seuil
  from public.stocks s
  where s.client_id = p_client_id
    and s.activity_id = v_activity_id
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

  insert into public.ventes (client_id, activity_id, libelle, quantite, prix_unitaire, montant_paye, date, statut, produit_id)
  values (
    p_client_id, v_activity_id, v_produit_nom, p_quantity, p_unit_price, v_paye, now(),
    case when v_paye <= 0 then 'Impayé' when v_paye < v_total then 'Partiel' else 'Payé' end,
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
    'stockThreshold', v_seuil,
    'activityId', v_activity_id
  );
end;
$$;

revoke all on function public.create_sale_atomic(uuid, uuid, text, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.create_sale_atomic(uuid, uuid, text, numeric, numeric, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- confirm_and_create_expense — activity-scoped pending + depense
-- ---------------------------------------------------------------------------
drop function if exists public.confirm_and_create_expense(uuid, bigint, text, uuid, text);

create or replace function public.confirm_and_create_expense(
  p_client_id uuid,
  p_activity_id uuid,
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
  v_activity_id uuid;
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

  v_activity_id := coalesce(p_activity_id, public.ash_resolve_default_activity(p_client_id));
  perform public.ash_validate_activity_for_client(p_client_id, v_activity_id);

  if p_expected_version is null and (p_consume_token is null or length(trim(p_consume_token)) = 0) then
    raise exception 'expected_version or consume_token required';
  end if;

  v_idempotency := public.claim_or_replay_agent_write_operation(
    p_client_id, p_operation_id, p_request_hash, 'create_expense'
  );
  if v_idempotency is not null then
    return v_idempotency;
  end if;

  select s.id, s.payload, s.state_version
  into v_session_id, v_payload, v_version
  from public.agent_sessions s
  where s.client_id = p_client_id
    and s.activity_id = v_activity_id
    and s.state_type = 'pending'
  for update;

  if v_session_id is null then
    return jsonb_build_object(
      'success', false, 'status', 'ALREADY_CONSUMED',
      'operation', 'create_expense', 'pending_consumed', false
    );
  end if;

  if not (
    (p_expected_version is not null and v_version = p_expected_version)
    or (
      p_consume_token is not null and length(trim(p_consume_token)) > 0
      and v_payload->>'consumeToken' = p_consume_token
    )
  ) then
    return jsonb_build_object(
      'success', false, 'status', 'VERSION_MISMATCH',
      'operation', 'create_expense', 'pending_consumed', false
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

  insert into public.depenses (client_id, activity_id, libelle_depense, type_depense, montant_depense, date)
  values (p_client_id, v_activity_id, v_label, v_label, v_amount, now())
  returning id into v_expense_id;

  if p_operation_id is not null then
    update public.agent_write_operations
    set status = 'completed', result_id = v_expense_id, completed_at = now(),
        metadata = jsonb_build_object('label', v_label, 'amount', v_amount)
    where client_id = p_client_id and operation_id = p_operation_id;
  end if;

  delete from public.agent_sessions where id = v_session_id;

  return jsonb_build_object(
    'success', true, 'status', 'COMMITTED', 'operation', 'create_expense',
    'result_id', v_expense_id, 'pending_consumed', true,
    'label', v_label, 'amount', v_amount, 'activityId', v_activity_id
  );
end;
$$;

revoke all on function public.confirm_and_create_expense(uuid, uuid, bigint, text, uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_and_create_expense(uuid, uuid, bigint, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- confirm_and_create_sale — activity-scoped pending + vente/stock
-- ---------------------------------------------------------------------------
drop function if exists public.confirm_and_create_sale(uuid, bigint, text, uuid, text);

create or replace function public.confirm_and_create_sale(
  p_client_id uuid,
  p_activity_id uuid,
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
  v_activity_id uuid;
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

  v_activity_id := coalesce(p_activity_id, public.ash_resolve_default_activity(p_client_id));
  perform public.ash_validate_activity_for_client(p_client_id, v_activity_id);

  if p_expected_version is null and (p_consume_token is null or length(trim(p_consume_token)) = 0) then
    raise exception 'expected_version or consume_token required';
  end if;

  v_idempotency := public.claim_or_replay_agent_write_operation(
    p_client_id, p_operation_id, p_request_hash, 'create_sale'
  );
  if v_idempotency is not null then
    return v_idempotency;
  end if;

  select s.id, s.payload, s.state_version
  into v_session_id, v_payload, v_version
  from public.agent_sessions s
  where s.client_id = p_client_id
    and s.activity_id = v_activity_id
    and s.state_type = 'pending'
  for update;

  if v_session_id is null then
    return jsonb_build_object(
      'success', false, 'status', 'ALREADY_CONSUMED',
      'operation', 'create_sale', 'pending_consumed', false
    );
  end if;

  if not (
    (p_expected_version is not null and v_version = p_expected_version)
    or (
      p_consume_token is not null and length(trim(p_consume_token)) > 0
      and v_payload->>'consumeToken' = p_consume_token
    )
  ) then
    return jsonb_build_object(
      'success', false, 'status', 'VERSION_MISMATCH',
      'operation', 'create_sale', 'pending_consumed', false
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

  v_produit_id := public.resolve_produit_id_for_activity(p_client_id, v_activity_id, v_produit_nom, null);
  if v_produit_id is null then
    raise exception 'vente product not found: %', v_produit_nom;
  end if;

  select coalesce(s.entrees, 0) - coalesce(s.sorties, 0), s.numero, coalesce(s.seuil_alerte, 0)
  into v_dispo, v_stock_numero, v_seuil
  from public.stocks s
  where s.client_id = p_client_id
    and s.activity_id = v_activity_id
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

  insert into public.ventes (client_id, activity_id, libelle, quantite, prix_unitaire, montant_paye, date, statut, produit_id)
  values (
    p_client_id, v_activity_id, v_produit_nom, v_quantity, v_unit_price, v_paye, now(),
    case when v_paye <= 0 then 'Impayé' when v_paye < v_total then 'Partiel' else 'Payé' end,
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
    set status = 'completed', result_id = v_vente_id, completed_at = now(),
        metadata = jsonb_build_object(
          'product', v_produit_nom, 'productId', v_produit_id,
          'quantity', v_quantity, 'unitPrice', v_unit_price, 'amountPaid', v_paye,
          'total', v_total, 'stockNumero', v_stock_numero,
          'stockRemaining', v_remaining, 'stockThreshold', v_seuil
        )
    where client_id = p_client_id and operation_id = p_operation_id;
  end if;

  delete from public.agent_sessions where id = v_session_id;

  return jsonb_build_object(
    'success', true, 'status', 'COMMITTED', 'operation', 'create_sale',
    'result_id', v_vente_id, 'pending_consumed', true,
    'product', v_produit_nom, 'productId', v_produit_id,
    'quantity', v_quantity, 'unitPrice', v_unit_price, 'amountPaid', v_paye,
    'total', v_total, 'stockNumero', v_stock_numero,
    'stockRemaining', v_remaining, 'stockThreshold', v_seuil,
    'activityId', v_activity_id
  );
end;
$$;

revoke all on function public.confirm_and_create_sale(uuid, uuid, bigint, text, uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_and_create_sale(uuid, uuid, bigint, text, uuid, text) to service_role;

notify pgrst, 'reload schema';

commit;

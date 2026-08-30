-- Atomic create_expense for Ashy backend (Phase 4.0).
-- Mirrors n8n depense insert in one transaction.

begin;

create or replace function public.create_expense_atomic(
  p_client_id uuid,
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
  v_label text;
  v_expense_id uuid;
begin
  if p_client_id is null then
    raise exception 'client_id required';
  end if;

  v_label := trim(coalesce(p_label, ''));
  if v_label = '' then
    raise exception 'label required';
  end if;

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'amount must be positive';
  end if;

  if not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception 'client not found';
  end if;

  insert into public.depenses (client_id, libelle_depense, type_depense, montant_depense, date)
  values (
    p_client_id,
    v_label,
    v_label,
    p_amount,
    now()
  )
  returning id into v_expense_id;

  return jsonb_build_object(
    'ok', true,
    'expenseId', v_expense_id,
    'label', v_label,
    'amount', p_amount
  );
exception
  when others then
    raise;
end;
$$;

revoke all on function public.create_expense_atomic(uuid, text, numeric) from public;
revoke all on function public.create_expense_atomic(uuid, text, numeric) from anon, authenticated;
grant execute on function public.create_expense_atomic(uuid, text, numeric) to service_role;

commit;

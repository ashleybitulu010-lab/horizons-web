-- =============================================================================
-- Phase 5.8-P0-STAGING-BOOTSTRAP — Minimal schema for P0 harness only
-- =============================================================================
--
-- TARGET: Supabase project "Ash Ledger Staging" (empty database).
-- NEVER run on production project knrwplidgvuvjnuqqmrt.
--
-- Apply order:
--   1. this file
--   2. supabase/migrations/20260904180000_conversation_persistence.sql
--   3. supabase/migrations/20260905120000_agent_sessions_p0_atomic_ops.sql
--
-- NOTE: The repository does not version the original CREATE TABLE for
-- public.clients. Column definitions below are reconstructed from migrations
-- and application code that reference public.clients (see audit report).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- public.clients (minimal tenant table for P0 harness)
-- Sources:
--   - apps/api/tests/agent-session-p0-staging.test.js (insert fields)
--   - apps/api/tests/conversation-persistence.test.js (insert fields)
--   - supabase/functions/dashboard-session/index.ts (insert fields)
--   - supabase/migrations/20260806123000_secure_dashboard_access.sql (auth_user_id)
--   - supabase/migrations/20260807020000_clients_defaults_sync_dettes.sql (defaults)
-- ---------------------------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  nom_client text not null,
  auth_user_id uuid references auth.users(id) on delete set null,
  thread_id text not null default '[]',
  created_at timestamptz not null default now(),
  date_inscription timestamptz,
  date_fin_abonnement timestamptz,
  onboarding_status text,
  onboarding_step integer
);

comment on table public.clients is
  'Ash Ledger tenant row. Staging bootstrap (P0 minimal). Not the full production schema.';

comment on column public.clients.user_id is
  'Business identifier (PocketBase / Airtable id). Used for tenant lookup.';

comment on column public.clients.auth_user_id is
  'Supabase Auth user linked to this tenant (clients.auth_user_id = auth.uid()).';

-- From 20260806123000_secure_dashboard_access.sql
create unique index if not exists clients_auth_user_id_key
  on public.clients (auth_user_id)
  where auth_user_id is not null;

-- From 20260807020000_clients_defaults_sync_dettes.sql (clients section only)
create or replace function public.clients_autofill_defaults()
returns trigger
language plpgsql
as $$
begin
  if new.date_inscription is null then
    new.date_inscription := coalesce(new.created_at, now());
  end if;

  if new.date_fin_abonnement is null then
    new.date_fin_abonnement := new.date_inscription + interval '30 days';
  end if;

  if new.thread_id is null or trim(new.thread_id) = '' then
    new.thread_id := '[]';
  end if;

  if new.nom_client is null or trim(new.nom_client) = '' then
    new.nom_client := 'Client';
  end if;

  if new.onboarding_status is null or trim(new.onboarding_status) = '' then
    new.onboarding_status := 'pending';
  end if;

  if new.onboarding_step is null then
    new.onboarding_step := 0;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_clients_autofill_defaults on public.clients;
create trigger trg_clients_autofill_defaults
before insert or update of date_inscription, date_fin_abonnement, thread_id, nom_client, onboarding_status, onboarding_step
on public.clients
for each row
execute function public.clients_autofill_defaults();

-- ---------------------------------------------------------------------------
-- public.ash_owns_client(uuid)
-- Canonical definition: supabase/migrations/20260807040000_complete_rls_ownership.sql
-- Required by 20260904180000_conversation_persistence.sql (RLS policies).
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

comment on function public.ash_owns_client(uuid) is
  'True when the authenticated Supabase user owns the client row.';

revoke all on function public.ash_owns_client(uuid) from public;
grant execute on function public.ash_owns_client(uuid) to authenticated;

-- P0 harness uses service_role for insert/delete on clients during tests.
grant all on table public.clients to service_role;

notify pgrst, 'reload schema';

commit;

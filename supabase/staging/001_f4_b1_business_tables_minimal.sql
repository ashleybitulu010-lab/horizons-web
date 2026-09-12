-- Phase 5.8-F4-B1-STAGING — Minimal business tables for transactional confirm harness.
-- TARGET: Supabase staging vwjkktqcmmhotadicbpg ONLY.
-- Apply before 20260908120000_confirm_and_create_transactional.sql if tables are absent.

begin;

create table if not exists public.produits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  nom_produit text not null,
  categorie text,
  prix_achat_unitaire numeric default 0,
  prix_vente_unitaire numeric default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.stocks (
  numero serial primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  produit_id uuid references public.produits(id) on delete set null,
  nom_article text not null,
  stock_initial numeric default 0,
  entrees numeric default 0,
  sorties numeric default 0,
  stock_actuel numeric,
  seuil_alerte numeric default 5,
  vente_ids jsonb default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.depenses (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  libelle_depense text not null,
  type_depense text,
  montant_depense numeric not null,
  date timestamptz not null default now()
);

create table if not exists public.ventes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  libelle text not null,
  quantite numeric not null,
  prix_unitaire numeric not null,
  montant_paye numeric not null default 0,
  date timestamptz not null default now(),
  statut text,
  produit_id uuid references public.produits(id) on delete set null
);

create index if not exists depenses_client_id_idx on public.depenses (client_id);
create index if not exists ventes_client_id_idx on public.ventes (client_id);
create index if not exists stocks_client_id_idx on public.stocks (client_id);
create index if not exists produits_client_id_idx on public.produits (client_id);

-- resolve_produit_id required by confirm_and_create_sale
create or replace function public.resolve_produit_id(
  p_client_id uuid,
  p_label text,
  p_existing uuid default null
)
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  matched uuid;
begin
  if p_existing is not null then
    return p_existing;
  end if;
  if p_client_id is null then
    return null;
  end if;

  if p_label is not null and trim(p_label) <> '' then
    select p.id into matched
    from public.produits p
    where p.client_id = p_client_id
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

  if (select count(*) from public.produits p where p.client_id = p_client_id) = 1 then
    select p.id into matched
    from public.produits p
    where p.client_id = p_client_id
    limit 1;
  end if;

  return matched;
end;
$$;

grant all on table public.produits to service_role;
grant all on table public.stocks to service_role;
grant all on table public.depenses to service_role;
grant all on table public.ventes to service_role;
grant usage, select on sequence public.stocks_numero_seq to service_role;

notify pgrst, 'reload schema';

commit;

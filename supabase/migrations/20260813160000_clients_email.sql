-- Store Ash Ledger account email on clients (PocketBase user email).

begin;

alter table public.clients
  add column if not exists email text;

comment on column public.clients.email is 'Ash Ledger account email (synced from PocketBase on dashboard session).';

create index if not exists clients_email_lower_idx
  on public.clients (lower(email))
  where email is not null;

notify pgrst, 'reload schema';

commit;

-- One currency only: currency_preference === ledger_currency.
-- Existing data currency (ledger) wins so dashboard amounts match stored numbers.

begin;

update public.clients
set currency_preference = ledger_currency
where currency_preference is distinct from ledger_currency;

revoke update on public.clients from authenticated;
grant update (currency_preference, ledger_currency, usd_cdf_rate) on public.clients to authenticated;

notify pgrst, 'reload schema';

commit;

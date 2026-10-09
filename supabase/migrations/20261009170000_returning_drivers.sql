-- Returning drivers (owner's decision of 2026-10-09): one driver record per contract. A driver who comes back for
-- another car gets a new record; the old one stays delisted with its own payments and balance.
--
-- Before: every NRIC could appear once in public.drivers (constraint drivers_nric_key), so a returning driver needed a
-- made-up NRIC. After: only one ACTIVE driver per real NRIC (12 digits, dashes and spaces ignored); delisted records may
-- share it. Short placeholder NRICs typed in the past are left alone.
--
-- If two active drivers already share a 12-digit NRIC, the new rule is not added (a notice names how many) and the
-- app's own check still stops a second active driver. Changes no data. Safe to run again.

alter table public.drivers drop constraint if exists drivers_nric_key;

do $$
declare
  clashes integer;
begin
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'drivers_one_active_per_nric') then
    return;
  end if;
  select count(*) into clashes from (
    select regexp_replace(coalesce(nric, ''), '\D', '', 'g') digits
    from public.drivers
    where not coalesce(is_delisted, false) and length(regexp_replace(coalesce(nric, ''), '\D', '', 'g')) = 12
    group by 1 having count(*) > 1) d;
  if clashes > 0 then
    raise notice '% NRIC(s) are shared by more than one active driver; the one-active-driver rule was not added', clashes;
    return;
  end if;
  create unique index drivers_one_active_per_nric on public.drivers ((regexp_replace(coalesce(nric, ''), '\D', '', 'g')))
    where not coalesce(is_delisted, false) and length(regexp_replace(coalesce(nric, ''), '\D', '', 'g')) = 12;
end $$;

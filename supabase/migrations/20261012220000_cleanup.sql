-- Clean-up (2026-10-12): removes database leftovers that nothing in the app, its Edge Functions or its tests uses.
-- Run it in the Supabase SQL Editor for RentalDatabase, after the 12 Oct security and money files. It is all-or-nothing
-- (an error leaves no change behind) and safe to run again. Nothing the live site uses is touched.
--
-- Tables are dropped without CASCADE on purpose: if anything unexpected still depends on one (a view, another
-- table's link), the file stops with an error and changes nothing, instead of silently taking that with it.
begin;

-- 0. public.cleanup_all_ghost_invoices_manual (every version): an old function in the live database that no file in the
--    repository defines and nothing calls. It probably reads public.invoices, so it would only fail once that table is
--    gone. Dropped first, so even a version tied to the table cannot stop step 1.
do $$
declare fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'cleanup_all_ghost_invoices_manual'
  loop
    raise notice 'Dropping function %', fn;
    execute format('drop function if exists %s', fn);
  end loop;
end$$;

-- 1. public.invoices: a copy of the generated rent invoices that the app wrote after each new payment until the
--    rent engine (utils.ts) became the only source. The app has not read or written it since, and it has been closed
--    to the browser since 27 Sep (20260927090200_close_public_access.sql).
drop table if exists public.invoices;

-- 2. public.fleet_snapshots: a daily count table that was never read or written; closed since 27 Sep.
drop table if exists public.fleet_snapshots;

-- 3. The retired Bank Recon function (every version) and the old debug function, both closed since 27 Sep.
do $$
declare fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('reconcile_bank_statement', 'test_get_drivers')
  loop
    raise notice 'Dropping function %', fn;
    execute format('drop function if exists %s', fn);
  end loop;
end$$;

-- 4. Five old Finance write endpoints that only raise "use the reviewed workflow" (20260920070959, lines 678-682).
--    The app calls the reviewed finance_mutate_record / import preview functions instead.
drop function if exists public.finance_save_record(text, jsonb);
drop function if exists public.finance_post_section_workbook(text, date, text, jsonb, integer, text);
drop function if exists public.finance_post_workshop(date, text, jsonb, integer, text);
drop function if exists public.finance_bootstrap(jsonb, text);
drop function if exists public.finance_copy_previous_shared_costs(date, jsonb, integer);

-- 5. Import previews that expired (30 minutes after they were made) and were never posted. Posted previews stay:
--    they point at the upload history in finance_private.section_uploads.
delete from finance_private.import_previews where expires_at < now() and applied_upload_id is null;

commit;

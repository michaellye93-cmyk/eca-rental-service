-- Close public access to driver and payment records (Cash & Efficiency Review F1; approved by the owner on 2026-09-27).
--
-- RUN THIS ONLY AFTER THE NEW SITE IS LIVE. The new site signs drivers in through driver_portal_login
-- (20260927090100_driver_portal_phone_screening.sql) and loads records only after staff or admins sign in. The old site
-- reads every driver and payment before sign-in, so its driver login would stop working if this ran first.
--
-- After this file: drivers and payments are readable and writable only by signed-in accounts whose profile role is
-- admin or staff. Finance's own functions keep working (they run with the owner's rights). The invoices table, which the
-- app no longer writes or reads, is closed to the browser.
--
-- Every policy this file removes is printed in the SQL Editor's output first ("Dropping policy ..."); keep that output.
-- supabase/rollback/20260927_reopen_public_access.sql restores open access if the new site ever has to be rolled back.
begin;

do $$
declare pol record;
begin
  for pol in
    select schemaname, tablename, policyname, cmd, roles, qual, with_check
    from pg_policies where schemaname = 'public' and tablename in ('drivers', 'payments', 'invoices')
  loop
    raise notice 'Dropping policy "%" on %.% (command %, roles %, using %, with check %)',
      pol.policyname, pol.schemaname, pol.tablename, pol.cmd, pol.roles, pol.qual, pol.with_check;
    execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

alter table public.drivers enable row level security;
alter table public.payments enable row level security;
revoke all on public.drivers, public.payments from public, anon;
grant select, insert, update, delete on public.drivers, public.payments to authenticated;

create policy "Staff and admins manage drivers" on public.drivers for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')));
create policy "Staff and admins manage payments" on public.payments for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')));

do $$ begin
  if to_regclass('public.invoices') is not null then
    execute 'alter table public.invoices enable row level security';
    execute 'revoke all on public.invoices from public, anon, authenticated';
  end if;
  -- "cars" appears in older notes but nothing in the app uses it; close it to the public if it exists.
  if to_regclass('public.cars') is not null then
    raise notice 'Closing public.cars to the public role';
    execute 'revoke all on public.cars from public, anon';
  end if;
end $$;

commit;

-- EMERGENCY ROLLBACK for supabase/migrations/20260927090200_close_public_access.sql.
-- Use only if the site has to go back to the version before the Cash & Efficiency release: that version reads every
-- driver and payment before anyone signs in, so it needs the tables open again. This deliberately reopens the
-- records to the public, as they were before 27 Sep 2026. Kept outside supabase/migrations so no tool applies it
-- by accident. Run it in the Supabase SQL Editor for RentalDatabase.
begin;

drop policy if exists "Staff and admins manage drivers" on public.drivers;
drop policy if exists "Staff and admins manage payments" on public.payments;
drop policy if exists "Rollback: open access to drivers" on public.drivers;
drop policy if exists "Rollback: open access to payments" on public.payments;
grant select, insert, update, delete on public.drivers, public.payments to anon, authenticated;
create policy "Rollback: open access to drivers" on public.drivers for all using (true) with check (true);
create policy "Rollback: open access to payments" on public.payments for all using (true) with check (true);

do $$ begin
  if to_regclass('public.invoices') is not null then
    execute 'grant all on public.invoices to anon, authenticated';
    execute 'drop policy if exists "Enable all access for all users" on public.invoices';
    execute 'create policy "Enable all access for all users" on public.invoices for all using (true) with check (true)';
  end if;
end $$;

commit;

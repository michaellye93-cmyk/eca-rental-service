-- Close the car list to signed-out visitors once the Fleet page is live (approved by the owner on 2026-09-29).
--
-- RUN THIS ONLY AFTER the Fleet page is live on the rental system and the owner has checked that it shows every car.
-- From then on the car list is readable and writable only by signed-in accounts whose profile role is admin or staff,
-- the same rule as drivers and payments. Eca Guardian (carinventory-seven.vercel.app) has no sign-in, so it stops
-- showing cars: that is the switch-off.
--
-- Every policy this file removes is printed in the SQL Editor's output first ("Dropping policy ..."); keep that output.
-- supabase/rollback/20260929_fleet_reopen_cars.sql reopens the car list if Guardian ever has to come back.
-- Safe to run again.
begin;

do $$
declare pol record;
begin
  if to_regclass('public.cars') is null then
    raise notice 'There is no public.cars table; nothing to close';
    return;
  end if;
  for pol in select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'cars'
  loop
    raise notice 'Dropping policy "%" on public.cars (command %, roles %, using %, with check %)',
      pol.policyname, pol.cmd, pol.roles, pol.qual, pol.with_check;
    execute format('drop policy %I on public.cars', pol.policyname);
  end loop;
  execute 'alter table public.cars enable row level security';
  execute 'revoke all on public.cars from public, anon';
  execute 'grant select, insert, update, delete on public.cars to authenticated';
  execute $policy$create policy "Staff and admins manage cars" on public.cars for all to authenticated
    using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')))
    with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')))$policy$;
end $$;

commit;

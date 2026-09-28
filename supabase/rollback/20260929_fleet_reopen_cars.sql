-- EMERGENCY ROLLBACK for supabase/migrations/20260929180000_fleet_close_cars.sql.
-- Use only if the retired Eca Guardian app has to work again: it has no sign-in, so this deliberately reopens the car
-- list, including its notes, to signed-out visitors, as it was before the switch-off. The Fleet page keeps working
-- either way. Kept outside supabase/migrations so no tool applies
-- it by accident. Run it in the Supabase SQL Editor for RentalDatabase.
begin;

grant select, insert, update, delete on public.cars to anon;
drop policy if exists "Rollback: open access to cars" on public.cars;
create policy "Rollback: open access to cars" on public.cars for all using (true) with check (true);

commit;

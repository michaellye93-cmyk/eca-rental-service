-- Give Eca Guardian (carinventory-seven.vercel.app) the car list back without signing in.
-- The 27 Sep lock-down (20260927090200_close_public_access.sql) closed public.cars on the belief that nothing used it,
-- but Guardian has no sign-in and uses only this table. The owner ran this grant in the SQL Editor on 2026-09-29; this
-- file records it so the repository matches the live database. Drivers and payments stay closed.
do $$ begin
  if to_regclass('public.cars') is not null then
    execute 'grant select, insert, update, delete on public.cars to anon';
  end if;
end $$;

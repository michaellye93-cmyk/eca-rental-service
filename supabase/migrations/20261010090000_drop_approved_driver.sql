-- "Approved other driver" was removed from the app on 2026-10-10 (owner's request); its column is no longer read or
-- written anywhere. Removes only that column. Safe to run again.
alter table public.drivers drop column if exists approved_driver;

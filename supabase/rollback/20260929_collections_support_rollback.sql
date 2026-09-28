-- ROLLBACK for supabase/migrations/20260929090000_collections_support.sql, only if the collections release is undone.
-- It stops plates being converted and puts back each plate's old spelling (XAA1001 back to XAA 1001), unless that
-- plate was changed again since. Everything else the file added stays: the previous site ignores it, and removing it
-- would lose the payment references, change log, promises, plans and bank-in details typed since. Kept outside
-- supabase/migrations so no tool applies it by accident. Run it in the Supabase SQL Editor for RentalDatabase.
begin;

drop trigger if exists drivers_normalize_plate on public.drivers;
do $$
declare restored integer;
begin
  update public.drivers d set car_plate = b.old_plate
    from finance_private.plate_conversion_backup b
    where b.driver_id = d.id and d.car_plate = b.new_plate;
  get diagnostics restored = row_count;
  raise notice 'Plates given back their old spelling: %', restored;
end $$;

commit;

-- Only if the additions must go as well. This deletes everything typed into them, so keep a copy first:
-- drop trigger if exists payments_log_change on public.payments;
-- drop table if exists public.payment_changes, public.payment_promises, public.catch_up_plans, public.collection_settings;
-- alter table public.payments drop column if exists reference;
-- alter table public.drivers drop column if exists whatsapp_group;

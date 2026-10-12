-- One vehicle, one plate (owner's review, 12 Oct 2026). Run it in the Supabase SQL Editor for RentalDatabase, after the
-- 12 Oct clean-up file. It is all-or-nothing (an error leaves no change behind) and safe to run again. The app works the
-- same before it is run: Fleet never writes plate_key.
begin;

-- 1. public.cars gets plate_key: the plate in the format drivers, payments and Finance use (capitals, no spaces;
--    "xaa 1001" is XAA1001), filled by a trigger from Fleet's typed "plateNumber", which is kept as typed. Existing cars
--    are filled in below. The index is not unique on purpose: two cars may share a plate in the live list today.
alter table public.cars add column if not exists plate_key text;

create or replace function finance_private.normalize_car_plate() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.plate_key := nullif(upper(regexp_replace(coalesce(new."plateNumber", ''), '\s', '', 'g')), '');
  return new;
end$$;
revoke all on function finance_private.normalize_car_plate() from public, anon, authenticated;
drop trigger if exists cars_plate_key on public.cars;
create trigger cars_plate_key before insert or update on public.cars
  for each row execute function finance_private.normalize_car_plate();

update public.cars set plate_key = nullif(upper(regexp_replace(coalesce("plateNumber", ''), '\s', '', 'g')), '')
  where plate_key is distinct from nullif(upper(regexp_replace(coalesce("plateNumber", ''), '\s', '', 'g')), '');
create index if not exists cars_plate_key_idx on public.cars (plate_key);

commit;

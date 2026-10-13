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

-- 2. Finance's insurance cover for the Fleet page: each plate's latest coverage end among policies that are not
--    cancelled (whoever paid). Admins only, like the rest of Finance; staff keep Fleet's own dates.
create or replace function finance_private.insurance_cover() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform finance_private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('plate_key', c.plate_key, 'coverage_end', c.coverage_end) order by c.plate_key)
    from (select i.plate_key, max(i.coverage_end) as coverage_end from finance_private.insurance i
          where i.cancelled_at is null and i.coverage_end is not null group by i.plate_key) c), '[]'::jsonb);
end$$;
create or replace function public.finance_insurance_cover() returns jsonb
  language sql security invoker set search_path = '' as $$select finance_private.insurance_cover()$$;

revoke all on function finance_private.insurance_cover() from public, anon, authenticated;
grant execute on function finance_private.insurance_cover() to authenticated;
revoke all on function public.finance_insurance_cover() from public, anon, authenticated;
grant execute on function public.finance_insurance_cover() to authenticated;

-- 3. The live updates read the change logs by time: index them so each minute's read stays quick.
create index if not exists payment_changes_changed_at on public.payment_changes (changed_at);
do $$
begin
  if to_regclass('public.driver_changes') is not null then
    create index if not exists driver_changes_changed_at on public.driver_changes (changed_at);
  end if;
end$$;

commit;

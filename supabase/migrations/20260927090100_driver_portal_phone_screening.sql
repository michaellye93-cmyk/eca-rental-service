-- Driver portal sign-in, driver phone numbers, shared daily screening and the portal's payment instructions
-- (Cash & Efficiency Review F1, F16, F17, F18; approved by the owner on 2026-09-27).
--
-- Safe for the current live site: it adds a column, a table and functions, and closes two unused functions and an
-- unused table that let anyone read records. Driver and payment records stay readable as today; closing them is a
-- separate file (20260927090200_close_public_access.sql) that runs only after the new site is live.
-- Run it in the Supabase SQL Editor for RentalDatabase. It is all-or-nothing: an error leaves no change behind.
begin;

-- The app and Finance treat driver ids as uuids. Stop before any change if this database differs.
do $$ begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'drivers' and column_name = 'id') is distinct from 'uuid' then
    raise exception 'public.drivers.id is not a uuid: stop and check with Claude before running this file';
  end if;
end $$;

-- F16: phone numbers for one-tap WhatsApp, stored as 60 followed by the number (no spaces or dashes).
alter table public.drivers add column if not exists phone text;
alter table public.drivers drop constraint if exists drivers_phone_format;
alter table public.drivers add constraint drivers_phone_format check (phone is null or phone ~ '^60[0-9]{8,11}$');

-- F18: daily screening shared between staff: who screened which driver, and when.
create table if not exists public.driver_screenings (
  driver_id uuid not null references public.drivers(id) on delete cascade,
  screened_on date not null,
  screened_by uuid not null default auth.uid(),
  screened_at timestamptz not null default now(),
  primary key (driver_id, screened_on)
);
alter table public.driver_screenings enable row level security;
revoke all on public.driver_screenings from public, anon, authenticated;
grant select, insert on public.driver_screenings to authenticated;
drop policy if exists "Staff and admins read screenings" on public.driver_screenings;
drop policy if exists "Staff and admins record their own screening" on public.driver_screenings;
create policy "Staff and admins read screenings" on public.driver_screenings for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')));
create policy "Staff and admins record their own screening" on public.driver_screenings for insert to authenticated
  with check (screened_by = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')));

-- F17: the payment instructions drivers see in the portal, set by an Admin.
create table if not exists finance_private.portal_settings (
  key text primary key check (key in ('payment_instructions')),
  value text not null check (char_length(value) <= 2000),
  updated_at timestamptz not null default now(),
  updated_by uuid not null
);
alter table finance_private.portal_settings enable row level security;
revoke all on finance_private.portal_settings from public, anon, authenticated;

create or replace function finance_private.portal_payment_instructions() returns text
language sql stable security definer set search_path = '' as $$
  select value from finance_private.portal_settings where key = 'payment_instructions'
$$;
create or replace function finance_private.read_portal_instructions() returns text
language plpgsql security definer set search_path = '' as $$
begin
  perform finance_private.require_admin();
  return finance_private.portal_payment_instructions();
end$$;
create or replace function finance_private.save_portal_instructions(p_text text) returns text
language plpgsql security definer set search_path = '' as $$
declare cleaned text := btrim(coalesce(p_text, ''));
begin
  perform finance_private.require_admin();
  if char_length(cleaned) > 2000 then raise exception 'Keep the payment instructions under 2,000 characters'; end if;
  if cleaned = '' then
    delete from finance_private.portal_settings where key = 'payment_instructions';
  else
    insert into finance_private.portal_settings(key, value, updated_by) values ('payment_instructions', cleaned, auth.uid())
      on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  end if;
  insert into finance_private.audit(actor, action, details)
    values (auth.uid(), 'PORTAL_PAYMENT_INSTRUCTIONS_SAVED', jsonb_build_object('characters', char_length(cleaned)));
  return nullif(cleaned, '');
end$$;
create or replace function public.finance_portal_instructions() returns text
  language sql security invoker set search_path = '' as $$select finance_private.read_portal_instructions()$$;
create or replace function public.finance_save_portal_instructions(p_text text) returns text
  language sql security invoker set search_path = '' as $$select finance_private.save_portal_instructions(p_text)$$;
revoke all on function finance_private.portal_payment_instructions() from public, anon, authenticated;
revoke all on function finance_private.read_portal_instructions(), finance_private.save_portal_instructions(text) from public, anon, authenticated;
grant execute on function finance_private.read_portal_instructions(), finance_private.save_portal_instructions(text) to authenticated;
revoke all on function public.finance_portal_instructions(), public.finance_save_portal_instructions(text) from public, anon, authenticated;
grant execute on function public.finance_portal_instructions(), public.finance_save_portal_instructions(text) to authenticated;

-- F1: drivers sign in on the server. Only the matching driver's contract and payments come back, never the list of
-- drivers, and never NRIC, address, email, phone or tags. At most 10 tries a minute per connection, 120 overall.
create table if not exists finance_private.driver_login_limits (
  bucket text not null,
  window_start timestamptz not null,
  attempts integer not null check (attempts > 0),
  primary key (bucket, window_start)
);
alter table finance_private.driver_login_limits enable row level security;
revoke all on finance_private.driver_login_limits from public, anon, authenticated;

create or replace function public.driver_portal_login(p_nric text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  digits text := regexp_replace(coalesce(p_nric, ''), '\D', '', 'g');
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  caller text := coalesce(nullif(btrim(split_part(headers->>'x-forwarded-for', ',', 1)), ''), 'unknown');
  bucket_key text := 'driver:' || md5(caller);
  tries integer;
  all_tries integer;
  match record;
begin
  delete from finance_private.driver_login_limits where window_start < now() - interval '1 day';
  insert into finance_private.driver_login_limits(bucket, window_start, attempts)
    values (bucket_key, date_trunc('minute', now()), 1)
    on conflict (bucket, window_start) do update set attempts = finance_private.driver_login_limits.attempts + 1
    returning attempts into tries;
  select coalesce(sum(l.attempts), 0) into all_tries from finance_private.driver_login_limits l where l.window_start = date_trunc('minute', now());
  if tries > 10 or all_tries > 120 then
    raise exception 'Too many attempts. Please wait a minute and try again.';
  end if;
  if length(digits) < 6 then return null; end if;

  select d.id, d.name, d.car_plate, d.contract_start_date, d.contract_end_date, d.category, d.rental_cycle,
         d.contract_duration_weeks, d.rental_rate, d.is_delisted, d.delist_date
    into match
    from public.drivers d
    where regexp_replace(coalesce(d.nric, ''), '\D', '', 'g') = digits
    order by d.created_at desc nulls last
    limit 1;
  if match.id is null then return null; end if;

  return jsonb_build_object(
    'driver', jsonb_build_object(
      'id', match.id, 'name', match.name, 'car_plate', match.car_plate,
      'contract_start_date', match.contract_start_date, 'contract_end_date', match.contract_end_date,
      'category', match.category, 'rental_cycle', match.rental_cycle,
      'contract_duration_weeks', match.contract_duration_weeks, 'rental_rate', match.rental_rate,
      'is_delisted', match.is_delisted, 'delist_date', match.delist_date),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'date', p.date, 'amount', p.amount,
        'service_claim', p.service_claim, 'payment_method', p.payment_method) order by p.date desc, p.id)
      from public.payments p where p.driver_id = match.id), '[]'::jsonb),
    'payment_instructions', finance_private.portal_payment_instructions());
end$$;
revoke all on function public.driver_portal_login(text) from public, anon, authenticated;
grant execute on function public.driver_portal_login(text) to anon, authenticated;

-- Close leftovers nothing in the app uses, which let anyone read records with the owner's rights:
-- test_get_drivers() returns every driver row; reconcile_bank_statement() served the retired Bank Recon screen;
-- fleet_snapshots has an open access rule.
do $$ begin
  if to_regprocedure('public.test_get_drivers()') is not null then
    revoke all on function public.test_get_drivers() from public, anon, authenticated;
  end if;
  if to_regprocedure('public.reconcile_bank_statement(jsonb)') is not null then
    revoke all on function public.reconcile_bank_statement(jsonb) from public, anon, authenticated;
  end if;
  if to_regclass('public.fleet_snapshots') is not null then
    revoke all on public.fleet_snapshots from public, anon, authenticated;
  end if;
end $$;

commit;

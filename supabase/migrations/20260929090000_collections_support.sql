-- Collections support (the owner's brief of 2026-09-29, approved the same day): plates in one format, a change log for
-- payments, a payment reference, the WhatsApp group name, bank-in details for WhatsApp statements, promises to pay and
-- catch-up plans.
--
-- Safe for the current live site: it adds columns, tables and triggers, and the current site ignores them. It also
-- converts the stored plates to capitals without spaces (XAA 1001 becomes XAA1001); each old spelling is kept in
-- finance_private.plate_conversion_backup, and supabase/rollback/20260929_collections_support_rollback.sql puts them back.
-- Finance's vehicle keys already ignore spaces and case, so vehicles still match. In an open Finance month, the payments
-- of drivers whose plate changed show a "vehicle attribution changed" warning after the next refresh (the owner accepted this).
-- Run it in the Supabase SQL Editor for RentalDatabase, before the new site is published. It is all-or-nothing, and
-- running it a second time changes nothing.
begin;

-- The app treats these ids as uuids. Stop before any change if this database differs.
do $$ begin
  if (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'drivers' and column_name = 'id') is distinct from 'uuid'
    or (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name = 'id') is distinct from 'uuid'
    or (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name = 'driver_id') is distinct from 'uuid' then
    raise exception 'drivers.id, payments.id or payments.driver_id is not a uuid: stop and check with Claude before running this file';
  end if;
  if to_regnamespace('finance_private') is null then
    raise exception 'The finance_private schema is missing: stop and check with Claude before running this file';
  end if;
end $$;

-- Who makes a change: their account's role, stored with each record at the time (profiles are readable only by their own
-- account), and shown as Admin or Staff. Usernames and emails are never stored: a username can look like an Access ID,
-- and these records are readable by all staff. Changes made in the SQL Editor (or by the server) have no signed-in account.
create or replace function finance_private.actor_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid()
$$;
revoke all on function finance_private.actor_role() from public, anon, authenticated;
create or replace function finance_private.actor_name() returns text
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null then 'Database (SQL Editor)' else coalesce(
    (select case p.role when 'admin' then 'Admin' when 'staff' then 'Staff' end from public.profiles p where p.id = auth.uid()),
    'Unknown account') end
$$;
revoke all on function finance_private.actor_name() from public, anon, authenticated;

-- B1.2: plates in one format, capitals without spaces, however they are typed.
create table if not exists finance_private.plate_conversion_backup (
  driver_id uuid primary key,
  old_plate text not null,
  new_plate text not null,
  converted_at timestamptz not null default now()
);
alter table finance_private.plate_conversion_backup enable row level security;
revoke all on finance_private.plate_conversion_backup from public, anon, authenticated;

create or replace function finance_private.normalize_driver_plate() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.car_plate := upper(regexp_replace(new.car_plate, '\s', '', 'g'));
  return new;
end $$;
revoke all on function finance_private.normalize_driver_plate() from public, anon, authenticated;
drop trigger if exists drivers_normalize_plate on public.drivers;
create trigger drivers_normalize_plate before insert or update of car_plate on public.drivers
  for each row execute function finance_private.normalize_driver_plate();

insert into finance_private.plate_conversion_backup(driver_id, old_plate, new_plate)
  select id, car_plate, upper(regexp_replace(car_plate, '\s', '', 'g')) from public.drivers
  where car_plate is distinct from upper(regexp_replace(car_plate, '\s', '', 'g'))
  on conflict (driver_id) do nothing;
do $$
declare converted integer;
begin
  update public.drivers set car_plate = car_plate where car_plate is distinct from upper(regexp_replace(car_plate, '\s', '', 'g'));
  get diagnostics converted = row_count;
  raise notice 'Plates converted to capitals without spaces: %', converted;
end $$;

-- A3 (Priority 3): the exact WhatsApp group name for each driver.
alter table public.drivers add column if not exists whatsapp_group text;
alter table public.drivers drop constraint if exists drivers_whatsapp_group_length;
alter table public.drivers add constraint drivers_whatsapp_group_length check (whatsapp_group is null or char_length(whatsapp_group) between 1 and 100);

-- A4 (Priority 4): an optional receipt or DuitNow reference on each payment.
alter table public.payments add column if not exists reference text;
alter table public.payments drop constraint if exists payments_reference_length;
alter table public.payments add constraint payments_reference_length check (reference is null or char_length(reference) between 1 and 100);

-- B1.3: every payment added, edited or deleted, with who did it, when, and the whole row before and after.
create table if not exists public.payment_changes (
  id bigint generated always as identity primary key,
  payment_id uuid not null,
  driver_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  changed_at timestamptz not null default now(),
  changed_by uuid,
  changed_by_name text not null,
  changed_by_role text,
  before jsonb,
  after jsonb
);
create index if not exists payment_changes_driver on public.payment_changes (driver_id, changed_at);
alter table public.payment_changes enable row level security;
revoke all on public.payment_changes from public, anon, authenticated;
grant select on public.payment_changes to authenticated;
drop policy if exists "Staff and admins read payment changes" on public.payment_changes;
create policy "Staff and admins read payment changes" on public.payment_changes for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')));

create or replace function finance_private.log_payment_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then return null; end if;
  insert into public.payment_changes(payment_id, driver_id, action, changed_by, changed_by_name, changed_by_role, before, after)
  values (
    case when tg_op = 'DELETE' then old.id else new.id end,
    case when tg_op = 'DELETE' then old.driver_id else new.driver_id end,
    tg_op, auth.uid(), finance_private.actor_name(), finance_private.actor_role(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return null;
end $$;
revoke all on function finance_private.log_payment_change() from public, anon, authenticated;
drop trigger if exists payments_log_change on public.payments;
create trigger payments_log_change after insert or update or delete on public.payments
  for each row execute function finance_private.log_payment_change();

-- A2 (Priority 2): the bank-in line of WhatsApp statements, one per rental category. Everyone signed in reads it;
-- only Admins set it.
create table if not exists public.collection_settings (
  key text primary key check (key in ('bank_in_sewabeli', 'bank_in_sewa_biasa')),
  value text not null check (char_length(value) between 1 and 500),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_role text
);
alter table public.collection_settings enable row level security;
revoke all on public.collection_settings from public, anon, authenticated;
grant select, insert, update, delete on public.collection_settings to authenticated;
drop policy if exists "Staff and admins read collection settings" on public.collection_settings;
drop policy if exists "Admins add collection settings" on public.collection_settings;
drop policy if exists "Admins change collection settings" on public.collection_settings;
drop policy if exists "Admins remove collection settings" on public.collection_settings;
create policy "Staff and admins read collection settings" on public.collection_settings for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')));
create policy "Admins add collection settings" on public.collection_settings for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));
create policy "Admins change collection settings" on public.collection_settings for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));
create policy "Admins remove collection settings" on public.collection_settings for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

create or replace function finance_private.stamp_collection_setting() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.updated_by_name := finance_private.actor_name();
  new.updated_by_role := finance_private.actor_role();
  return new;
end $$;
revoke all on function finance_private.stamp_collection_setting() from public, anon, authenticated;
drop trigger if exists collection_settings_stamp on public.collection_settings;
create trigger collection_settings_stamp before insert or update on public.collection_settings
  for each row execute function finance_private.stamp_collection_setting();

-- A5 (Priority 5): promises to pay. Staff and Admins log them under their own name; only Admins remove one logged by
-- mistake. Kept or missed is worked out in the app from the payments.
create table if not exists public.payment_promises (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  promised_date date not null,
  note text check (note is null or char_length(note) <= 300),
  logged_on date not null,
  logged_at timestamptz not null default now(),
  logged_by uuid,
  logged_by_name text not null,
  logged_by_role text
);
create index if not exists payment_promises_driver on public.payment_promises (driver_id, logged_at desc);
alter table public.payment_promises enable row level security;
revoke all on public.payment_promises from public, anon, authenticated;
grant select, insert, delete on public.payment_promises to authenticated;
drop policy if exists "Staff and admins read promises" on public.payment_promises;
drop policy if exists "Staff and admins log promises" on public.payment_promises;
drop policy if exists "Admins remove promises" on public.payment_promises;
create policy "Staff and admins read promises" on public.payment_promises for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')));
create policy "Staff and admins log promises" on public.payment_promises for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')));
create policy "Admins remove promises" on public.payment_promises for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

create or replace function finance_private.stamp_payment_promise() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.logged_at := now();
  new.logged_on := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  new.logged_by := auth.uid();
  new.logged_by_name := finance_private.actor_name();
  new.logged_by_role := finance_private.actor_role();
  if new.promised_date < new.logged_on then raise exception 'The promised date is in the past'; end if;
  return new;
end $$;
revoke all on function finance_private.stamp_payment_promise() from public, anon, authenticated;
drop trigger if exists payment_promises_stamp on public.payment_promises;
create trigger payment_promises_stamp before insert on public.payment_promises
  for each row execute function finance_private.stamp_payment_promise();

-- B2.4: catch-up plans, an extra amount each rent cycle on top of rent. Admins create, change and stop them; staff read
-- them. A driver has one running plan at a time (a plan runs until it is stopped).
create table if not exists public.catch_up_plans (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  extra_per_cycle numeric(12, 2) not null check (extra_per_cycle > 0),
  start_date date not null,
  end_date date,
  note text check (note is null or char_length(note) <= 300),
  stopped_on date,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text not null,
  created_by_role text,
  constraint catch_up_plans_end_after_start check (end_date is null or end_date >= start_date)
);
create unique index if not exists catch_up_plans_one_running on public.catch_up_plans (driver_id) where stopped_on is null;
alter table public.catch_up_plans enable row level security;
revoke all on public.catch_up_plans from public, anon, authenticated;
grant select, insert, delete on public.catch_up_plans to authenticated;
grant update (stopped_on, end_date, note) on public.catch_up_plans to authenticated;
drop policy if exists "Staff and admins read catch-up plans" on public.catch_up_plans;
drop policy if exists "Admins create catch-up plans" on public.catch_up_plans;
drop policy if exists "Admins change catch-up plans" on public.catch_up_plans;
drop policy if exists "Admins remove catch-up plans" on public.catch_up_plans;
create policy "Staff and admins read catch-up plans" on public.catch_up_plans for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')));
create policy "Admins create catch-up plans" on public.catch_up_plans for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));
create policy "Admins change catch-up plans" on public.catch_up_plans for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));
create policy "Admins remove catch-up plans" on public.catch_up_plans for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

create or replace function finance_private.stamp_catch_up_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.created_at := now();
  new.created_by := auth.uid();
  new.created_by_name := finance_private.actor_name();
  new.created_by_role := finance_private.actor_role();
  return new;
end $$;
revoke all on function finance_private.stamp_catch_up_plan() from public, anon, authenticated;
drop trigger if exists catch_up_plans_stamp on public.catch_up_plans;
create trigger catch_up_plans_stamp before insert on public.catch_up_plans
  for each row execute function finance_private.stamp_catch_up_plan();

commit;

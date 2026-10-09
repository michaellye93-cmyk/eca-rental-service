-- Vehicle details and the agreement generator (owner's request of 2026-10-09).
--
-- car_details: the chassis number, registration date, colour and registered owner's name and ID for each Fleet car.
-- Staff and admins read and change them, like the car list (staff download agreements too); signed-out visitors and
-- other accounts cannot. One row per car, removed with the car.
--
-- agreement_settings: the agreement templates (one per agreement type, with its editable sections) and the company
-- details printed on every agreement. Staff and admins read them; only admins change them. Until a row is saved the app
-- uses its built-in draft. Agreements themselves are never stored: the PDF is made in the browser.
--
-- Changes nothing that exists. Safe to run again.

create table if not exists public.car_details (
  car_id text primary key,
  chassis_no text not null default '',
  registered_date date,
  colour text not null default '',
  owner_name text not null default '',
  owner_id text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

-- Remove a car's details with the car. Guardian made public.cars, so the link is added only when its id is unique.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'car_details_car_id_fkey')
     and exists (
       select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
       where i.indrelid = 'public.cars'::regclass and i.indisunique and i.indnatts = 1 and a.attname = 'id') then
    alter table public.car_details
      add constraint car_details_car_id_fkey foreign key (car_id) references public.cars(id) on delete cascade;
  end if;
end $$;

alter table public.car_details enable row level security;
revoke all on public.car_details from public, anon;
grant select, insert, update, delete on public.car_details to authenticated;
drop policy if exists "Staff and admins manage vehicle details" on public.car_details;
create policy "Staff and admins manage vehicle details" on public.car_details for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')));

create table if not exists public.agreement_settings (
  key text primary key check (key in ('company', 'template:SEWA_BIASA', 'template:SEWABELI')),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.agreement_settings enable row level security;
revoke all on public.agreement_settings from public, anon;
grant select, insert, update, delete on public.agreement_settings to authenticated;
drop policy if exists "Staff and admins read agreement settings" on public.agreement_settings;
create policy "Staff and admins read agreement settings" on public.agreement_settings for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')));
drop policy if exists "Admins manage agreement settings" on public.agreement_settings;
create policy "Admins manage agreement settings" on public.agreement_settings for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

-- Who changed a row last, and when (an upsert from the app would otherwise keep the first writer).
create or replace function public.touch_changed_by() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
revoke all on function public.touch_changed_by() from public, anon, authenticated;
drop trigger if exists car_details_touch on public.car_details;
create trigger car_details_touch before insert or update on public.car_details for each row execute function public.touch_changed_by();
drop trigger if exists agreement_settings_touch on public.agreement_settings;
create trigger agreement_settings_touch before insert or update on public.agreement_settings for each row execute function public.touch_changed_by();

-- The four tables that existed before this repository kept SQL files: profiles, drivers, payments and cars.
--
-- RECONSTRUCTED from the app's code and the later files that alter these tables (12 Oct 2026); it is NOT a dump of the
-- live database, and column types or defaults there may differ. It exists so the repository describes every table it
-- relies on. It is kept outside supabase/migrations so no tool applies it; on a fresh database it would run first,
-- before 20260915084108_secure_profile_roles.sql.
--
-- To replace it with the real thing: Supabase dashboard -> Database -> Schema Visualizer -> "Copy as SQL", paste the
-- profiles, drivers, payments and cars parts over this file.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  role text check (role in ('admin', 'staff')),
  updated_at timestamptz
);

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nric text not null,
  name text not null,
  email text,
  phone text,                         -- 60 followed by 8 to 11 digits (check added 2026-09-27)
  address text,
  whatsapp_group text,                -- added 2026-09-29
  emergency_contact_name text,        -- added 2026-10-09
  emergency_contact_phone text,       -- added 2026-10-09
  car_plate text not null,            -- capitals without spaces (trigger added 2026-09-29)
  category text default 'SEWABELI',   -- SEWABELI or SEWA_BIASA
  rental_cycle text default 'WEEKLY', -- WEEKLY or MONTHLY
  contract_start_date date not null,
  contract_end_date date,
  contract_duration_weeks integer not null,  -- number of rent cycles, weekly or monthly
  rental_rate numeric not null,
  tags text[] default '{}',
  is_delisted boolean default false,
  delist_date date
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  date date not null,
  amount numeric not null default 0,
  service_claim numeric default 0,                -- added 2026-05-22
  payment_method text default 'BANK TRANSFER',   -- added 2026-05-26
  reference text,                                 -- added 2026-09-29
  car_plate text                                  -- the driver's car on the day (added 2026-10-06)
);
create index if not exists payments_driver_date on public.payments (driver_id, date);

-- Shared with the retired Eca Guardian app, which wrote these camelCase columns; never rename them.
create table if not exists public.cars (
  id text primary key,
  make text,
  model text,
  "plateNumber" text,
  "roadtaxExpiry" text,
  "insuranceExpiry" text,
  "inspectionExpiry" text,
  notes text,
  label text,
  ownership text
);

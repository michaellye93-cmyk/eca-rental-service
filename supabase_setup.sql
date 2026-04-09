
/* 
  INSTRUCTIONS:
  1. Go to your Supabase Dashboard > SQL Editor.
  2. Create a new query.
  3. Paste ALL the content below into the query editor.
  4. Click "Run" (bottom right).
  
  This script will:
  - Create tables if they don't exist.
  - Add missing columns (rental_cycle, tags, category, contract_end_date) to existing tables without losing data.
  - Enable security policies.
*/

-- 1. Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1.1 CLEANUP: Remove broken triggers from previous versions
DROP TRIGGER IF EXISTS tr_cleanup_ghost_invoices ON public.drivers;
DROP TRIGGER IF EXISTS on_driver_update ON public.drivers;
DROP FUNCTION IF EXISTS cleanup_ghost_invoices() CASCADE;

-- 2. Create Drivers Table (Safe if not exists)
create table if not exists public.drivers (
  id uuid default uuid_generate_v4() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  nric text unique not null,
  name text not null,
  car_plate text not null,
  contract_start_date date not null,
  contract_duration_weeks integer not null default 52,
  rental_rate numeric not null default 0,
  rental_cycle text default 'WEEKLY', 
  tags text[] default '{}'::text[],
  category text default 'SEWABELI', 
  contract_end_date date,
  total_amount_paid numeric default 0,
  is_delisted boolean default false,
  delist_date date
);

-- 2.1 Create Cars Table (Safe if not exists)
create table if not exists public.cars (
  id text primary key,
  make text not null,
  model text not null,
  plateNumber text not null,
  roadtaxExpiry text not null,
  insuranceExpiry text not null,
  inspectionExpiry text not null,
  notes text
);

-- 2.2 Create Profiles Table (Safe if not exists)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  role text default 'staff' check (role in ('admin', 'staff'))
);

-- 3. Create Payments Table (Safe if not exists)
create table if not exists public.payments (
  id uuid default uuid_generate_v4() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  driver_id uuid references public.drivers(id) on delete cascade not null,
  amount numeric not null,
  date date not null
);

-- 4. Enable Row Level Security (RLS)
alter table public.drivers enable row level security;
alter table public.payments enable row level security;
alter table public.cars enable row level security;
alter table public.profiles enable row level security;

-- 5. Create Policies (Safe execution)
do $$
begin
    if not exists (select from pg_policies where tablename = 'drivers' and policyname = 'Enable all access for drivers') then
        create policy "Enable all access for drivers" on public.drivers for all using (true) with check (true);
    end if;

    if not exists (select from pg_policies where tablename = 'payments' and policyname = 'Enable all access for payments') then
        create policy "Enable all access for payments" on public.payments for all using (true) with check (true);
    end if;

    if not exists (select from pg_policies where tablename = 'cars' and policyname = 'Enable all access for cars') then
        create policy "Enable all access for cars" on public.cars for all using (true) with check (true);
    end if;

    if not exists (select from pg_policies where tablename = 'profiles' and policyname = 'Enable all access for profiles') then
        create policy "Enable all access for profiles" on public.profiles for all using (true) with check (true);
    end if;
end
$$;

-- 6. MIGRATION: Add columns if they are missing (Fixes "column not found" errors)
do $$
begin
    -- Add rental_cycle if missing
    if not exists (select from information_schema.columns where table_name = 'drivers' and column_name = 'rental_cycle') then
        alter table public.drivers add column rental_cycle text default 'WEEKLY';
    end if;

    -- Add tags if missing
    if not exists (select from information_schema.columns where table_name = 'drivers' and column_name = 'tags') then
        alter table public.drivers add column tags text[] default '{}'::text[];
    end if;

    -- Add category if missing (For Sewabeli / Sewa Biasa)
    if not exists (select from information_schema.columns where table_name = 'drivers' and column_name = 'category') then
        alter table public.drivers add column category text default 'SEWABELI';
    end if;

    -- Add contract_end_date if missing
    if not exists (select from information_schema.columns where table_name = 'drivers' and column_name = 'contract_end_date') then
        alter table public.drivers add column contract_end_date date;
    end if;
end
$$;

-- 8. RPC: Cleanup Ghost Records (Manual Audit)
create or replace function cleanup_all_ghost_invoices_manual()
returns json
language plpgsql
as $$
declare
  updated_count integer;
begin
  with updates as (
    update public.drivers
    set contract_duration_weeks = case 
        when rental_cycle = 'MONTHLY' then ceil((contract_end_date - contract_start_date)::numeric / 30.0)
        else ceil((contract_end_date - contract_start_date)::numeric / 7.0)
    end
    where contract_end_date is not null 
      and contract_start_date is not null
      and contract_duration_weeks != case 
        when rental_cycle = 'MONTHLY' then ceil((contract_end_date - contract_start_date)::numeric / 30.0)
        else ceil((contract_end_date - contract_start_date)::numeric / 7.0)
    end
    returning 1
  )
  select count(*) into updated_count from updates;

  return json_build_object(
    'status', 'success',
    'records_cleared', updated_count
  );
end;
$$;

-- 7. REFRESH SCHEMA CACHE HINT
-- If you still see "column not found in schema cache" errors after running this:
-- Go to Supabase Dashboard -> Settings -> API -> click "Reload" under Schema Cache.

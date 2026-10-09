-- One master input for agreements, and the driver's own copy (owner's request of 2026-10-09).
--
-- drivers: the emergency contact and any approved other driver, entered once in Add / Edit Driver and printed on the
-- agreement.
--
-- driver_agreements: when staff download an agreement, a copy of what it says (the template and the filled-in values,
-- a few KB of text, never the PDF) is kept against the driver. Staff and admins add and read them; nobody edits or
-- deletes one. The newest copy is what the driver sees on their phone page.
--
-- driver_portal_record (the driver's own record behind sign-in and "keep me signed in") gains one key, 'agreement':
-- the newest copy, or null. Everything else it returns is unchanged.
--
-- Run after 20261007120000_driver_portal_remember.sql. Changes no existing data. Safe to run again.

alter table public.drivers
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists approved_driver text;

create table if not exists public.driver_agreements (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  kind text not null check (kind in ('SEWA_BIASA', 'SEWABELI')),
  content jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists driver_agreements_driver on public.driver_agreements (driver_id, created_at desc);
alter table public.driver_agreements enable row level security;
revoke all on public.driver_agreements from public, anon, authenticated;
grant select, insert on public.driver_agreements to authenticated;
drop policy if exists "Staff and admins read agreement copies" on public.driver_agreements;
create policy "Staff and admins read agreement copies" on public.driver_agreements for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')));
drop policy if exists "Staff and admins add agreement copies" on public.driver_agreements;
create policy "Staff and admins add agreement copies" on public.driver_agreements for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')));

-- Same as the 2026-10-07 version, plus 'agreement'.
create or replace function finance_private.driver_portal_record(p_driver uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'driver', jsonb_build_object(
      'id', d.id, 'name', d.name, 'car_plate', d.car_plate,
      'contract_start_date', d.contract_start_date, 'contract_end_date', d.contract_end_date,
      'category', d.category, 'rental_cycle', d.rental_cycle,
      'contract_duration_weeks', d.contract_duration_weeks, 'rental_rate', d.rental_rate,
      'is_delisted', d.is_delisted, 'delist_date', d.delist_date),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'date', p.date, 'amount', p.amount,
        'service_claim', p.service_claim, 'payment_method', p.payment_method) order by p.date desc, p.id)
      from public.payments p where p.driver_id = d.id), '[]'::jsonb),
    'payment_instructions', finance_private.portal_payment_instructions(),
    'agreement', (select a.content || jsonb_build_object('created_at', a.created_at)
      from public.driver_agreements a where a.driver_id = d.id order by a.created_at desc, a.id limit 1))
  from public.drivers d where d.id = p_driver
$$;
revoke all on function finance_private.driver_portal_record(uuid) from public, anon, authenticated;

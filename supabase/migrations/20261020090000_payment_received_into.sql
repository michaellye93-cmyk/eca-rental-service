-- Which account a payment was received into (owner's request, 20 Oct 2026). Run it in the Supabase SQL Editor for
-- RentalDatabase before the app that asks for it goes live. It is all-or-nothing and safe to run again. The live app
-- works the same after it is run: the new column is empty until someone picks an account.
--
-- The account numbers themselves are business data, so they are not in this file (the repository is public). The owner
-- adds them with a short insert in the SQL Editor; this file only makes the list and the payment column.
begin;

-- 1. The list of accounts payments are received into: the one master list the payment form reads. Each account belongs
--    to one company (SDN BHD or Enterprise) so the bank reconciliation can be done per company.
create table if not exists public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  label text not null unique check (btrim(label) <> '' and char_length(label) <= 60),
  entity text not null check (entity in ('SDN_BHD', 'ENTERPRISE')),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.payment_accounts enable row level security;
-- Staff and admins read it; nobody changes it from the app (the SQL Editor is where it is kept).
revoke all on public.payment_accounts from public, anon, authenticated;
grant select on public.payment_accounts to authenticated;
drop policy if exists "Staff and admins read payment accounts" on public.payment_accounts;
create policy "Staff and admins read payment accounts" on public.payment_accounts for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')));

-- 2. Each payment can say which account it went into. Payments recorded before today stay empty ("Untagged") until
--    someone sorts them. An account in use cannot be deleted; set active = false to take it off the form instead.
alter table public.payments add column if not exists received_into uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_received_into_fkey') then
    alter table public.payments add constraint payments_received_into_fkey
      foreign key (received_into) references public.payment_accounts(id) on delete restrict;
  end if;
end $$;
create index if not exists payments_received_into on public.payments (received_into);

commit;

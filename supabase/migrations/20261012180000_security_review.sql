-- Security items from the 12 Oct 2026 system review (owner said "build them all", 2026-10-12).
--
-- A3  Only admins may permanently delete a driver, a payment or a deposit line. Staff keep reading, adding and editing.
-- A4  Every change to a driver record is logged (who, when, which fields, before and after), like payments already are.
-- F5  A bank reference can be recorded once: a second bank transfer or cash deposit carrying the same reference (any
--     spacing or capitals) is refused. Claim-only lines, cash in hand and deposit forfeits are not checked: they are
--     not bank receipts, and forfeits all carry the label "Deposit contra". If two
--     payments already share a reference the rule is NOT switched on; the SQL Editor output says how many, and the query
--     at the end of this file lists them so they can be fixed and the file run again.
-- E3  The sign-in limit for all phones together goes from 120 to 600 tries a minute, so one caller cannot lock every
--     driver out. Each phone keeps its own limit of 10 a minute.
-- E4  The driver's sign-in no longer returns the old "How to pay" text (nothing has shown it since 28 Sep); the unused
--     text, its table and its two functions are removed.
--
-- Run in the Supabase SQL Editor for RentalDatabase. Changes no rent, payment or driver figures. Safe to run again.
begin;

-- A3 ---------------------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['drivers', 'payments', 'driver_deposits'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists %I on public.%I', 'Staff and admins manage ' || case t when 'driver_deposits' then 'deposits' else t end, t);
    execute format('drop policy if exists %I on public.%I', 'Staff and admins read ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'Staff and admins add ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'Staff and admins edit ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'Admins delete ' || t, t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')))$p$, 'Staff and admins read ' || t, t);
    execute format($p$create policy %I on public.%I for insert to authenticated
      with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')))$p$, 'Staff and admins add ' || t, t);
    execute format($p$create policy %I on public.%I for update to authenticated
      using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')))
      with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')))$p$, 'Staff and admins edit ' || t, t);
    execute format($p$create policy %I on public.%I for delete to authenticated
      using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))$p$, 'Admins delete ' || t, t);
  end loop;
end $$;

-- A4 ---------------------------------------------------------------------------------------------------------------
create table if not exists public.driver_changes (
  id bigint generated always as identity primary key,
  driver_id uuid not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  changed_at timestamptz not null default now(),
  changed_by uuid,
  changed_by_name text not null,
  changed_by_role text,
  fields text[] not null default '{}',
  before jsonb,
  after jsonb
);
create index if not exists driver_changes_driver on public.driver_changes (driver_id, changed_at);
alter table public.driver_changes enable row level security;
revoke all on public.driver_changes from public, anon, authenticated;
grant select on public.driver_changes to authenticated;
drop policy if exists "Staff and admins read driver changes" on public.driver_changes;
create policy "Staff and admins read driver changes" on public.driver_changes for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')));

-- Only the fields that changed are kept in before/after (a whole driver row is not needed to read an edit).
create or replace function finance_private.log_driver_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_row jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  new_row jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  changed text[];
begin
  select coalesce(array_agg(k order by k), '{}') into changed
    from (select jsonb_object_keys(old_row || new_row) k) keys
    where (old_row -> k) is distinct from (new_row -> k);
  if tg_op = 'UPDATE' and cardinality(changed) = 0 then return null; end if;
  insert into public.driver_changes(driver_id, action, changed_by, changed_by_name, changed_by_role, fields, before, after)
  values (
    case when tg_op = 'DELETE' then old.id else new.id end,
    tg_op, auth.uid(), finance_private.actor_name(), finance_private.actor_role(), changed,
    case when tg_op = 'INSERT' then null
      else (select coalesce(jsonb_object_agg(k, old_row -> k), '{}'::jsonb) from unnest(changed) k) end,
    case when tg_op = 'DELETE' then null
      else (select coalesce(jsonb_object_agg(k, new_row -> k), '{}'::jsonb) from unnest(changed) k) end);
  return null;
end $$;
revoke all on function finance_private.log_driver_change() from public, anon, authenticated;
drop trigger if exists drivers_log_change on public.drivers;
create trigger drivers_log_change after insert or update or delete on public.drivers
  for each row execute function finance_private.log_driver_change();

-- F5 ---------------------------------------------------------------------------------------------------------------
create or replace function public.payment_reference_key(p_reference text) returns text
language sql immutable set search_path = '' as $$
  select nullif(upper(regexp_replace(coalesce(p_reference, ''), '\s', '', 'g')), '')
$$;
grant execute on function public.payment_reference_key(text) to authenticated;
-- A payment that came through the bank with a receipt: an amount, paid by bank transfer or cash deposit (no method
-- recorded counts as bank transfer, as the app reads it).
create or replace function public.payment_is_bank_receipt(p_amount numeric, p_method text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_amount, 0) > 0 and upper(coalesce(nullif(btrim(p_method), ''), 'BANK TRANSFER')) in ('BANK TRANSFER', 'CASH DEPOSIT')
$$;
grant execute on function public.payment_is_bank_receipt(numeric, text) to authenticated;

do $$
declare clashes integer;
begin
  if to_regclass('public.payments_reference_once') is not null then return; end if;
  select count(*) into clashes from (
    select public.payment_reference_key(reference) from public.payments
    where public.payment_is_bank_receipt(amount, payment_method) and public.payment_reference_key(reference) is not null
    group by 1 having count(*) > 1) dup;
  if clashes > 0 then
    raise notice 'NOT switched on: % reference(s) are already used by more than one payment. List them with the query at the end of this file, fix them, and run the file again.', clashes;
  else
    execute 'create unique index payments_reference_once on public.payments (public.payment_reference_key(reference))
      where public.payment_is_bank_receipt(amount, payment_method) and public.payment_reference_key(reference) is not null';
    raise notice 'Switched on: each bank reference can now be recorded once.';
  end if;
end $$;

-- E3 ---------------------------------------------------------------------------------------------------------------
-- Same as the 2026-10-07 version except the limit for all phones together (120 -> 600 a minute).
create or replace function public.driver_portal_login(p_nric text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  digits text := regexp_replace(coalesce(p_nric, ''), '\D', '', 'g');
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  caller text := coalesce(
    nullif(btrim(headers->>'cf-connecting-ip'), ''),
    nullif(btrim(regexp_replace(coalesce(headers->>'x-forwarded-for', ''), '^.*,', '')), ''),
    'unknown');
  bucket_key text := 'driver:' || md5(caller);
  tries integer;
  all_tries integer;
  match_id uuid;
begin
  delete from finance_private.driver_login_limits where window_start < now() - interval '1 day';
  insert into finance_private.driver_login_limits(bucket, window_start, attempts)
    values (bucket_key, date_trunc('minute', now()), 1)
    on conflict (bucket, window_start) do update set attempts = finance_private.driver_login_limits.attempts + 1
    returning attempts into tries;
  select coalesce(sum(l.attempts), 0) into all_tries from finance_private.driver_login_limits l where l.window_start = date_trunc('minute', now());
  if tries > 10 or all_tries > 600 then
    raise exception 'Too many attempts. Please wait a minute and try again.';
  end if;
  if length(digits) < 6 then return null; end if;

  select d.id into match_id
    from public.drivers d
    where regexp_replace(coalesce(d.nric, ''), '\D', '', 'g') = digits
    order by d.created_at desc nulls last
    limit 1;
  if match_id is null then return null; end if;
  return finance_private.driver_portal_record(match_id);
end$$;
revoke all on function public.driver_portal_login(text) from public, anon, authenticated;
grant execute on function public.driver_portal_login(text) to anon, authenticated;

-- E4 ---------------------------------------------------------------------------------------------------------------
-- Same as the 2026-10-09 version without 'payment_instructions'.
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
    'agreement', (select a.content || jsonb_build_object('created_at', a.created_at)
      from public.driver_agreements a where a.driver_id = d.id order by a.created_at desc, a.id limit 1))
  from public.drivers d where d.id = p_driver
$$;
revoke all on function finance_private.driver_portal_record(uuid) from public, anon, authenticated;

drop function if exists public.finance_portal_instructions();
drop function if exists public.finance_save_portal_instructions(text);
drop function if exists finance_private.read_portal_instructions();
drop function if exists finance_private.save_portal_instructions(text);
drop function if exists finance_private.portal_payment_instructions();
drop table if exists finance_private.portal_settings;

commit;

-- F5 clash list (run on its own if the notice said "NOT switched on"):
--   select public.payment_reference_key(p.reference) as reference, p.id, p.driver_id, d.name, p.date, p.amount
--   from public.payments p join public.drivers d on d.id = p.driver_id
--   where public.payment_is_bank_receipt(p.amount, p.payment_method) and public.payment_reference_key(p.reference) in (
--     select public.payment_reference_key(reference) from public.payments
--     where public.payment_is_bank_receipt(amount, payment_method) and public.payment_reference_key(reference) is not null
--     group by 1 having count(*) > 1)
--   order by 1, p.date;

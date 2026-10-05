-- Car history and cash-flow-only costs (the owner's decisions of 2026-10-06):
--   1. Each payment remembers the car plate it was paid for. Revenue is measured per car plate, and a driver can change
--      car during a month, so Finance books each payment to that plate instead of the driver's current car.
--   2. A history of every driver's car changes.
--   3. An Operation Fix Cost can count in the P&L (the default) or only in cash flow. Tax instalments such as LHDN CP204
--      are paying tax already owed, so they reduce cash but are not an operating cost; they start as cash flow only.
--
-- Safe for the current live site: it adds a column, tables, triggers and functions, and the current site ignores them.
-- Existing payments take their driver's current car (the best record there is), so history is exact from today onwards.
-- Run it once in the SQL Editor; running it again changes nothing.

begin;

-- 1. The car each payment was paid for.
alter table public.payments add column if not exists car_plate text;

create or replace function finance_private.fill_payment_car_plate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.car_plate is null or btrim(new.car_plate) = '' then
    select d.car_plate into new.car_plate from public.drivers d where d.id = new.driver_id;
  end if;
  new.car_plate := nullif(upper(regexp_replace(coalesce(new.car_plate, ''), '\s', '', 'g')), '');
  return new;
end $$;
revoke all on function finance_private.fill_payment_car_plate() from public, anon, authenticated;
drop trigger if exists payments_fill_car_plate on public.payments;
create trigger payments_fill_car_plate before insert or update of car_plate on public.payments
  for each row execute function finance_private.fill_payment_car_plate();

-- Fill existing payments without adding an "Edited" line to each one's change log.
do $$
declare
  logged boolean := exists (select 1 from pg_trigger where tgname = 'payments_log_change' and tgrelid = 'public.payments'::regclass);
  filled integer;
begin
  if logged then execute 'alter table public.payments disable trigger payments_log_change'; end if;
  update public.payments p set car_plate = d.car_plate from public.drivers d where d.id = p.driver_id and p.car_plate is null;
  get diagnostics filled = row_count;
  if logged then execute 'alter table public.payments enable trigger payments_log_change'; end if;
  raise notice 'Payments given their car plate: %', filled;
end $$;

-- 2. Every driver's car changes. Admins and staff read it; nobody edits it.
create table if not exists public.driver_car_assignments (
  id bigint generated always as identity primary key,
  driver_id uuid not null,
  car_plate text,
  previous_plate text,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  changed_by_name text not null
);
create index if not exists driver_car_assignments_driver on public.driver_car_assignments (driver_id, changed_at);
alter table public.driver_car_assignments enable row level security;
revoke all on public.driver_car_assignments from public, anon, authenticated;
grant select on public.driver_car_assignments to authenticated;
drop policy if exists "Staff and admins read car assignments" on public.driver_car_assignments;
create policy "Staff and admins read car assignments" on public.driver_car_assignments for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')));

create or replace function finance_private.log_driver_car_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Plates are already normalised by drivers_normalize_plate, so a spacing-only edit is not a change.
  if tg_op = 'UPDATE' and new.car_plate is not distinct from old.car_plate then return null; end if;
  insert into public.driver_car_assignments(driver_id, car_plate, previous_plate, changed_by, changed_by_name)
  values (new.id, new.car_plate, case when tg_op = 'UPDATE' then old.car_plate end, auth.uid(), finance_private.actor_name());
  return null;
end $$;
revoke all on function finance_private.log_driver_car_change() from public, anon, authenticated;
drop trigger if exists drivers_log_car_change on public.drivers;
create trigger drivers_log_car_change after insert or update of car_plate on public.drivers
  for each row execute function finance_private.log_driver_car_change();

-- Starting point: each driver's current car, once.
insert into public.driver_car_assignments(driver_id, car_plate, previous_plate, changed_by, changed_by_name)
  select d.id, d.car_plate, null, null, 'Starting point'
  from public.drivers d
  where not exists (select 1 from public.driver_car_assignments a where a.driver_id = d.id);

-- Finance books each payment to the car it was paid for (falling back to the driver's car for any payment without one).
create or replace function finance_private.refresh_payments(p_month date) returns jsonb language plpgsql security definer set search_path='' as $$
declare last_id uuid;batch_count integer;batch_last uuid;stamp timestamptz:=clock_timestamp();begin perform finance_private.lock_finance();perform finance_private.require_draft(p_month);
 if exists(select 1 from public.payments p join finance_private.ehailing e on e.source_payment_id=p.id where p.date>=p_month and p.date<p_month+interval '1 month' and e.finance_month<>p_month) then raise exception 'Payment source ID belongs to another Finance month. Reopen and refresh that original month first.';end if;
 drop table if exists pg_temp.finance_payment_stage;create temporary table finance_payment_stage (like finance_private.ehailing including defaults) on commit drop;
 insert into pg_temp.finance_payment_stage(source_payment_id,driver_id,driver_name_snapshot,car_plate_snapshot,plate_key,payment_date,cash_amount,service_claim,gross_rental_revenue,payment_method,refreshed_at,finance_month,attribution_changed)
 select p.id,p.driver_id,d.name,coalesce(p.car_plate,d.car_plate),coalesce(finance_private.canonical_plate(coalesce(p.car_plate,d.car_plate)),nullif(regexp_replace(upper(coalesce(p.car_plate,d.car_plate)),'\s','','g'),'')),p.date,p.amount,p.service_claim,p.amount+p.service_claim,p.payment_method,stamp,p_month,coalesce(old.attribution_changed,false) or (old.source_payment_id is not null and old.car_plate_snapshot is distinct from coalesce(p.car_plate,d.car_plate))
 from public.payments p left join public.drivers d on d.id=p.driver_id left join finance_private.ehailing old on old.source_payment_id=p.id where p.date>=p_month and p.date<p_month+interval '1 month';
 delete from finance_private.ehailing where finance_month=p_month;
 loop with page as(select * from pg_temp.finance_payment_stage where last_id is null or source_payment_id>last_id order by source_payment_id limit 500),written as(insert into finance_private.ehailing(source_payment_id,driver_id,driver_name_snapshot,car_plate_snapshot,plate_key,payment_date,cash_amount,service_claim,payment_method,refreshed_at,finance_month,attribution_changed) select source_payment_id,driver_id,driver_name_snapshot,car_plate_snapshot,plate_key,payment_date,cash_amount,service_claim,payment_method,refreshed_at,finance_month,attribution_changed from page returning source_payment_id) select count(*),max(source_payment_id::text)::uuid into batch_count,batch_last from written;exit when batch_count=0;last_id:=batch_last;end loop;
 update finance_private.months set refreshed_at=stamp,revision=revision+1,source_count=(select count(*) from pg_temp.finance_payment_stage),total_cash=(select coalesce(sum(cash_amount),0) from pg_temp.finance_payment_stage),total_claim=(select coalesce(sum(service_claim),0) from pg_temp.finance_payment_stage),earliest_date=(select min(payment_date) from pg_temp.finance_payment_stage),latest_date=(select max(payment_date) from pg_temp.finance_payment_stage) where finance_month=p_month;
 update finance_private.mutation_state set generation=generation+1 where singleton;insert into finance_private.audit(actor,finance_month,action) values(auth.uid(),p_month,'REFRESH_PAYMENTS');return finance_private.input(p_month);end$$;

-- Month review compares Finance's copy with the payments using the same car (the one each payment was paid for), so a
-- driver changing car does not block Ready or Close. Only that comparison differs from the 2026-09-20 version.
create or replace function finance_private.transition_month(p_month date,p_action text,p_revision integer,p_acknowledgement text) returns jsonb language plpgsql security definer set search_path='' as $$
declare m finance_private.months;result jsonb;begin perform finance_private.lock_finance();perform finance_private.ensure_month(p_month);select * into m from finance_private.months where finance_month=p_month for update;perform finance_private.require_admin();
 if p_revision is distinct from m.revision then raise exception 'Month changed. Reload and review before continuing.';end if;
 if p_action='REOPEN' then if m.status='DRAFT' then raise exception 'Month is already Draft';end if;if nullif(btrim(p_acknowledgement),'') is null then raise exception 'Enter a reason to reopen';end if;insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),p_month,'REOPEN',jsonb_build_object('reason',p_acknowledgement,'previous_frozen_input',m.frozen_input));update finance_private.months set status='DRAFT',revision=revision+1,frozen_input=null,frozen_at=null where finance_month=p_month;
 elsif p_action in ('READY','CLOSE') then
  if (p_action='READY' and m.status<>'DRAFT') or (p_action='CLOSE' and m.status<>'READY FOR REVIEW') then raise exception 'Invalid month lifecycle transition';end if;
  if m.refreshed_at is null then raise exception 'Refresh the complete E-hailing ledger first';end if;perform finance_private.validate_bank_links(p_month);
  if not exists(select 1 from finance_private.imports where finance_month=p_month and kind='SMART_DRIVE' and status='POSTED') then raise exception 'Approve the official Smart Drive report first';end if;
  if exists(select 1 from finance_private.ehailing e left join finance_private.vehicles v on v.plate_key=e.plate_key where e.finance_month=p_month and (e.driver_id is null or e.driver_name_snapshot is null or v.plate_key is null)) or exists(select 1 from finance_private.smart_rows s join finance_private.imports i on i.id=s.import_id left join finance_private.vehicles v on v.plate_key=s.plate_key where i.finance_month=p_month and i.status='POSTED' and v.plate_key is null) then raise exception 'Resolve missing driver or unmatched vehicle mappings before review';end if;
  if exists(select 1 from (select p.id,p.driver_id,p.date,p.amount,p.service_claim,p.payment_method,d.name,coalesce(p.car_plate,d.car_plate) as car_plate from public.payments p left join public.drivers d on d.id=p.driver_id where p.date>=p_month and p.date<p_month+interval '1 month') p full join (select * from finance_private.ehailing where finance_month=p_month) e on e.source_payment_id=p.id where p.id is null or e.source_payment_id is null or row(p.driver_id,p.date,p.amount,p.service_claim,p.payment_method,p.name,p.car_plate) is distinct from row(e.driver_id,e.payment_date,e.cash_amount,e.service_claim,e.payment_method,e.driver_name_snapshot,e.car_plate_snapshot)) then raise exception 'Operational ledger changed. Reopen review and refresh before closing.';end if;
  if exists(select 1 from finance_private.import_previews p where p.finance_month=p_month and p.applied_upload_id is null and p.expires_at>now() and exists(select 1 from jsonb_array_elements(p.changes)x where x->>'action'='NEEDS_REVIEW')) then raise exception 'Resolve or discard the import rows that need review';end if;
  if exists(select 1 from finance_private.recurring_costs a join finance_private.recurring_costs b on a.id<b.id and a.obligation_id<>b.obligation_id and a.cancelled_at is null and b.cancelled_at is null and a.plate_key=b.plate_key and a.monthly_amount=b.monthly_amount and coalesce(a.payee,'')=coalesce(b.payee,'') and a.start_month=b.start_month and a.end_month is not distinct from b.end_month where a.start_month<=p_month and (a.end_month is null or a.end_month>=p_month) and not exists(select 1 from finance_private.recurring_duplicate_resolutions r where r.obligation_a=case when a.obligation_id<b.obligation_id then a.obligation_id else b.obligation_id end and r.obligation_b=case when a.obligation_id<b.obligation_id then b.obligation_id else a.obligation_id end and r.fingerprint=md5(concat_ws('|',a.plate_key,a.monthly_amount,coalesce(a.payee,''),a.start_month,coalesce(a.end_month::text,''))))) then raise exception 'Resolve possible duplicate recurring costs before review';end if;
  if exists(select 1 from (values ('workshop'),('vehicle_expense'),('corporate_expense'),('other_income')) required(section) left join finance_private.section_reviews r on r.finance_month=p_month and r.section=required.section where r.section is null or r.fingerprint is distinct from finance_private.section_fingerprint(p_month,required.section)) then raise exception 'Review every Finance section and distinguish confirmed none from recorded rows';end if;
  if p_action='READY' then update finance_private.months set status='READY FOR REVIEW',revision=revision+1 where finance_month=p_month;
  else
   if nullif(btrim(p_acknowledgement),'') is null then raise exception 'Acknowledge review of costs and historical plate attribution before closing';end if;
   if exists(select 1 from finance_private.workshop_summaries s where s.finance_month=p_month and s.cancelled_at is null and s.amount>(select coalesce(sum(e.amount),0) from finance_private.workshop_allocations a join finance_private.expenses e on e.id=a.expense_id and e.cancelled_at is null where a.summary_id=s.id)) and position('WORKSHOP_ALLOCATION_ACK' in p_acknowledgement)=0 then raise exception 'Acknowledge incomplete workshop allocation before closing';end if;
   result:=finance_private.input(p_month);result:=jsonb_set(result,'{month}',(result->'month')||jsonb_build_object('status','CLOSED','revision',m.revision+1,'frozen_at',now()));update finance_private.months set status='CLOSED',revision=revision+1,frozen_at=now(),frozen_input=result where finance_month=p_month;
  end if;
  insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),p_month,p_action,jsonb_build_object('acknowledgement',p_acknowledgement));
 else raise exception 'Unknown month lifecycle action';end if;return finance_private.read_month(p_month);end$$;


-- 3. Operation Fix Costs that count only in cash flow. Kept per cost series, so it survives future edits of the cost.
create table if not exists finance_private.fixed_cost_treatments (
  series_id uuid primary key,
  treatment text not null check (treatment in ('PNL', 'CASH_FLOW_ONLY')),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table finance_private.fixed_cost_treatments enable row level security;
revoke all on finance_private.fixed_cost_treatments from public, anon, authenticated;

-- Tax instalments recorded so far (LHDN, CP204) start as cash flow only. An admin can change it on screen.
do $$
declare seeded integer;
begin
  insert into finance_private.fixed_cost_treatments(series_id, treatment)
    select distinct t.series_id, 'CASH_FLOW_ONLY' from finance_private.fixed_cost_templates t
    where t.cancelled_at is null and (t.category ilike '%LHDN%' or t.category ilike '%CP204%' or coalesce(t.payee, '') ilike '%CP204%')
    on conflict (series_id) do nothing;
  get diagnostics seeded = row_count;
  raise notice 'Operation Fix Costs set to cash flow only (tax instalments): %', seeded;
end $$;

create or replace function finance_private.fixed_cost_treatment_rows() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('series_id', series_id, 'treatment', treatment) order by series_id), '[]'::jsonb)
  from finance_private.fixed_cost_treatments where treatment <> 'PNL'
$$;
create or replace function finance_private.fixed_cost_treatments() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform finance_private.require_admin();
  return finance_private.fixed_cost_treatment_rows();
end $$;
create or replace function finance_private.set_fixed_cost_treatment(p_series_id uuid, p_treatment text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform finance_private.require_admin();
  if p_treatment is null or p_treatment not in ('PNL', 'CASH_FLOW_ONLY') then raise exception 'Choose P&L or cash flow only'; end if;
  if not exists (select 1 from finance_private.fixed_cost_templates where series_id = p_series_id) then
    raise exception 'That Operation Fix Cost no longer exists';
  end if;
  insert into finance_private.fixed_cost_treatments(series_id, treatment, updated_at, updated_by)
    values (p_series_id, p_treatment, now(), auth.uid())
    on conflict (series_id) do update set treatment = excluded.treatment, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  insert into finance_private.audit(actor, action, details)
    values (auth.uid(), 'FIXED_COST_TREATMENT', jsonb_build_object('series_id', p_series_id, 'treatment', p_treatment));
  return finance_private.fixed_cost_treatment_rows();
end $$;

-- Finance's month data carries the cash-flow-only list, so a month frozen at close keeps the treatment it was closed
-- with. Same as the 2026-09-15 version plus that one key.
create or replace function finance_private.input(p_month date) returns jsonb language sql stable security definer set search_path='' as $$
 select finance_private.base_input(p_month)||jsonb_build_object(
  'bank_imports',coalesce((select jsonb_agg(to_jsonb(b)-'imported_by' order by imported_at,id) from finance_private.bank_imports b where finance_month=p_month),'[]'),
  'bank_rows',coalesce((select jsonb_agg((to_jsonb(r)-'account_key'-'fingerprint')||jsonb_build_object('match_valid',r.decision<>'MATCHED' or finance_private.bank_match_valid(p_month,r.matched_kind,r.matched_id,r.debit,r.credit)) order by r.import_id,r.source_row) from finance_private.bank_rows r join finance_private.bank_imports b on b.id=r.import_id where b.finance_month=p_month),'[]'),
  'fixed_cost_treatments',finance_private.fixed_cost_treatment_rows())
$$;
revoke all on function finance_private.input(date) from public,anon,authenticated;

create or replace function public.finance_fixed_cost_treatments() returns jsonb
  language sql security invoker set search_path = '' as $$select finance_private.fixed_cost_treatments()$$;
create or replace function public.finance_set_fixed_cost_treatment(p_series_id uuid, p_treatment text) returns jsonb
  language sql security invoker set search_path = '' as $$select finance_private.set_fixed_cost_treatment(p_series_id, p_treatment)$$;

revoke all on function finance_private.fixed_cost_treatment_rows() from public, anon, authenticated;
revoke all on function finance_private.fixed_cost_treatments(), finance_private.set_fixed_cost_treatment(uuid, text)
  from public, anon, authenticated;
grant execute on function finance_private.fixed_cost_treatments(), finance_private.set_fixed_cost_treatment(uuid, text) to authenticated;
revoke all on function public.finance_fixed_cost_treatments(), public.finance_set_fixed_cost_treatment(uuid, text)
  from public, anon, authenticated;
grant execute on function public.finance_fixed_cost_treatments(), public.finance_set_fixed_cost_treatment(uuid, text) to authenticated;

commit;

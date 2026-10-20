-- Vehicle loans (owner's decisions A, B and C, 21 Oct 2026). Run it in the Supabase SQL Editor for RentalDatabase,
-- before the frontend that shows the Vehicle loans page. It is all-or-nothing (an error leaves no change behind) and
-- safe to run again. Until it is run the Vehicle loans page shows that the database update is needed; nothing else
-- changes.
--
-- A. Each own-fleet car's hire-purchase loan is the master of its "Hire Purchase / Loan" monthly cost in Finance:
--    saving a loan creates or updates that cost (amount, payee, start and end month), and Records shows it read-only.
-- B. Admin only, like the rest of Finance: the browser reaches the loans only through public.finance_* functions.
-- C. Status Active / Settled / Car sold is typed; a settled or sold loan ends its cost from the month it closed.
begin;

-- 1. The loans. One active loan per car; deleted loans are kept (cancelled_at) for the audit.
create table if not exists finance_private.vehicle_loans (
  id uuid primary key default gen_random_uuid(),
  plate_key text not null check (plate_key <> '' and plate_key = regexp_replace(upper(plate_key), '\s', '', 'g')),
  display_plate text not null check (btrim(display_plate) <> ''),
  bank text not null check (btrim(bank) <> ''),
  finance_amount numeric(16,2) not null check (finance_amount > 0),
  -- Flat interest rate, % per year.
  flat_rate_percent numeric(6,3) not null check (flat_rate_percent >= 0),
  tenure_months integer not null check (tenure_months > 0),
  first_payment_date date not null,
  downpayment numeric(16,2) not null default 0 check (downpayment >= 0),
  -- Worked out in the browser from the three figures above (override allowed for the bank's rounding), then stored.
  monthly_instalment numeric(16,2) not null check (monthly_instalment > 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SETTLED', 'SOLD')),
  closed_on date,
  notes text,
  recurring_cost_id uuid references finance_private.recurring_costs(id),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancellation_reason text,
  record_version integer not null default 1,
  constraint vehicle_loans_closed_on check ((status = 'ACTIVE') = (closed_on is null))
);
create unique index if not exists vehicle_loans_one_active_per_car on finance_private.vehicle_loans (plate_key)
  where cancelled_at is null and status = 'ACTIVE';
alter table finance_private.vehicle_loans enable row level security;
revoke all on finance_private.vehicle_loans from public, anon, authenticated;

-- 2. The monthly cost a loan owns. Costs typed in Records keep loan_id null and behave as before.
alter table finance_private.recurring_costs add column if not exists loan_id uuid references finance_private.vehicle_loans(id);
create unique index if not exists recurring_costs_one_per_loan on finance_private.recurring_costs (loan_id)
  where loan_id is not null and cancelled_at is null;

-- 2b. Every door is shut on a loan-owned cost, not only Records: an Excel import, a later function or a hand-typed
--     statement cannot change its figures, months, link or cancellation. Only save_vehicle_loan may, and it says so
--     with a transaction-local setting. A plate correction, a note or a version bump still passes.
create or replace function finance_private.guard_loan_owned_cost() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.loan_id is not null and coalesce(current_setting('finance.vehicle_loan_write', true), '') <> 'on'
     and (new.loan_id is distinct from old.loan_id or new.monthly_amount is distinct from old.monthly_amount
       or new.start_month is distinct from old.start_month or new.end_month is distinct from old.end_month
       or new.cost_type is distinct from old.cost_type or new.payee is distinct from old.payee
       or new.cancelled_at is distinct from old.cancelled_at) then
    raise exception 'This cost is managed in Vehicle loans';
  end if;
  return new;
end$$;
drop trigger if exists recurring_costs_loan_owned on finance_private.recurring_costs;
create trigger recurring_costs_loan_owned before update on finance_private.recurring_costs
  for each row execute function finance_private.guard_loan_owned_cost();

-- 3. Records cannot edit, stop or delete a cost a loan owns. finance_private.mutate_record is as in
--    20260920070959_finance_editable_safe_imports.sql with one line added after the row is read (marked below).
create or replace function finance_private.mutate_record(p_kind text,p_action text,p_record jsonb,p_effective_month date,p_revision integer,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rid uuid;old jsonb;row_old finance_private.recurring_costs%rowtype;new_id uuid;plate text;before_exp jsonb;business text;begin
 perform finance_private.assert_open_revision(p_effective_month,p_revision);
 if jsonb_typeof(p_record)<>'object' or p_action not in ('ADD','UPDATE','OVERRIDE_MONTH','STOP','CANCEL','CORRECT_PLATE') then raise exception 'Invalid Finance record mutation';end if;
 rid:=nullif(p_record->>'id','')::uuid;plate:=coalesce(finance_private.canonical_plate(p_record->>'plate_key'),nullif(regexp_replace(upper(p_record->>'plate_key'),'\s','','g'),''));
 if p_kind='recurring_cost' then
  if p_action='ADD' then
   if plate is null or not exists(select 1 from finance_private.vehicles where plate_key=plate and deleted_at is null) then raise exception 'Select an active Finance vehicle';end if;
   if exists(select 1 from finance_private.recurring_costs c where c.cancelled_at is null and c.plate_key=plate and c.monthly_amount=(p_record->>'monthly_amount')::numeric and coalesce(c.payee,'')=coalesce(nullif(btrim(p_record->>'payee'),''),'') and c.start_month=(p_record->>'start_month')::date and c.end_month is not distinct from nullif(p_record->>'end_month','')::date) and p_reason not ilike '%separate%' then raise exception 'A matching obligation already exists. Confirm this is a separate obligation.';end if;
   insert into finance_private.recurring_costs(obligation_id,plate_key,start_month,end_month,cost_type,monthly_amount,payee,notes)
   values(gen_random_uuid(),plate,(p_record->>'start_month')::date,nullif(p_record->>'end_month','')::date,btrim(p_record->>'cost_type'),(p_record->>'monthly_amount')::numeric,nullif(btrim(p_record->>'payee'),''),nullif(btrim(p_record->>'notes'),'')) returning id,obligation_id into rid,new_id;
   if p_reason ilike '%separate%' then
    insert into finance_private.recurring_duplicate_resolutions(obligation_a,obligation_b,fingerprint,reason,resolved_by)
    select case when c.obligation_id<new_id then c.obligation_id else new_id end,case when c.obligation_id<new_id then new_id else c.obligation_id end,md5(concat_ws('|',plate,(p_record->>'monthly_amount')::numeric,coalesce(nullif(btrim(p_record->>'payee'),''),''),(p_record->>'start_month'),coalesce(p_record->>'end_month',''))),p_reason,auth.uid()
    from finance_private.recurring_costs c where c.id<>rid and c.obligation_id<>new_id and c.cancelled_at is null and c.plate_key=plate and c.monthly_amount=(p_record->>'monthly_amount')::numeric and coalesce(c.payee,'')=coalesce(nullif(btrim(p_record->>'payee'),''),'') and c.start_month=(p_record->>'start_month')::date and c.end_month is not distinct from nullif(p_record->>'end_month','')::date
    on conflict(obligation_a,obligation_b,fingerprint) do update set reason=excluded.reason,resolved_at=now(),resolved_by=excluded.resolved_by;
   end if;
  else
   select * into row_old from finance_private.recurring_costs where id=rid for update;if not found then raise exception 'Recurring cost no longer exists';end if;old:=to_jsonb(row_old);
   -- Added by 20261021090000_vehicle_loans.sql:
   if row_old.loan_id is not null then raise exception 'This cost is managed in Vehicle loans';end if;
   if row_old.cancelled_at is not null then raise exception 'Cancelled recurring costs require an explicit restore review';end if;
   if p_action='CANCEL' then update finance_private.recurring_costs set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason=nullif(btrim(p_reason),''),record_version=record_version+1 where id=rid and cancelled_at is null;
   elsif p_action='STOP' then update finance_private.recurring_costs set end_month=p_effective_month,record_version=record_version+1 where id=rid and cancelled_at is null and p_effective_month>=start_month;
   elsif p_action in ('UPDATE','OVERRIDE_MONTH') then
    if p_effective_month<row_old.start_month or (row_old.end_month is not null and p_effective_month>row_old.end_month) then raise exception 'Effective month is outside this obligation version';end if;
    if exists(select 1 from finance_private.recurring_costs c where c.obligation_id=row_old.obligation_id and c.id<>row_old.id and c.cancelled_at is null and c.start_month>row_old.start_month) then raise exception 'A later obligation version already exists. Review the full timeline before changing an earlier version.';end if;
    if p_action='OVERRIDE_MONTH' then
     if p_effective_month>row_old.start_month then update finance_private.recurring_costs set end_month=(p_effective_month-interval '1 month')::date,record_version=record_version+1 where id=rid;else update finance_private.recurring_costs set end_month=p_effective_month,plate_key=coalesce(plate,plate_key),cost_type=coalesce(nullif(btrim(p_record->>'cost_type'),''),cost_type),monthly_amount=coalesce(nullif(p_record->>'monthly_amount','')::numeric,monthly_amount),payee=nullif(btrim(p_record->>'payee'),''),notes=nullif(btrim(p_record->>'notes'),''),record_version=record_version+1 where id=rid;end if;
     if p_effective_month>row_old.start_month then insert into finance_private.recurring_costs(obligation_id,version_no,plate_key,start_month,end_month,cost_type,monthly_amount,payee,notes,source_upload_id) values(row_old.obligation_id,(select max(version_no)+1 from finance_private.recurring_costs where obligation_id=row_old.obligation_id),coalesce(plate,row_old.plate_key),p_effective_month,p_effective_month,coalesce(nullif(btrim(p_record->>'cost_type'),''),row_old.cost_type),coalesce(nullif(p_record->>'monthly_amount','')::numeric,row_old.monthly_amount),nullif(btrim(p_record->>'payee'),''),nullif(btrim(p_record->>'notes'),''),row_old.source_upload_id);end if;
     if row_old.end_month is null or row_old.end_month>p_effective_month then insert into finance_private.recurring_costs(obligation_id,version_no,plate_key,start_month,end_month,cost_type,monthly_amount,payee,notes,source_upload_id) values(row_old.obligation_id,(select max(version_no)+1 from finance_private.recurring_costs where obligation_id=row_old.obligation_id),row_old.plate_key,(p_effective_month+interval '1 month')::date,row_old.end_month,row_old.cost_type,row_old.monthly_amount,row_old.payee,row_old.notes,row_old.source_upload_id);end if;
    elsif p_action='UPDATE' then
    if p_effective_month>row_old.start_month then
     update finance_private.recurring_costs set end_month=(p_effective_month-interval '1 month')::date,record_version=record_version+1 where id=rid;
     insert into finance_private.recurring_costs(obligation_id,version_no,plate_key,start_month,end_month,cost_type,monthly_amount,payee,notes,source_upload_id)
     values(row_old.obligation_id,(select max(version_no)+1 from finance_private.recurring_costs where obligation_id=row_old.obligation_id),coalesce(plate,row_old.plate_key),p_effective_month,nullif(p_record->>'end_month','')::date,coalesce(nullif(btrim(p_record->>'cost_type'),''),row_old.cost_type),coalesce(nullif(p_record->>'monthly_amount','')::numeric,row_old.monthly_amount),nullif(btrim(p_record->>'payee'),''),nullif(btrim(p_record->>'notes'),''),row_old.source_upload_id) returning id into new_id;
    else
     update finance_private.recurring_costs set plate_key=coalesce(plate,plate_key),end_month=nullif(p_record->>'end_month','')::date,cost_type=coalesce(nullif(btrim(p_record->>'cost_type'),''),cost_type),monthly_amount=coalesce(nullif(p_record->>'monthly_amount','')::numeric,monthly_amount),payee=nullif(btrim(p_record->>'payee'),''),notes=nullif(btrim(p_record->>'notes'),''),record_version=record_version+1 where id=rid and cancelled_at is null;
    end if;end if;
   end if;
  end if;
  perform finance_private.mark_month_changed(p_effective_month,true);
 elsif p_kind='expense' then
  if p_action='ADD' then
   if (p_record->>'finance_month')::date is distinct from p_effective_month then raise exception 'Expense month does not match the reviewed Finance month';end if;
   insert into finance_private.expenses(finance_month,billing_date,plate_key,category,payment_source,supplier,amount,reference,description,frequency,start_month,end_month,source,notes)
   values((p_record->>'finance_month')::date,nullif(p_record->>'billing_date','')::date,plate,btrim(p_record->>'category'),p_record->>'payment_source',nullif(btrim(p_record->>'supplier'),''),(p_record->>'amount')::numeric,nullif(btrim(p_record->>'reference'),''),nullif(btrim(p_record->>'description'),''),coalesce(nullif(p_record->>'frequency',''),'ONE_OFF'),nullif(p_record->>'start_month','')::date,nullif(p_record->>'end_month','')::date,nullif(btrim(p_record->>'source'),''),nullif(btrim(p_record->>'notes'),''));
  else
   select to_jsonb(e) into before_exp from finance_private.expenses e where id=rid for update;if before_exp is null then raise exception 'Expense no longer exists';end if;
   if (before_exp->>'finance_month')::date is distinct from p_effective_month or (p_record ? 'finance_month' and (p_record->>'finance_month')::date is distinct from p_effective_month) then raise exception 'Expense belongs to a different Finance month';end if;
   if p_action='CANCEL' then
    if exists(select 1 from finance_private.bank_rows where expense_id=rid) then raise exception 'A bank review depends on this expense';end if;
    update finance_private.expenses set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason=nullif(btrim(p_reason),''),record_version=record_version+1 where id=rid and cancelled_at is null;
    update finance_private.fixed_cost_occurrences set cancelled_at=now() where expense_id=rid;
   elsif p_action='UPDATE' then
    if exists(select 1 from finance_private.workshop_allocations wa join finance_private.workshop_summaries s on s.id=wa.summary_id where wa.expense_id=rid and (p_record->>'payment_source'<>'Workshop Billing' or s.finance_month<>p_effective_month or (s.business_unit is not null and s.business_unit is distinct from (select business_unit from finance_private.vehicles where plate_key=plate)) or (select coalesce(sum(x.amount),0) from finance_private.workshop_allocations a join finance_private.expenses x on x.id=a.expense_id where a.summary_id=s.id and a.expense_id<>rid and x.cancelled_at is null)+(p_record->>'amount')::numeric>s.amount)) then raise exception 'Workshop allocation would no longer match its summary or would exceed the total';end if;
    update finance_private.expenses set billing_date=nullif(p_record->>'billing_date','')::date,plate_key=plate,category=btrim(p_record->>'category'),payment_source=p_record->>'payment_source',supplier=nullif(btrim(p_record->>'supplier'),''),amount=(p_record->>'amount')::numeric,reference=nullif(btrim(p_record->>'reference'),''),description=nullif(btrim(p_record->>'description'),''),frequency=coalesce(nullif(p_record->>'frequency',''),'ONE_OFF'),start_month=nullif(p_record->>'start_month','')::date,end_month=nullif(p_record->>'end_month','')::date,source=nullif(btrim(p_record->>'source'),''),notes=nullif(btrim(p_record->>'notes'),''),record_version=record_version+1 where id=rid and cancelled_at is null;end if;
  end if;perform finance_private.mark_month_changed(p_effective_month,false);
 elsif p_kind='insurance' then
  if p_action='ADD' then insert into finance_private.insurance(plate_key,premium,payment_date,coverage_start,coverage_end,responsibility,supplier,reference,source) values(plate,(p_record->>'premium')::numeric,nullif(p_record->>'payment_date','')::date,nullif(p_record->>'coverage_start','')::date,nullif(p_record->>'coverage_end','')::date,finance_private.normalize_insurance_responsibility(p_record->>'responsibility'),nullif(btrim(p_record->>'supplier'),''),nullif(btrim(p_record->>'reference'),''),coalesce(nullif(btrim(p_record->>'source'),''),'Manual'));
  elsif p_action='CANCEL' then select to_jsonb(i) into old from finance_private.insurance i where id=rid for update;if old is null then raise exception 'Insurance policy no longer exists';end if;update finance_private.insurance set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason=nullif(btrim(p_reason),''),record_version=record_version+1 where id=rid and cancelled_at is null;
  elsif p_action='UPDATE' then update finance_private.insurance set plate_key=plate,premium=(p_record->>'premium')::numeric,payment_date=nullif(p_record->>'payment_date','')::date,coverage_start=nullif(p_record->>'coverage_start','')::date,coverage_end=nullif(p_record->>'coverage_end','')::date,responsibility=finance_private.normalize_insurance_responsibility(p_record->>'responsibility'),supplier=nullif(btrim(p_record->>'supplier'),''),reference=nullif(btrim(p_record->>'reference'),''),source=coalesce(nullif(btrim(p_record->>'source'),''),source),record_version=record_version+1 where id=rid and cancelled_at is null;
  else raise exception 'Invalid insurance action';end if;perform finance_private.mark_month_changed(p_effective_month,true);
 elsif p_kind='vehicle' and p_action='ADD' then
  if plate is null or exists(select 1 from finance_private.vehicles where plate_key=plate) then raise exception 'Vehicle plate is missing or already exists';end if;
  insert into finance_private.vehicles(plate_key,display_plate,model,business_unit,ownership_type,status) values(plate,btrim(p_record->>'display_plate'),nullif(btrim(p_record->>'model'),''),p_record->>'business_unit',btrim(p_record->>'ownership_type'),btrim(p_record->>'status')) returning vehicle_id into rid;
  insert into finance_private.vehicle_plate_history(vehicle_id,plate_key,display_plate) values(rid,plate,btrim(p_record->>'display_plate')) on conflict(vehicle_id,plate_key) do update set display_plate=excluded.display_plate;perform finance_private.mark_month_changed(p_effective_month,true);
 elsif p_kind='vehicle' and p_action='UPDATE' then
  declare vid uuid:=nullif(p_record->>'vehicle_id','')::uuid;current_plate text;new_business text:=p_record->>'business_unit';begin
   select plate_key into current_plate from finance_private.vehicles where vehicle_id=vid and deleted_at is null for update;if current_plate is null then raise exception 'Vehicle no longer exists';end if;
   if plate is distinct from current_plate then raise exception 'Use Correct plate to change a registration';end if;
   if exists(select 1 from finance_private.workshop_allocations wa join finance_private.expenses e on e.id=wa.expense_id join finance_private.workshop_summaries s on s.id=wa.summary_id where e.plate_key=current_plate and e.cancelled_at is null and s.cancelled_at is null and s.business_unit is not null and s.business_unit is distinct from new_business) then raise exception 'Vehicle business conflicts with an allocated workshop summary';end if;
   update finance_private.vehicles set display_plate=btrim(p_record->>'display_plate'),model=nullif(btrim(p_record->>'model'),''),business_unit=new_business,ownership_type=btrim(p_record->>'ownership_type'),status=btrim(p_record->>'status') where vehicle_id=vid;
  end;perform finance_private.mark_month_changed(p_effective_month,true);
 elsif p_kind='vehicle' and p_action='CORRECT_PLATE' then
  declare old_plate text:=nullif(regexp_replace(upper(p_record->>'old_plate'),'\s','','g'),'');new_plate text:=plate;vid uuid;new_business text:=p_record->>'business_unit';begin
   if new_plate is null or exists(select 1 from finance_private.vehicles where plate_key=new_plate) then raise exception 'Corrected plate collides with an existing Finance vehicle';end if;
   select vehicle_id into vid from finance_private.vehicles where plate_key=old_plate and deleted_at is null for update;if vid is null then raise exception 'Vehicle no longer exists';end if;new_business:=coalesce(nullif(new_business,''),(select business_unit from finance_private.vehicles where vehicle_id=vid));
   if exists(select 1 from finance_private.workshop_allocations wa join finance_private.expenses e on e.id=wa.expense_id join finance_private.workshop_summaries s on s.id=wa.summary_id where e.plate_key=old_plate and e.cancelled_at is null and s.cancelled_at is null and s.business_unit is not null and s.business_unit is distinct from new_business) then raise exception 'Vehicle business conflicts with an allocated workshop summary';end if;
   update finance_private.vehicle_plate_history set valid_until=now(),correction_reason=nullif(btrim(p_reason),'') where vehicle_id=vid and plate_key=old_plate and valid_until is null;
   update finance_private.vehicles set plate_key=new_plate,display_plate=btrim(p_record->>'display_plate'),model=case when p_record ? 'model' then nullif(btrim(p_record->>'model'),'') else model end,business_unit=new_business,ownership_type=coalesce(nullif(btrim(p_record->>'ownership_type'),''),ownership_type),status=coalesce(nullif(btrim(p_record->>'status'),''),status) where vehicle_id=vid;
   update finance_private.recurring_costs set plate_key=new_plate where plate_key=old_plate;update finance_private.vehicle_loans set plate_key=new_plate,display_plate=btrim(p_record->>'display_plate'),updated_at=now(),updated_by=auth.uid() where plate_key=old_plate and cancelled_at is null; -- Added by 20261021090000_vehicle_loans.sql
   update finance_private.insurance set plate_key=new_plate where plate_key=old_plate;update finance_private.expenses set plate_key=new_plate where plate_key=old_plate;update finance_private.other_income set plate_key=new_plate,record_version=record_version+1 where plate_key=old_plate;update finance_private.ehailing set plate_key=new_plate where plate_key=old_plate;update finance_private.smart_rows set plate_key=new_plate,display_plate=btrim(p_record->>'display_plate') where plate_key=old_plate;
   insert into finance_private.vehicle_plate_history(vehicle_id,plate_key,display_plate,correction_reason) values(vid,new_plate,btrim(p_record->>'display_plate'),nullif(btrim(p_reason),''));
  end;perform finance_private.mark_month_changed(p_effective_month,true);
 else raise exception 'Unsupported Finance record mutation';end if;
 insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),p_effective_month,case when p_action='CANCEL' then 'CANCEL_FINANCE_RECORD' else 'MUTATE_FINANCE_RECORD' end,jsonb_strip_nulls(jsonb_build_object('kind',p_kind,'action',p_action,'id',coalesce(rid,new_id),'reason',nullif(btrim(p_reason),''),'before',old,'expense_before',before_exp)));
 return finance_private.input(p_effective_month);
end$$;

-- 4. The loans list (not deleted), each with its monthly cost's id.
create or replace function finance_private.vehicle_loan_rows() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(l) - 'cancelled_at' - 'cancelled_by' - 'cancellation_reason' order by l.plate_key, l.first_payment_date, l.id), '[]'::jsonb)
  from finance_private.vehicle_loans l where l.cancelled_at is null
$$;
create or replace function finance_private.vehicle_loans() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform finance_private.require_admin();
  return finance_private.vehicle_loan_rows();
end$$;

-- 5. Add, edit or delete a loan, and with it its "Hire Purchase / Loan" monthly cost, in one transaction:
--    cost_type 'Hire Purchase / Loan', payee = bank, monthly_amount = instalment, start_month = the first payment's
--    month, end_month = the last instalment's month (first month + tenure - 1). A settled or sold loan stops costing
--    from the month it closed: end_month = the month before (a loan settled in June ends in May), never earlier than
--    the start month and never later than the last instalment month. On ADD, the car's one Hire Purchase / Loan cost
--    typed in Records for the loan's months (if any) is adopted instead of adding a second one.
create or replace function finance_private.save_vehicle_loan(p_action text, p_record jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  rid uuid := nullif(p_record->>'id', '')::uuid;
  before_loan finance_private.vehicle_loans%rowtype;
  saved finance_private.vehicle_loans%rowtype;
  plate text;
  shown text;
  v_bank text := nullif(btrim(p_record->>'bank'), '');
  v_status text := coalesce(nullif(upper(btrim(p_record->>'status')), ''), 'ACTIVE');
  v_closed date := nullif(p_record->>'closed_on', '')::date;
  v_first date := nullif(p_record->>'first_payment_date', '')::date;
  v_tenure integer := nullif(p_record->>'tenure_months', '')::integer;
  v_amount numeric := nullif(p_record->>'finance_amount', '')::numeric;
  v_rate numeric := coalesce(nullif(p_record->>'flat_rate_percent', '')::numeric, 0);
  v_down numeric := coalesce(nullif(p_record->>'downpayment', '')::numeric, 0);
  v_instalment numeric := nullif(p_record->>'monthly_instalment', '')::numeric;
  start_m date;
  last_m date;
  end_m date;
  cost_id uuid;
  candidates integer;
begin
  perform finance_private.lock_finance();
  perform set_config('finance.vehicle_loan_write', 'on', true);
  if p_action is null or p_action not in ('ADD', 'UPDATE', 'DELETE') or jsonb_typeof(p_record) is distinct from 'object' then
    raise exception 'Invalid vehicle loan change';
  end if;
  if p_action <> 'ADD' then
    select * into before_loan from finance_private.vehicle_loans where id = rid for update;
    if not found or before_loan.cancelled_at is not null then raise exception 'This loan no longer exists. Reload Vehicle loans.'; end if;
    if nullif(p_record->>'record_version', '')::integer is distinct from before_loan.record_version then
      raise exception 'This loan was changed elsewhere. Reload Vehicle loans and try again.';
    end if;
  end if;

  if p_action = 'DELETE' then
    if nullif(btrim(p_reason), '') is null then raise exception 'Enter a reason for deleting this loan'; end if;
    update finance_private.vehicle_loans set cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = btrim(p_reason),
      updated_at = now(), updated_by = auth.uid(), record_version = record_version + 1
      where id = rid returning * into saved;
    update finance_private.recurring_costs set cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = btrim(p_reason),
      record_version = record_version + 1
      where id = before_loan.recurring_cost_id and cancelled_at is null;
  else
    plate := finance_private.canonical_plate(p_record->>'plate_key');
    select v.display_plate into shown from finance_private.vehicles v where v.plate_key = plate and v.deleted_at is null;
    if shown is null then raise exception 'Add this car to Finance''s vehicle list first'; end if;
    if v_bank is null then raise exception 'Enter the bank'; end if;
    if v_amount is null or v_amount <= 0 then raise exception 'Enter the finance amount'; end if;
    if v_rate < 0 then raise exception 'The flat rate cannot be below zero'; end if;
    if v_tenure is null or v_tenure <= 0 then raise exception 'Enter the tenure in months'; end if;
    if v_first is null then raise exception 'Enter the first payment date'; end if;
    if v_down < 0 then raise exception 'The downpayment cannot be below zero'; end if;
    if v_instalment is null or v_instalment <= 0 then raise exception 'Enter the monthly instalment'; end if;
    if v_status not in ('ACTIVE', 'SETTLED', 'SOLD') then raise exception 'Choose Active, Settled or Car sold'; end if;
    if v_status = 'ACTIVE' then v_closed := null;
    elsif v_closed is null then raise exception 'Enter the date the loan was settled or the car sold'; end if;
    if v_status = 'ACTIVE' and exists (select 1 from finance_private.vehicle_loans l where l.plate_key = plate and l.status = 'ACTIVE'
        and l.cancelled_at is null and l.id is distinct from rid) then
      raise exception 'This car already has an active loan. Edit that loan, or mark it settled first.';
    end if;

    start_m := date_trunc('month', v_first)::date;
    last_m := (start_m + make_interval(months => v_tenure - 1))::date;
    end_m := last_m;
    if v_closed is not null then
      end_m := greatest(start_m, least(last_m, (date_trunc('month', v_closed) - interval '1 month')::date));
    end if;

    if p_action = 'ADD' then
      select count(*)::integer, min(c.id::text)::uuid into candidates, cost_id from finance_private.recurring_costs c
        where c.cancelled_at is null and c.loan_id is null and c.cost_type = 'Hire Purchase / Loan' and c.plate_key = plate
          and c.start_month <= last_m and coalesce(c.end_month, 'infinity'::date) >= start_m;
      if candidates > 1 then
        raise exception 'This car has more than one Hire Purchase / Loan monthly cost in Records for these months. Delete the extra one in Records first.';
      end if;
      insert into finance_private.vehicle_loans(plate_key, display_plate, bank, finance_amount, flat_rate_percent, tenure_months, first_payment_date,
          downpayment, monthly_instalment, status, closed_on, notes, created_by, updated_by)
        values (plate, shown, v_bank, v_amount, v_rate, v_tenure, v_first, v_down, v_instalment, v_status, v_closed,
          nullif(btrim(p_record->>'notes'), ''), auth.uid(), auth.uid())
        returning * into saved;
    else
      update finance_private.vehicle_loans set plate_key = plate, display_plate = shown, bank = v_bank, finance_amount = v_amount,
          flat_rate_percent = v_rate, tenure_months = v_tenure, first_payment_date = v_first, downpayment = v_down,
          monthly_instalment = v_instalment, status = v_status, closed_on = v_closed, notes = nullif(btrim(p_record->>'notes'), ''),
          updated_at = now(), updated_by = auth.uid(), record_version = record_version + 1
        where id = rid returning * into saved;
      select c.id into cost_id from finance_private.recurring_costs c where c.id = before_loan.recurring_cost_id and c.cancelled_at is null;
    end if;

    if cost_id is null then
      insert into finance_private.recurring_costs(obligation_id, plate_key, start_month, end_month, cost_type, monthly_amount, payee, loan_id)
        values (gen_random_uuid(), plate, start_m, end_m, 'Hire Purchase / Loan', v_instalment, v_bank, saved.id)
        returning id into cost_id;
    else
      update finance_private.recurring_costs set plate_key = plate, start_month = start_m, end_month = end_m, cost_type = 'Hire Purchase / Loan',
          monthly_amount = v_instalment, payee = v_bank, loan_id = saved.id, record_version = record_version + 1
        where id = cost_id;
    end if;
    update finance_private.vehicle_loans set recurring_cost_id = cost_id where id = saved.id returning * into saved;
  end if;

  -- Like an edit of a monthly cost in Records: every open month goes back to Draft; closed months keep their snapshot.
  perform finance_private.mark_month_changed(date_trunc('month', current_date)::date, true);
  insert into finance_private.audit(actor, finance_month, action, details)
    values (auth.uid(), null, 'SAVE_VEHICLE_LOAN', jsonb_strip_nulls(jsonb_build_object('action', p_action, 'id', saved.id,
      'recurring_cost_id', saved.recurring_cost_id, 'reason', nullif(btrim(p_reason), ''),
      'before', case when p_action = 'ADD' then null else to_jsonb(before_loan) end, 'after', to_jsonb(saved))));
  return finance_private.vehicle_loan_rows();
end$$;

create or replace function public.finance_vehicle_loans() returns jsonb
  language sql security invoker set search_path = '' as $$select finance_private.vehicle_loans()$$;
create or replace function public.finance_save_vehicle_loan(p_action text, p_record jsonb, p_reason text default '') returns jsonb
  language sql security invoker set search_path = '' as $$select finance_private.save_vehicle_loan(p_action, p_record, p_reason)$$;

revoke all on function finance_private.vehicle_loan_rows() from public, anon, authenticated;
revoke all on function finance_private.vehicle_loans() from public, anon, authenticated;
grant execute on function finance_private.vehicle_loans() to authenticated;
revoke all on function finance_private.save_vehicle_loan(text, jsonb, text) from public, anon, authenticated;
grant execute on function finance_private.save_vehicle_loan(text, jsonb, text) to authenticated;
revoke all on function public.finance_vehicle_loans() from public, anon, authenticated;
grant execute on function public.finance_vehicle_loans() to authenticated;
revoke all on function public.finance_save_vehicle_loan(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.finance_save_vehicle_loan(text, jsonb, text) to authenticated;

commit;

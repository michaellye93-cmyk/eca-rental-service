-- Monthly recurring Other Income (owner's decision, 21 Oct 2026).
-- An Other Income line is One-off (as before) or Monthly recurring. A recurring line starts a series that carries
-- forward: when a Draft Finance month opens, each active series gets a DRAFT line in that month, confirmed by hand when
-- the money arrives (so the P&L never counts cash not yet received). Editing a generated line changes that month only;
-- Stop recurring ends the series after that line's month. The Cash page counts recurring income at its amount.
-- Built like Operation Fix Costs (fixed_cost_templates / generate_fixed_costs). Run it in the Supabase SQL Editor for
-- RentalDatabase before the frontend that uses it. All-or-nothing, and safe to run again.
begin;

-- 1. The series: what each month's line is made from.
create table if not exists finance_private.other_income_series(
  id uuid primary key default gen_random_uuid(),
  income_type text not null check (btrim(income_type) <> ''),
  amount numeric(16,2) not null check (amount >= 0),
  plate_key text,
  business_unit text check (business_unit in ('E-HAILING','DAILY RENTAL','SMART DRIVE','SAMBUNG BAYAR')),
  reference text,
  notes text,
  effective_from date not null check (extract(day from effective_from) = 1),
  effective_until date check (extract(day from effective_until) = 1),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancellation_reason text,
  record_version integer not null default 1,
  check (plate_key is not null or business_unit is not null),
  check (effective_until is null or effective_until >= effective_from)
);
alter table finance_private.other_income_series enable row level security;
revoke all on finance_private.other_income_series from public, anon, authenticated;

-- 2. Each line made from a series points to it; a series has at most one active line per month.
alter table finance_private.other_income add column if not exists series_id uuid references finance_private.other_income_series(id);
create unique index if not exists finance_other_income_series_month on finance_private.other_income(series_id, finance_month)
  where cancelled_at is null and series_id is not null;

-- 3. A month's lines from the active series. Any line of the series already in the month counts, a deleted one too, so a
--    line deleted by hand is not made again. The business comes from the vehicle when there is one, as save_other_income does.
create or replace function finance_private.generate_other_income_core(p_month date) returns integer
language plpgsql security definer set search_path='' as $$
declare s finance_private.other_income_series%rowtype; business text; written integer := 0;
begin
  for s in select * from finance_private.other_income_series
    where cancelled_at is null and effective_from <= p_month and (effective_until is null or effective_until >= p_month)
    order by created_at, id loop
    continue when exists (select 1 from finance_private.other_income where series_id = s.id and finance_month = p_month);
    business := coalesce((select v.business_unit from finance_private.vehicles v where v.plate_key = s.plate_key and v.deleted_at is null), s.business_unit);
    continue when business is null;
    insert into finance_private.other_income(finance_month, status, income_type, amount, plate_key, business_unit, reference, notes, source,
        confirmation_key, created_by, series_id)
      values (p_month, 'DRAFT', s.income_type, s.amount, s.plate_key, business, s.reference, s.notes, 'Recurring Other Income',
        md5(concat_ws('|', 'series', s.id, p_month)), coalesce(auth.uid(), s.created_by), s.id);
    written := written + 1;
  end loop;
  return written;
end$$;

-- 4. Opening a Draft month creates its Operation Fix Cost lines and now its recurring Other Income lines (same body as
--    20260920070959, plus the second count).
create or replace function finance_private.generate_fixed_costs(p_month date,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$declare n integer;begin perform finance_private.assert_open_revision(p_month,p_revision);n:=finance_private.generate_fixed_costs_core(p_month)+finance_private.generate_other_income_core(p_month);if n>0 then perform finance_private.mark_month_changed(p_month,false);end if;return finance_private.input(p_month);end$$;

-- 5. Saving Other Income (same as 20260920070959's latest version, plus): ADD with frequency MONTHLY_RECURRING also
--    creates the series (from this month, until end_month or ongoing) and links the line to it; STOP_RECURRING on a
--    linked line ends its series at that line's month (the line stays) and removes Draft lines already made for later
--    open months. UPDATE and CANCEL work on the one line only.
create or replace function finance_private.save_other_income(p_action text,p_record jsonb,p_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 m date:=(p_record->>'finance_month')::date;
 rid uuid:=nullif(p_record->>'id','')::uuid;
 plate text;
 business text;
 ck text;
 existing uuid;
 stored_month date;
 before jsonb;
 after jsonb;
 frequency text:=coalesce(nullif(btrim(p_record->>'frequency'),''),'ONE_OFF');
 until_month date;
 sid uuid;
 series_before jsonb;
 series_after jsonb;
 later record;
begin
 perform finance_private.lock_finance();
 if rid is not null then
  select finance_month,to_jsonb(i) into stored_month,before from finance_private.other_income i where id=rid for update;
  if stored_month is null then raise exception 'Other Income record no longer exists';end if;
  if m is distinct from stored_month then raise exception 'Other Income belongs to a different Finance month';end if;
 end if;
 perform finance_private.assert_open_revision(m,p_revision);
 if p_action='STOP_RECURRING' then
  sid:=nullif(before->>'series_id','')::uuid;
  if sid is null or (before->>'cancelled_at') is not null then raise exception 'This Other Income line is not monthly recurring';end if;
  select to_jsonb(s) into series_before from finance_private.other_income_series s where id=sid for update;
  update finance_private.other_income_series set effective_until=m,record_version=record_version+1
   where id=sid and cancelled_at is null and (effective_until is null or effective_until>m);
  for later in select i.id,i.finance_month from finance_private.other_income i join finance_private.months fm on fm.finance_month=i.finance_month
   where i.series_id=sid and i.finance_month>m and i.cancelled_at is null and i.status='DRAFT' and fm.status<>'CLOSED' order by i.finance_month loop
   update finance_private.other_income set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason='Monthly recurring stopped',record_version=record_version+1 where id=later.id;
   perform finance_private.mark_month_changed(later.finance_month,false);
  end loop;
  select to_jsonb(s) into series_after from finance_private.other_income_series s where id=sid;
  perform finance_private.mark_month_changed(m,false);
  insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),m,'SAVE_OTHER_INCOME',jsonb_build_object('action',p_action,'id',rid,'series_id',sid,'series_before',series_before,'series_after',series_after));
  return finance_private.input(m);
 end if;
 plate:=finance_private.canonical_plate(p_record->>'plate_key');
 if plate is not null then
  select business_unit into business from finance_private.vehicles where plate_key=plate and deleted_at is null;
  if business is null then raise exception 'Map the Other Income vehicle in Finance first';end if;
 else business:=p_record->>'business_unit';end if;
 ck:=md5(concat_ws('|',m,p_record->>'status',lower(btrim(p_record->>'income_type')),coalesce(plate,''),coalesce(business,''),(p_record->>'amount')::numeric,coalesce(p_record->>'receipt_date',''),coalesce(btrim(p_record->>'reference'),'')));
 if p_action='ADD' then
  if frequency not in ('ONE_OFF','MONTHLY_RECURRING') then raise exception 'Choose a frequency: One-off or Monthly recurring';end if;
  select id into existing from finance_private.other_income where confirmation_key=ck and cancelled_at is null;
  if existing is not null then return finance_private.input(m);end if;
  if frequency='MONTHLY_RECURRING' then
   until_month:=date_trunc('month',nullif(p_record->>'end_month','')::date)::date;
   if until_month<m then raise exception 'The Until month cannot be before this month';end if;
   insert into finance_private.other_income_series(income_type,amount,plate_key,business_unit,reference,notes,effective_from,effective_until,created_by)
   values(btrim(p_record->>'income_type'),(p_record->>'amount')::numeric,plate,business,nullif(btrim(p_record->>'reference'),''),nullif(btrim(p_record->>'notes'),''),m,until_month,auth.uid()) returning id into sid;
  end if;
  insert into finance_private.other_income(finance_month,status,income_type,amount,plate_key,business_unit,receipt_date,reference,notes,confirmation_key,created_by,series_id)
  values(m,p_record->>'status',btrim(p_record->>'income_type'),(p_record->>'amount')::numeric,plate,business,nullif(p_record->>'receipt_date','')::date,nullif(btrim(p_record->>'reference'),''),nullif(btrim(p_record->>'notes'),''),ck,auth.uid(),sid) returning id into rid;
 elsif p_action='UPDATE' then
  update finance_private.other_income set status=p_record->>'status',income_type=btrim(p_record->>'income_type'),amount=(p_record->>'amount')::numeric,plate_key=plate,business_unit=business,receipt_date=nullif(p_record->>'receipt_date','')::date,reference=nullif(btrim(p_record->>'reference'),''),notes=nullif(btrim(p_record->>'notes'),''),confirmation_key=ck,record_version=record_version+1 where id=rid and cancelled_at is null;
 elsif p_action='CANCEL' then
  if nullif(btrim(p_record->>'reason'),'') is null then raise exception 'Enter a correction reason';end if;
  update finance_private.other_income set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason=btrim(p_record->>'reason'),record_version=record_version+1 where id=rid and cancelled_at is null;
 else raise exception 'Invalid Other Income action';end if;
 select to_jsonb(i) into after from finance_private.other_income i where id=rid;
 perform finance_private.mark_month_changed(m,false);
 insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),m,'SAVE_OTHER_INCOME',jsonb_build_object('action',p_action,'id',rid,'reason',nullif(btrim(p_record->>'reason'),''),'before',before,'after',after));
 return finance_private.input(m);
end$$;

-- 6. A plate correction (finance_mutate_record CORRECT_PLATE changes vehicles.plate_key in place) moves the series too,
--    so later months' lines carry the corrected plate like the lines already made.
create or replace function finance_private.other_income_series_follow_plate() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update finance_private.other_income_series set plate_key = new.plate_key, record_version = record_version + 1 where plate_key = old.plate_key;
  return new;
end$$;
drop trigger if exists finance_other_income_series_follow_plate on finance_private.vehicles;
create trigger finance_other_income_series_follow_plate after update of plate_key on finance_private.vehicles
  for each row when (old.plate_key is distinct from new.plate_key) execute function finance_private.other_income_series_follow_plate();

-- 7. The month read (same as 20261006200000_driver_deposits.sql, plus the active series) lets the browser see that a Draft
--    month still needs its recurring lines. Lines carry series_id already (they are read with to_jsonb).
create or replace function finance_private.input(p_month date) returns jsonb language sql stable security definer set search_path='' as $$
 select finance_private.base_input(p_month)||jsonb_build_object(
  'bank_imports',coalesce((select jsonb_agg(to_jsonb(b)-'imported_by' order by imported_at,id) from finance_private.bank_imports b where finance_month=p_month),'[]'),
  'bank_rows',coalesce((select jsonb_agg((to_jsonb(r)-'account_key'-'fingerprint')||jsonb_build_object('match_valid',r.decision<>'MATCHED' or finance_private.bank_match_valid(p_month,r.matched_kind,r.matched_id,r.matched_ids,r.matched_deposit_ids,r.debit,r.credit)) order by r.import_id,r.source_row) from finance_private.bank_rows r join finance_private.bank_imports b on b.id=r.import_id where b.finance_month=p_month),'[]'),
  'fixed_cost_treatments',finance_private.fixed_cost_treatment_rows(),
  'deposits',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'driver_id',d.driver_id,'driver_name',dr.name,'car_plate',dr.car_plate,'kind',d.kind,'entry',d.entry,'entry_date',d.entry_date,'amount',d.amount,'method',d.method,'reference',d.reference,'note',d.note) order by d.entry_date,d.created_at) from public.driver_deposits d left join public.drivers dr on dr.id=d.driver_id where d.entry_date>=p_month and d.entry_date<p_month+interval '1 month'),'[]'),
  'deposits_held',jsonb_build_object(
   'DEPOSIT',(select coalesce(sum(case when entry='RECEIVED' then amount else -amount end),0) from public.driver_deposits where kind='DEPOSIT' and entry_date<p_month+interval '1 month'),
   'DOWNPAYMENT',(select coalesce(sum(case when entry='RECEIVED' then amount else -amount end),0) from public.driver_deposits where kind='DOWNPAYMENT' and entry_date<p_month+interval '1 month')),
  'other_income_series',coalesce((select jsonb_agg(to_jsonb(s)-'cancelled_at'-'cancelled_by'-'cancellation_reason' order by s.effective_from,s.created_at,s.id) from finance_private.other_income_series s where s.cancelled_at is null),'[]'))
$$;

-- 8. The cash outlook (same as 20260927090000, plus): each history month's recurring_other_income (its confirmed lines
--    made from a series), and recurring_ahead, the active series' amounts for this month and the next five.
create or replace function finance_private.cash_outlook(p_today date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  first_month date;
  last_day date;
begin
  perform finance_private.require_admin();
  if p_today is null then raise exception 'Choose the day to forecast from'; end if;
  first_month := date_trunc('month', p_today)::date;
  last_day := (first_month + interval '4 months')::date - 1;
  return jsonb_build_object(
    'today', p_today,
    'balances', finance_private.cash_balance_rows(),
    'months', (select jsonb_agg(jsonb_build_object(
        'month', m.month,
        'recurring', coalesce((select sum(c.monthly_amount) from finance_private.recurring_costs c
          where c.cancelled_at is null and c.start_month <= m.month and (c.end_month is null or c.end_month >= m.month)), 0),
        'fixed', coalesce((select sum(t.monthly_amount) from finance_private.fixed_cost_templates t
          where t.cancelled_at is null and t.effective_from <= m.month and (t.effective_until is null or t.effective_until >= m.month)), 0)
      ) order by m.month)
      from (select (first_month + make_interval(months => g))::date as month from generate_series(0, 3) g) m),
    'insurance', coalesce((select jsonb_agg(jsonb_build_object('plate_key', i.plate_key, 'display_plate', i.display_plate,
        'due_date', i.due_date, 'amount', i.amount, 'kind', i.kind) order by i.due_date, i.plate_key, i.kind)
      from (
        select p.plate_key, v.display_plate, p.coverage_start as due_date, p.premium as amount, 'PAYMENT' as kind
        from finance_private.insurance p
        join finance_private.vehicles v on v.plate_key = p.plate_key and v.deleted_at is null
        where p.cancelled_at is null and p.responsibility = 'ECA_PAID' and p.premium > 0
          and p.coverage_start between p_today and last_day
        union all
        select latest.plate_key, v.display_plate, latest.coverage_end + 1, latest.premium, 'RENEWAL'
        from (select distinct on (p.plate_key) p.plate_key, p.coverage_end, p.premium, p.responsibility
              from finance_private.insurance p
              where p.cancelled_at is null and p.coverage_end is not null
              order by p.plate_key, p.coverage_end desc) latest
        join finance_private.vehicles v on v.plate_key = latest.plate_key and v.deleted_at is null
        where latest.responsibility = 'ECA_PAID' and latest.premium > 0
          and latest.coverage_end + 1 between p_today and last_day
      ) i), '[]'::jsonb),
    'history', (select jsonb_agg(jsonb_build_object(
        'month', h.month,
        'has_data', exists (select 1 from finance_private.months fm where fm.finance_month = h.month and fm.refreshed_at is not null)
          -- expenses Finance generates from fixed-cost templates do not count as data entered for the month
          or exists (select 1 from finance_private.expenses e where e.finance_month = h.month and e.cancelled_at is null and e.fixed_cost_template_id is null)
          or exists (select 1 from finance_private.imports si where si.finance_month = h.month and si.kind = 'SMART_DRIVE' and si.status = 'POSTED')
          or exists (select 1 from finance_private.other_income oi where oi.finance_month = h.month and oi.status = 'CONFIRMED' and oi.cancelled_at is null),
        'workshop', coalesce((select sum(e.amount) from finance_private.expenses e
            where e.finance_month = h.month and e.cancelled_at is null and e.payment_source = 'Workshop Billing'), 0)
          + coalesce((select sum(greatest(s.amount - coalesce((select sum(x.amount) from finance_private.workshop_allocations wa
                join finance_private.expenses x on x.id = wa.expense_id where wa.summary_id = s.id and x.cancelled_at is null), 0), 0))
            from finance_private.workshop_summaries s where s.finance_month = h.month and s.cancelled_at is null), 0),
        'vehicle_costs', coalesce((select sum(e.amount) from finance_private.expenses e
            where e.finance_month = h.month and e.cancelled_at is null and e.payment_source = 'Vehicle Direct Cost'), 0),
        'one_off_opex', coalesce((select sum(e.amount) from finance_private.expenses e
            where e.finance_month = h.month and e.cancelled_at is null and e.payment_source = 'Corporate Opex'
              and e.fixed_cost_template_id is null and e.frequency = 'ONE_OFF'), 0),
        'smart_drive_net', coalesce((select sum(r.gross_revenue - r.commission) from finance_private.smart_rows r
            join finance_private.imports si on si.id = r.import_id
            where si.finance_month = h.month and si.kind = 'SMART_DRIVE' and si.status = 'POSTED'), 0),
        'other_income', coalesce((select sum(oi.amount) from finance_private.other_income oi
            where oi.finance_month = h.month and oi.status = 'CONFIRMED' and oi.cancelled_at is null), 0),
        'recurring_other_income', coalesce((select sum(oi.amount) from finance_private.other_income oi
            where oi.finance_month = h.month and oi.status = 'CONFIRMED' and oi.cancelled_at is null and oi.series_id is not null), 0)
      ) order by h.month)
      from (select (first_month - make_interval(months => g))::date as month from generate_series(1, 3) g) h),
    'duplicate_recurring', (select jsonb_build_object('vehicles', count(distinct d.plate_key), 'monthly_amount', coalesce(sum(d.monthly_amount), 0))
      from finance_private.recurring_costs d
      where d.cancelled_at is null and d.start_month <= first_month and (d.end_month is null or d.end_month >= first_month)
        and exists (select 1 from finance_private.recurring_costs o
          where o.cancelled_at is null and o.id < d.id and o.plate_key = d.plate_key and o.monthly_amount = d.monthly_amount
            and o.obligation_id <> d.obligation_id
            and o.start_month <= first_month and (o.end_month is null or o.end_month >= first_month)
            and not exists (select 1 from finance_private.recurring_duplicate_resolutions r
              where r.obligation_a = least(o.obligation_id, d.obligation_id) and r.obligation_b = greatest(o.obligation_id, d.obligation_id)))),
    'recurring_ahead', (select jsonb_agg(jsonb_build_object(
        'month', a.month,
        'amount', coalesce((select sum(s.amount) from finance_private.other_income_series s
          where s.cancelled_at is null and s.effective_from <= a.month and (s.effective_until is null or s.effective_until >= a.month)), 0)
      ) order by a.month)
      from (select (first_month + make_interval(months => g))::date as month from generate_series(0, 5) g) a)
  );
end$$;

-- 9. The new helpers are private (replaced functions keep their existing grants); the browser reaches all of this
--    only through the existing public.finance_* entry points.
revoke all on function finance_private.generate_other_income_core(date), finance_private.other_income_series_follow_plate(),
  finance_private.input(date) from public, anon, authenticated;

commit;

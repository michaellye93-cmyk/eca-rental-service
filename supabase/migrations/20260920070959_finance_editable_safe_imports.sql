-- Editable Finance records, record-idempotent imports, fixed operating costs,
-- workshop summaries and confirmed Other Income. All client access remains RPC-only.

alter table finance_private.vehicles add column vehicle_id uuid not null default gen_random_uuid();
alter table finance_private.vehicles add column model text;
create unique index finance_vehicle_identity on finance_private.vehicles(vehicle_id);
create table finance_private.vehicle_plate_history(
 vehicle_id uuid not null, plate_key text not null, display_plate text not null,
 valid_from timestamptz not null default now(), valid_until timestamptz,
 correction_reason text, primary key(vehicle_id,plate_key)
);
insert into finance_private.vehicle_plate_history(vehicle_id,plate_key,display_plate)
select vehicle_id,plate_key,display_plate from finance_private.vehicles;
create function finance_private.track_new_vehicle_plate() returns trigger language plpgsql set search_path='' as $$begin insert into finance_private.vehicle_plate_history(vehicle_id,plate_key,display_plate) values(new.vehicle_id,new.plate_key,new.display_plate) on conflict(vehicle_id,plate_key) do nothing;return new;end$$;
create trigger finance_track_new_vehicle_plate after insert on finance_private.vehicles for each row execute function finance_private.track_new_vehicle_plate();
revoke all on function finance_private.track_new_vehicle_plate() from public,anon,authenticated;
create function finance_private.canonical_plate(p_plate text) returns text language plpgsql stable security definer set search_path='' as $$declare normalized text:=nullif(regexp_replace(upper(p_plate),'\s','','g'),'');resolved text;matches integer;begin if normalized is null then return null;end if;select plate_key into resolved from finance_private.vehicles where plate_key=normalized and deleted_at is null;if resolved is not null then return resolved;end if;select count(distinct h.vehicle_id),min(v.plate_key) into matches,resolved from finance_private.vehicle_plate_history h join finance_private.vehicles v on v.vehicle_id=h.vehicle_id and v.deleted_at is null where h.plate_key=normalized;if matches>1 then raise exception 'Historical plate alias is ambiguous. Resolve the Vehicle Master before importing or refreshing.';end if;return resolved;end$$;

alter table finance_private.recurring_costs
 add column obligation_id uuid,
 add column version_no integer not null default 1,
 add column record_version integer not null default 1,
 add column cancelled_at timestamptz,
 add column cancelled_by uuid,
 add column cancellation_reason text,
 add column source_upload_id uuid references finance_private.section_uploads(id);
update finance_private.recurring_costs set obligation_id=id where obligation_id is null;
alter table finance_private.recurring_costs alter column obligation_id set not null;
create unique index finance_recurring_obligation_version on finance_private.recurring_costs(obligation_id,version_no);
create index finance_recurring_active_months on finance_private.recurring_costs(start_month,end_month) where cancelled_at is null;
create function finance_private.derive_recurring_identity() returns trigger language plpgsql set search_path='' as $$begin new.obligation_id:=coalesce(new.obligation_id,new.id);return new;end$$;
create trigger derive_recurring_identity before insert on finance_private.recurring_costs for each row execute function finance_private.derive_recurring_identity();
revoke all on function finance_private.derive_recurring_identity() from public,anon,authenticated;

alter table finance_private.insurance
 add column record_version integer not null default 1,
 add column cancelled_at timestamptz,
 add column cancelled_by uuid,
 add column cancellation_reason text,
 add column source_upload_id uuid references finance_private.section_uploads(id);
alter table finance_private.expenses
 add column record_version integer not null default 1,
 add column cancelled_at timestamptz,
 add column cancelled_by uuid,
 add column cancellation_reason text,
 add column source_upload_id uuid references finance_private.section_uploads(id);
do $$declare c text;begin
 for c in select conname from pg_constraint where conrelid='finance_private.expenses'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%frequency%'
 loop execute format('alter table finance_private.expenses drop constraint %I',c);end loop;
end$$;
alter table finance_private.expenses add constraint finance_expense_frequency_check check(frequency in ('ONE_OFF','MONTHLY_RECURRING','MONTHLY_SUMMARY'));
alter table finance_private.expenses add constraint finance_expense_frequency_dates_v2 check(
 (frequency='ONE_OFF' and billing_date is not null and start_month is null and end_month is null)
 or (frequency='MONTHLY_RECURRING' and payment_source='Corporate Opex' and start_month is not null and extract(day from start_month)=1 and start_month<=finance_month and (end_month is null or (extract(day from end_month)=1 and end_month>=finance_month and end_month>=start_month)))
 or (frequency='MONTHLY_SUMMARY' and payment_source in ('Workshop Billing','Vehicle Direct Cost') and billing_date is null and start_month=finance_month and end_month=finance_month));

-- Corporate categories are user managed. Vehicle and workshop classifications remain constrained.
do $$declare c text;begin
 for c in select conname from pg_constraint where conrelid='finance_private.expenses'::regclass and contype='c'
  and pg_get_constraintdef(oid) like '%Office Rental%Accounting Fee%'
 loop execute format('alter table finance_private.expenses drop constraint %I',c);end loop;
end$$;
alter table finance_private.expenses add constraint finance_expense_category_scope check(
 (payment_source='Workshop Billing' and category='Service & Maintenance') or
 (payment_source='Vehicle Direct Cost' and category in ('Road Tax','APAD / Permit','Puspakom','Tyres','Battery','Repair','Accident','Towing','Restoration','Other Vehicle Cost')) or
 (payment_source='Corporate Opex' and btrim(category)<>'')
);

create table finance_private.mutation_state(
 singleton boolean primary key default true check(singleton), generation bigint not null default 0
);
insert into finance_private.mutation_state(singleton) values(true);
create table finance_private.recurring_duplicate_resolutions(
 id uuid primary key default gen_random_uuid(), obligation_a uuid not null, obligation_b uuid not null,
 fingerprint text not null, reason text not null check(btrim(reason)<>''), resolved_at timestamptz not null default now(), resolved_by uuid not null,
 check(obligation_a<obligation_b), unique(obligation_a,obligation_b,fingerprint)
);

create table finance_private.import_previews(
 id uuid primary key default gen_random_uuid(), finance_month date not null references finance_private.months(finance_month),
 kind text not null, filename text not null, source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 mode text not null check(mode in ('UPDATE','REPLACE')), replace_upload_id uuid references finance_private.section_uploads(id),
 requested_rows jsonb not null, changes jsonb not null, month_revision integer not null, mutation_generation bigint not null,
 created_by uuid not null, created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '30 minutes',
 applied_upload_id uuid references finance_private.section_uploads(id),
 check(jsonb_typeof(requested_rows)='array' and jsonb_typeof(changes)='array')
);
alter table finance_private.section_uploads add column status text not null default 'POSTED' check(status in ('POSTED','REPLACED','UNDONE'));
alter table finance_private.section_uploads drop constraint section_uploads_kind_check;
alter table finance_private.section_uploads add constraint section_uploads_kind_check check(kind in ('VEHICLE_EXPENSE','CORPORATE_EXPENSE','VEHICLE','RECURRING_COST','INSURANCE','WORKSHOP','FIXED_COST','OTHER_INCOME'));
create table finance_private.section_upload_changes(
 upload_id uuid not null references finance_private.section_uploads(id), change_no integer not null,
 record_kind text not null, record_id uuid, action text not null,
 before_image jsonb, after_image jsonb, primary key(upload_id,change_no)
);
create index finance_upload_changes_record on finance_private.section_upload_changes(record_kind,record_id);

create table finance_private.fixed_cost_templates(
 id uuid primary key default gen_random_uuid(), series_id uuid not null default gen_random_uuid(), version_no integer not null default 1,
 category text not null check(btrim(category)<>''), monthly_amount numeric(16,2) not null check(monthly_amount>=0),
 effective_from date not null check(extract(day from effective_from)=1), effective_until date check(extract(day from effective_until)=1),
 payee text, note text, source text, linked_expense_id uuid references finance_private.expenses(id),
 source_upload_id uuid references finance_private.section_uploads(id),
 cancelled_at timestamptz, cancelled_by uuid, cancellation_reason text, record_version integer not null default 1,
 check(effective_until is null or effective_until>=effective_from), unique(series_id,version_no)
);
create index finance_fixed_cost_active on finance_private.fixed_cost_templates(effective_from,effective_until) where cancelled_at is null;
alter table finance_private.expenses add column fixed_cost_template_id uuid references finance_private.fixed_cost_templates(id);
create table finance_private.fixed_cost_occurrences(
 series_id uuid not null, template_id uuid not null references finance_private.fixed_cost_templates(id), finance_month date not null references finance_private.months(finance_month),
 expense_id uuid references finance_private.expenses(id), cancelled_at timestamptz, created_at timestamptz not null default now(),
 primary key(series_id,finance_month), unique(expense_id)
);
insert into finance_private.fixed_cost_templates(series_id,category,monthly_amount,effective_from,effective_until,payee,note,source,linked_expense_id)
select gen_random_uuid(),e.category,e.amount,e.start_month,e.end_month,e.supplier,coalesce(e.notes,e.description),e.source,e.id
from finance_private.expenses e where e.payment_source='Corporate Opex' and e.frequency='MONTHLY_RECURRING';
update finance_private.expenses e set fixed_cost_template_id=t.id from finance_private.fixed_cost_templates t where t.linked_expense_id=e.id;
insert into finance_private.fixed_cost_occurrences(series_id,template_id,finance_month,expense_id)
select t.series_id,t.id,e.finance_month,e.id from finance_private.fixed_cost_templates t join finance_private.expenses e on e.id=t.linked_expense_id;

create table finance_private.workshop_summaries(
 id uuid primary key default gen_random_uuid(), finance_month date not null references finance_private.months(finance_month),
 business_unit text check(business_unit in ('E-HAILING','DAILY RENTAL','SMART DRIVE','SAMBUNG BAYAR')),
 amount numeric(16,2) not null check(amount>=0), supplier text, reference text, note text,
 record_version integer not null default 1, cancelled_at timestamptz, cancelled_by uuid, cancellation_reason text,
 created_at timestamptz not null default now(), created_by uuid not null
);
create index finance_workshop_summary_month on finance_private.workshop_summaries(finance_month) where cancelled_at is null;
create table finance_private.workshop_allocations(
 summary_id uuid not null references finance_private.workshop_summaries(id),
 expense_id uuid not null references finance_private.expenses(id), allocated_at timestamptz not null default now(), allocated_by uuid not null,
 primary key(summary_id,expense_id), unique(expense_id)
);
create index finance_workshop_allocation_expense on finance_private.workshop_allocations(expense_id);

create table finance_private.other_income(
 id uuid primary key default gen_random_uuid(), finance_month date not null references finance_private.months(finance_month),
 status text not null check(status in ('DRAFT','CONFIRMED')), income_type text not null check(btrim(income_type)<>''),
 amount numeric(16,2) not null check(amount>=0), plate_key text, business_unit text not null check(business_unit in ('E-HAILING','DAILY RENTAL','SMART DRIVE','SAMBUNG BAYAR')),
 receipt_date date, reference text, notes text, source text not null default 'Manual / Other Income',
 confirmation_key text not null, record_version integer not null default 1,
 cancelled_at timestamptz, cancelled_by uuid, cancellation_reason text,
 created_at timestamptz not null default now(), created_by uuid not null,
 check(plate_key is not null or business_unit is not null)
);
create unique index finance_other_income_confirmation on finance_private.other_income(confirmation_key) where cancelled_at is null;
create index finance_other_income_month on finance_private.other_income(finance_month,status) where cancelled_at is null;

do $$declare t text;begin
 foreach t in array array['vehicle_plate_history','mutation_state','recurring_duplicate_resolutions','import_previews','section_upload_changes','fixed_cost_templates','fixed_cost_occurrences','workshop_summaries','workshop_allocations','other_income'] loop
  execute format('alter table finance_private.%I enable row level security',t);
  execute format('revoke all on finance_private.%I from public,anon,authenticated',t);
 end loop;
end$$;

create function finance_private.assert_open_revision(p_month date,p_revision integer) returns void
language plpgsql security definer set search_path='' as $$declare s text;r integer;begin
 perform finance_private.lock_finance();perform finance_private.ensure_month(p_month);
 select status,revision into s,r from finance_private.months where finance_month=p_month for update;
 if s='CLOSED' then raise exception 'Reopen the closed month before changing Finance records';end if;
 if p_revision is distinct from r then raise exception 'Finance data changed. Reload and review before saving.';end if;
end$$;
create function finance_private.mark_month_changed(p_month date,p_global boolean default false) returns void
language plpgsql security definer set search_path='' as $$begin
 update finance_private.mutation_state set generation=generation+1 where singleton;
 if p_global then update finance_private.months set status='DRAFT',revision=revision+1 where status<>'CLOSED';
 else update finance_private.months set status='DRAFT',revision=revision+1 where finance_month=p_month and status<>'CLOSED';end if;
end$$;

create or replace function finance_private.base_input(p_month date) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('calculation_version',3,
 'month',(select to_jsonb(m)-'frozen_input' from finance_private.months m where finance_month=p_month),
 'vehicles',coalesce((select jsonb_agg(to_jsonb(v) order by plate_key) from finance_private.vehicles v),'[]'),
 'vehicle_plate_history',coalesce((select jsonb_agg(to_jsonb(h) order by vehicle_id,valid_from) from finance_private.vehicle_plate_history h),'[]'),
 'recurring_costs',coalesce((select jsonb_agg(to_jsonb(c) order by obligation_id,version_no,id) from finance_private.recurring_costs c),'[]'),
 'insurance',coalesce((select jsonb_agg(to_jsonb(i) order by id) from finance_private.insurance i),'[]'),
 'expenses',coalesce((select jsonb_agg(to_jsonb(e) order by id) from finance_private.expenses e where finance_month=p_month),'[]'),
 'fixed_cost_templates',coalesce((select jsonb_agg(to_jsonb(t) order by category,id) from finance_private.fixed_cost_templates t),'[]'),
 'workshop_summaries',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('allocated_amount',coalesce(a.amount,0),'unallocated_amount',greatest(s.amount-coalesce(a.amount,0),0)) order by s.id)
  from finance_private.workshop_summaries s left join lateral(select sum(e.amount) amount from finance_private.workshop_allocations wa join finance_private.expenses e on e.id=wa.expense_id where wa.summary_id=s.id and e.cancelled_at is null)a on true where s.finance_month=p_month),'[]'),
 'workshop_allocations',coalesce((select jsonb_agg(jsonb_build_object('summary_id',a.summary_id,'expense_id',a.expense_id) order by a.summary_id,a.expense_id) from finance_private.workshop_allocations a join finance_private.workshop_summaries s on s.id=a.summary_id where s.finance_month=p_month),'[]'),
 'other_income',coalesce((select jsonb_agg(to_jsonb(o) order by id) from finance_private.other_income o where finance_month=p_month),'[]'),
 'ehailing',coalesce((select jsonb_agg(to_jsonb(e) order by source_payment_id) from finance_private.ehailing e where finance_month=p_month),'[]'),
 'smart_import',(select to_jsonb(i)-'source_audit' from finance_private.imports i where finance_month=p_month and kind='SMART_DRIVE' and status='POSTED'),
 'smart_rows',coalesce((select jsonb_agg(to_jsonb(s)-'import_id' order by s.sheet_name,s.source_row) from finance_private.smart_rows s join finance_private.imports i on i.id=s.import_id where i.finance_month=p_month and i.kind='SMART_DRIVE' and i.status='POSTED'),'[]'),
 'imports',coalesce((select jsonb_agg(to_jsonb(i) order by imported_at,id) from finance_private.imports i where i.finance_month=p_month or i.kind='BOOTSTRAP'),'[]'),
 'bootstrap_completed',exists(select 1 from finance_private.imports where kind='BOOTSTRAP'))
$$;

create function finance_private.mutate_record(p_kind text,p_action text,p_record jsonb,p_effective_month date,p_revision integer,p_reason text) returns jsonb
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
   update finance_private.recurring_costs set plate_key=new_plate where plate_key=old_plate;update finance_private.insurance set plate_key=new_plate where plate_key=old_plate;update finance_private.expenses set plate_key=new_plate where plate_key=old_plate;update finance_private.other_income set plate_key=new_plate,record_version=record_version+1 where plate_key=old_plate;update finance_private.ehailing set plate_key=new_plate where plate_key=old_plate;update finance_private.smart_rows set plate_key=new_plate,display_plate=btrim(p_record->>'display_plate') where plate_key=old_plate;
   insert into finance_private.vehicle_plate_history(vehicle_id,plate_key,display_plate,correction_reason) values(vid,new_plate,btrim(p_record->>'display_plate'),nullif(btrim(p_reason),''));
  end;perform finance_private.mark_month_changed(p_effective_month,true);
 else raise exception 'Unsupported Finance record mutation';end if;
 insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),p_effective_month,case when p_action='CANCEL' then 'CANCEL_FINANCE_RECORD' else 'MUTATE_FINANCE_RECORD' end,jsonb_strip_nulls(jsonb_build_object('kind',p_kind,'action',p_action,'id',coalesce(rid,new_id),'reason',nullif(btrim(p_reason),''),'before',old,'expense_before',before_exp)));
 return finance_private.input(p_effective_month);
end$$;

create function finance_private.preview_section_import(p_kind text,p_month date,p_filename text,p_rows jsonb,p_revision integer,p_source_hash text,p_mode text,p_replace_upload_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb;changes jsonb:='[]';candidate uuid;matches integer;act text;before jsonb;candidate_options jsonb:='[]';current_total numeric:=0;proposed_total numeric:=0;token uuid;gen bigint;counts jsonb;begin
 perform finance_private.assert_open_revision(p_month,p_revision);
 if p_kind not in ('RECURRING_COST','VEHICLE','INSURANCE','VEHICLE_EXPENSE','CORPORATE_EXPENSE','WORKSHOP','FIXED_COST','OTHER_INCOME') or p_mode not in ('UPDATE','REPLACE') or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or nullif(btrim(p_filename),'') is null or p_source_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid Finance import preview';end if;
 if p_mode='REPLACE' and (p_replace_upload_id is null or not exists(select 1 from finance_private.section_uploads where id=p_replace_upload_id and kind=p_kind)) then raise exception 'Select the exact upload to replace';end if;
 if p_kind='RECURRING_COST' then select coalesce(sum(monthly_amount),0) into current_total from finance_private.recurring_costs where cancelled_at is null and start_month<=p_month and (end_month is null or end_month>=p_month);
 elsif p_kind='FIXED_COST' then select coalesce(sum(monthly_amount),0) into current_total from finance_private.fixed_cost_templates where cancelled_at is null and effective_from<=p_month and (effective_until is null or effective_until>=p_month);
 elsif p_kind='OTHER_INCOME' then select coalesce(sum(amount),0) into current_total from finance_private.other_income where cancelled_at is null and finance_month=p_month and status='CONFIRMED';
 elsif p_kind in ('VEHICLE_EXPENSE','CORPORATE_EXPENSE','WORKSHOP') then select coalesce(sum(amount),0) into current_total from finance_private.expenses where cancelled_at is null and finance_month=p_month and payment_source=case when p_kind='CORPORATE_EXPENSE' then 'Corporate Opex' when p_kind='VEHICLE_EXPENSE' then 'Vehicle Direct Cost' else 'Workshop Billing' end;end if;proposed_total:=current_total;
 for r in select value from jsonb_array_elements(p_rows) loop candidate:=null;matches:=0;before:=null;candidate_options:='[]';if nullif(r->>'plate_key','') is not null then r:=jsonb_set(r,'{plate_key}',to_jsonb(coalesce(finance_private.canonical_plate(r->>'plate_key'),regexp_replace(upper(r->>'plate_key'),'\s','','g'))));end if;
  if p_kind='RECURRING_COST' then
   if nullif(r->>'record_id','') is not null then select id,to_jsonb(c) into candidate,before from finance_private.recurring_costs c where id=(r->>'record_id')::uuid;
   else
    select count(*),(min(id::text))::uuid,case when count(*)=1 then min(to_jsonb(c)::text)::jsonb end,coalesce(jsonb_agg(jsonb_build_object('record_id',c.id,'cost_type',c.cost_type,'payee',c.payee,'monthly_amount',c.monthly_amount,'start_month',c.start_month,'end_month',c.end_month,'cancelled_at',c.cancelled_at) order by c.start_month,c.id),'[]') into matches,candidate,before,candidate_options from finance_private.recurring_costs c where c.cancelled_at is null and c.plate_key=regexp_replace(upper(r->>'plate_key'),'\s','','g') and coalesce(c.payee,'')=coalesce(r->>'payee','') and c.start_month<=coalesce(nullif(r->>'end_month','')::date,'infinity'::date) and coalesce(c.end_month,'infinity'::date)>=(r->>'start_month')::date;
    if matches=0 then select count(*),(min(id::text))::uuid,case when count(*)=1 then min(to_jsonb(c)::text)::jsonb end,coalesce(jsonb_agg(jsonb_build_object('record_id',c.id,'cost_type',c.cost_type,'payee',c.payee,'monthly_amount',c.monthly_amount,'start_month',c.start_month,'end_month',c.end_month,'cancelled_at',c.cancelled_at) order by c.start_month,c.id),'[]') into matches,candidate,before,candidate_options from finance_private.recurring_costs c where c.cancelled_at is not null and c.plate_key=regexp_replace(upper(r->>'plate_key'),'\s','','g') and coalesce(c.payee,'')=coalesce(r->>'payee','') and c.start_month<=coalesce(nullif(r->>'end_month','')::date,'infinity'::date) and coalesce(c.end_month,'infinity'::date)>=(r->>'start_month')::date;end if;
    if matches>1 then candidate:=null;before:=null;end if;
   end if;
   if matches>1 and r->>'resolution'='ADD_SEPARATE' then candidate:=null;before:=null;act:='NEW';proposed_total:=proposed_total+case when (r->>'start_month')::date<=p_month and (nullif(r->>'end_month','') is null or (r->>'end_month')::date>=p_month) then (r->>'monthly_amount')::numeric else 0 end;
   elsif matches>1 and r->>'resolution'='UPDATE_EXISTING' and nullif(r->>'target_record_id','') is not null and exists(select 1 from finance_private.recurring_costs c where c.id=(r->>'target_record_id')::uuid and c.plate_key=regexp_replace(upper(r->>'plate_key'),'\s','','g') and c.cancelled_at is null) then candidate:=(r->>'target_record_id')::uuid;select to_jsonb(c) into before from finance_private.recurring_costs c where c.id=candidate;act:='UPDATED';
   elsif matches>1 and r->>'resolution'='RESTORE' and nullif(r->>'target_record_id','') is not null and exists(select 1 from finance_private.recurring_costs c where c.id=(r->>'target_record_id')::uuid and c.plate_key=regexp_replace(upper(r->>'plate_key'),'\s','','g') and c.cancelled_at is not null) then candidate:=(r->>'target_record_id')::uuid;select to_jsonb(c) into before from finance_private.recurring_costs c where c.id=candidate;act:='UPDATED';
   elsif before is not null and before->>'cancelled_at' is not null and r->>'resolution'='RESTORE' then act:='UPDATED';
   elsif before is not null and before->>'cancelled_at' is not null then act:='NEEDS_REVIEW';
   elsif before is not null and r->>'resolution'='ADD_SEPARATE' then candidate:=null;before:=null;act:='NEW';proposed_total:=proposed_total+case when (r->>'start_month')::date<=p_month and (nullif(r->>'end_month','') is null or (r->>'end_month')::date>=p_month) then (r->>'monthly_amount')::numeric else 0 end;
   elsif matches>1 then act:='NEEDS_REVIEW';
   elsif before is null then act:='NEW';proposed_total:=proposed_total+case when (r->>'start_month')::date<=p_month and (nullif(r->>'end_month','') is null or (r->>'end_month')::date>=p_month) then (r->>'monthly_amount')::numeric else 0 end;
   elsif (before->>'plate_key'=regexp_replace(upper(r->>'plate_key'),'\s','','g') and (before->>'start_month')::date=(r->>'start_month')::date and nullif(before->>'end_month','')::date is not distinct from nullif(r->>'end_month','')::date and before->>'cost_type'=r->>'cost_type' and (before->>'monthly_amount')::numeric=(r->>'monthly_amount')::numeric and coalesce(before->>'payee','')=coalesce(r->>'payee','') and coalesce(before->>'notes','')=coalesce(r->>'notes','')) then act:='UNCHANGED';
   else act:='UPDATED';if (before->>'start_month')::date<=p_month and (nullif(before->>'end_month','') is null or (before->>'end_month')::date>=p_month) then proposed_total:=proposed_total-(before->>'monthly_amount')::numeric;end if;if (r->>'start_month')::date<=p_month and (nullif(r->>'end_month','') is null or (r->>'end_month')::date>=p_month) then proposed_total:=proposed_total+(r->>'monthly_amount')::numeric;end if;end if;
  elsif p_kind='FIXED_COST' then
   candidate:=nullif(r->>'record_id','')::uuid;if candidate is not null then select to_jsonb(t) into before from finance_private.fixed_cost_templates t where id=candidate;else select count(*),(min(id::text))::uuid,case when count(*)=1 then min(to_jsonb(t)::text)::jsonb end into matches,candidate,before from finance_private.fixed_cost_templates t where t.category=r->>'category' and coalesce(t.payee,'')=coalesce(r->>'payee','') and t.effective_from=(r->>'effective_from')::date;end if;
   if matches>1 then act:='NEEDS_REVIEW';elsif before is not null and before->>'cancelled_at' is not null and coalesce(r->>'resolution','')<>'RESTORE' then act:='NEEDS_REVIEW';elsif before is null then act:='NEW';proposed_total:=proposed_total+case when (r->>'effective_from')::date<=p_month and (nullif(r->>'effective_until','') is null or (r->>'effective_until')::date>=p_month) then (r->>'monthly_amount')::numeric else 0 end;elsif before->>'category'=r->>'category' and (before->>'monthly_amount')::numeric=(r->>'monthly_amount')::numeric and (before->>'effective_from')::date=(r->>'effective_from')::date and nullif(before->>'effective_until','')::date is not distinct from nullif(r->>'effective_until','')::date and coalesce(before->>'payee','')=coalesce(r->>'payee','') and coalesce(before->>'note','')=coalesce(r->>'notes','') then act:='UNCHANGED';else act:='UPDATED';proposed_total:=proposed_total-(before->>'monthly_amount')::numeric+(r->>'monthly_amount')::numeric;end if;
  elsif p_kind='OTHER_INCOME' then
   candidate:=nullif(r->>'record_id','')::uuid;if candidate is not null then select to_jsonb(i) into before from finance_private.other_income i where id=candidate;else select count(*),(min(id::text))::uuid,case when count(*)=1 then min(to_jsonb(i)::text)::jsonb end into matches,candidate,before from finance_private.other_income i where i.finance_month=p_month and lower(i.income_type)=lower(r->>'income_type') and i.amount=(r->>'amount')::numeric and coalesce(i.plate_key,'')=coalesce(regexp_replace(upper(r->>'plate_key'),'\s','','g'),'') and coalesce(i.reference,'')=coalesce(r->>'reference','');end if;
   if matches>1 then act:='NEEDS_REVIEW';elsif before is not null and before->>'cancelled_at' is not null and coalesce(r->>'resolution','')<>'RESTORE' then act:='NEEDS_REVIEW';elsif before is null then act:='NEW';proposed_total:=proposed_total+(r->>'amount')::numeric;elsif before->>'status'=coalesce(nullif(r->>'status',''),'CONFIRMED') and before->>'income_type'=r->>'income_type' and (before->>'amount')::numeric=(r->>'amount')::numeric and coalesce(before->>'plate_key','')=coalesce(regexp_replace(upper(r->>'plate_key'),'\s','','g'),'') and coalesce(before->>'business_unit','')=coalesce(r->>'business_unit','') and coalesce(before->>'receipt_date','')=coalesce(r->>'receipt_date','') and coalesce(before->>'reference','')=coalesce(r->>'reference','') and coalesce(before->>'notes','')=coalesce(r->>'notes','') then act:='UNCHANGED';else act:='UPDATED';proposed_total:=proposed_total-(before->>'amount')::numeric+(r->>'amount')::numeric;end if;
  elsif p_kind='VEHICLE' then
   candidate:=nullif(r->>'record_id','')::uuid;if candidate is not null then select to_jsonb(v) into before from finance_private.vehicles v where vehicle_id=candidate;else select vehicle_id,to_jsonb(v) into candidate,before from finance_private.vehicles v where plate_key=regexp_replace(upper(r->>'plate_key'),'\s','','g');end if;
   if before is null then act:='NEW';elsif before->>'deleted_at' is not null then act:='NEEDS_REVIEW';elsif before->>'plate_key' is distinct from regexp_replace(upper(r->>'plate_key'),'\s','','g') then act:='NEEDS_REVIEW';elsif before->>'display_plate'=btrim(r->>'display_plate') and coalesce(before->>'model','')=coalesce(r->>'model','') and before->>'business_unit'=r->>'business_unit' and before->>'ownership_type'=r->>'ownership_type' and before->>'status'=r->>'status' then act:='UNCHANGED';else act:='UPDATED';end if;
  elsif p_kind='INSURANCE' then
   candidate:=nullif(r->>'record_id','')::uuid;if candidate is not null then select to_jsonb(i) into before from finance_private.insurance i where id=candidate;else select count(*),(min(id::text))::uuid,case when count(*)=1 then min(to_jsonb(i)::text)::jsonb end into matches,candidate,before from finance_private.insurance i where i.plate_key=regexp_replace(upper(r->>'plate_key'),'\s','','g') and i.coverage_start is not distinct from nullif(r->>'coverage_start','')::date;end if;
   if matches>1 then act:='NEEDS_REVIEW';elsif before is not null and before->>'cancelled_at' is not null and coalesce(r->>'resolution','')<>'RESTORE' then act:='NEEDS_REVIEW';elsif before is null then act:='NEW';elsif nullif(r->>'record_id','') is null and coalesce(r->>'resolution','')='ADD_SEPARATE' then candidate:=null;before:=null;act:='NEW';elsif nullif(r->>'record_id','') is null and coalesce(r->>'resolution','')='' then act:='NEEDS_REVIEW';elsif before->>'plate_key'=regexp_replace(upper(r->>'plate_key'),'\s','','g') and (before->>'premium')::numeric=(r->>'premium')::numeric and nullif(before->>'payment_date','')::date is not distinct from nullif(r->>'payment_date','')::date and nullif(before->>'coverage_start','')::date is not distinct from nullif(r->>'coverage_start','')::date and nullif(before->>'coverage_end','')::date is not distinct from nullif(r->>'coverage_end','')::date and coalesce(before->>'responsibility','')=coalesce(r->>'responsibility','') and coalesce(before->>'supplier','')=coalesce(r->>'supplier','') and coalesce(before->>'reference','')=coalesce(r->>'reference','') and coalesce(before->>'source','')=coalesce(r->>'source','') then act:='UNCHANGED';else act:='UPDATED';end if;
  else
   candidate:=nullif(r->>'record_id','')::uuid;if candidate is not null then select to_jsonb(e) into before from finance_private.expenses e where id=candidate;else
    select count(*),(min(id::text))::uuid,case when count(*)=1 then min(to_jsonb(e)::text)::jsonb end,coalesce(jsonb_agg(jsonb_build_object('record_id',e.id,'category',e.category,'supplier',e.supplier,'amount',e.amount,'billing_date',e.billing_date,'reference',e.reference,'cancelled_at',e.cancelled_at) order by e.billing_date,e.id),'[]') into matches,candidate,before,candidate_options from finance_private.expenses e where e.finance_month=p_month and e.payment_source=case when p_kind='CORPORATE_EXPENSE' then 'Corporate Opex' when p_kind='VEHICLE_EXPENSE' then 'Vehicle Direct Cost' else 'Workshop Billing' end and e.plate_key is not distinct from nullif(regexp_replace(upper(r->>'plate_key'),'\s','','g'),'') and coalesce(e.supplier,'')=coalesce(r->>'supplier','') and ((nullif(btrim(r->>'reference'),'') is not null and e.reference=btrim(r->>'reference')) or (nullif(btrim(r->>'reference'),'') is null and nullif(btrim(e.reference),'') is null and e.billing_date is not distinct from nullif(r->>'billing_date','')::date and e.category=r->>'category' and coalesce(e.description,'')=coalesce(r->>'description','')));end if;
   if matches>1 and r->>'resolution'='UPDATE_EXISTING' and nullif(r->>'target_record_id','') is not null and exists(select 1 from finance_private.expenses e where e.id=(r->>'target_record_id')::uuid and e.cancelled_at is null) then candidate:=(r->>'target_record_id')::uuid;select to_jsonb(e) into before from finance_private.expenses e where e.id=candidate;act:='UPDATED';
   elsif matches>1 and r->>'resolution'='RESTORE' and nullif(r->>'target_record_id','') is not null and exists(select 1 from finance_private.expenses e where e.id=(r->>'target_record_id')::uuid and e.cancelled_at is not null) then candidate:=(r->>'target_record_id')::uuid;select to_jsonb(e) into before from finance_private.expenses e where e.id=candidate;act:='UPDATED';
   elsif matches>1 then act:='NEEDS_REVIEW';elsif before is not null and before->>'cancelled_at' is not null and coalesce(r->>'resolution','')<>'RESTORE' then act:='NEEDS_REVIEW';elsif before is null then act:='NEW';proposed_total:=proposed_total+(r->>'amount')::numeric;elsif nullif(r->>'record_id','') is null and coalesce(r->>'resolution','')='ADD_SEPARATE' then candidate:=null;before:=null;act:='NEW';proposed_total:=proposed_total+(r->>'amount')::numeric;elsif nullif(r->>'record_id','') is null and coalesce(r->>'resolution','')='KEEP_EXISTING' then act:='UNCHANGED';elsif nullif(r->>'record_id','') is null and coalesce(r->>'resolution','')='' then act:='NEEDS_REVIEW';elsif nullif(before->>'billing_date','')::date is not distinct from nullif(r->>'billing_date','')::date and coalesce(before->>'plate_key','')=coalesce(r->>'plate_key','') and (before->>'amount')::numeric=(r->>'amount')::numeric and coalesce(before->>'category','')=coalesce(r->>'category','') and coalesce(before->>'supplier','')=coalesce(r->>'supplier','') and coalesce(before->>'reference','')=coalesce(r->>'reference','') and coalesce(before->>'description','')=coalesce(r->>'description','') and coalesce(before->>'frequency','ONE_OFF')=coalesce(r->>'frequency','ONE_OFF') and nullif(before->>'start_month','')::date is not distinct from nullif(r->>'start_month','')::date and nullif(before->>'end_month','')::date is not distinct from nullif(r->>'end_month','')::date and coalesce(before->>'source','')=coalesce(r->>'source','') and coalesce(before->>'notes','')=coalesce(r->>'notes','') then act:='UNCHANGED';else act:='UPDATED';proposed_total:=proposed_total-(before->>'amount')::numeric+(r->>'amount')::numeric;end if;
  end if;
  changes:=changes||jsonb_build_array(jsonb_build_object('source_row',(r->>'source_row')::integer,'sheet_name',r->>'sheet_name','action',act,'record_id',candidate,'before',before,'candidates',candidate_options,'row',r));
 end loop;
 select coalesce(jsonb_agg(
   case when exists(
     select 1 from jsonb_array_elements(changes) with ordinality d(value,ord2)
     where d.ord2<>a.ord
       and coalesce(a.value->'row'->>'resolution','')<>'ADD_SEPARATE'
       and (
         (nullif(a.value->>'record_id','') is not null and d.value->>'record_id'=a.value->>'record_id')
         or (((d.value->'row')-'source_row'::text-'sheet_name'::text)=((a.value->'row')-'source_row'::text-'sheet_name'::text))
       )
   ) then jsonb_set(a.value,'{action}','"NEEDS_REVIEW"'::jsonb) else a.value end
   order by a.ord),'[]'::jsonb) into changes
 from jsonb_array_elements(changes) with ordinality a(value,ord);
 if p_mode='REPLACE' then
  for candidate in select nullif(x->>'record_id','')::uuid from finance_private.section_uploads u,jsonb_array_elements(u.source_audit)x where u.id=p_replace_upload_id and nullif(x->>'record_id','') is not null and not exists(select 1 from jsonb_array_elements(changes)c where c->>'record_id'=x->>'record_id') loop
   changes:=changes||jsonb_build_array(jsonb_build_object('source_row',0,'sheet_name','Replacement','action','CANCELLED','record_id',candidate,'row','{}'::jsonb));
  end loop;
 end if;
 counts:=jsonb_build_object('new',(select count(*) from jsonb_array_elements(changes)c where c->>'action'='NEW'),'updated',(select count(*) from jsonb_array_elements(changes)c where c->>'action'='UPDATED'),'unchanged',(select count(*) from jsonb_array_elements(changes)c where c->>'action'='UNCHANGED'),'needs_review',(select count(*) from jsonb_array_elements(changes)c where c->>'action'='NEEDS_REVIEW'),'cancelled',(select count(*) from jsonb_array_elements(changes)c where c->>'action'='CANCELLED'));
 select generation into gen from finance_private.mutation_state where singleton;
 insert into finance_private.import_previews(finance_month,kind,filename,source_hash,mode,replace_upload_id,requested_rows,changes,month_revision,mutation_generation,created_by) values(p_month,p_kind,p_filename,p_source_hash,p_mode,p_replace_upload_id,p_rows,changes,p_revision,gen,auth.uid()) returning id into token;
 return jsonb_build_object('preview_token',token,'selected_section',p_kind,'worksheet',(select string_agg(distinct x->>'sheet_name',', ' order by x->>'sheet_name') from jsonb_array_elements(p_rows)x),'finance_month',p_month,'counts',counts,'current_total',current_total,'proposed_total',proposed_total,'changes',changes);
end$$;

create function finance_private.apply_section_import(p_preview_token uuid,p_confirmation jsonb,p_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p finance_private.import_previews%rowtype;c jsonb;upload uuid;rid uuid;after_image jsonb;parent_after jsonb;n integer:=0;gen bigint;begin
 perform finance_private.lock_finance();select * into p from finance_private.import_previews where id=p_preview_token for update;if not found or p.created_by<>auth.uid() then raise exception 'Import preview is unavailable';end if;
 if p_confirmation is distinct from p.changes then raise exception 'Import confirmation changed and does not match the reviewed preview';end if;
 if p.applied_upload_id is not null then return finance_private.input(p.finance_month);end if;
 perform finance_private.assert_open_revision(p.finance_month,p_revision);select generation into gen from finance_private.mutation_state where singleton;
 if p.expires_at<now() or p.month_revision<>p_revision or p.mutation_generation<>gen then raise exception 'Import preview is stale. Reload and review again.';end if;
 if exists(select 1 from jsonb_array_elements(p.changes)x where x->>'action'='NEEDS_REVIEW') then raise exception 'Resolve all import rows that need review before posting';end if;
 insert into finance_private.section_uploads(finance_month,kind,filename,source_hash,imported_by,row_count,total_amount,source_audit) values(p.finance_month,p.kind,p.filename,p.source_hash,auth.uid(),jsonb_array_length(p.requested_rows),0,'[]') returning id into upload;
 for c in select value from jsonb_array_elements(p.changes) loop n:=n+1;rid:=nullif(c->>'record_id','')::uuid;after_image:=null;
  if c->>'action'='UNCHANGED' then after_image:=c->'before';
  elsif p.kind='RECURRING_COST' and c->>'action'='NEW' then insert into finance_private.recurring_costs(obligation_id,plate_key,start_month,end_month,cost_type,monthly_amount,payee,notes,source_upload_id) values(gen_random_uuid(),regexp_replace(upper(c->'row'->>'plate_key'),'\s','','g'),(c->'row'->>'start_month')::date,nullif(c->'row'->>'end_month','')::date,c->'row'->>'cost_type',(c->'row'->>'monthly_amount')::numeric,nullif(c->'row'->>'payee',''),nullif(c->'row'->>'notes',''),upload) returning id,to_jsonb(finance_private.recurring_costs.*) into rid,after_image;
  if p.kind='RECURRING_COST' and c->'row'->>'resolution'='ADD_SEPARATE' then
   insert into finance_private.recurring_duplicate_resolutions(obligation_a,obligation_b,fingerprint,reason,resolved_by)
   select case when x.obligation_id<n.obligation_id then x.obligation_id else n.obligation_id end,case when x.obligation_id<n.obligation_id then n.obligation_id else x.obligation_id end,md5(concat_ws('|',n.plate_key,n.monthly_amount,coalesce(n.payee,''),n.start_month,coalesce(n.end_month::text,''))),'Explicit separate obligation confirmed during import',auth.uid()
   from finance_private.recurring_costs n join finance_private.recurring_costs x on x.id<>n.id and x.obligation_id<>n.obligation_id and x.cancelled_at is null and x.plate_key=n.plate_key and x.monthly_amount=n.monthly_amount and coalesce(x.payee,'')=coalesce(n.payee,'') and x.start_month=n.start_month and x.end_month is not distinct from n.end_month where n.id=rid
   on conflict(obligation_a,obligation_b,fingerprint) do update set resolved_at=now(),resolved_by=excluded.resolved_by;
  end if;
  elsif p.kind='RECURRING_COST' and c->>'action'='UPDATED' then
   if (c->'row'->>'start_month')::date>(c->'before'->>'start_month')::date then
   if exists(select 1 from finance_private.recurring_costs x where x.obligation_id=(c->'before'->>'obligation_id')::uuid and x.id<>rid and x.cancelled_at is null and x.start_month>=(c->'row'->>'start_month')::date) then raise exception 'A later obligation version exists. Reload and review the timeline.';end if;
    update finance_private.recurring_costs set end_month=((c->'row'->>'start_month')::date-interval '1 month')::date,record_version=record_version+1 where id=rid returning to_jsonb(finance_private.recurring_costs.*) into parent_after;
    insert into finance_private.section_upload_changes(upload_id,change_no,record_kind,record_id,action,before_image,after_image) values(upload,n,'recurring_cost',rid,'UPDATED',c->'before',parent_after);
    update finance_private.section_uploads set source_audit=source_audit||jsonb_build_array(jsonb_build_object('sheet_name',c->>'sheet_name','source_row',(c->>'source_row')::integer,'record_kind','recurring_cost','record_id',rid,'action','UPDATED')) where id=upload;
    n:=n+1;
    insert into finance_private.recurring_costs(obligation_id,version_no,plate_key,start_month,end_month,cost_type,monthly_amount,payee,notes,source_upload_id) values((c->'before'->>'obligation_id')::uuid,(select max(version_no)+1 from finance_private.recurring_costs where obligation_id=(c->'before'->>'obligation_id')::uuid),regexp_replace(upper(c->'row'->>'plate_key'),'\s','','g'),(c->'row'->>'start_month')::date,nullif(c->'row'->>'end_month','')::date,c->'row'->>'cost_type',(c->'row'->>'monthly_amount')::numeric,nullif(c->'row'->>'payee',''),nullif(c->'row'->>'notes',''),upload) returning id,to_jsonb(finance_private.recurring_costs.*) into rid,after_image;
    c:=jsonb_set(jsonb_set(c,'{action}','"NEW"'::jsonb),'{before}','null'::jsonb);
   else update finance_private.recurring_costs set plate_key=regexp_replace(upper(c->'row'->>'plate_key'),'\s','','g'),end_month=nullif(c->'row'->>'end_month','')::date,cost_type=c->'row'->>'cost_type',monthly_amount=(c->'row'->>'monthly_amount')::numeric,payee=nullif(c->'row'->>'payee',''),notes=nullif(c->'row'->>'notes',''),record_version=record_version+1,source_upload_id=upload,cancelled_at=null,cancelled_by=null,cancellation_reason=null where id=rid returning to_jsonb(finance_private.recurring_costs.*) into after_image;end if;
  elsif p.kind='RECURRING_COST' and c->>'action'='CANCELLED' then update finance_private.recurring_costs set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason='Replaced upload',record_version=record_version+1 where id=rid returning to_jsonb(finance_private.recurring_costs.*) into after_image;
  elsif p.kind='FIXED_COST' and c->>'action'='NEW' then insert into finance_private.fixed_cost_templates(category,monthly_amount,effective_from,effective_until,payee,note,source,source_upload_id) values(c->'row'->>'category',(c->'row'->>'monthly_amount')::numeric,(c->'row'->>'effective_from')::date,nullif(c->'row'->>'effective_until','')::date,nullif(c->'row'->>'payee',''),nullif(c->'row'->>'notes',''),'Imported Fixed Operating Costs',upload) returning id,to_jsonb(finance_private.fixed_cost_templates.*) into rid,after_image;
  elsif p.kind='FIXED_COST' and c->>'action'='UPDATED' then
   if (c->'row'->>'effective_from')::date>(c->'before'->>'effective_from')::date then
    update finance_private.fixed_cost_templates set effective_until=((c->'row'->>'effective_from')::date-interval '1 month')::date,record_version=record_version+1 where id=rid returning to_jsonb(finance_private.fixed_cost_templates.*) into parent_after;
    insert into finance_private.section_upload_changes(upload_id,change_no,record_kind,record_id,action,before_image,after_image) values(upload,n,'fixed_cost',rid,'UPDATED',c->'before',parent_after);n:=n+1;
    insert into finance_private.fixed_cost_templates(series_id,version_no,category,monthly_amount,effective_from,effective_until,payee,note,source,source_upload_id) values((c->'before'->>'series_id')::uuid,(select max(version_no)+1 from finance_private.fixed_cost_templates where series_id=(c->'before'->>'series_id')::uuid),c->'row'->>'category',(c->'row'->>'monthly_amount')::numeric,(c->'row'->>'effective_from')::date,nullif(c->'row'->>'effective_until','')::date,nullif(c->'row'->>'payee',''),nullif(c->'row'->>'notes',''),'Imported Fixed Operating Costs',upload) returning id,to_jsonb(finance_private.fixed_cost_templates.*) into rid,after_image;c:=jsonb_set(jsonb_set(c,'{action}','"NEW"'::jsonb),'{before}','null'::jsonb);
   else update finance_private.fixed_cost_templates set category=c->'row'->>'category',monthly_amount=(c->'row'->>'monthly_amount')::numeric,effective_until=nullif(c->'row'->>'effective_until','')::date,payee=nullif(c->'row'->>'payee',''),note=nullif(c->'row'->>'notes',''),source_upload_id=upload,cancelled_at=null,cancelled_by=null,cancellation_reason=null,record_version=record_version+1 where id=rid returning to_jsonb(finance_private.fixed_cost_templates.*) into after_image;end if;
  elsif p.kind='FIXED_COST' and c->>'action'='CANCELLED' then update finance_private.fixed_cost_templates set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason='Replaced upload',record_version=record_version+1 where id=rid returning to_jsonb(finance_private.fixed_cost_templates.*) into after_image;
  elsif p.kind='OTHER_INCOME' and c->>'action'='NEW' then insert into finance_private.other_income(finance_month,status,income_type,amount,plate_key,business_unit,receipt_date,reference,notes,source,confirmation_key,created_by) select p.finance_month,coalesce(nullif(c->'row'->>'status',''),'CONFIRMED'),c->'row'->>'income_type',(c->'row'->>'amount')::numeric,nullif(regexp_replace(upper(c->'row'->>'plate_key'),'\s','','g'),''),coalesce((select business_unit from finance_private.vehicles where plate_key=nullif(regexp_replace(upper(c->'row'->>'plate_key'),'\s','','g'),'')),c->'row'->>'business_unit'),nullif(c->'row'->>'receipt_date','')::date,nullif(c->'row'->>'reference',''),nullif(c->'row'->>'notes',''),'Imported Other Income',md5(concat_ws('|',p.finance_month,coalesce(nullif(c->'row'->>'status',''),'CONFIRMED'),lower(c->'row'->>'income_type'),coalesce(c->'row'->>'plate_key',''),coalesce(c->'row'->>'business_unit',''),(c->'row'->>'amount')::numeric,coalesce(c->'row'->>'receipt_date',''),coalesce(c->'row'->>'reference',''))),auth.uid() returning id,to_jsonb(finance_private.other_income.*) into rid,after_image;
  elsif p.kind='OTHER_INCOME' and c->>'action'='UPDATED' then update finance_private.other_income set status=coalesce(nullif(c->'row'->>'status',''),'CONFIRMED'),income_type=c->'row'->>'income_type',amount=(c->'row'->>'amount')::numeric,plate_key=nullif(regexp_replace(upper(c->'row'->>'plate_key'),'\s','','g'),''),business_unit=coalesce((select business_unit from finance_private.vehicles where plate_key=nullif(regexp_replace(upper(c->'row'->>'plate_key'),'\s','','g'),'')),c->'row'->>'business_unit'),receipt_date=nullif(c->'row'->>'receipt_date','')::date,reference=nullif(c->'row'->>'reference',''),notes=nullif(c->'row'->>'notes',''),confirmation_key=md5(concat_ws('|',p.finance_month,coalesce(nullif(c->'row'->>'status',''),'CONFIRMED'),lower(c->'row'->>'income_type'),coalesce(c->'row'->>'plate_key',''),coalesce(c->'row'->>'business_unit',''),(c->'row'->>'amount')::numeric,coalesce(c->'row'->>'receipt_date',''),coalesce(c->'row'->>'reference',''))),record_version=record_version+1,cancelled_at=null,cancelled_by=null,cancellation_reason=null where id=rid returning to_jsonb(finance_private.other_income.*) into after_image;
  elsif p.kind='OTHER_INCOME' and c->>'action'='CANCELLED' then update finance_private.other_income set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason='Replaced upload',record_version=record_version+1 where id=rid returning to_jsonb(finance_private.other_income.*) into after_image;
  elsif p.kind='VEHICLE' and c->>'action'='NEW' then insert into finance_private.vehicles(plate_key,display_plate,model,business_unit,ownership_type,status) values(regexp_replace(upper(c->'row'->>'plate_key'),'\s','','g'),btrim(c->'row'->>'display_plate'),nullif(btrim(c->'row'->>'model'),''),c->'row'->>'business_unit',c->'row'->>'ownership_type',c->'row'->>'status') returning vehicle_id into rid;insert into finance_private.vehicle_plate_history(vehicle_id,plate_key,display_plate) values(rid,regexp_replace(upper(c->'row'->>'plate_key'),'\s','','g'),btrim(c->'row'->>'display_plate')) on conflict(vehicle_id,plate_key) do update set display_plate=excluded.display_plate;select to_jsonb(v) into after_image from finance_private.vehicles v where vehicle_id=rid;
  elsif p.kind='VEHICLE' and c->>'action'='UPDATED' then update finance_private.vehicles set display_plate=btrim(c->'row'->>'display_plate'),model=nullif(btrim(c->'row'->>'model'),''),business_unit=c->'row'->>'business_unit',ownership_type=c->'row'->>'ownership_type',status=c->'row'->>'status' where vehicle_id=rid returning to_jsonb(finance_private.vehicles.*) into after_image;
  elsif p.kind='VEHICLE' and c->>'action'='CANCELLED' then update finance_private.vehicles set deleted_at=now() where vehicle_id=rid returning to_jsonb(finance_private.vehicles.*) into after_image;
  elsif p.kind='INSURANCE' and c->>'action'='NEW' then insert into finance_private.insurance(plate_key,premium,payment_date,coverage_start,coverage_end,responsibility,supplier,reference,source,source_upload_id) values(regexp_replace(upper(c->'row'->>'plate_key'),'\s','','g'),(c->'row'->>'premium')::numeric,nullif(c->'row'->>'payment_date','')::date,nullif(c->'row'->>'coverage_start','')::date,nullif(c->'row'->>'coverage_end','')::date,finance_private.normalize_insurance_responsibility(c->'row'->>'responsibility'),nullif(c->'row'->>'supplier',''),nullif(c->'row'->>'reference',''),coalesce(nullif(c->'row'->>'source',''),'Workbook'),upload) returning id into rid;select to_jsonb(i) into after_image from finance_private.insurance i where id=rid;
  elsif p.kind='INSURANCE' and c->>'action'='UPDATED' then update finance_private.insurance set plate_key=regexp_replace(upper(c->'row'->>'plate_key'),'\s','','g'),premium=(c->'row'->>'premium')::numeric,payment_date=nullif(c->'row'->>'payment_date','')::date,coverage_start=nullif(c->'row'->>'coverage_start','')::date,coverage_end=nullif(c->'row'->>'coverage_end','')::date,responsibility=finance_private.normalize_insurance_responsibility(c->'row'->>'responsibility'),supplier=nullif(c->'row'->>'supplier',''),reference=nullif(c->'row'->>'reference',''),source=coalesce(nullif(c->'row'->>'source',''),source),source_upload_id=upload,record_version=record_version+1,cancelled_at=null,cancelled_by=null,cancellation_reason=null where id=rid returning to_jsonb(finance_private.insurance.*) into after_image;
  elsif p.kind='INSURANCE' and c->>'action'='CANCELLED' then update finance_private.insurance set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason='Replaced upload',record_version=record_version+1 where id=rid returning to_jsonb(finance_private.insurance.*) into after_image;
  elsif p.kind in ('VEHICLE_EXPENSE','CORPORATE_EXPENSE','WORKSHOP') and c->>'action'='NEW' then insert into finance_private.expenses(finance_month,billing_date,plate_key,category,payment_source,supplier,amount,reference,description,source_row,sheet_name,frequency,start_month,end_month,source,notes,source_upload_id) values(p.finance_month,nullif(c->'row'->>'billing_date','')::date,nullif(regexp_replace(upper(c->'row'->>'plate_key'),'\s','','g'),''),c->'row'->>'category',case when p.kind='CORPORATE_EXPENSE' then 'Corporate Opex' when p.kind='VEHICLE_EXPENSE' then 'Vehicle Direct Cost' else 'Workshop Billing' end,nullif(c->'row'->>'supplier',''),(c->'row'->>'amount')::numeric,nullif(c->'row'->>'reference',''),nullif(c->'row'->>'description',''),(c->>'source_row')::integer,c->>'sheet_name',coalesce(nullif(c->'row'->>'frequency',''),'ONE_OFF'),nullif(c->'row'->>'start_month','')::date,nullif(c->'row'->>'end_month','')::date,coalesce(nullif(c->'row'->>'source',''),'Workbook'),nullif(c->'row'->>'notes',''),upload) returning id into rid;select to_jsonb(e) into after_image from finance_private.expenses e where id=rid;
  elsif p.kind in ('VEHICLE_EXPENSE','CORPORATE_EXPENSE','WORKSHOP') and c->>'action'='UPDATED' then update finance_private.expenses set billing_date=nullif(c->'row'->>'billing_date','')::date,plate_key=nullif(regexp_replace(upper(c->'row'->>'plate_key'),'\s','','g'),''),category=c->'row'->>'category',supplier=nullif(c->'row'->>'supplier',''),amount=(c->'row'->>'amount')::numeric,reference=nullif(c->'row'->>'reference',''),description=nullif(c->'row'->>'description',''),frequency=coalesce(nullif(c->'row'->>'frequency',''),'ONE_OFF'),start_month=nullif(c->'row'->>'start_month','')::date,end_month=nullif(c->'row'->>'end_month','')::date,source=coalesce(nullif(c->'row'->>'source',''),source),notes=nullif(c->'row'->>'notes',''),source_upload_id=upload,record_version=record_version+1,cancelled_at=null,cancelled_by=null,cancellation_reason=null where id=rid returning to_jsonb(finance_private.expenses.*) into after_image;
  elsif p.kind in ('VEHICLE_EXPENSE','CORPORATE_EXPENSE','WORKSHOP') and c->>'action'='CANCELLED' then if exists(select 1 from finance_private.bank_rows where expense_id=rid) then raise exception 'A bank review depends on an omitted expense';end if;update finance_private.expenses set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason='Replaced upload',record_version=record_version+1 where id=rid returning to_jsonb(finance_private.expenses.*) into after_image;
  else raise exception 'This import section requires the current client workflow';end if;
  insert into finance_private.section_upload_changes(upload_id,change_no,record_kind,record_id,action,before_image,after_image) values(upload,n,lower(p.kind),rid,c->>'action',c->'before',after_image);
  update finance_private.section_uploads set source_audit=source_audit||jsonb_build_array(jsonb_build_object('sheet_name',c->>'sheet_name','source_row',(c->>'source_row')::integer,'record_kind',lower(p.kind),'record_id',rid,'action',c->>'action')) where id=upload;
 end loop;
 update finance_private.section_uploads set total_amount=case
  when p.kind='VEHICLE' then 0
  when p.kind in ('RECURRING_COST','FIXED_COST') then (select coalesce(sum((x->>'monthly_amount')::numeric),0) from jsonb_array_elements(p.requested_rows)x)
  when p.kind='INSURANCE' then (select coalesce(sum((x->>'premium')::numeric),0) from jsonb_array_elements(p.requested_rows)x)
  else (select coalesce(sum((x->>'amount')::numeric),0) from jsonb_array_elements(p.requested_rows)x)
 end where id=upload;
 if p.kind='FIXED_COST' then perform finance_private.generate_fixed_costs_core(p.finance_month);end if;
 if p.mode='REPLACE' then update finance_private.section_uploads set status='REPLACED' where id=p.replace_upload_id;end if;
 update finance_private.import_previews set applied_upload_id=upload where id=p.id;perform finance_private.mark_month_changed(p.finance_month,p.kind in ('RECURRING_COST','VEHICLE','INSURANCE'));
 insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),p.finance_month,'APPLY_SAFE_IMPORT',jsonb_build_object('upload_id',upload,'preview_id',p.id,'mode',p.mode));return finance_private.input(p.finance_month);
end$$;

create function finance_private.undo_section_import(p_upload_id uuid,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare u finance_private.section_uploads%rowtype;c finance_private.section_upload_changes%rowtype;current_image jsonb;begin
 perform finance_private.lock_finance();select * into u from finance_private.section_uploads where id=p_upload_id for update;if not found or u.status<>'POSTED' then raise exception 'Only a currently posted upload can be undone';end if;perform finance_private.assert_open_revision(u.finance_month,p_revision);
 if exists(select 1 from finance_private.section_upload_changes a join finance_private.section_uploads later on later.id=a.upload_id where a.record_id in(select record_id from finance_private.section_upload_changes where upload_id=u.id) and later.imported_at>u.imported_at and later.status='POSTED') then raise exception 'Later imports depend on records from this upload';end if;
 for c in select * from finance_private.section_upload_changes where upload_id=u.id order by change_no desc loop
  if c.record_kind='recurring_cost' then select to_jsonb(r) into current_image from finance_private.recurring_costs r where id=c.record_id for update;
   if current_image is distinct from c.after_image then raise exception 'A Finance record changed after this upload. Review conflicts before undo.';end if;
   if c.action='NEW' then update finance_private.recurring_costs set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason='Undo upload',record_version=record_version+1 where id=c.record_id;
   elsif c.before_image is not null then update finance_private.recurring_costs set plate_key=c.before_image->>'plate_key',start_month=(c.before_image->>'start_month')::date,end_month=nullif(c.before_image->>'end_month','')::date,cost_type=c.before_image->>'cost_type',monthly_amount=(c.before_image->>'monthly_amount')::numeric,payee=nullif(c.before_image->>'payee',''),notes=nullif(c.before_image->>'notes',''),record_version=(c.before_image->>'record_version')::integer,cancelled_at=nullif(c.before_image->>'cancelled_at','')::timestamptz,cancelled_by=nullif(c.before_image->>'cancelled_by','')::uuid,cancellation_reason=nullif(c.before_image->>'cancellation_reason',''),source_upload_id=nullif(c.before_image->>'source_upload_id','')::uuid where id=c.record_id;end if;
  elsif c.record_kind in ('vehicle_expense','corporate_expense','workshop') then
   select to_jsonb(e) into current_image from finance_private.expenses e where id=c.record_id for update;
   if current_image is distinct from c.after_image then raise exception 'A Finance record changed after this upload. Review conflicts before undo.';end if;
   if c.action='NEW' then
    if exists(select 1 from finance_private.bank_rows where expense_id=c.record_id) or exists(select 1 from finance_private.workshop_allocations where expense_id=c.record_id) then raise exception 'A Finance workflow depends on this imported expense';end if;
    update finance_private.expenses set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason='Undo upload',record_version=record_version+1 where id=c.record_id;
   elsif c.before_image is not null then
    update finance_private.expenses set finance_month=(c.before_image->>'finance_month')::date,billing_date=nullif(c.before_image->>'billing_date','')::date,plate_key=nullif(c.before_image->>'plate_key',''),category=c.before_image->>'category',payment_source=c.before_image->>'payment_source',supplier=nullif(c.before_image->>'supplier',''),amount=(c.before_image->>'amount')::numeric,reference=nullif(c.before_image->>'reference',''),description=nullif(c.before_image->>'description',''),frequency=c.before_image->>'frequency',start_month=nullif(c.before_image->>'start_month','')::date,end_month=nullif(c.before_image->>'end_month','')::date,source=c.before_image->>'source',notes=nullif(c.before_image->>'notes',''),record_version=(c.before_image->>'record_version')::integer,cancelled_at=nullif(c.before_image->>'cancelled_at','')::timestamptz,cancelled_by=nullif(c.before_image->>'cancelled_by','')::uuid,cancellation_reason=nullif(c.before_image->>'cancellation_reason',''),source_upload_id=nullif(c.before_image->>'source_upload_id','')::uuid where id=c.record_id;
   end if;
  elsif c.record_kind='insurance' then
   select to_jsonb(i) into current_image from finance_private.insurance i where id=c.record_id for update;
   if current_image is distinct from c.after_image then raise exception 'A Finance record changed after this upload. Review conflicts before undo.';end if;
   if c.action='NEW' then update finance_private.insurance set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason='Undo upload',record_version=record_version+1 where id=c.record_id;
   elsif c.before_image is not null then update finance_private.insurance set plate_key=c.before_image->>'plate_key',premium=(c.before_image->>'premium')::numeric,payment_date=nullif(c.before_image->>'payment_date','')::date,coverage_start=nullif(c.before_image->>'coverage_start','')::date,coverage_end=nullif(c.before_image->>'coverage_end','')::date,responsibility=c.before_image->>'responsibility',supplier=nullif(c.before_image->>'supplier',''),reference=nullif(c.before_image->>'reference',''),source=c.before_image->>'source',record_version=(c.before_image->>'record_version')::integer,cancelled_at=nullif(c.before_image->>'cancelled_at','')::timestamptz,cancelled_by=nullif(c.before_image->>'cancelled_by','')::uuid,cancellation_reason=nullif(c.before_image->>'cancellation_reason',''),source_upload_id=nullif(c.before_image->>'source_upload_id','')::uuid where id=c.record_id;end if;
  elsif c.record_kind='vehicle' then
   select to_jsonb(v) into current_image from finance_private.vehicles v where vehicle_id=c.record_id for update;
   if current_image is distinct from c.after_image then raise exception 'A Finance record changed after this upload. Review conflicts before undo.';end if;
   if c.action='NEW' then
    if exists(select 1 from finance_private.recurring_costs where plate_key=current_image->>'plate_key') or exists(select 1 from finance_private.insurance where plate_key=current_image->>'plate_key') or exists(select 1 from finance_private.expenses where plate_key=current_image->>'plate_key') then raise exception 'Finance records depend on this imported vehicle';end if;
    update finance_private.vehicles set deleted_at=now() where vehicle_id=c.record_id;
   elsif c.before_image is not null then update finance_private.vehicles set display_plate=c.before_image->>'display_plate',model=nullif(c.before_image->>'model',''),business_unit=c.before_image->>'business_unit',ownership_type=c.before_image->>'ownership_type',status=c.before_image->>'status',deleted_at=nullif(c.before_image->>'deleted_at','')::timestamptz where vehicle_id=c.record_id;end if;
  elsif c.record_kind='fixed_cost' then
   select to_jsonb(t) into current_image from finance_private.fixed_cost_templates t where id=c.record_id for update;if current_image is distinct from c.after_image then raise exception 'A Finance record changed after this upload. Review conflicts before undo.';end if;
   if c.action='NEW' then
    if exists(select 1 from finance_private.fixed_cost_occurrences o join finance_private.expenses e on e.id=o.expense_id where o.template_id=c.record_id and o.finance_month>=u.finance_month and e.cancelled_at is null and (e.record_version<>1 or exists(select 1 from finance_private.bank_rows b where b.expense_id=e.id) or exists(select 1 from finance_private.workshop_allocations a where a.expense_id=e.id))) then raise exception 'A generated fixed-cost occurrence changed or has dependencies after this upload';end if;
    update finance_private.fixed_cost_templates set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason='Undo upload',record_version=record_version+1 where id=c.record_id;update finance_private.fixed_cost_occurrences o set cancelled_at=now() where template_id=c.record_id and finance_month>=u.finance_month;update finance_private.expenses e set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason='Undo upload',record_version=record_version+1 from finance_private.fixed_cost_occurrences o where o.template_id=c.record_id and o.expense_id=e.id and e.cancelled_at is null;
   elsif c.before_image is not null then update finance_private.fixed_cost_templates set category=c.before_image->>'category',monthly_amount=(c.before_image->>'monthly_amount')::numeric,effective_from=(c.before_image->>'effective_from')::date,effective_until=nullif(c.before_image->>'effective_until','')::date,payee=nullif(c.before_image->>'payee',''),note=nullif(c.before_image->>'note',''),source=nullif(c.before_image->>'source',''),record_version=(c.before_image->>'record_version')::integer,cancelled_at=nullif(c.before_image->>'cancelled_at','')::timestamptz,cancelled_by=nullif(c.before_image->>'cancelled_by','')::uuid,cancellation_reason=nullif(c.before_image->>'cancellation_reason',''),source_upload_id=nullif(c.before_image->>'source_upload_id','')::uuid where id=c.record_id;end if;
  elsif c.record_kind='other_income' then
   select to_jsonb(i) into current_image from finance_private.other_income i where id=c.record_id for update;if current_image is distinct from c.after_image then raise exception 'A Finance record changed after this upload. Review conflicts before undo.';end if;
   if c.action='NEW' then update finance_private.other_income set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason='Undo upload',record_version=record_version+1 where id=c.record_id;
   elsif c.before_image is not null then update finance_private.other_income set status=c.before_image->>'status',income_type=c.before_image->>'income_type',amount=(c.before_image->>'amount')::numeric,plate_key=nullif(c.before_image->>'plate_key',''),business_unit=c.before_image->>'business_unit',receipt_date=nullif(c.before_image->>'receipt_date','')::date,reference=nullif(c.before_image->>'reference',''),notes=nullif(c.before_image->>'notes',''),source=c.before_image->>'source',confirmation_key=c.before_image->>'confirmation_key',record_version=(c.before_image->>'record_version')::integer,cancelled_at=nullif(c.before_image->>'cancelled_at','')::timestamptz,cancelled_by=nullif(c.before_image->>'cancelled_by','')::uuid,cancellation_reason=nullif(c.before_image->>'cancellation_reason','') where id=c.record_id;end if;
  else raise exception 'This upload lacks a safe before-image undo path';end if;
 end loop;
 update finance_private.section_uploads set status='UNDONE' where id=u.id;perform finance_private.mark_month_changed(u.finance_month,u.kind in ('RECURRING_COST','VEHICLE','INSURANCE'));insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),u.finance_month,'UNDO_SAFE_IMPORT',jsonb_build_object('upload_id',u.id));return finance_private.input(u.finance_month);
end$$;

create function finance_private.generate_fixed_costs_core(p_month date) returns integer language plpgsql security definer set search_path='' as $$
declare t finance_private.fixed_cost_templates%rowtype;eid uuid;occ finance_private.fixed_cost_occurrences%rowtype;written integer:=0;begin
 for t in select * from finance_private.fixed_cost_templates where cancelled_at is null and effective_from<=p_month and (effective_until is null or effective_until>=p_month) order by id loop
  select * into occ from finance_private.fixed_cost_occurrences where series_id=t.series_id and finance_month=p_month for update;
  if not found then
   eid:=case when t.linked_expense_id is not null and exists(select 1 from finance_private.expenses where id=t.linked_expense_id and finance_month=p_month) then t.linked_expense_id else null end;
   if eid is null then insert into finance_private.expenses(finance_month,billing_date,plate_key,category,payment_source,supplier,amount,description,frequency,start_month,end_month,source,notes,fixed_cost_template_id) values(p_month,null,null,t.category,'Corporate Opex',t.payee,t.monthly_amount,t.note,'MONTHLY_RECURRING',t.effective_from,t.effective_until,coalesce(t.source,'Fixed Operating Cost'),t.note,t.id) returning id into eid;else update finance_private.expenses set fixed_cost_template_id=t.id where id=eid;end if;
   insert into finance_private.fixed_cost_occurrences(series_id,template_id,finance_month,expense_id) values(t.series_id,t.id,p_month,eid);written:=written+1;
  elsif occ.cancelled_at is null and occ.template_id<>t.id then
   update finance_private.fixed_cost_occurrences set template_id=t.id where series_id=t.series_id and finance_month=p_month;
   update finance_private.expenses set fixed_cost_template_id=t.id,category=case when record_version=1 then t.category else category end,supplier=case when record_version=1 then t.payee else supplier end,amount=case when record_version=1 then t.monthly_amount else amount end,description=case when record_version=1 then t.note else description end,start_month=t.effective_from,end_month=t.effective_until where id=occ.expense_id and cancelled_at is null;written:=written+1;
  end if;occ:=null;
 end loop;return written;
end$$;
create function finance_private.generate_fixed_costs(p_month date,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$declare n integer;begin perform finance_private.assert_open_revision(p_month,p_revision);n:=finance_private.generate_fixed_costs_core(p_month);if n>0 then perform finance_private.mark_month_changed(p_month,false);end if;return finance_private.input(p_month);end$$;
create function finance_private.save_fixed_cost(p_action text,p_record jsonb,p_month date,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid:=nullif(p_record->>'id','')::uuid;old finance_private.fixed_cost_templates%rowtype;series uuid;ver integer;affected date;new_template uuid;begin
 perform finance_private.assert_open_revision(p_month,p_revision);
 if p_action='ADD' then insert into finance_private.fixed_cost_templates(category,monthly_amount,effective_from,effective_until,payee,note,source) values(btrim(p_record->>'category'),(p_record->>'monthly_amount')::numeric,(p_record->>'effective_from')::date,nullif(p_record->>'effective_until','')::date,nullif(btrim(p_record->>'payee'),''),nullif(btrim(p_record->>'note'),''),'Manual / Fixed Operating Cost');
 else select * into old from finance_private.fixed_cost_templates where id=rid for update;if not found then raise exception 'Fixed operating cost no longer exists';end if;
  if p_action='STOP' then if p_month<old.effective_from then raise exception 'Stop month cannot be before the fixed cost starts';end if;update finance_private.fixed_cost_templates set effective_until=p_month,record_version=record_version+1 where id=rid;update finance_private.expenses e set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason='Fixed cost stopped',record_version=record_version+1 from finance_private.fixed_cost_occurrences o join finance_private.months m on m.finance_month=o.finance_month where o.series_id=old.series_id and o.finance_month>p_month and o.expense_id=e.id and m.status<>'CLOSED' and e.cancelled_at is null;update finance_private.fixed_cost_occurrences o set cancelled_at=now() from finance_private.months m where o.series_id=old.series_id and o.finance_month>p_month and m.finance_month=o.finance_month and m.status<>'CLOSED';
  elsif p_action='DELETE' then update finance_private.fixed_cost_templates set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason='Deleted in Settings',record_version=record_version+1 where id=rid;update finance_private.expenses e set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason='Fixed cost deleted',record_version=record_version+1 from finance_private.fixed_cost_occurrences o join finance_private.months m on m.finance_month=o.finance_month where o.series_id=old.series_id and o.expense_id=e.id and m.status<>'CLOSED' and e.cancelled_at is null;update finance_private.fixed_cost_occurrences o set cancelled_at=now() from finance_private.months m where o.series_id=old.series_id and m.finance_month=o.finance_month and m.status<>'CLOSED';
  elsif p_action='UPDATE_FUTURE' then if p_month<old.effective_from then raise exception 'Future update month cannot be before the fixed cost starts';end if;update finance_private.fixed_cost_templates set effective_until=(p_month-interval '1 month')::date,record_version=record_version+1 where id=rid;select old.series_id,max(version_no)+1 into series,ver from finance_private.fixed_cost_templates where series_id=old.series_id group by old.series_id;insert into finance_private.fixed_cost_templates(series_id,version_no,category,monthly_amount,effective_from,effective_until,payee,note,source) values(series,ver,btrim(p_record->>'category'),(p_record->>'monthly_amount')::numeric,p_month,nullif(p_record->>'effective_until','')::date,nullif(btrim(p_record->>'payee'),''),nullif(btrim(p_record->>'note'),''),old.source) returning id into new_template;
   for affected in select o.finance_month from finance_private.fixed_cost_occurrences o join finance_private.months m on m.finance_month=o.finance_month where o.series_id=old.series_id and o.finance_month>=p_month and m.status<>'CLOSED' order by o.finance_month loop perform finance_private.generate_fixed_costs_core(affected);end loop;
  else raise exception 'Invalid fixed operating cost action';end if;
 end if;
 if p_action in ('ADD','UPDATE_FUTURE') then perform finance_private.generate_fixed_costs_core(p_month);end if;perform finance_private.mark_month_changed(p_month,true);insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),p_month,'SAVE_FIXED_COST',jsonb_build_object('action',p_action,'id',rid,'before',case when rid is null then null else to_jsonb(old) end,'new_template_id',new_template));return finance_private.input(p_month);
end$$;

create function finance_private.save_workshop_summary(p_action text,p_record jsonb,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare m date:=(p_record->>'finance_month')::date;rid uuid:=nullif(p_record->>'id','')::uuid;stored_month date;before jsonb;after jsonb;begin perform finance_private.lock_finance();
 if rid is not null then select finance_month,to_jsonb(s) into stored_month,before from finance_private.workshop_summaries s where id=rid for update;if stored_month is null then raise exception 'Workshop summary no longer exists';end if;if m is distinct from stored_month then raise exception 'Workshop summary belongs to a different Finance month';end if;end if;
 perform finance_private.assert_open_revision(m,p_revision);
 if p_action='ADD' then insert into finance_private.workshop_summaries(finance_month,business_unit,amount,supplier,reference,note,created_by) values(m,nullif(p_record->>'business_unit',''),(p_record->>'amount')::numeric,nullif(btrim(p_record->>'supplier'),''),nullif(btrim(p_record->>'reference'),''),nullif(btrim(p_record->>'note'),''),auth.uid()) returning id into rid;
 elsif p_action='UPDATE' then if exists(select 1 from finance_private.workshop_allocations wa join finance_private.expenses e on e.id=wa.expense_id join finance_private.vehicles v on v.plate_key=e.plate_key where wa.summary_id=rid and e.cancelled_at is null and nullif(p_record->>'business_unit','') is not null and v.business_unit is distinct from nullif(p_record->>'business_unit','')) then raise exception 'Workshop summary business conflicts with an existing vehicle allocation';end if;update finance_private.workshop_summaries set business_unit=nullif(p_record->>'business_unit',''),amount=(p_record->>'amount')::numeric,supplier=nullif(btrim(p_record->>'supplier'),''),reference=nullif(btrim(p_record->>'reference'),''),note=nullif(btrim(p_record->>'note'),''),record_version=record_version+1 where id=rid and cancelled_at is null;
 elsif p_action='CANCEL' then if nullif(btrim(p_record->>'reason'),'') is null then raise exception 'Enter a correction reason';end if;if exists(select 1 from finance_private.workshop_allocations where summary_id=rid) then raise exception 'Remove or reassign linked workshop allocations before cancelling the summary';end if;update finance_private.workshop_summaries set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason=btrim(p_record->>'reason'),record_version=record_version+1 where id=rid and cancelled_at is null;
 else raise exception 'Invalid workshop summary action';end if;
 if exists(select 1 from finance_private.workshop_summaries s where s.id=rid and (select coalesce(sum(e.amount),0) from finance_private.workshop_allocations a join finance_private.expenses e on e.id=a.expense_id where a.summary_id=s.id and e.cancelled_at is null)>s.amount) then raise exception 'Workshop allocations exceed the monthly summary';end if;
 select to_jsonb(s) into after from finance_private.workshop_summaries s where id=rid;perform finance_private.mark_month_changed(m,false);insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),m,'SAVE_WORKSHOP_SUMMARY',jsonb_build_object('id',rid,'action',p_action,'reason',nullif(btrim(p_record->>'reason'),''),'before',before,'after',after));return finance_private.input(m);end$$;
create function finance_private.link_workshop_allocation(p_summary_id uuid,p_expense_id uuid,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare s finance_private.workshop_summaries%rowtype;e finance_private.expenses%rowtype;b text;allocated numeric;linked uuid;begin perform finance_private.lock_finance();select * into s from finance_private.workshop_summaries where id=p_summary_id and cancelled_at is null for update;select * into e from finance_private.expenses where id=p_expense_id and cancelled_at is null for update;if s.id is null or e.id is null then raise exception 'Workshop summary or expense no longer exists';end if;perform finance_private.assert_open_revision(s.finance_month,p_revision);if e.payment_source<>'Workshop Billing' or e.finance_month<>s.finance_month then raise exception 'Workshop allocation must use an active workshop expense from the same month';end if;select summary_id into linked from finance_private.workshop_allocations where expense_id=e.id;if linked=s.id then return finance_private.input(s.finance_month);elsif linked is not null then raise exception 'Workshop expense is already linked to another summary';end if;select business_unit into b from finance_private.vehicles where plate_key=e.plate_key;if s.business_unit is not null and b is distinct from s.business_unit then raise exception 'Workshop allocation business does not match the summary';end if;select coalesce(sum(x.amount),0) into allocated from finance_private.workshop_allocations a join finance_private.expenses x on x.id=a.expense_id where a.summary_id=s.id and x.cancelled_at is null;if allocated+e.amount>s.amount then raise exception 'Workshop allocations exceed the monthly summary';end if;insert into finance_private.workshop_allocations(summary_id,expense_id,allocated_by) values(s.id,e.id,auth.uid());perform finance_private.mark_month_changed(s.finance_month,false);insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),s.finance_month,'LINK_WORKSHOP_ALLOCATION',jsonb_build_object('summary_id',s.id,'expense_id',e.id,'allocated_before',allocated,'allocated_after',allocated+e.amount,'summary_amount',s.amount));return finance_private.input(s.finance_month);end$$;

create function finance_private.save_other_income(p_action text,p_record jsonb,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare m date:=(p_record->>'finance_month')::date;rid uuid:=nullif(p_record->>'id','')::uuid;plate text:=nullif(regexp_replace(upper(p_record->>'plate_key'),'\s','','g'),'');business text;ck text;existing uuid;stored_month date;before jsonb;after jsonb;begin if rid is not null then select finance_month,to_jsonb(i) into stored_month,before from finance_private.other_income i where id=rid for update;if stored_month is null then raise exception 'Other Income record no longer exists';end if;if m is distinct from stored_month then raise exception 'Other Income belongs to a different Finance month';end if;end if;perform finance_private.assert_open_revision(m,p_revision);if plate is not null then select business_unit into business from finance_private.vehicles where plate_key=plate and deleted_at is null;if business is null then raise exception 'Map the Other Income vehicle in Finance first';end if;else business:=p_record->>'business_unit';end if;ck:=md5(concat_ws('|',m,p_record->>'status',lower(btrim(p_record->>'income_type')),coalesce(plate,''),coalesce(business,''),(p_record->>'amount')::numeric,coalesce(p_record->>'receipt_date',''),coalesce(btrim(p_record->>'reference'),'')));
 if p_action='ADD' then select id into existing from finance_private.other_income where confirmation_key=ck and cancelled_at is null;if existing is not null then return finance_private.input(m);end if;insert into finance_private.other_income(finance_month,status,income_type,amount,plate_key,business_unit,receipt_date,reference,notes,confirmation_key,created_by) values(m,p_record->>'status',btrim(p_record->>'income_type'),(p_record->>'amount')::numeric,plate,business,nullif(p_record->>'receipt_date','')::date,nullif(btrim(p_record->>'reference'),''),nullif(btrim(p_record->>'notes'),''),ck,auth.uid()) returning id into rid;
 elsif p_action='UPDATE' then update finance_private.other_income set status=p_record->>'status',income_type=btrim(p_record->>'income_type'),amount=(p_record->>'amount')::numeric,plate_key=plate,business_unit=business,receipt_date=nullif(p_record->>'receipt_date','')::date,reference=nullif(btrim(p_record->>'reference'),''),notes=nullif(btrim(p_record->>'notes'),''),confirmation_key=ck,record_version=record_version+1 where id=rid and cancelled_at is null;
 elsif p_action='CANCEL' then if nullif(btrim(p_record->>'reason'),'') is null then raise exception 'Enter a correction reason';end if;update finance_private.other_income set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason=btrim(p_record->>'reason'),record_version=record_version+1 where id=rid and cancelled_at is null;
 else raise exception 'Invalid Other Income action';end if;select to_jsonb(i) into after from finance_private.other_income i where id=rid;perform finance_private.mark_month_changed(m,false);insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),m,'SAVE_OTHER_INCOME',jsonb_build_object('action',p_action,'id',rid,'reason',nullif(btrim(p_record->>'reason'),''),'before',before,'after',after));return finance_private.input(m);end$$;

create function public.finance_mutate_record(p_kind text,p_action text,p_record jsonb,p_effective_month date,p_revision integer,p_reason text default '') returns jsonb language sql security invoker set search_path='' as $$select finance_private.mutate_record(p_kind,p_action,p_record,p_effective_month,p_revision,p_reason)$$;
create function public.finance_preview_section_import(p_kind text,p_month date,p_filename text,p_rows jsonb,p_revision integer,p_source_hash text,p_mode text default 'UPDATE',p_replace_upload_id uuid default null) returns jsonb language sql security invoker set search_path='' as $$select finance_private.preview_section_import(p_kind,p_month,p_filename,p_rows,p_revision,p_source_hash,p_mode,p_replace_upload_id)$$;
create function public.finance_apply_section_import(p_preview_token uuid,p_confirmation jsonb,p_revision integer) returns jsonb language sql security invoker set search_path='' as $$select finance_private.apply_section_import(p_preview_token,p_confirmation,p_revision)$$;
create function public.finance_undo_section_import(p_upload_id uuid,p_revision integer) returns jsonb language sql security invoker set search_path='' as $$select finance_private.undo_section_import(p_upload_id,p_revision)$$;
create function public.finance_generate_fixed_costs(p_month date,p_revision integer) returns jsonb language sql security invoker set search_path='' as $$select finance_private.generate_fixed_costs(p_month,p_revision)$$;
create function public.finance_save_fixed_cost(p_action text,p_record jsonb,p_month date,p_revision integer) returns jsonb language sql security invoker set search_path='' as $$select finance_private.save_fixed_cost(p_action,p_record,p_month,p_revision)$$;
create function public.finance_save_workshop_summary(p_action text,p_record jsonb,p_revision integer) returns jsonb language sql security invoker set search_path='' as $$select finance_private.save_workshop_summary(p_action,p_record,p_revision)$$;
create function public.finance_link_workshop_allocation(p_summary_id uuid,p_expense_id uuid,p_revision integer) returns jsonb language sql security invoker set search_path='' as $$select finance_private.link_workshop_allocation(p_summary_id,p_expense_id,p_revision)$$;
create function public.finance_save_other_income(p_action text,p_record jsonb,p_revision integer) returns jsonb language sql security invoker set search_path='' as $$select finance_private.save_other_income(p_action,p_record,p_revision)$$;

do $$declare c text;begin
 select conname into c from pg_constraint where conrelid='finance_private.section_reviews'::regclass and contype='c' and pg_get_constraintdef(oid) like '%section%';
 if c is not null then execute format('alter table finance_private.section_reviews drop constraint %I',c);end if;
end$$;
alter table finance_private.section_reviews add constraint finance_section_reviews_section_check check(section in ('workshop','vehicle_expense','corporate_expense','other_income'));

create or replace function finance_private.section_fingerprint(p_month date,p_section text) returns text language sql stable security definer set search_path='' as $$
 select case
  when p_section='other_income' then coalesce((select jsonb_agg(jsonb_build_array(i.id,i.status,i.income_type,i.amount,i.plate_key,i.business_unit,i.receipt_date,i.reference,i.cancelled_at) order by i.id)::text from finance_private.other_income i where i.finance_month=p_month),'[]')
  when p_section='workshop' then jsonb_build_object(
   'expenses',coalesce((select jsonb_agg(jsonb_build_array(e.id,e.billing_date,e.plate_key,e.category,e.supplier,e.amount,e.reference,e.description,e.cancelled_at) order by e.id) from finance_private.expenses e where e.finance_month=p_month and e.payment_source='Workshop Billing'),'[]'::jsonb),
   'summaries',coalesce((select jsonb_agg(jsonb_build_array(s.id,s.business_unit,s.amount,s.supplier,s.reference,s.cancelled_at) order by s.id) from finance_private.workshop_summaries s where s.finance_month=p_month),'[]'::jsonb),
   'allocations',coalesce((select jsonb_agg(jsonb_build_array(a.summary_id,a.expense_id) order by a.summary_id,a.expense_id) from finance_private.workshop_allocations a join finance_private.workshop_summaries s on s.id=a.summary_id where s.finance_month=p_month),'[]'::jsonb)
  )::text
  else coalesce((select jsonb_agg(jsonb_build_array(e.id,e.billing_date,e.plate_key,e.category,e.payment_source,e.supplier,e.amount,e.reference,e.description,e.cancelled_at) order by e.id)::text from finance_private.expenses e where e.finance_month=p_month and ((p_section='vehicle_expense' and e.payment_source='Vehicle Direct Cost') or (p_section='corporate_expense' and e.payment_source='Corporate Opex'))),'[]') end
$$;
create or replace function finance_private.workspace_meta(p_month date) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform finance_private.require_admin();if p_month is null or extract(day from p_month)<>1 then raise exception 'Finance month must be the first day of a month';end if;
 return jsonb_build_object(
  'reviews',(select coalesce(jsonb_agg(jsonb_build_object('section',s.section,'decision',coalesce(r.decision,'MISSING'),'reviewed_at',r.reviewed_at,'valid',coalesce(r.fingerprint=finance_private.section_fingerprint(p_month,s.section),false)) order by s.section),'[]'::jsonb) from (values ('workshop'),('vehicle_expense'),('corporate_expense'),('other_income')) s(section) left join finance_private.section_reviews r on r.finance_month=p_month and r.section=s.section),
  'uploads',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'kind',lower(u.kind),'filename',u.filename,'imported_at',u.imported_at,'row_count',u.row_count,'total_amount',u.total_amount,'status',u.status,'source_audit',u.source_audit) order by u.imported_at desc,u.id),'[]'::jsonb) from finance_private.section_uploads u where u.finance_month=p_month));
end$$;
create or replace function finance_private.review_section(p_month date,p_section text,p_decision text,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare has_rows boolean;begin perform finance_private.lock_finance();perform finance_private.assert_open_revision(p_month,p_revision);
 if p_section not in ('workshop','vehicle_expense','corporate_expense','other_income') or p_decision not in ('NONE','REVIEWED') then raise exception 'Invalid section review';end if;
 select case when p_section='other_income' then exists(select 1 from finance_private.other_income where finance_month=p_month and cancelled_at is null)
  when p_section='workshop' then exists(select 1 from finance_private.expenses where finance_month=p_month and payment_source='Workshop Billing' and cancelled_at is null) or exists(select 1 from finance_private.workshop_summaries where finance_month=p_month and cancelled_at is null)
  else exists(select 1 from finance_private.expenses where finance_month=p_month and cancelled_at is null and payment_source=case when p_section='vehicle_expense' then 'Vehicle Direct Cost' else 'Corporate Opex' end) end into has_rows;
 if p_decision='NONE' and has_rows then raise exception 'A non-empty section cannot be marked none';end if;
 insert into finance_private.section_reviews(finance_month,section,decision,reviewed_at,reviewed_by,fingerprint) values(p_month,p_section,p_decision,now(),auth.uid(),finance_private.section_fingerprint(p_month,p_section)) on conflict(finance_month,section) do update set decision=excluded.decision,reviewed_at=excluded.reviewed_at,reviewed_by=excluded.reviewed_by,fingerprint=excluded.fingerprint;
 insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),p_month,'REVIEW_FINANCE_SECTION',jsonb_build_object('section',p_section,'decision',p_decision));return finance_private.workspace_meta(p_month);end$$;

create or replace function finance_private.transition_month(p_month date,p_action text,p_revision integer,p_acknowledgement text) returns jsonb language plpgsql security definer set search_path='' as $$
declare m finance_private.months;result jsonb;begin perform finance_private.lock_finance();perform finance_private.ensure_month(p_month);select * into m from finance_private.months where finance_month=p_month for update;perform finance_private.require_admin();
 if p_revision is distinct from m.revision then raise exception 'Month changed. Reload and review before continuing.';end if;
 if p_action='REOPEN' then if m.status='DRAFT' then raise exception 'Month is already Draft';end if;if nullif(btrim(p_acknowledgement),'') is null then raise exception 'Enter a reason to reopen';end if;insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),p_month,'REOPEN',jsonb_build_object('reason',p_acknowledgement,'previous_frozen_input',m.frozen_input));update finance_private.months set status='DRAFT',revision=revision+1,frozen_input=null,frozen_at=null where finance_month=p_month;
 elsif p_action in ('READY','CLOSE') then
  if (p_action='READY' and m.status<>'DRAFT') or (p_action='CLOSE' and m.status<>'READY FOR REVIEW') then raise exception 'Invalid month lifecycle transition';end if;
  if m.refreshed_at is null then raise exception 'Refresh the complete E-hailing ledger first';end if;perform finance_private.validate_bank_links(p_month);
  if not exists(select 1 from finance_private.imports where finance_month=p_month and kind='SMART_DRIVE' and status='POSTED') then raise exception 'Approve the official Smart Drive report first';end if;
  if exists(select 1 from finance_private.ehailing e left join finance_private.vehicles v on v.plate_key=e.plate_key where e.finance_month=p_month and (e.driver_id is null or e.driver_name_snapshot is null or v.plate_key is null)) or exists(select 1 from finance_private.smart_rows s join finance_private.imports i on i.id=s.import_id left join finance_private.vehicles v on v.plate_key=s.plate_key where i.finance_month=p_month and i.status='POSTED' and v.plate_key is null) then raise exception 'Resolve missing driver or unmatched vehicle mappings before review';end if;
  if exists(select 1 from (select p.id,p.driver_id,p.date,p.amount,p.service_claim,p.payment_method,d.name,d.car_plate from public.payments p left join public.drivers d on d.id=p.driver_id where p.date>=p_month and p.date<p_month+interval '1 month') p full join (select * from finance_private.ehailing where finance_month=p_month) e on e.source_payment_id=p.id where p.id is null or e.source_payment_id is null or row(p.driver_id,p.date,p.amount,p.service_claim,p.payment_method,p.name,p.car_plate) is distinct from row(e.driver_id,e.payment_date,e.cash_amount,e.service_claim,e.payment_method,e.driver_name_snapshot,e.car_plate_snapshot)) then raise exception 'Operational ledger changed. Reopen review and refresh before closing.';end if;
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

create or replace function finance_private.refresh_payments(p_month date) returns jsonb language plpgsql security definer set search_path='' as $$
declare last_id uuid;batch_count integer;batch_last uuid;stamp timestamptz:=clock_timestamp();begin perform finance_private.lock_finance();perform finance_private.require_draft(p_month);
 if exists(select 1 from public.payments p join finance_private.ehailing e on e.source_payment_id=p.id where p.date>=p_month and p.date<p_month+interval '1 month' and e.finance_month<>p_month) then raise exception 'Payment source ID belongs to another Finance month. Reopen and refresh that original month first.';end if;
 drop table if exists pg_temp.finance_payment_stage;create temporary table finance_payment_stage (like finance_private.ehailing including defaults) on commit drop;
 insert into pg_temp.finance_payment_stage(source_payment_id,driver_id,driver_name_snapshot,car_plate_snapshot,plate_key,payment_date,cash_amount,service_claim,gross_rental_revenue,payment_method,refreshed_at,finance_month,attribution_changed)
 select p.id,p.driver_id,d.name,d.car_plate,coalesce(finance_private.canonical_plate(d.car_plate),nullif(regexp_replace(upper(d.car_plate),'\s','','g'),'')),p.date,p.amount,p.service_claim,p.amount+p.service_claim,p.payment_method,stamp,p_month,coalesce(old.attribution_changed,false) or (old.source_payment_id is not null and old.car_plate_snapshot is distinct from d.car_plate)
 from public.payments p left join public.drivers d on d.id=p.driver_id left join finance_private.ehailing old on old.source_payment_id=p.id where p.date>=p_month and p.date<p_month+interval '1 month';
 delete from finance_private.ehailing where finance_month=p_month;
 loop with page as(select * from pg_temp.finance_payment_stage where last_id is null or source_payment_id>last_id order by source_payment_id limit 500),written as(insert into finance_private.ehailing(source_payment_id,driver_id,driver_name_snapshot,car_plate_snapshot,plate_key,payment_date,cash_amount,service_claim,payment_method,refreshed_at,finance_month,attribution_changed) select source_payment_id,driver_id,driver_name_snapshot,car_plate_snapshot,plate_key,payment_date,cash_amount,service_claim,payment_method,refreshed_at,finance_month,attribution_changed from page returning source_payment_id) select count(*),max(source_payment_id::text)::uuid into batch_count,batch_last from written;exit when batch_count=0;last_id:=batch_last;end loop;
 update finance_private.months set refreshed_at=stamp,revision=revision+1,source_count=(select count(*) from pg_temp.finance_payment_stage),total_cash=(select coalesce(sum(cash_amount),0) from pg_temp.finance_payment_stage),total_claim=(select coalesce(sum(service_claim),0) from pg_temp.finance_payment_stage),earliest_date=(select min(payment_date) from pg_temp.finance_payment_stage),latest_date=(select max(payment_date) from pg_temp.finance_payment_stage) where finance_month=p_month;
 update finance_private.mutation_state set generation=generation+1 where singleton;insert into finance_private.audit(actor,finance_month,action) values(auth.uid(),p_month,'REFRESH_PAYMENTS');return finance_private.input(p_month);end$$;

create or replace function finance_private.post_smart_drive(p_month date,p_filename text,p_rows jsonb,p_replace boolean,p_revision integer,p_source_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare import_key uuid;existing uuid;begin perform finance_private.lock_finance();perform finance_private.require_draft(p_month);if p_revision is distinct from(select revision from finance_private.months where finance_month=p_month) then raise exception 'Month changed. Reload and review before posting.';end if;if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Invalid Smart Drive rows';end if;
 select coalesce(jsonb_agg(case when nullif(x->>'plate_key','') is null then x else x||jsonb_build_object('plate_key',r.plate_key,'display_plate',coalesce(v.display_plate,r.plate_key)) end),'[]'::jsonb) into p_rows
 from jsonb_array_elements(p_rows)x
 left join lateral(select coalesce(finance_private.canonical_plate(x->>'plate_key'),regexp_replace(upper(x->>'plate_key'),'\s','','g')) plate_key)r on true
 left join finance_private.vehicles v on v.plate_key=r.plate_key and v.deleted_at is null;
 select id into existing from finance_private.imports where finance_month=p_month and kind='SMART_DRIVE' and status='POSTED';if existing is not null and not coalesce(p_replace,false) then raise exception 'Smart Drive import already exists. View Existing, Replace Import, or Cancel.';end if;if existing is not null then update finance_private.imports set status='REPLACED' where id=existing;end if;
 insert into finance_private.imports(finance_month,kind,filename,imported_by,row_count,source_hash) values(p_month,'SMART_DRIVE',p_filename,auth.uid(),jsonb_array_length(p_rows),p_source_hash) returning id into import_key;
 insert into finance_private.smart_rows(import_id,source_row,sheet_name,reference,plate_key,display_plate,pickup_date,return_date,gross_revenue,commission,status,payment_status) select import_key,r.source_row,r.sheet_name,nullif(btrim(r.reference),''),r.plate_key,r.display_plate,r.pickup_date,r.return_date,r.gross_revenue,r.commission,r.status,r.payment_status from jsonb_to_recordset(p_rows) as r(source_row integer,sheet_name text,reference text,plate_key text,display_plate text,pickup_date date,return_date date,gross_revenue numeric,commission numeric,status text,payment_status text);
 update finance_private.months set revision=revision+1 where finance_month=p_month;update finance_private.mutation_state set generation=generation+1 where singleton;insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),p_month,'APPROVE_SMART_DRIVE',jsonb_build_object('import_id',import_key,'replaces',existing));return finance_private.input(p_month);end$$;

-- Lock before reading mutable rows so summary/allocation/import mutations share one lock order.
create or replace function finance_private.save_workshop_summary(p_action text,p_record jsonb,p_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 m date:=(p_record->>'finance_month')::date;
 rid uuid:=nullif(p_record->>'id','')::uuid;
 stored_month date;
 before jsonb;
 after jsonb;
 reason text:=nullif(btrim(p_record->>'reason'),'');
begin
 perform finance_private.lock_finance();
 if rid is not null then
  select finance_month,to_jsonb(s) into stored_month,before from finance_private.workshop_summaries s where id=rid for update;
  if stored_month is null then raise exception 'Workshop summary no longer exists';end if;
  if m is distinct from stored_month then raise exception 'Workshop summary belongs to a different Finance month';end if;
 end if;
 perform finance_private.assert_open_revision(m,p_revision);
 if p_action='ADD' then
  insert into finance_private.workshop_summaries(finance_month,business_unit,amount,supplier,reference,note,created_by)
  values(m,nullif(p_record->>'business_unit',''),(p_record->>'amount')::numeric,nullif(btrim(p_record->>'supplier'),''),nullif(btrim(p_record->>'reference'),''),nullif(btrim(p_record->>'note'),''),auth.uid()) returning id into rid;
 elsif p_action='UPDATE' then
  if (before->>'amount')::numeric is distinct from (p_record->>'amount')::numeric and reason is null then raise exception 'Enter a correction reason when changing the workshop total';end if;
  if exists(select 1 from finance_private.workshop_allocations wa join finance_private.expenses e on e.id=wa.expense_id join finance_private.vehicles v on v.plate_key=e.plate_key where wa.summary_id=rid and e.cancelled_at is null and nullif(p_record->>'business_unit','') is not null and v.business_unit is distinct from nullif(p_record->>'business_unit','')) then raise exception 'Workshop summary business conflicts with an existing vehicle allocation';end if;
  update finance_private.workshop_summaries set business_unit=nullif(p_record->>'business_unit',''),amount=(p_record->>'amount')::numeric,supplier=nullif(btrim(p_record->>'supplier'),''),reference=nullif(btrim(p_record->>'reference'),''),note=nullif(btrim(p_record->>'note'),''),record_version=record_version+1 where id=rid and cancelled_at is null;
 elsif p_action='CANCEL' then
  if reason is null then raise exception 'Enter a correction reason';end if;
  if exists(select 1 from finance_private.workshop_allocations where summary_id=rid) then raise exception 'Remove or reassign linked workshop allocations before cancelling the summary';end if;
  update finance_private.workshop_summaries set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason=reason,record_version=record_version+1 where id=rid and cancelled_at is null;
 else raise exception 'Invalid workshop summary action';end if;
 if exists(select 1 from finance_private.workshop_summaries s where s.id=rid and (select coalesce(sum(e.amount),0) from finance_private.workshop_allocations a join finance_private.expenses e on e.id=a.expense_id where a.summary_id=s.id and e.cancelled_at is null)>s.amount) then raise exception 'Workshop allocations exceed the monthly summary';end if;
 select to_jsonb(s) into after from finance_private.workshop_summaries s where id=rid;
 perform finance_private.mark_month_changed(m,false);
 insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),m,'SAVE_WORKSHOP_SUMMARY',jsonb_build_object('id',rid,'action',p_action,'reason',reason,'before',before,'after',after));
 return finance_private.input(m);
end$$;

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
begin
 perform finance_private.lock_finance();
 if rid is not null then
  select finance_month,to_jsonb(i) into stored_month,before from finance_private.other_income i where id=rid for update;
  if stored_month is null then raise exception 'Other Income record no longer exists';end if;
  if m is distinct from stored_month then raise exception 'Other Income belongs to a different Finance month';end if;
 end if;
 perform finance_private.assert_open_revision(m,p_revision);
 plate:=finance_private.canonical_plate(p_record->>'plate_key');
 if plate is not null then
  select business_unit into business from finance_private.vehicles where plate_key=plate and deleted_at is null;
  if business is null then raise exception 'Map the Other Income vehicle in Finance first';end if;
 else business:=p_record->>'business_unit';end if;
 ck:=md5(concat_ws('|',m,p_record->>'status',lower(btrim(p_record->>'income_type')),coalesce(plate,''),coalesce(business,''),(p_record->>'amount')::numeric,coalesce(p_record->>'receipt_date',''),coalesce(btrim(p_record->>'reference'),'')));
 if p_action='ADD' then
  select id into existing from finance_private.other_income where confirmation_key=ck and cancelled_at is null;
  if existing is not null then return finance_private.input(m);end if;
  insert into finance_private.other_income(finance_month,status,income_type,amount,plate_key,business_unit,receipt_date,reference,notes,confirmation_key,created_by)
  values(m,p_record->>'status',btrim(p_record->>'income_type'),(p_record->>'amount')::numeric,plate,business,nullif(p_record->>'receipt_date','')::date,nullif(btrim(p_record->>'reference'),''),nullif(btrim(p_record->>'notes'),''),ck,auth.uid()) returning id into rid;
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

-- Legacy write endpoints cannot bypass reviewed identities, cancellation tombstones or revision checks.
create or replace function public.finance_save_record(p_kind text,p_record jsonb) returns void language plpgsql security invoker set search_path='' as $$begin raise exception 'Refresh Finance and use the reviewed Add/Edit/Delete workflow';end$$;
create or replace function public.finance_post_section_workbook(p_kind text,p_month date,p_filename text,p_rows jsonb,p_revision integer,p_source_hash text) returns jsonb language plpgsql security invoker set search_path='' as $$begin raise exception 'Review the import changes before posting';end$$;
create or replace function public.finance_post_workshop(p_month date,p_filename text,p_rows jsonb,p_revision integer,p_source_hash text default null) returns jsonb language plpgsql security invoker set search_path='' as $$begin raise exception 'Review the workshop import changes before posting';end$$;
create or replace function public.finance_bootstrap(p_data jsonb,p_filename text) returns void language plpgsql security invoker set search_path='' as $$begin raise exception 'Use the section-specific reviewed import workflow';end$$;
create or replace function public.finance_copy_previous_shared_costs(p_month date,p_rows jsonb,p_revision integer) returns jsonb language plpgsql security invoker set search_path='' as $$begin raise exception 'Use Fixed Operating Costs; active templates generate each open month without copying';end$$;
revoke all on function finance_private.save_record(text,jsonb),finance_private.post_section_workbook(text,date,text,jsonb,integer,text),finance_private.post_workshop(date,text,jsonb,integer,text),finance_private.bootstrap(jsonb,text),finance_private.copy_previous_shared_costs(date,jsonb,integer) from authenticated;

create or replace function finance_private.delete_vehicle(p_month date,p_plate text,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$declare original finance_private.vehicles%rowtype;begin perform finance_private.assert_open_revision(p_month,p_revision);select * into original from finance_private.vehicles where plate_key=regexp_replace(upper(p_plate),'\s','','g') for update;if not found then raise exception 'This vehicle no longer exists. Reload the Vehicle Master.';end if;if original.deleted_at is not null then raise exception 'This vehicle is already deleted.';end if;update finance_private.vehicles set deleted_at=now() where vehicle_id=original.vehicle_id;perform finance_private.mark_month_changed(p_month,true);insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),p_month,'DELETE_VEHICLE',jsonb_build_object('plate_key',original.plate_key,'vehicle',to_jsonb(original)));return finance_private.input(p_month);end$$;

revoke all on function finance_private.canonical_plate(text),finance_private.assert_open_revision(date,integer),finance_private.mark_month_changed(date,boolean),finance_private.mutate_record(text,text,jsonb,date,integer,text),finance_private.preview_section_import(text,date,text,jsonb,integer,text,text,uuid),finance_private.apply_section_import(uuid,jsonb,integer),finance_private.undo_section_import(uuid,integer),finance_private.generate_fixed_costs_core(date),finance_private.generate_fixed_costs(date,integer),finance_private.save_fixed_cost(text,jsonb,date,integer),finance_private.save_workshop_summary(text,jsonb,integer),finance_private.link_workshop_allocation(uuid,uuid,integer),finance_private.save_other_income(text,jsonb,integer) from public,anon,authenticated;
revoke all on function public.finance_mutate_record(text,text,jsonb,date,integer,text),public.finance_preview_section_import(text,date,text,jsonb,integer,text,text,uuid),public.finance_apply_section_import(uuid,jsonb,integer),public.finance_undo_section_import(uuid,integer),public.finance_generate_fixed_costs(date,integer),public.finance_save_fixed_cost(text,jsonb,date,integer),public.finance_save_workshop_summary(text,jsonb,integer),public.finance_link_workshop_allocation(uuid,uuid,integer),public.finance_save_other_income(text,jsonb,integer),public.finance_save_record(text,jsonb),public.finance_post_section_workbook(text,date,text,jsonb,integer,text),public.finance_post_workshop(date,text,jsonb,integer,text),public.finance_bootstrap(jsonb,text) from public,anon,authenticated;
grant execute on function finance_private.mutate_record(text,text,jsonb,date,integer,text),finance_private.preview_section_import(text,date,text,jsonb,integer,text,text,uuid),finance_private.apply_section_import(uuid,jsonb,integer),finance_private.undo_section_import(uuid,integer),finance_private.generate_fixed_costs(date,integer),finance_private.save_fixed_cost(text,jsonb,date,integer),finance_private.save_workshop_summary(text,jsonb,integer),finance_private.link_workshop_allocation(uuid,uuid,integer),finance_private.save_other_income(text,jsonb,integer) to authenticated;
grant execute on function public.finance_mutate_record(text,text,jsonb,date,integer,text),public.finance_preview_section_import(text,date,text,jsonb,integer,text,text,uuid),public.finance_apply_section_import(uuid,jsonb,integer),public.finance_undo_section_import(uuid,integer),public.finance_generate_fixed_costs(date,integer),public.finance_save_fixed_cost(text,jsonb,date,integer),public.finance_save_workshop_summary(text,jsonb,integer),public.finance_link_workshop_allocation(uuid,uuid,integer),public.finance_save_other_income(text,jsonb,integer),public.finance_save_record(text,jsonb),public.finance_post_section_workbook(text,date,text,jsonb,integer,text),public.finance_post_workshop(date,text,jsonb,integer,text),public.finance_bootstrap(jsonb,text) to authenticated;

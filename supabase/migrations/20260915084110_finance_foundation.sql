-- Finance owns its records. Operational payments/drivers are read-only sources.
-- Internal tables/functions are outside PostgREST's exposed public schema.
do $$begin
 if has_column_privilege('anon','public.profiles','role','UPDATE') or has_column_privilege('authenticated','public.profiles','role','UPDATE')
 or has_table_privilege('anon','public.profiles','INSERT') or has_table_privilege('authenticated','public.profiles','INSERT') then
  raise exception 'Secure profile role permissions before installing Finance';
 end if;
end$$;
create schema finance_private;
revoke all on schema finance_private from public, anon, authenticated;
grant usage on schema finance_private to authenticated;

create table finance_private.months (
  finance_month date primary key check(extract(day from finance_month)=1),
  status text not null default 'DRAFT' check(status in ('DRAFT','READY FOR REVIEW','CLOSED')),
  revision integer not null default 0, refreshed_at timestamptz, frozen_at timestamptz,
  source_count integer not null default 0, total_cash numeric not null default 0, total_claim numeric not null default 0,
  earliest_date date, latest_date date, frozen_input jsonb,
  check ((status='CLOSED') = (frozen_input is not null))
);
create table finance_private.vehicles (
  plate_key text primary key check(plate_key<>'' and plate_key=regexp_replace(upper(plate_key),'\s','','g')),
  display_plate text not null check(btrim(display_plate)<>''),
  business_unit text not null check(business_unit in ('E-HAILING','DAILY RENTAL','SMART DRIVE','SAMBUNG BAYAR')),
  ownership_type text not null check(btrim(ownership_type)<>''), status text not null check(btrim(status)<>''),
  check(plate_key=regexp_replace(upper(display_plate),'\s','','g'))
);
create table finance_private.recurring_costs (
  id uuid primary key default gen_random_uuid(), plate_key text not null check(plate_key<>''),
  start_month date not null check(extract(day from start_month)=1), end_month date check(extract(day from end_month)=1),
  -- Preserve prepared-workbook classifications verbatim; unresolved labels are flagged in Finance.
  cost_type text not null check(btrim(cost_type)<>''),
  monthly_amount numeric(16,2) not null check(monthly_amount>=0 and monthly_amount<'Infinity'), payee text, notes text,
  check(end_month is null or end_month>=start_month)
);
create table finance_private.insurance (
  id uuid primary key default gen_random_uuid(),plate_key text not null check(plate_key<>''),
  premium numeric(16,2) not null check(premium>=0 and premium<'Infinity'),payment_date date,
  coverage_start date not null,coverage_end date not null check(coverage_end>=coverage_start)
);
create table finance_private.imports (
  id uuid primary key default gen_random_uuid(),finance_month date not null,
  kind text not null check(kind in ('SMART_DRIVE','BOOTSTRAP','WORKSHOP')), filename text not null check(btrim(filename)<>''),
  imported_at timestamptz not null default now(),imported_by uuid not null,
  row_count integer not null check(row_count>=0),status text not null default 'POSTED' check(status in ('POSTED','REPLACED')),
  source_hash text,source_audit jsonb not null default '[]'
);
create unique index finance_one_smart_month on finance_private.imports(finance_month) where kind='SMART_DRIVE' and status='POSTED';
create unique index finance_one_bootstrap on finance_private.imports(kind) where kind='BOOTSTRAP';
create unique index finance_workshop_hash on finance_private.imports(source_hash) where kind='WORKSHOP' and source_hash is not null;
create table finance_private.expenses (
  id uuid primary key default gen_random_uuid(),finance_month date not null references finance_private.months(finance_month),billing_date date not null,
  plate_key text,category text not null,payment_source text not null check(payment_source in ('Workshop Billing','Vehicle Direct Cost','Corporate Opex')),
  supplier text,amount numeric(16,2) not null check(amount>=0 and amount<'Infinity'),reference text,description text,
  import_id uuid references finance_private.imports(id),source_row integer,sheet_name text,
  check ((payment_source='Corporate Opex' and plate_key is null) or (payment_source<>'Corporate Opex' and plate_key is not null and plate_key<>'')),
  check ((payment_source='Workshop Billing' and category='Service & Maintenance') or
    (payment_source='Vehicle Direct Cost' and category in ('Road Tax','APAD / Permit','Puspakom','Tyres','Battery','Repair','Accident','Towing','Restoration','Other Vehicle Cost')) or
    (payment_source='Corporate Opex' and category in ('Office Rental','Accounting Fee','Salary','KWSP','PERKESO','PCB','Utilities','Internet','Professional Fees','General Software','Other Corporate Cost')))
);
create table finance_private.ehailing (
  source_payment_id uuid primary key,driver_id uuid,driver_name_snapshot text,car_plate_snapshot text,plate_key text,
  payment_date date not null,cash_amount numeric not null,service_claim numeric not null,
  gross_rental_revenue numeric generated always as(cash_amount+service_claim) stored,payment_method text,
  refreshed_at timestamptz not null,finance_month date not null references finance_private.months(finance_month),attribution_changed boolean not null default false
);
create index finance_ehailing_month on finance_private.ehailing(finance_month,source_payment_id);
create table finance_private.smart_rows (
  import_id uuid not null references finance_private.imports(id),source_row integer not null check(source_row>0),sheet_name text not null,
  reference text,plate_key text not null check(plate_key<>''),display_plate text not null,
  pickup_date date not null,return_date date not null check(return_date>=pickup_date),
  gross_revenue numeric(16,2) not null check(gross_revenue>=0 and gross_revenue<'Infinity'),commission numeric(16,2) not null check(commission>=0 and commission<=gross_revenue),
  status text not null check(btrim(status)<>''),payment_status text,
  primary key(import_id,sheet_name,source_row),check(plate_key=regexp_replace(upper(display_plate),'\s','','g'))
);
create unique index finance_smart_reference on finance_private.smart_rows(import_id,reference) where nullif(btrim(reference),'') is not null;
create table finance_private.audit (
  id uuid primary key default gen_random_uuid(),occurred_at timestamptz not null default now(),actor uuid not null,
  finance_month date,action text not null,details jsonb not null default '{}'
);
do $$declare t text;begin
 for t in select tablename from pg_tables where schemaname='finance_private' loop
  execute format('alter table finance_private.%I enable row level security',t);
  execute format('revoke all on finance_private.%I from public,anon,authenticated',t);
 end loop;
end$$;

create function finance_private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((auth.jwt()->>'role')='authenticated' and (auth.jwt()->>'is_anonymous') is distinct from 'true'
  and case when (auth.jwt()->>'exp') ~ '^[0-9]+$' then (auth.jwt()->>'exp')::numeric > extract(epoch from now()) else false end
  and exists(select 1 from public.profiles p join auth.users u on u.id=p.id join auth.sessions s on s.user_id=u.id
   where p.id=auth.uid() and p.role='admin' and not coalesce(u.is_anonymous,false) and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<now()) and s.id::text=auth.jwt()->>'session_id'
   and (s.not_after is null or s.not_after>now())),false)
$$;
create function finance_private.require_admin() returns void language plpgsql security definer set search_path='' as $$begin
 if not finance_private.is_admin() then raise exception 'Finance requires a valid authenticated Admin session' using errcode='42501';end if;
end$$;
create function finance_private.lock_finance() returns void language plpgsql security definer set search_path='' as $$begin
 perform finance_private.require_admin();
 -- One transaction lock serializes low-volume monthly Finance edits, imports and closures.
 perform pg_advisory_xact_lock(6727,202608);
end$$;
create function finance_private.ensure_month(p_month date) returns void language plpgsql security definer set search_path='' as $$begin
 if p_month is null or extract(day from p_month)<>1 then raise exception 'Finance month must be the first day of a month';end if;
 insert into finance_private.months(finance_month) values(p_month) on conflict do nothing;
end$$;
create function finance_private.require_draft(p_month date) returns void language plpgsql security definer set search_path='' as $$declare s text;begin
 perform finance_private.ensure_month(p_month);select status into s from finance_private.months where finance_month=p_month;
 if s='CLOSED' then raise exception 'Reopen the closed month before changing Finance records';end if;
 if s<>'DRAFT' then raise exception 'Reopen review to Draft before changing Finance records';end if;
end$$;
create function finance_private.touch_open_months() returns void language sql security definer set search_path='' as $$
 update finance_private.months set status='DRAFT',revision=revision+1 where status<>'CLOSED';
$$;
create function finance_private.input(p_month date) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('calculation_version',1,
 'month',(select to_jsonb(m)-'frozen_input' from finance_private.months m where finance_month=p_month),
 'vehicles',coalesce((select jsonb_agg(to_jsonb(v) order by plate_key) from finance_private.vehicles v),'[]'),
 'recurring_costs',coalesce((select jsonb_agg(to_jsonb(c) order by id) from finance_private.recurring_costs c),'[]'),
 'insurance',coalesce((select jsonb_agg(to_jsonb(i) order by id) from finance_private.insurance i),'[]'),
 'expenses',coalesce((select jsonb_agg(to_jsonb(e) order by id) from finance_private.expenses e where finance_month=p_month),'[]'),
 'ehailing',coalesce((select jsonb_agg(to_jsonb(e) order by source_payment_id) from finance_private.ehailing e where finance_month=p_month),'[]'),
 'smart_import',(select to_jsonb(i)-'source_audit' from finance_private.imports i where finance_month=p_month and kind='SMART_DRIVE' and status='POSTED'),
 'smart_rows',coalesce((select jsonb_agg(to_jsonb(s)-'import_id' order by s.sheet_name,s.source_row) from finance_private.smart_rows s join finance_private.imports i on i.id=s.import_id where i.finance_month=p_month and i.kind='SMART_DRIVE' and i.status='POSTED'),'[]'),
 'imports',coalesce((select jsonb_agg(to_jsonb(i) order by imported_at,id) from finance_private.imports i where i.finance_month=p_month or i.kind='BOOTSTRAP'),'[]'),
 'bootstrap_completed',exists(select 1 from finance_private.imports where kind='BOOTSTRAP'))
$$;
create function finance_private.read_month(p_month date) returns jsonb language plpgsql security definer set search_path='' as $$declare frozen jsonb;begin
 perform finance_private.lock_finance();perform finance_private.ensure_month(p_month);
 select frozen_input into frozen from finance_private.months where finance_month=p_month;
 return coalesce(frozen,finance_private.input(p_month));
end$$;
create function finance_private.refresh_payments(p_month date) returns jsonb language plpgsql security definer set search_path='' as $$
declare last_id uuid;batch_count integer;batch_last uuid;stamp timestamptz:=clock_timestamp();begin
 perform finance_private.lock_finance();perform finance_private.require_draft(p_month);
 -- A moved operational payment must be removed by refreshing its original Draft month first.
 if exists(select 1 from public.payments p join finance_private.ehailing e on e.source_payment_id=p.id where p.date>=p_month and p.date<p_month+interval '1 month' and e.finance_month<>p_month) then
  raise exception 'Payment source ID belongs to another Finance month. Reopen and refresh that original month first.';
 end if;
 -- Snapshot the full applicable ledger at one SQL statement boundary, then explicitly consume
 -- ordered 500-row keyset pages. This never depends on PostgREST's 1,000-row return limit.
 -- Never reuse a caller-created temporary table inside privileged code.
 drop table if exists pg_temp.finance_payment_stage;
 create temporary table finance_payment_stage (like finance_private.ehailing including defaults) on commit drop;
 insert into pg_temp.finance_payment_stage(source_payment_id,driver_id,driver_name_snapshot,car_plate_snapshot,plate_key,payment_date,cash_amount,service_claim,gross_rental_revenue,payment_method,refreshed_at,finance_month,attribution_changed)
 select p.id,p.driver_id,d.name,d.car_plate,nullif(regexp_replace(upper(d.car_plate),'\s','','g'),''),p.date,p.amount,p.service_claim,p.amount+p.service_claim,p.payment_method,stamp,p_month,
 coalesce(old.attribution_changed,false) or (old.source_payment_id is not null and old.car_plate_snapshot is distinct from d.car_plate)
 from public.payments p left join public.drivers d on d.id=p.driver_id left join finance_private.ehailing old on old.source_payment_id=p.id
 where p.date>=p_month and p.date<p_month+interval '1 month';
 delete from finance_private.ehailing where finance_month=p_month;
 loop
  with page as (select * from pg_temp.finance_payment_stage where last_id is null or source_payment_id>last_id order by source_payment_id limit 500),
  written as (insert into finance_private.ehailing(source_payment_id,driver_id,driver_name_snapshot,car_plate_snapshot,plate_key,payment_date,cash_amount,service_claim,payment_method,refreshed_at,finance_month,attribution_changed)
   select source_payment_id,driver_id,driver_name_snapshot,car_plate_snapshot,plate_key,payment_date,cash_amount,service_claim,payment_method,refreshed_at,finance_month,attribution_changed from page returning source_payment_id)
  select count(*),max(source_payment_id::text)::uuid into batch_count,batch_last from written;
  exit when batch_count=0;last_id:=batch_last;
 end loop;
 update finance_private.months set refreshed_at=stamp,revision=revision+1,
 source_count=(select count(*) from pg_temp.finance_payment_stage),total_cash=(select coalesce(sum(cash_amount),0) from pg_temp.finance_payment_stage),
 total_claim=(select coalesce(sum(service_claim),0) from pg_temp.finance_payment_stage),earliest_date=(select min(payment_date) from pg_temp.finance_payment_stage),latest_date=(select max(payment_date) from pg_temp.finance_payment_stage)
 where finance_month=p_month;
 insert into finance_private.audit(actor,finance_month,action) values(auth.uid(),p_month,'REFRESH_PAYMENTS');
 return finance_private.input(p_month);
end$$;

create function finance_private.save_record(p_kind text,p_record jsonb) returns void language plpgsql security definer set search_path='' as $$
declare rid uuid;plate text;old_month date;new_month date;begin
 perform finance_private.lock_finance();
 if jsonb_typeof(p_record)<>'object' then raise exception 'Invalid Finance record';end if;
 rid:=coalesce(nullif(p_record->>'id','')::uuid,gen_random_uuid());
 plate:=nullif(regexp_replace(upper(p_record->>'plate_key'),'\s','','g'),'');
 if p_kind='vehicle' then
  insert into finance_private.vehicles(plate_key,display_plate,business_unit,ownership_type,status)
   values(plate,btrim(p_record->>'display_plate'),p_record->>'business_unit',p_record->>'ownership_type',p_record->>'status')
   on conflict(plate_key) do update set display_plate=excluded.display_plate,business_unit=excluded.business_unit,ownership_type=excluded.ownership_type,status=excluded.status;
 elsif p_kind='recurring_cost' then
  if p_record->>'id' is not null and not exists(select 1 from finance_private.recurring_costs where id=rid) then raise exception 'Recurring cost no longer exists';end if;
  insert into finance_private.recurring_costs(id,plate_key,start_month,end_month,cost_type,monthly_amount,payee,notes)
   values(rid,plate,(p_record->>'start_month')::date,nullif(p_record->>'end_month','')::date,p_record->>'cost_type',(p_record->>'monthly_amount')::numeric,p_record->>'payee',p_record->>'notes')
   on conflict(id) do update set plate_key=excluded.plate_key,start_month=excluded.start_month,end_month=excluded.end_month,cost_type=excluded.cost_type,monthly_amount=excluded.monthly_amount,payee=excluded.payee,notes=excluded.notes;
 elsif p_kind='insurance' then
  if p_record->>'id' is not null and not exists(select 1 from finance_private.insurance where id=rid) then raise exception 'Insurance no longer exists';end if;
  insert into finance_private.insurance(id,plate_key,premium,payment_date,coverage_start,coverage_end)
   values(rid,plate,(p_record->>'premium')::numeric,nullif(p_record->>'payment_date','')::date,(p_record->>'coverage_start')::date,(p_record->>'coverage_end')::date)
   on conflict(id) do update set plate_key=excluded.plate_key,premium=excluded.premium,payment_date=excluded.payment_date,coverage_start=excluded.coverage_start,coverage_end=excluded.coverage_end;
 elsif p_kind='expense' then
  new_month:=(p_record->>'finance_month')::date;
  select finance_month into old_month from finance_private.expenses where id=rid;
  if p_record->>'id' is not null and old_month is null then raise exception 'Expense no longer exists';end if;
  if old_month is not null then perform finance_private.require_draft(old_month);end if;
  perform finance_private.require_draft(new_month);
  insert into finance_private.expenses(id,finance_month,billing_date,plate_key,category,payment_source,supplier,amount,reference,description)
   values(rid,new_month,(p_record->>'billing_date')::date,plate,p_record->>'category',p_record->>'payment_source',p_record->>'supplier',(p_record->>'amount')::numeric,p_record->>'reference',p_record->>'description')
   on conflict(id) do update set finance_month=excluded.finance_month,billing_date=excluded.billing_date,plate_key=excluded.plate_key,category=excluded.category,payment_source=excluded.payment_source,supplier=excluded.supplier,amount=excluded.amount,reference=excluded.reference,description=excluded.description;
 else raise exception 'Unknown Finance record kind';end if;
 perform finance_private.touch_open_months();
 insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),new_month,'SAVE_RECORD',jsonb_build_object('kind',p_kind,'id',rid,'plate_key',plate));
end$$;

create function finance_private.post_smart_drive(p_month date,p_filename text,p_rows jsonb,p_replace boolean,p_revision integer,p_source_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare import_key uuid;existing uuid;begin
 perform finance_private.lock_finance();perform finance_private.require_draft(p_month);
 if p_revision is distinct from (select revision from finance_private.months where finance_month=p_month) then raise exception 'Month changed. Reload and review before posting.';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Invalid Smart Drive rows';end if;
 select id into existing from finance_private.imports where finance_month=p_month and kind='SMART_DRIVE' and status='POSTED';
 if existing is not null and not coalesce(p_replace,false) then raise exception 'Smart Drive import already exists. View Existing, Replace Import, or Cancel.';end if;
 if existing is not null then update finance_private.imports set status='REPLACED' where id=existing;end if;
 insert into finance_private.imports(finance_month,kind,filename,imported_by,row_count,source_hash)
 values(p_month,'SMART_DRIVE',p_filename,auth.uid(),jsonb_array_length(p_rows),p_source_hash) returning id into import_key;
 -- Explicit column whitelist discards customer identity fields even if sent by a hostile client.
 insert into finance_private.smart_rows(import_id,source_row,sheet_name,reference,plate_key,display_plate,pickup_date,return_date,gross_revenue,commission,status,payment_status)
 select import_key,r.source_row,r.sheet_name,nullif(btrim(r.reference),''),r.plate_key,r.display_plate,r.pickup_date,r.return_date,r.gross_revenue,r.commission,r.status,r.payment_status
 from jsonb_to_recordset(p_rows) as r(source_row integer,sheet_name text,reference text,plate_key text,display_plate text,pickup_date date,return_date date,gross_revenue numeric,commission numeric,status text,payment_status text);
 update finance_private.months set revision=revision+1 where finance_month=p_month;
 insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),p_month,'APPROVE_SMART_DRIVE',jsonb_build_object('import_id',import_key,'replaces',existing));
 return finance_private.input(p_month);
end$$;
create function finance_private.bootstrap(p_data jsonb,p_filename text) returns void language plpgsql security definer set search_path='' as $$declare row_data jsonb;import_key uuid;begin
 perform finance_private.lock_finance();
 if exists(select 1 from finance_private.imports where kind='BOOTSTRAP') then raise exception 'Initial Finance import already completed';end if;
 if exists(select 1 from finance_private.vehicles) or exists(select 1 from finance_private.recurring_costs) or exists(select 1 from finance_private.insurance) then raise exception 'Initial import requires empty Finance masters; maintain existing records inside Finance';end if;
 if jsonb_typeof(p_data->'vehicles') is distinct from 'array' or jsonb_array_length(p_data->'vehicles')=0 or jsonb_typeof(p_data->'recurring_costs') is distinct from 'array' or jsonb_typeof(p_data->'insurance') is distinct from 'array' then raise exception 'Invalid bootstrap: vehicle, monthly cost and insurance sheets required';end if;
 if exists(select 1 from jsonb_array_elements(p_data->'vehicles') v group by regexp_replace(upper(v->>'plate_key'),'\s','','g') having count(*)>1) then raise exception 'Duplicate or ambiguous bootstrap plate';end if;
 for row_data in select value from jsonb_array_elements(p_data->'vehicles') loop perform finance_private.save_record('vehicle',row_data-'id');end loop;
 for row_data in select value from jsonb_array_elements(p_data->'recurring_costs') loop
  if not exists(select 1 from finance_private.vehicles where plate_key=regexp_replace(upper(row_data->>'plate_key'),'\s','','g')) then raise exception 'Unmatched monthly cost plate';end if;
  perform finance_private.save_record('recurring_cost',row_data-'id');
 end loop;
 for row_data in select value from jsonb_array_elements(p_data->'insurance') loop
  if not exists(select 1 from finance_private.vehicles where plate_key=regexp_replace(upper(row_data->>'plate_key'),'\s','','g')) then raise exception 'Unmatched insurance plate';end if;
  perform finance_private.save_record('insurance',row_data-'id');
 end loop;
 insert into finance_private.imports(finance_month,kind,filename,imported_by,row_count,source_audit)
 values(date_trunc('month',current_date),'BOOTSTRAP',p_filename,auth.uid(),jsonb_array_length(p_data->'vehicles')+jsonb_array_length(p_data->'recurring_costs')+jsonb_array_length(p_data->'insurance'),
  (select coalesce(jsonb_agg(jsonb_build_object('sheet_name',v->>'sheet_name','source_row',v->'source_row','plate_key',v->>'plate_key')),'[]') from jsonb_array_elements((p_data->'vehicles')||(p_data->'recurring_costs')||(p_data->'insurance')) v)) returning id into import_key;
 insert into finance_private.audit(actor,action,details) values(auth.uid(),'APPROVE_BOOTSTRAP',jsonb_build_object('import_id',import_key));
end$$;
create function finance_private.post_workshop(p_month date,p_filename text,p_rows jsonb,p_revision integer,p_source_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare row_data jsonb;expense_id uuid;import_key uuid;begin
 perform finance_private.lock_finance();perform finance_private.require_draft(p_month);
 if p_revision is distinct from (select revision from finance_private.months where finance_month=p_month) then raise exception 'Month changed. Reload and review before posting.';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)=0 then raise exception 'Invalid workshop rows';end if;
 if p_source_hash is null or p_source_hash !~ '^[a-f0-9]{64}$' then raise exception 'Workshop file SHA-256 is required to prevent duplicate uploads';end if;
 if exists(select 1 from finance_private.imports where kind='WORKSHOP' and (source_hash=p_source_hash or (finance_month=p_month and filename=p_filename))) then raise exception 'Workshop file already imported';end if;
 insert into finance_private.imports(finance_month,kind,filename,imported_by,row_count,source_hash) values(p_month,'WORKSHOP',p_filename,auth.uid(),jsonb_array_length(p_rows),p_source_hash) returning id into import_key;
 for row_data in select value from jsonb_array_elements(p_rows) loop
  if (row_data->>'finance_month')::date is distinct from p_month or row_data->>'payment_source' is distinct from 'Workshop Billing' then raise exception 'Invalid workshop month or payment source';end if;
  if (row_data->>'source_row') is null or (row_data->>'source_row')::integer<1 or nullif(row_data->>'sheet_name','') is null then raise exception 'Workshop source sheet and row are required';end if;
  insert into finance_private.expenses(finance_month,billing_date,plate_key,category,payment_source,supplier,amount,reference,description,import_id,source_row,sheet_name)
   values(p_month,(row_data->>'billing_date')::date,nullif(regexp_replace(upper(row_data->>'plate_key'),'\s','','g'),''),'Service & Maintenance','Workshop Billing',row_data->>'supplier',
    (row_data->>'amount')::numeric,row_data->>'reference',row_data->>'description',import_key,(row_data->>'source_row')::integer,row_data->>'sheet_name');
 end loop;
 update finance_private.months set revision=revision+1 where finance_month=p_month;
 insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),p_month,'APPROVE_WORKSHOP',jsonb_build_object('import_id',import_key));
 return finance_private.input(p_month);
end$$;

create function finance_private.validate_bank_links(p_month date) returns void language sql security definer set search_path='' as $$select finance_private.require_admin()$$;
create function finance_private.transition_month(p_month date,p_action text,p_revision integer,p_acknowledgement text) returns jsonb language plpgsql security definer set search_path='' as $$
declare m finance_private.months;result jsonb;begin
 perform finance_private.lock_finance();perform finance_private.ensure_month(p_month);
 select * into m from finance_private.months where finance_month=p_month;
 if p_revision is distinct from m.revision then raise exception 'Month changed. Reload and review before continuing.';end if;
 if p_action='REOPEN' then
  if m.status='DRAFT' then raise exception 'Month is already Draft';end if;
  if nullif(btrim(p_acknowledgement),'') is null then raise exception 'Enter a reason to reopen';end if;
  insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),p_month,'REOPEN',jsonb_build_object('reason',p_acknowledgement,'previous_frozen_input',m.frozen_input));
  update finance_private.months set status='DRAFT',revision=revision+1,frozen_input=null,frozen_at=null where finance_month=p_month;
 elsif p_action in ('READY','CLOSE') then
  if (p_action='READY' and m.status<>'DRAFT') or (p_action='CLOSE' and m.status<>'READY FOR REVIEW') then raise exception 'Invalid month lifecycle transition';end if;
  if m.refreshed_at is null then raise exception 'Refresh the complete E-hailing ledger first';end if;
  perform finance_private.validate_bank_links(p_month);
  if not exists(select 1 from finance_private.imports where finance_month=p_month and kind='SMART_DRIVE' and status='POSTED') then raise exception 'Approve the official Smart Drive report first';end if;
  if exists(select 1 from finance_private.ehailing e left join finance_private.vehicles v on v.plate_key=e.plate_key where e.finance_month=p_month and (e.driver_id is null or e.driver_name_snapshot is null or v.plate_key is null))
   or exists(select 1 from finance_private.smart_rows s join finance_private.imports i on i.id=s.import_id left join finance_private.vehicles v on v.plate_key=s.plate_key where i.finance_month=p_month and i.status='POSTED' and v.plate_key is null)
   then raise exception 'Resolve missing driver or unmatched vehicle mappings before review';end if;
  -- Compare each raw field, not just sums: compensating edits must also invalidate review.
  if exists(select 1 from (select p.id,p.driver_id,p.date,p.amount,p.service_claim,p.payment_method,d.name,d.car_plate from public.payments p left join public.drivers d on d.id=p.driver_id where p.date>=p_month and p.date<p_month+interval '1 month') p
    full join (select * from finance_private.ehailing where finance_month=p_month) e on e.source_payment_id=p.id
    where p.id is null or e.source_payment_id is null or row(p.driver_id,p.date,p.amount,p.service_claim,p.payment_method,p.name,p.car_plate) is distinct from row(e.driver_id,e.payment_date,e.cash_amount,e.service_claim,e.payment_method,e.driver_name_snapshot,e.car_plate_snapshot)) then raise exception 'Operational ledger changed. Reopen review and refresh before closing.';end if;
  if p_action='READY' then update finance_private.months set status='READY FOR REVIEW',revision=revision+1 where finance_month=p_month;
  else
   if nullif(btrim(p_acknowledgement),'') is null then raise exception 'Acknowledge review of costs and historical plate attribution before closing';end if;
   -- Build the complete frozen input in one statement. The stored month metadata describes CLOSED.
   result:=finance_private.input(p_month);
   result:=jsonb_set(result,'{month}',(result->'month')||jsonb_build_object('status','CLOSED','revision',m.revision+1,'frozen_at',now()));
   update finance_private.months set status='CLOSED',revision=revision+1,frozen_at=now(),frozen_input=result where finance_month=p_month;
  end if;
  insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),p_month,p_action,jsonb_build_object('acknowledgement',p_acknowledgement));
 else raise exception 'Unknown month lifecycle action';end if;
 return finance_private.read_month(p_month);
end$$;

-- Public APIs are invoker wrappers. Only the narrowly granted private entry points can
-- elevate, and each verifies the current Admin session before reading or writing anything.
create function public.finance_access() returns boolean language sql security invoker set search_path='' as $$select finance_private.is_admin()$$;
create function public.finance_read_month(p_month date) returns jsonb language sql security invoker set search_path='' as $$select finance_private.read_month(p_month)$$;
create function public.finance_refresh_payments(p_month date) returns jsonb language sql security invoker set search_path='' as $$select finance_private.refresh_payments(p_month)$$;
create function public.finance_save_record(p_kind text,p_record jsonb) returns void language sql security invoker set search_path='' as $$select finance_private.save_record(p_kind,p_record)$$;
create function public.finance_post_smart_drive(p_month date,p_filename text,p_rows jsonb,p_replace boolean,p_revision integer,p_source_hash text default null) returns jsonb language sql security invoker set search_path='' as $$select finance_private.post_smart_drive(p_month,p_filename,p_rows,p_replace,p_revision,p_source_hash)$$;
create function public.finance_bootstrap(p_data jsonb,p_filename text) returns void language sql security invoker set search_path='' as $$select finance_private.bootstrap(p_data,p_filename)$$;
create function public.finance_post_workshop(p_month date,p_filename text,p_rows jsonb,p_revision integer,p_source_hash text default null) returns jsonb language sql security invoker set search_path='' as $$select finance_private.post_workshop(p_month,p_filename,p_rows,p_revision,p_source_hash)$$;
create function public.finance_transition_month(p_month date,p_action text,p_revision integer,p_acknowledgement text default '') returns jsonb language sql security invoker set search_path='' as $$select finance_private.transition_month(p_month,p_action,p_revision,p_acknowledgement)$$;
revoke all on all functions in schema finance_private from public,anon,authenticated;
grant execute on function finance_private.is_admin(),finance_private.read_month(date),finance_private.refresh_payments(date),finance_private.save_record(text,jsonb),finance_private.post_smart_drive(date,text,jsonb,boolean,integer,text),finance_private.bootstrap(jsonb,text),finance_private.post_workshop(date,text,jsonb,integer,text),finance_private.transition_month(date,text,integer,text) to authenticated;
do $$declare f record;begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'finance\_%' escape '\' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end$$;

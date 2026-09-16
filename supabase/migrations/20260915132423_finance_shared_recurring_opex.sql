-- Recurring Shared Opex belongs to a Finance month without inventing an expense date.
alter table finance_private.expenses
 alter column billing_date drop not null,
 add column frequency text not null default 'ONE_OFF' check(frequency in ('ONE_OFF','MONTHLY_RECURRING')),
 add column start_month date,
 add column end_month date,
 add column source text,
 add column notes text,
 add constraint finance_expense_frequency_dates check(
  (frequency='ONE_OFF' and billing_date is not null and start_month is null and end_month is null)
  or (frequency='MONTHLY_RECURRING' and payment_source='Corporate Opex'
   and start_month is not null and extract(day from start_month)=1 and start_month<=finance_month
   and (end_month is null or (extract(day from end_month)=1 and end_month>=finance_month and end_month>=start_month))));

-- Corporate workbooks can be reused in a different month; same-month duplicates stay blocked.
alter table finance_private.section_uploads drop constraint section_uploads_kind_source_hash_key;
create unique index finance_section_global_hash on finance_private.section_uploads(kind,source_hash) where kind<>'CORPORATE_EXPENSE';
create unique index finance_corporate_month_hash on finance_private.section_uploads(kind,finance_month,source_hash) where kind='CORPORATE_EXPENSE';


create or replace function finance_private.save_record(p_kind text,p_record jsonb) returns void language plpgsql security definer set search_path='' as $$
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
  insert into finance_private.insurance(id,plate_key,premium,payment_date,coverage_start,coverage_end,responsibility,supplier,reference,source)
   values(rid,plate,(p_record->>'premium')::numeric,nullif(p_record->>'payment_date','')::date,nullif(p_record->>'coverage_start','')::date,nullif(p_record->>'coverage_end','')::date,case when p_record ? 'responsibility' then finance_private.normalize_insurance_responsibility(p_record->>'responsibility') else (select responsibility from finance_private.insurance where id=rid) end,
    case when p_record ? 'supplier' then nullif(btrim(p_record->>'supplier'),'') else (select supplier from finance_private.insurance where id=rid) end,
    case when p_record ? 'reference' then nullif(btrim(p_record->>'reference'),'') else (select reference from finance_private.insurance where id=rid) end,
    case when p_record ? 'source' then nullif(btrim(p_record->>'source'),'') else (select source from finance_private.insurance where id=rid) end)
   on conflict(id) do update set plate_key=excluded.plate_key,premium=excluded.premium,payment_date=excluded.payment_date,coverage_start=excluded.coverage_start,coverage_end=excluded.coverage_end,responsibility=excluded.responsibility,supplier=excluded.supplier,reference=excluded.reference,source=excluded.source;
 elsif p_kind='expense' then
  new_month:=(p_record->>'finance_month')::date;
  select finance_month into old_month from finance_private.expenses where id=rid;
  if p_record->>'id' is not null and old_month is null then raise exception 'Expense no longer exists';end if;
  if old_month is not null then perform finance_private.require_draft(old_month);end if;
  perform finance_private.require_draft(new_month);
  insert into finance_private.expenses(id,finance_month,billing_date,plate_key,category,payment_source,supplier,amount,reference,description,frequency,start_month,end_month,source,notes)
   values(rid,new_month,nullif(p_record->>'billing_date','')::date,plate,p_record->>'category',p_record->>'payment_source',p_record->>'supplier',(p_record->>'amount')::numeric,p_record->>'reference',p_record->>'description',
    case when p_record ? 'frequency' then p_record->>'frequency' else coalesce((select frequency from finance_private.expenses where id=rid),'ONE_OFF') end,
    case when p_record ? 'start_month' then nullif(p_record->>'start_month','')::date else (select start_month from finance_private.expenses where id=rid) end,
    case when p_record ? 'end_month' then nullif(p_record->>'end_month','')::date else (select end_month from finance_private.expenses where id=rid) end,
    case when p_record ? 'source' then p_record->>'source' else (select source from finance_private.expenses where id=rid) end,
    case when p_record ? 'notes' then p_record->>'notes' else (select notes from finance_private.expenses where id=rid) end)
   on conflict(id) do update set finance_month=excluded.finance_month,billing_date=excluded.billing_date,plate_key=excluded.plate_key,category=excluded.category,payment_source=excluded.payment_source,supplier=excluded.supplier,amount=excluded.amount,reference=excluded.reference,description=excluded.description,frequency=excluded.frequency,start_month=excluded.start_month,end_month=excluded.end_month,source=excluded.source,notes=excluded.notes;
 else raise exception 'Unknown Finance record kind';end if;
 perform finance_private.touch_open_months();
 insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),new_month,'SAVE_RECORD',jsonb_build_object('kind',p_kind,'id',rid,'plate_key',plate));
end$$;

create or replace function finance_private.post_section_workbook(p_kind text,p_month date,p_filename text,p_rows jsonb,p_revision integer,p_source_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; upload_id uuid; plate text; natural_id uuid; target_id uuid; total numeric:=0; expected_source text; allowed_categories text[];begin
 perform finance_private.lock_finance();perform finance_private.require_draft(p_month);
 if p_revision is distinct from (select revision from finance_private.months where finance_month=p_month) then raise exception 'Month changed. Reload and review before posting.';end if;
 if p_kind not in ('VEHICLE_EXPENSE','CORPORATE_EXPENSE','VEHICLE','RECURRING_COST','INSURANCE') then raise exception 'Invalid Finance section kind';end if;
 if nullif(btrim(p_filename),'') is null or p_source_hash !~ '^[a-f0-9]{64}$' then raise exception 'Filename and SHA-256 source hash are required';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)=0 then raise exception 'Invalid section rows';end if;
 if exists(select 1 from finance_private.section_uploads where kind=p_kind and source_hash=p_source_hash and (p_kind<>'CORPORATE_EXPENSE' or finance_month=p_month)) then raise exception 'This workbook content was already imported for this section';end if;
 insert into finance_private.section_uploads(finance_month,kind,filename,source_hash,imported_by,row_count,source_audit) values(p_month,p_kind,p_filename,p_source_hash,auth.uid(),jsonb_array_length(p_rows),'[]'::jsonb) returning id into upload_id;
 for r in select value from jsonb_array_elements(p_rows) loop
  if nullif(r->>'sheet_name','') is null or coalesce((r->>'source_row')::integer,0)<1 then raise exception 'Source sheet and row are required';end if;
  plate:=nullif(regexp_replace(upper(r->>'plate_key'),'\s','','g'),'');
  if p_kind in ('VEHICLE_EXPENSE','CORPORATE_EXPENSE') then
   expected_source:=case when p_kind='VEHICLE_EXPENSE' then 'Vehicle Direct Cost' else 'Corporate Opex' end;
   allowed_categories:=case when p_kind='VEHICLE_EXPENSE' then array['Road Tax','APAD / Permit','Puspakom','Tyres','Battery','Repair','Accident','Towing','Restoration','Other Vehicle Cost'] else array['Office Rental','Accounting Fee','Salary','KWSP','PERKESO','PCB','Utilities','Internet','Professional Fees','General Software','Other Corporate Cost'] end;
   if (r->>'finance_month')::date is distinct from p_month or r->>'payment_source' is distinct from expected_source or nullif(btrim(r->>'category'),'') is null or (case when r->>'category'='Software' then 'General Software' else r->>'category' end)<>all(allowed_categories) or (r->>'amount')::numeric is null or (r->>'amount')::numeric<0 or (r->>'amount')::numeric<>round((r->>'amount')::numeric,2) then raise exception 'Invalid expense row';end if;
   if p_kind='CORPORATE_EXPENSE' and r->>'frequency'='MONTHLY_RECURRING' then
    if nullif(r->>'start_month','')::date is null or extract(day from (r->>'start_month')::date)<>1 or (r->>'start_month')::date>p_month
     or (nullif(r->>'end_month','') is not null and (extract(day from (r->>'end_month')::date)<>1 or (r->>'end_month')::date<p_month or (r->>'end_month')::date<(r->>'start_month')::date)) then raise exception 'Invalid recurring expense month range';end if;
   elsif coalesce(r->>'frequency','ONE_OFF')<>'ONE_OFF' or nullif(r->>'billing_date','')::date is null or (r->>'billing_date')::date<p_month or (r->>'billing_date')::date>=p_month+interval '1 month' then raise exception 'Invalid expense date or frequency';end if;
   if p_kind='VEHICLE_EXPENSE' and (plate is null or not exists(select 1 from finance_private.vehicles where plate_key=plate)) then raise exception 'Vehicle expense has an unknown vehicle';end if;
   if p_kind='CORPORATE_EXPENSE' and plate is not null then raise exception 'Corporate expense cannot have a vehicle';end if;
   if exists(select 1 from finance_private.expenses e where e.finance_month=p_month and e.billing_date is not distinct from nullif(r->>'billing_date','')::date and e.plate_key is not distinct from plate and e.category=(case when r->>'category'='Software' then 'General Software' else r->>'category' end) and e.payment_source=expected_source and e.supplier is not distinct from r->>'supplier' and e.amount=(r->>'amount')::numeric and e.reference is not distinct from r->>'reference' and e.description is not distinct from r->>'description') then raise exception 'This Finance expense row was already imported';end if;
   insert into finance_private.expenses(finance_month,billing_date,plate_key,category,payment_source,supplier,amount,reference,description,source_row,sheet_name,frequency,start_month,end_month,source,notes) values(p_month,nullif(r->>'billing_date','')::date,plate,case when r->>'category'='Software' then 'General Software' else r->>'category' end,expected_source,r->>'supplier',(r->>'amount')::numeric,r->>'reference',r->>'description',(r->>'source_row')::integer,r->>'sheet_name',coalesce(r->>'frequency','ONE_OFF'),nullif(r->>'start_month','')::date,nullif(r->>'end_month','')::date,r->>'source',r->>'notes') returning id into target_id;total:=total+(r->>'amount')::numeric;
  elsif p_kind='VEHICLE' then
   if plate is null or nullif(btrim(r->>'display_plate'),'') is null or r->>'business_unit' not in ('E-HAILING','DAILY RENTAL','SMART DRIVE','SAMBUNG BAYAR') or nullif(btrim(r->>'ownership_type'),'') is null or nullif(btrim(r->>'status'),'') is null then raise exception 'Invalid vehicle master row';end if;
   perform finance_private.save_record('vehicle',jsonb_build_object('plate_key',plate,'display_plate',r->>'display_plate','business_unit',r->>'business_unit','ownership_type',r->>'ownership_type','status',r->>'status')); target_id:=null;
  elsif p_kind='RECURRING_COST' then
   if plate is null or not exists(select 1 from finance_private.vehicles where plate_key=plate) or (r->>'start_month')::date is null or extract(day from (r->>'start_month')::date)<>1 or (nullif(r->>'end_month','') is not null and (extract(day from (r->>'end_month')::date)<>1 or (r->>'end_month')::date<(r->>'start_month')::date)) or nullif(btrim(r->>'cost_type'),'') is null or (r->>'monthly_amount')::numeric is null or (r->>'monthly_amount')::numeric<0 or (r->>'monthly_amount')::numeric<>round((r->>'monthly_amount')::numeric,2) then raise exception 'Invalid recurring cost row';end if;
   select id into natural_id from finance_private.recurring_costs where plate_key=plate and start_month=(r->>'start_month')::date and cost_type=r->>'cost_type'; if (select count(*) from finance_private.recurring_costs where plate_key=plate and start_month=(r->>'start_month')::date and cost_type=r->>'cost_type')>1 then raise exception 'Ambiguous recurring cost natural key';end if;perform finance_private.save_record('recurring_cost',jsonb_build_object('id',natural_id,'plate_key',plate,'start_month',r->>'start_month','end_month',nullif(r->>'end_month',''),'cost_type',r->>'cost_type','monthly_amount',r->>'monthly_amount','payee',r->>'payee','notes',r->>'notes'));select id into target_id from finance_private.recurring_costs where plate_key=plate and start_month=(r->>'start_month')::date and cost_type=r->>'cost_type';total:=total+(r->>'monthly_amount')::numeric;
  else
   if plate is null or not exists(select 1 from finance_private.vehicles where plate_key=plate) or (r->>'premium')::numeric is null or (r->>'premium')::numeric<0 or (r->>'premium')::numeric<>round((r->>'premium')::numeric,2) then raise exception 'Invalid insurance premium or vehicle';end if;
   select id into natural_id from finance_private.insurance where plate_key=plate and coverage_start is not distinct from nullif(r->>'coverage_start','')::date;
   if (select count(*) from finance_private.insurance where plate_key=plate and coverage_start is not distinct from nullif(r->>'coverage_start','')::date)>1 then raise exception 'Ambiguous insurance natural key';end if;
   perform finance_private.save_record('insurance',jsonb_build_object('id',natural_id,'plate_key',plate,'premium',r->>'premium','coverage_start',nullif(r->>'coverage_start',''),'coverage_end',nullif(r->>'coverage_end',''))
    || case when r ? 'responsibility' then jsonb_build_object('responsibility',r->'responsibility') else '{}'::jsonb end
    || case when r ? 'supplier' then jsonb_build_object('supplier',r->'supplier') else '{}'::jsonb end
    || case when r ? 'reference' then jsonb_build_object('reference',r->'reference') else '{}'::jsonb end
    || case when r ? 'source' then jsonb_build_object('source',r->'source') else '{}'::jsonb end);
   select id into target_id from finance_private.insurance where plate_key=plate and coverage_start is not distinct from nullif(r->>'coverage_start','')::date;
   total:=total+coalesce((select premium from finance_private.insurance where id=target_id and responsibility='ECA_PAID' and premium>0),0);
  end if;
  update finance_private.section_uploads set source_audit=source_audit || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('sheet_name',r->>'sheet_name','source_row',(r->>'source_row')::integer,'record_kind',lower(p_kind),'record_id',target_id,'plate_key',case when p_kind='VEHICLE' then plate else null end))) where id=upload_id;
 end loop;
 update finance_private.section_uploads set total_amount=total where id=upload_id;
 if p_kind in ('VEHICLE_EXPENSE','CORPORATE_EXPENSE') then update finance_private.months set revision=revision+1 where finance_month=p_month;end if;
 insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),p_month,'IMPORT_FINANCE_SECTION',jsonb_build_object('upload_id',upload_id,'kind',p_kind));return finance_private.input(p_month);
end;$$;

create or replace function finance_private.preview_previous_shared_costs(p_month date) returns jsonb language plpgsql security definer set search_path='' as $$
declare prev date:=p_month-interval '1 month'; frozen jsonb;begin
 perform finance_private.require_admin();if p_month is null or extract(day from p_month)<>1 then raise exception 'Finance month must be the first day of a month';end if;select frozen_input into frozen from finance_private.months where finance_month=prev and status='CLOSED';
 if frozen is not null then return coalesce((select jsonb_agg((x-'id')||jsonb_build_object('source_id',x->>'id','id',x->>'id','finance_month',p_month,'billing_date',case when x->>'frequency'='MONTHLY_RECURRING' then null else (p_month+least(extract(day from (x->>'billing_date')::date)::integer,extract(day from(p_month+interval '1 month - 1 day'))::integer)-1)::text end) order by x->>'id') from jsonb_array_elements(frozen->'expenses') x where x->>'payment_source'='Corporate Opex' and (coalesce(x->>'frequency','ONE_OFF')<>'MONTHLY_RECURRING' or ((x->>'start_month')::date<=p_month and (nullif(x->>'end_month','') is null or (x->>'end_month')::date>=p_month)))),'[]'::jsonb);end if;
 return coalesce((select jsonb_agg(jsonb_build_object('source_id',e.id,'id',e.id,'finance_month',p_month,'billing_date',case when e.frequency='MONTHLY_RECURRING' then null else (p_month+least(extract(day from e.billing_date)::integer,extract(day from(p_month+interval '1 month - 1 day'))::integer)-1)::text end,'plate_key',null,'category',e.category,'payment_source','Corporate Opex','supplier',e.supplier,'amount',e.amount,'reference',e.reference,'description',e.description,'frequency',e.frequency,'start_month',e.start_month,'end_month',e.end_month,'source',e.source,'notes',e.notes) order by e.id) from finance_private.expenses e where e.finance_month=prev and e.payment_source='Corporate Opex' and (e.frequency<>'MONTHLY_RECURRING' or (e.start_month<=p_month and (e.end_month is null or e.end_month>=p_month)))),'[]'::jsonb);
end$$;

create or replace function finance_private.copy_previous_shared_costs(p_month date,p_rows jsonb,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; expected jsonb; source uuid; target uuid;begin
 perform finance_private.lock_finance();perform finance_private.require_draft(p_month);if p_revision is distinct from(select revision from finance_private.months where finance_month=p_month) then raise exception 'Month changed. Reload and review before posting.';end if;if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)=0 then raise exception 'Select one or more reviewed shared costs';end if;
 for r in select value from jsonb_array_elements(p_rows) loop source:=nullif(r->>'source_id','')::uuid;if source is null then raise exception 'Copied shared cost is missing its source';end if;select x into expected from jsonb_array_elements(finance_private.preview_previous_shared_costs(p_month)) x where x->>'source_id'=source::text;if expected is null or r is distinct from expected then raise exception 'Previous shared costs changed. Reload the preview before copying.';end if;if exists(select 1 from finance_private.shared_cost_copies where source_expense_id=source and target_month=p_month) then raise exception 'This shared cost was already copied to the selected month';end if;if expected->>'frequency'='MONTHLY_RECURRING' and exists(select 1 from finance_private.expenses e where e.finance_month=p_month and e.frequency='MONTHLY_RECURRING' and e.category=expected->>'category' and e.amount=(expected->>'amount')::numeric and e.supplier is not distinct from expected->>'supplier' and e.description is not distinct from expected->>'description' and e.start_month=(expected->>'start_month')::date and e.end_month is not distinct from (expected->>'end_month')::date) then raise exception 'This recurring shared cost was already imported';end if;insert into finance_private.expenses(finance_month,billing_date,plate_key,category,payment_source,supplier,amount,reference,description,frequency,start_month,end_month,source,notes) values(p_month,(expected->>'billing_date')::date,null,expected->>'category','Corporate Opex',expected->>'supplier',(expected->>'amount')::numeric,expected->>'reference',expected->>'description',coalesce(expected->>'frequency','ONE_OFF'),(expected->>'start_month')::date,(expected->>'end_month')::date,expected->>'source',expected->>'notes') returning id into target;insert into finance_private.shared_cost_copies(source_expense_id,target_month,target_expense_id,copied_by) values(source,p_month,target,auth.uid());end loop;
 update finance_private.months set revision=revision+1 where finance_month=p_month;insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),p_month,'COPY_PREVIOUS_SHARED_COSTS',jsonb_build_object('count',jsonb_array_length(p_rows)));return finance_private.input(p_month);
end$$;
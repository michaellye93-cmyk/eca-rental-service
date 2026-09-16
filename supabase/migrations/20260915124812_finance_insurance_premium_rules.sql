-- Zero-cost responsibility records may be undated; paid ECA policies require coverage.
alter table finance_private.insurance
 alter column coverage_start drop not null,
 alter column coverage_end drop not null,
 add column supplier text,
 add column reference text,
 add column source text,
 add constraint insurance_eca_coverage check (responsibility is distinct from 'ECA_PAID' or premium=0 or (coverage_start is not null and coverage_end is not null and coverage_end>=coverage_start));

create function finance_private.derive_insurance_payment_date() returns trigger
language plpgsql set search_path='' as $$begin
 new.payment_date:=case when new.responsibility='ECA_PAID' and new.premium>0 then new.coverage_start else null end;
 return new;
end$$;
revoke all on function finance_private.derive_insurance_payment_date() from public,anon,authenticated;
create trigger derive_insurance_payment_date before insert or update on finance_private.insurance
for each row execute function finance_private.derive_insurance_payment_date();

-- Frozen month JSON remains untouched. Open records adopt the approved cash-date rule.
update finance_private.insurance set payment_date=case when responsibility='ECA_PAID' and premium>0 then coverage_start else null end
 where payment_date is distinct from case when responsibility='ECA_PAID' and premium>0 then coverage_start else null end;
do $$begin if exists(select 1 from finance_private.insurance) then perform finance_private.touch_open_months();end if;end$$;


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
  insert into finance_private.expenses(id,finance_month,billing_date,plate_key,category,payment_source,supplier,amount,reference,description)
   values(rid,new_month,(p_record->>'billing_date')::date,plate,p_record->>'category',p_record->>'payment_source',p_record->>'supplier',(p_record->>'amount')::numeric,p_record->>'reference',p_record->>'description')
   on conflict(id) do update set finance_month=excluded.finance_month,billing_date=excluded.billing_date,plate_key=excluded.plate_key,category=excluded.category,payment_source=excluded.payment_source,supplier=excluded.supplier,amount=excluded.amount,reference=excluded.reference,description=excluded.description;
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
 if exists(select 1 from finance_private.section_uploads where kind=p_kind and source_hash=p_source_hash) then raise exception 'This workbook content was already imported for this section';end if;
 insert into finance_private.section_uploads(finance_month,kind,filename,source_hash,imported_by,row_count,source_audit) values(p_month,p_kind,p_filename,p_source_hash,auth.uid(),jsonb_array_length(p_rows),'[]'::jsonb) returning id into upload_id;
 for r in select value from jsonb_array_elements(p_rows) loop
  if nullif(r->>'sheet_name','') is null or coalesce((r->>'source_row')::integer,0)<1 then raise exception 'Source sheet and row are required';end if;
  plate:=nullif(regexp_replace(upper(r->>'plate_key'),'\s','','g'),'');
  if p_kind in ('VEHICLE_EXPENSE','CORPORATE_EXPENSE') then
   expected_source:=case when p_kind='VEHICLE_EXPENSE' then 'Vehicle Direct Cost' else 'Corporate Opex' end;
   allowed_categories:=case when p_kind='VEHICLE_EXPENSE' then array['Road Tax','APAD / Permit','Puspakom','Tyres','Battery','Repair','Accident','Towing','Restoration','Other Vehicle Cost'] else array['Office Rental','Accounting Fee','Salary','KWSP','PERKESO','PCB','Utilities','Internet','Professional Fees','General Software','Other Corporate Cost'] end;
   if (r->>'finance_month')::date is distinct from p_month or r->>'payment_source' is distinct from expected_source or (r->>'billing_date')::date is null or (r->>'billing_date')::date<p_month or (r->>'billing_date')::date>=p_month+interval '1 month' or nullif(btrim(r->>'category'),'') is null or (case when r->>'category'='Software' then 'General Software' else r->>'category' end)<>all(allowed_categories) or (r->>'amount')::numeric is null or (r->>'amount')::numeric<0 or (r->>'amount')::numeric<>round((r->>'amount')::numeric,2) then raise exception 'Invalid expense row';end if;
   if p_kind='VEHICLE_EXPENSE' and (plate is null or not exists(select 1 from finance_private.vehicles where plate_key=plate)) then raise exception 'Vehicle expense has an unknown vehicle';end if;
   if p_kind='CORPORATE_EXPENSE' and plate is not null then raise exception 'Corporate expense cannot have a vehicle';end if;
   if exists(select 1 from finance_private.expenses e where e.finance_month=p_month and e.billing_date=(r->>'billing_date')::date and e.plate_key is not distinct from plate and e.category=(case when r->>'category'='Software' then 'General Software' else r->>'category' end) and e.payment_source=expected_source and e.supplier is not distinct from r->>'supplier' and e.amount=(r->>'amount')::numeric and e.reference is not distinct from r->>'reference' and e.description is not distinct from r->>'description') then raise exception 'This Finance expense row was already imported';end if;
   insert into finance_private.expenses(finance_month,billing_date,plate_key,category,payment_source,supplier,amount,reference,description,source_row,sheet_name) values(p_month,(r->>'billing_date')::date,plate,case when r->>'category'='Software' then 'General Software' else r->>'category' end,expected_source,r->>'supplier',(r->>'amount')::numeric,r->>'reference',r->>'description',(r->>'source_row')::integer,r->>'sheet_name') returning id into target_id;total:=total+(r->>'amount')::numeric;
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

create or replace function finance_private.base_input(p_month date) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('calculation_version',2,
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

-- One bank line, several payments (the owner's decision of 2026-10-06): a driver sometimes pays two things recorded
-- separately (rent and a penalty, say) in one transfer. A posted bank credit may now be matched to two or more payments
-- of the month whose cash adds up exactly to it. The payments are kept in bank_rows.matched_ids; matched_id stays the
-- first of them, so everything that reads single matches keeps working. Single matches are unchanged.
--
-- Changes only the payment checks of: bank_match_valid (new overload), input(), validate_bank_links(),
-- post_bank_statement(), review_bank_match() and payment_bank_status(). Safe to run again.

alter table finance_private.bank_rows add column if not exists matched_ids uuid[];
alter table finance_private.bank_rows drop constraint if exists bank_rows_split_match;
alter table finance_private.bank_rows add constraint bank_rows_split_match check (
  matched_ids is null or (decision = 'MATCHED' and matched_kind = 'payment' and cardinality(matched_ids) >= 2 and matched_id = any(matched_ids)));

-- Every payment exists in the month with cash, none is listed twice, and their cash adds up exactly to the credit.
create or replace function finance_private.bank_payments_valid(p_month date, p_ids uuid[], p_debit numeric, p_credit numeric) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_debit = 0 and coalesce(cardinality(p_ids), 0) >= 1
    and cardinality(p_ids) = (select count(distinct x) from unnest(p_ids) x)
    and cardinality(p_ids) = (select count(*) from finance_private.ehailing where finance_month = p_month and source_payment_id = any(p_ids) and cash_amount > 0)
    and p_credit = (select coalesce(sum(cash_amount), 0) from finance_private.ehailing where finance_month = p_month and source_payment_id = any(p_ids))
$$;
revoke all on function finance_private.bank_payments_valid(date, uuid[], numeric, numeric) from public, anon, authenticated;

-- Same as the single-record check, plus split payment matches when p_ids is given.
create or replace function finance_private.bank_match_valid(p_month date, p_kind text, p_id uuid, p_ids uuid[], p_debit numeric, p_credit numeric) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_ids is null then finance_private.bank_match_valid(p_month, p_kind, p_id, p_debit, p_credit)
    else p_kind = 'payment' and cardinality(p_ids) >= 2 and p_id = any(p_ids) and finance_private.bank_payments_valid(p_month, p_ids, p_debit, p_credit) end
$$;
revoke all on function finance_private.bank_match_valid(date, text, uuid, uuid[], numeric, numeric) from public, anon, authenticated;

-- Same as the 2026-10-06 version; match_valid now checks split matches too.
create or replace function finance_private.input(p_month date) returns jsonb language sql stable security definer set search_path='' as $$
 select finance_private.base_input(p_month)||jsonb_build_object(
  'bank_imports',coalesce((select jsonb_agg(to_jsonb(b)-'imported_by' order by imported_at,id) from finance_private.bank_imports b where finance_month=p_month),'[]'),
  'bank_rows',coalesce((select jsonb_agg((to_jsonb(r)-'account_key'-'fingerprint')||jsonb_build_object('match_valid',r.decision<>'MATCHED' or finance_private.bank_match_valid(p_month,r.matched_kind,r.matched_id,r.matched_ids,r.debit,r.credit)) order by r.import_id,r.source_row) from finance_private.bank_rows r join finance_private.bank_imports b on b.id=r.import_id where b.finance_month=p_month),'[]'),
  'fixed_cost_treatments',finance_private.fixed_cost_treatment_rows())
$$;
revoke all on function finance_private.input(date) from public,anon,authenticated;

-- Same as the 2026-10-06 version; split matches are checked too.
create or replace function finance_private.validate_bank_links(p_month date) returns void language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from finance_private.bank_imports where finance_month=p_month) then
  raise exception 'Reconcile the bank statement for this month (Reconcile tab) before marking it ready or closing it';
 end if;
 if exists(select 1 from finance_private.bank_rows r join finance_private.bank_imports b on b.id=r.import_id where b.finance_month=p_month and r.decision='MATCHED' and not finance_private.bank_match_valid(p_month,r.matched_kind,r.matched_id,r.matched_ids,r.debit,r.credit)) then
  raise exception 'Review changed bank matches before marking this month ready or closing it';
 end if;
end$$;
revoke all on function finance_private.validate_bank_links(date) from public,anon,authenticated;

-- Same as the 2026-09-15 version; a row may carry matched_ids (two or more payments adding up to its credit).
create or replace function finance_private.post_bank_statement(p_month date,p_filename text,p_account_label text,p_rows jsonb,p_revision integer,p_source_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r record;import_key uuid;expense_key uuid;fingerprint_key text;account_key_value text;matched boolean;ids uuid[];begin
 perform finance_private.lock_finance();perform finance_private.require_draft(p_month);
 if p_revision is distinct from (select revision from finance_private.months where finance_month=p_month) then raise exception 'Month changed. Reload and review before posting.';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)=0 then raise exception 'Bank statement has no transaction rows';end if;
 if p_source_hash is null or p_source_hash !~ '^[a-f0-9]{64}$' then raise exception 'A statement SHA-256 is required';end if;
 if exists(select 1 from finance_private.bank_imports where source_hash=p_source_hash) then raise exception 'Bank statement file already imported';end if;
 if nullif(btrim(p_account_label),'') is null then raise exception 'Enter a consistent bank account label';end if;
 account_key_value:=regexp_replace(upper(btrim(p_account_label)),'\s+',' ','g');
 insert into finance_private.bank_imports(finance_month,filename,account_label,source_hash,imported_by,row_count,total_debits,total_credits)
 values(p_month,p_filename,btrim(p_account_label),p_source_hash,auth.uid(),jsonb_array_length(p_rows),0,0) returning id into import_key;
 for r in select * from jsonb_to_recordset(p_rows) as x(source_row integer,transaction_date date,description text,reference text,debit numeric,credit numeric,decision text,payment_source text,category text,plate_key text,matched_kind text,matched_id uuid,matched_ids jsonb,review_note text) loop
  expense_key:=null;matched:=false;ids:=null;
  if r.transaction_date is null or r.transaction_date<p_month or r.transaction_date>=p_month+interval '1 month' then raise exception 'Bank row % is outside the Finance month',r.source_row;end if;
  if r.debit is null or r.credit is null or not ((r.debit>0 and r.debit<'Infinity' and r.credit=0) or (r.credit>0 and r.credit<'Infinity' and r.debit=0)) then raise exception 'Bank row % requires exactly one positive debit or credit',r.source_row;end if;
  if r.debit<>round(r.debit,2) or r.credit<>round(r.credit,2) then raise exception 'Bank row % amounts must have at most two decimal places',r.source_row;end if;
  if r.decision is null or r.decision not in ('EXPENSE','MATCHED','EXCLUDED') then raise exception 'Review every bank row before posting';end if;
  r.plate_key:=nullif(regexp_replace(upper(r.plate_key),'\s','','g'),'');
  r.review_note:=coalesce(r.review_note,'');
  if r.decision='MATCHED' and jsonb_typeof(r.matched_ids)='array' then
   select array_agg(x::uuid) into ids from jsonb_array_elements_text(r.matched_ids) x;
  end if;
  -- Independent of filename and row number: overlapping/re-uploaded statements cannot post twice.
  fingerprint_key:=md5(concat_ws('|',r.transaction_date::text,round(r.debit,2)::text,round(r.credit,2)::text,
   regexp_replace(upper(coalesce(r.reference,'')),'\s+',' ','g'),regexp_replace(upper(coalesce(r.description,'')),'\s+',' ','g')));
  if exists(select 1 from finance_private.bank_rows where account_key=account_key_value and fingerprint=fingerprint_key) then raise exception 'Possible duplicate bank transaction on row %. Review the existing statement.',r.source_row;end if;
  if r.decision='MATCHED' then
   if ids is not null then select r.matched_kind='payment' and coalesce(cardinality(ids),0)>=2 and r.matched_id=any(ids) and finance_private.bank_payments_valid(p_month,ids,r.debit,r.credit) into matched;
   elsif r.matched_kind='payment' then select exists(select 1 from finance_private.ehailing where finance_month=p_month and source_payment_id=r.matched_id and cash_amount=r.credit and r.debit=0) into matched;
   elsif r.matched_kind='smart_import' then select exists(select 1 from finance_private.imports i where i.id=r.matched_id and i.finance_month=p_month and i.kind='SMART_DRIVE' and i.status='POSTED' and r.credit>0 and r.debit=0) into matched;
   elsif r.matched_kind='recurring_cost' then select exists(select 1 from finance_private.recurring_costs where id=r.matched_id and start_month<=p_month and (end_month is null or end_month>=p_month) and monthly_amount=r.debit and r.credit=0) into matched;
   elsif r.matched_kind='insurance' then select exists(select 1 from finance_private.insurance where responsibility is distinct from 'OWNER_PAID' and id=r.matched_id and premium=r.debit and r.credit=0 and payment_date>=p_month and payment_date<p_month+interval '1 month') into matched;
   elsif r.matched_kind='expense' then select exists(select 1 from finance_private.expenses where id=r.matched_id and finance_month=p_month and amount=r.debit and r.credit=0) into matched;
   end if;
   if not coalesce(matched,false) then raise exception 'Bank row % does not match the selected existing Finance record',r.source_row;end if;
  elsif r.decision='EXCLUDED' then
   if nullif(btrim(r.review_note),'') is null then raise exception 'Explain the exclusion of bank row %',r.source_row;end if;
  else
   if r.credit<>0 or r.debit<=0 then raise exception 'Only debit rows can create P&L expenses; match or exclude credits';end if;
   if r.payment_source<>'Corporate Opex' and not exists(select 1 from finance_private.vehicles where plate_key=r.plate_key) then raise exception 'Map the vehicle for bank expense row %',r.source_row;end if;
   if exists(select 1 from finance_private.expenses e where e.finance_month=p_month and e.amount=r.debit and e.billing_date=r.transaction_date and e.plate_key is not distinct from r.plate_key)
    or exists(select 1 from finance_private.recurring_costs c where c.monthly_amount=r.debit and c.plate_key=r.plate_key and c.start_month<=p_month and (c.end_month is null or c.end_month>=p_month))
    or exists(select 1 from finance_private.insurance i where i.premium=r.debit and i.plate_key=r.plate_key and i.payment_date=r.transaction_date) then
    if nullif(btrim(r.review_note),'') is null then raise exception 'Possible existing cost for row %. Match it or explain why this is a separate expense.',r.source_row;end if;
   end if;
   insert into finance_private.expenses(finance_month,billing_date,plate_key,category,payment_source,supplier,amount,reference,description,source_row,sheet_name)
    values(p_month,r.transaction_date,r.plate_key,r.category,r.payment_source,null,r.debit,r.reference,r.description,r.source_row,p_filename) returning id into expense_key;
  end if;
  insert into finance_private.bank_rows(import_id,source_row,transaction_date,description,reference,debit,credit,decision,payment_source,category,plate_key,matched_kind,matched_id,matched_ids,review_note,expense_id,account_key,fingerprint)
   values(import_key,r.source_row,r.transaction_date,coalesce(r.description,''),r.reference,r.debit,r.credit,r.decision,r.payment_source,r.category,r.plate_key,r.matched_kind,r.matched_id,ids,r.review_note,expense_key,account_key_value,fingerprint_key);
 end loop;
 update finance_private.bank_imports set total_debits=(select sum(debit) from finance_private.bank_rows where import_id=import_key),total_credits=(select sum(credit) from finance_private.bank_rows where import_id=import_key) where id=import_key;
 update finance_private.months set revision=revision+1 where finance_month=p_month;
 insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),p_month,'APPROVE_BANK_STATEMENT',jsonb_build_object('import_id',import_key));
 return finance_private.input(p_month);
end$$;
revoke all on function finance_private.post_bank_statement(date,text,text,jsonb,integer,text) from public,anon,authenticated;
grant execute on function finance_private.post_bank_statement(date,text,text,jsonb,integer,text) to authenticated;

-- Same as the 2026-09-15 version; amending a posted row to a single match or an exclusion clears any split.
create or replace function finance_private.review_bank_match(p_month date,p_import_id uuid,p_source_row integer,p_decision text,p_matched_kind text,p_matched_id uuid,p_note text,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous finance_private.bank_rows;begin
 perform finance_private.lock_finance();perform finance_private.require_draft(p_month);
 if p_revision is distinct from (select revision from finance_private.months where finance_month=p_month) then raise exception 'Month changed. Reload and review before posting.';end if;
 select r.* into previous from finance_private.bank_rows r join finance_private.bank_imports b on b.id=r.import_id where b.finance_month=p_month and r.import_id=p_import_id and r.source_row=p_source_row;
 if not found then raise exception 'Bank row not found';end if;
 if previous.decision='EXPENSE' then raise exception 'Bank-derived expenses retain their approved financial values';end if;
 if nullif(btrim(p_note),'') is null then raise exception 'Explain the amended bank review';end if;
 if p_decision='MATCHED' then
  if not finance_private.bank_match_valid(p_month,p_matched_kind,p_matched_id,previous.debit,previous.credit) then raise exception 'Selected Finance match is invalid';end if;
 elsif p_decision='EXCLUDED' then p_matched_kind:=null;p_matched_id:=null;
 else raise exception 'Amend an existing bank row by matching an existing record or excluding it with a reason';end if;
 insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),p_month,'AMEND_BANK_REVIEW',jsonb_build_object('previous',to_jsonb(previous),'reason',p_note));
 update finance_private.bank_rows set decision=p_decision,matched_kind=p_matched_kind,matched_id=p_matched_id,matched_ids=null,review_note=p_note where import_id=p_import_id and source_row=p_source_row;
 update finance_private.months set revision=revision+1 where finance_month=p_month;
 return finance_private.input(p_month);
end$$;
revoke all on function finance_private.review_bank_match(date,uuid,integer,text,text,uuid,text,integer) from public,anon,authenticated;
grant execute on function finance_private.review_bank_match(date,uuid,integer,text,text,uuid,text,integer) to authenticated;

-- Same as the 2026-10-06 version; every payment of a split match shows Bank ✓.
create or replace function finance_private.payment_bank_status(p_driver_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform finance_private.require_admin();
  return jsonb_build_object(
    'matched', coalesce((select jsonb_agg(distinct m.id) from finance_private.bank_rows r
      cross join lateral unnest(coalesce(r.matched_ids, array[r.matched_id])) as m(id)
      join public.payments p on p.id = m.id
      where r.decision = 'MATCHED' and r.matched_kind = 'payment' and p.driver_id = p_driver_id), '[]'::jsonb),
    'months', coalesce((select jsonb_agg(distinct to_char(b.finance_month, 'YYYY-MM')) from finance_private.bank_imports b), '[]'::jsonb));
end $$;
revoke all on function finance_private.payment_bank_status(uuid) from public, anon, authenticated;
grant execute on function finance_private.payment_bank_status(uuid) to authenticated;

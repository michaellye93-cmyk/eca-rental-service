-- User-approved Finance bank statement extension; operational Bank Reconciliation is untouched.
create table finance_private.bank_imports (
 id uuid primary key default gen_random_uuid(), finance_month date not null references finance_private.months(finance_month),
 filename text not null check(btrim(filename)<>''), account_label text not null check(btrim(account_label)<>''),
 source_hash text not null unique check(source_hash ~ '^[a-f0-9]{64}$'),
 imported_at timestamptz not null default now(),imported_by uuid not null,row_count integer not null check(row_count>0),
 total_debits numeric(16,2) not null,total_credits numeric(16,2) not null
);
create table finance_private.bank_rows (
 import_id uuid not null references finance_private.bank_imports(id),source_row integer not null check(source_row>0),
 transaction_date date not null,description text not null,reference text,debit numeric(16,2) not null,credit numeric(16,2) not null,
 decision text not null check(decision in ('EXPENSE','MATCHED','EXCLUDED')),
 payment_source text,category text,plate_key text,matched_kind text,matched_id uuid,review_note text not null,
 expense_id uuid references finance_private.expenses(id),account_key text not null,fingerprint text not null,
 primary key(import_id,source_row),unique(account_key,fingerprint),
 check((debit>0 and debit<'Infinity' and credit=0) or (credit>0 and credit<'Infinity' and debit=0)),
 check(decision<>'EXPENSE' or (debit>0 and credit=0 and expense_id is not null)),
 check(decision<>'MATCHED' or (matched_kind in ('payment','smart_import','recurring_cost','insurance','expense') and matched_id is not null)),
 check(decision<>'EXCLUDED' or btrim(review_note)<>'')
);
alter table finance_private.bank_imports enable row level security;
alter table finance_private.bank_rows enable row level security;
revoke all on finance_private.bank_imports,finance_private.bank_rows from public,anon,authenticated;

-- Keep the original input assembly isolated; the complete input includes bank audit before freezing.
create function finance_private.bank_match_valid(p_month date,p_kind text,p_id uuid,p_debit numeric,p_credit numeric) returns boolean language sql stable security definer set search_path='' as $$
 select case p_kind
 when 'payment' then exists(select 1 from finance_private.ehailing where finance_month=p_month and source_payment_id=p_id and cash_amount=p_credit and p_debit=0)
 when 'smart_import' then exists(select 1 from finance_private.imports where id=p_id and finance_month=p_month and kind='SMART_DRIVE' and status='POSTED' and p_credit>0 and p_debit=0)
 when 'recurring_cost' then exists(select 1 from finance_private.recurring_costs where id=p_id and start_month<=p_month and (end_month is null or end_month>=p_month) and monthly_amount=p_debit and p_credit=0)
 when 'insurance' then exists(select 1 from finance_private.insurance where id=p_id and premium=p_debit and p_credit=0 and payment_date>=p_month and payment_date<p_month+interval '1 month')
 when 'expense' then exists(select 1 from finance_private.expenses where id=p_id and finance_month=p_month and amount=p_debit and p_credit=0)
 else false end
$$;
revoke all on function finance_private.bank_match_valid(date,text,uuid,numeric,numeric) from public,anon,authenticated;
create or replace function finance_private.validate_bank_links(p_month date) returns void language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from finance_private.bank_rows r join finance_private.bank_imports b on b.id=r.import_id where b.finance_month=p_month and r.decision='MATCHED' and not finance_private.bank_match_valid(p_month,r.matched_kind,r.matched_id,r.debit,r.credit)) then
  raise exception 'Review changed bank matches before marking this month ready or closing it';
 end if;
end$$;
create function finance_private.guard_bank_expense() returns trigger language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from finance_private.bank_rows where expense_id=old.id) and
  (tg_op='DELETE' or row(new.amount,new.finance_month,new.billing_date,new.plate_key,new.category,new.payment_source) is distinct from row(old.amount,old.finance_month,old.billing_date,old.plate_key,old.category,old.payment_source)) then
  raise exception 'This expense was approved from a bank statement; its financial fields are fixed to that source';
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end$$;
revoke all on function finance_private.guard_bank_expense() from public,anon,authenticated;
create trigger finance_guard_bank_expense before update or delete on finance_private.expenses for each row execute function finance_private.guard_bank_expense();
alter function finance_private.input(date) rename to base_input;
create function finance_private.input(p_month date) returns jsonb language sql stable security definer set search_path='' as $$
 select finance_private.base_input(p_month)||jsonb_build_object(
  'bank_imports',coalesce((select jsonb_agg(to_jsonb(b)-'imported_by' order by imported_at,id) from finance_private.bank_imports b where finance_month=p_month),'[]'),
  'bank_rows',coalesce((select jsonb_agg((to_jsonb(r)-'account_key'-'fingerprint')||jsonb_build_object('match_valid',r.decision<>'MATCHED' or finance_private.bank_match_valid(p_month,r.matched_kind,r.matched_id,r.debit,r.credit)) order by r.import_id,r.source_row) from finance_private.bank_rows r join finance_private.bank_imports b on b.id=r.import_id where b.finance_month=p_month),'[]'))
$$;
revoke all on function finance_private.input(date) from public,anon,authenticated;

create function finance_private.post_bank_statement(p_month date,p_filename text,p_account_label text,p_rows jsonb,p_revision integer,p_source_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r record;import_key uuid;expense_key uuid;fingerprint_key text;account_key_value text;matched boolean;begin
 perform finance_private.lock_finance();perform finance_private.require_draft(p_month);
 if p_revision is distinct from (select revision from finance_private.months where finance_month=p_month) then raise exception 'Month changed. Reload and review before posting.';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)=0 then raise exception 'Bank statement has no transaction rows';end if;
 if p_source_hash is null or p_source_hash !~ '^[a-f0-9]{64}$' then raise exception 'A statement SHA-256 is required';end if;
 if exists(select 1 from finance_private.bank_imports where source_hash=p_source_hash) then raise exception 'Bank statement file already imported';end if;
 if nullif(btrim(p_account_label),'') is null then raise exception 'Enter a consistent bank account label';end if;
 account_key_value:=regexp_replace(upper(btrim(p_account_label)),'\s+',' ','g');
 insert into finance_private.bank_imports(finance_month,filename,account_label,source_hash,imported_by,row_count,total_debits,total_credits)
 values(p_month,p_filename,btrim(p_account_label),p_source_hash,auth.uid(),jsonb_array_length(p_rows),0,0) returning id into import_key;
 for r in select * from jsonb_to_recordset(p_rows) as x(source_row integer,transaction_date date,description text,reference text,debit numeric,credit numeric,decision text,payment_source text,category text,plate_key text,matched_kind text,matched_id uuid,review_note text) loop
  expense_key:=null;matched:=false;
  if r.transaction_date is null or r.transaction_date<p_month or r.transaction_date>=p_month+interval '1 month' then raise exception 'Bank row % is outside the Finance month',r.source_row;end if;
  if r.debit is null or r.credit is null or not ((r.debit>0 and r.debit<'Infinity' and r.credit=0) or (r.credit>0 and r.credit<'Infinity' and r.debit=0)) then raise exception 'Bank row % requires exactly one positive debit or credit',r.source_row;end if;
  if r.debit<>round(r.debit,2) or r.credit<>round(r.credit,2) then raise exception 'Bank row % amounts must have at most two decimal places',r.source_row;end if;
  if r.decision is null or r.decision not in ('EXPENSE','MATCHED','EXCLUDED') then raise exception 'Review every bank row before posting';end if;
  r.plate_key:=nullif(regexp_replace(upper(r.plate_key),'\s','','g'),'');
  r.review_note:=coalesce(r.review_note,'');
  -- Independent of filename and row number: overlapping/re-uploaded statements cannot post twice.
  fingerprint_key:=md5(concat_ws('|',r.transaction_date::text,round(r.debit,2)::text,round(r.credit,2)::text,
   regexp_replace(upper(coalesce(r.reference,'')),'\s+',' ','g'),regexp_replace(upper(coalesce(r.description,'')),'\s+',' ','g')));
  if exists(select 1 from finance_private.bank_rows where account_key=account_key_value and fingerprint=fingerprint_key) then raise exception 'Possible duplicate bank transaction on row %. Review the existing statement.',r.source_row;end if;
  if r.decision='MATCHED' then
   if r.matched_kind='payment' then select exists(select 1 from finance_private.ehailing where finance_month=p_month and source_payment_id=r.matched_id and cash_amount=r.credit and r.debit=0) into matched;
   elsif r.matched_kind='smart_import' then select exists(select 1 from finance_private.imports i where i.id=r.matched_id and i.finance_month=p_month and i.kind='SMART_DRIVE' and i.status='POSTED' and r.credit>0 and r.debit=0) into matched;
   elsif r.matched_kind='recurring_cost' then select exists(select 1 from finance_private.recurring_costs where id=r.matched_id and start_month<=p_month and (end_month is null or end_month>=p_month) and monthly_amount=r.debit and r.credit=0) into matched;
   elsif r.matched_kind='insurance' then select exists(select 1 from finance_private.insurance where id=r.matched_id and premium=r.debit and r.credit=0 and payment_date>=p_month and payment_date<p_month+interval '1 month') into matched;
   elsif r.matched_kind='expense' then select exists(select 1 from finance_private.expenses where id=r.matched_id and finance_month=p_month and amount=r.debit and r.credit=0) into matched;
   end if;
   if not matched then raise exception 'Bank row % does not match the selected existing Finance record',r.source_row;end if;
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
  insert into finance_private.bank_rows(import_id,source_row,transaction_date,description,reference,debit,credit,decision,payment_source,category,plate_key,matched_kind,matched_id,review_note,expense_id,account_key,fingerprint)
   values(import_key,r.source_row,r.transaction_date,coalesce(r.description,''),r.reference,r.debit,r.credit,r.decision,r.payment_source,r.category,r.plate_key,r.matched_kind,r.matched_id,r.review_note,expense_key,account_key_value,fingerprint_key);
 end loop;
 update finance_private.bank_imports set total_debits=(select sum(debit) from finance_private.bank_rows where import_id=import_key),total_credits=(select sum(credit) from finance_private.bank_rows where import_id=import_key) where id=import_key;
 update finance_private.months set revision=revision+1 where finance_month=p_month;
 insert into finance_private.audit(actor,finance_month,action,details) values(auth.uid(),p_month,'APPROVE_BANK_STATEMENT',jsonb_build_object('import_id',import_key));
 return finance_private.input(p_month);
end$$;
revoke all on function finance_private.post_bank_statement(date,text,text,jsonb,integer,text) from public,anon,authenticated;
grant execute on function finance_private.post_bank_statement(date,text,text,jsonb,integer,text) to authenticated;
create function public.finance_post_bank_statement(p_month date,p_filename text,p_account_label text,p_rows jsonb,p_revision integer,p_source_hash text) returns jsonb language sql security invoker set search_path='' as $$select finance_private.post_bank_statement(p_month,p_filename,p_account_label,p_rows,p_revision,p_source_hash)$$;
revoke all on function public.finance_post_bank_statement(date,text,text,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.finance_post_bank_statement(date,text,text,jsonb,integer,text) to authenticated;

create function finance_private.review_bank_match(p_month date,p_import_id uuid,p_source_row integer,p_decision text,p_matched_kind text,p_matched_id uuid,p_note text,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
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
 update finance_private.bank_rows set decision=p_decision,matched_kind=p_matched_kind,matched_id=p_matched_id,review_note=p_note where import_id=p_import_id and source_row=p_source_row;
 update finance_private.months set revision=revision+1 where finance_month=p_month;
 return finance_private.input(p_month);
end$$;
revoke all on function finance_private.review_bank_match(date,uuid,integer,text,text,uuid,text,integer) from public,anon,authenticated;
grant execute on function finance_private.review_bank_match(date,uuid,integer,text,text,uuid,text,integer) to authenticated;
create function public.finance_review_bank_match(p_month date,p_import_id uuid,p_source_row integer,p_decision text,p_matched_kind text,p_matched_id uuid,p_note text,p_revision integer) returns jsonb language sql security invoker set search_path='' as $$select finance_private.review_bank_match(p_month,p_import_id,p_source_row,p_decision,p_matched_kind,p_matched_id,p_note,p_revision)$$;
revoke all on function public.finance_review_bank_match(date,uuid,integer,text,text,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.finance_review_bank_match(date,uuid,integer,text,text,uuid,text,integer) to authenticated;

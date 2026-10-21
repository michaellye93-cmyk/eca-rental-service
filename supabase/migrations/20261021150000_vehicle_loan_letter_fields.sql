-- Vehicle loans: the bank letter's lines (owner, 21 Oct 2026). Run it in the Supabase SQL Editor for RentalDatabase
-- after 20261021090000_vehicle_loans.sql and before the frontend that shows the Add / Edit loan form in the letter's
-- order. It is all-or-nothing (an error leaves no change behind) and safe to run again. Loans saved before it read back
-- with no cost, a flat rate, no commencement date and no hirer; nothing else changes.
--
-- Four new lines on each loan, all optional:
--   cash_price         the letter's "Cost" (the cash price), RM.
--   rate_type          the interest rate is Flat (the default) or Variable; for Variable the instalment is typed.
--   commencement_date  the agreement's commencement; the first instalment date stays its own stored line.
--   hirer              the hirer on the HP agreement (the registered owner); Vehicle loans groups its list by it.
begin;

alter table finance_private.vehicle_loans add column if not exists cash_price numeric(16,2);
alter table finance_private.vehicle_loans add column if not exists rate_type text not null default 'FLAT';
alter table finance_private.vehicle_loans add column if not exists commencement_date date;
alter table finance_private.vehicle_loans add column if not exists hirer text;
alter table finance_private.vehicle_loans drop constraint if exists vehicle_loans_cash_price;
alter table finance_private.vehicle_loans add constraint vehicle_loans_cash_price check (cash_price >= 0);
alter table finance_private.vehicle_loans drop constraint if exists vehicle_loans_rate_type;
alter table finance_private.vehicle_loans add constraint vehicle_loans_rate_type check (rate_type in ('FLAT', 'VARIABLE'));

-- Add, edit or delete a loan: finance_private.save_vehicle_loan is as in 20261021090000_vehicle_loans.sql, with the
-- four lines read from p_record, checked and written. finance_private.vehicle_loan_rows() returns them as they are.
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
  -- The bank letter's own lines (20261021150000): all optional; the rate is flat unless Variable is given.
  v_cash numeric := nullif(p_record->>'cash_price', '')::numeric;
  v_rate_type text := coalesce(nullif(upper(btrim(p_record->>'rate_type')), ''), 'FLAT');
  v_commenced date := nullif(p_record->>'commencement_date', '')::date;
  v_hirer text := nullif(btrim(p_record->>'hirer'), '');
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
    if v_cash < 0 then raise exception 'The cost cannot be below zero'; end if;
    if v_rate_type not in ('FLAT', 'VARIABLE') then raise exception 'Choose Flat or Variable for the interest rate'; end if;
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
          downpayment, monthly_instalment, status, closed_on, notes, cash_price, rate_type, commencement_date, hirer, created_by, updated_by)
        values (plate, shown, v_bank, v_amount, v_rate, v_tenure, v_first, v_down, v_instalment, v_status, v_closed,
          nullif(btrim(p_record->>'notes'), ''), v_cash, v_rate_type, v_commenced, v_hirer, auth.uid(), auth.uid())
        returning * into saved;
    else
      update finance_private.vehicle_loans set plate_key = plate, display_plate = shown, bank = v_bank, finance_amount = v_amount,
          flat_rate_percent = v_rate, tenure_months = v_tenure, first_payment_date = v_first, downpayment = v_down,
          monthly_instalment = v_instalment, status = v_status, closed_on = v_closed, notes = nullif(btrim(p_record->>'notes'), ''),
          cash_price = v_cash, rate_type = v_rate_type, commencement_date = v_commenced, hirer = v_hirer,
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

revoke all on function finance_private.save_vehicle_loan(text, jsonb, text) from public, anon, authenticated;
grant execute on function finance_private.save_vehicle_loan(text, jsonb, text) to authenticated;

commit;

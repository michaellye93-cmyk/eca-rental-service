-- Cash position and cash outlook (Cash & Efficiency Review F5-F7, approved by the owner on 2026-09-27).
-- Additive only: one new private table and five functions. Nothing the current live site uses is changed.
-- Run it in the Supabase SQL Editor for RentalDatabase. It is all-or-nothing (an error leaves no change behind) and
-- safe to run again.
begin;

-- Bank balances the owner types in (the "Cash in bank" column). Entries are never deleted: a mistake is removed with a
-- reason, and every save or removal is written to Finance's audit log.
create table if not exists finance_private.cash_balances (
  id uuid primary key default gen_random_uuid(),
  account_label text not null check (btrim(account_label) <> '' and char_length(account_label) <= 80),
  balance numeric(16,2) not null check (balance > -1000000000000 and balance < 1000000000000),
  as_of date not null,
  note text check (note is null or char_length(note) <= 500),
  entered_at timestamptz not null default now(),
  entered_by uuid not null,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancellation_reason text,
  check ((cancelled_at is null) = (cancelled_by is null))
);
create index if not exists finance_cash_balances_active on finance_private.cash_balances(account_label, as_of desc, entered_at desc) where cancelled_at is null;
alter table finance_private.cash_balances enable row level security;
revoke all on finance_private.cash_balances from public, anon, authenticated;

-- Active balance entries, newest first.
create or replace function finance_private.cash_balance_rows() returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'account_label', b.account_label, 'balance', b.balance,
    'as_of', b.as_of, 'note', b.note, 'entered_at', b.entered_at) order by b.as_of desc, b.entered_at desc), '[]'::jsonb)
  from finance_private.cash_balances b where b.cancelled_at is null
$$;

create or replace function finance_private.save_cash_balance(p_account text, p_balance numeric, p_as_of date, p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare label text := btrim(coalesce(p_account, ''));
begin
  perform finance_private.require_admin();
  if label = '' or char_length(label) > 80 then raise exception 'Enter an account name of up to 80 characters'; end if;
  if p_balance is null or p_balance <> round(p_balance, 2) or abs(p_balance) >= 1000000000000 then
    raise exception 'Enter the balance in ringgit with at most two decimals';
  end if;
  -- Malaysia is 8 hours ahead of the database clock, so tomorrow's date (database time) is still today there.
  if p_as_of is null or p_as_of > current_date + 1 then raise exception 'The balance date cannot be in the future'; end if;
  insert into finance_private.cash_balances(account_label, balance, as_of, note, entered_by)
    values (label, p_balance, p_as_of, nullif(btrim(coalesce(p_note, '')), ''), auth.uid());
  insert into finance_private.audit(actor, action, details)
    values (auth.uid(), 'CASH_BALANCE_SAVED', jsonb_build_object('account_label', label, 'balance', p_balance, 'as_of', p_as_of));
  return finance_private.cash_balance_rows();
end$$;

create or replace function finance_private.cancel_cash_balance(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare reason text := btrim(coalesce(p_reason, ''));
begin
  perform finance_private.require_admin();
  if reason = '' then raise exception 'Give a reason for removing this balance'; end if;
  update finance_private.cash_balances set cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = reason
    where id = p_id and cancelled_at is null;
  if not found then raise exception 'That balance entry was not found or is already removed'; end if;
  insert into finance_private.audit(actor, action, details)
    values (auth.uid(), 'CASH_BALANCE_REMOVED', jsonb_build_object('id', p_id, 'reason', reason));
  return finance_private.cash_balance_rows();
end$$;

-- Everything the cash line and Cash page need from Finance, counted the way the Management P&L counts it:
--   months:  monthly vehicle costs (financing and owner payouts) and operation fix costs for this month and the next 3
--   insurance: ECA-paid premiums falling due before the end of that period (a recorded policy on its cover start date,
--              which is Finance's cash date for premiums; renewals the day after the latest cover ends, at the last premium)
--   history: the 3 months before this one, for averages (workshop, other vehicle costs, one-off company costs,
--            Smart Drive net of commission, confirmed other income)
--   duplicate_recurring: vehicles carrying the same monthly cost twice this month (not confirmed as separate)
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
            where oi.finance_month = h.month and oi.status = 'CONFIRMED' and oi.cancelled_at is null), 0)
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
              where r.obligation_a = least(o.obligation_id, d.obligation_id) and r.obligation_b = greatest(o.obligation_id, d.obligation_id))))
  );
end$$;

-- Public entry points are thin wrappers; each private function checks for a current Admin session first.
create or replace function public.finance_cash_outlook(p_today date) returns jsonb
  language sql security invoker set search_path='' as $$select finance_private.cash_outlook(p_today)$$;
create or replace function public.finance_save_cash_balance(p_account text, p_balance numeric, p_as_of date, p_note text default null) returns jsonb
  language sql security invoker set search_path='' as $$select finance_private.save_cash_balance(p_account, p_balance, p_as_of, p_note)$$;
create or replace function public.finance_cancel_cash_balance(p_id uuid, p_reason text) returns jsonb
  language sql security invoker set search_path='' as $$select finance_private.cancel_cash_balance(p_id, p_reason)$$;

revoke all on function finance_private.cash_balance_rows() from public, anon, authenticated;
revoke all on function finance_private.cash_outlook(date), finance_private.save_cash_balance(text, numeric, date, text),
  finance_private.cancel_cash_balance(uuid, text) from public, anon, authenticated;
grant execute on function finance_private.cash_outlook(date), finance_private.save_cash_balance(text, numeric, date, text),
  finance_private.cancel_cash_balance(uuid, text) to authenticated;
revoke all on function public.finance_cash_outlook(date), public.finance_save_cash_balance(text, numeric, date, text),
  public.finance_cancel_cash_balance(uuid, text) from public, anon, authenticated;
grant execute on function public.finance_cash_outlook(date), public.finance_save_cash_balance(text, numeric, date, text),
  public.finance_cancel_cash_balance(uuid, text) to authenticated;

commit;

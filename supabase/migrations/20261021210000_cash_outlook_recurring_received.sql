-- Money -> Cash: monthly recurring Other Income already Confirmed for a month is in the bank balance, so the projection
-- no longer expects it again for that month (owner's bug-check pick, 21 Oct 2026). Only recurring_ahead changes; the rest of
-- cash_outlook is as in 20261021180000_other_income_recurring.sql. Run it in the Supabase SQL Editor for RentalDatabase.
-- All-or-nothing, and safe to run again.
begin;

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
        -- A series whose line for that month is already Confirmed is money received (in the balance), so it is not expected again
        'amount', coalesce((select sum(s.amount) from finance_private.other_income_series s
          where s.cancelled_at is null and s.effective_from <= a.month and (s.effective_until is null or s.effective_until >= a.month)
            and not exists (select 1 from finance_private.other_income oi
              where oi.series_id = s.id and oi.finance_month = a.month and oi.status = 'CONFIRMED' and oi.cancelled_at is null)), 0)
      ) order by a.month)
      from (select (first_month + make_interval(months => g))::date as month from generate_series(0, 5) g) a)
  );
end$$;

commit;

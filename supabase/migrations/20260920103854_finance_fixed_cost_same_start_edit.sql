create or replace function finance_private.save_fixed_cost(
  p_action text,
  p_record jsonb,
  p_month date,
  p_revision integer
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  rid uuid:=nullif(p_record->>'id','')::uuid;
  old finance_private.fixed_cost_templates%rowtype;
  series uuid;
  ver integer;
  affected date;
  new_template uuid;
begin
  perform finance_private.assert_open_revision(p_month,p_revision);
  if p_action='ADD' then
    insert into finance_private.fixed_cost_templates(category,monthly_amount,effective_from,effective_until,payee,note,source)
    values(btrim(p_record->>'category'),(p_record->>'monthly_amount')::numeric,(p_record->>'effective_from')::date,nullif(p_record->>'effective_until','')::date,nullif(btrim(p_record->>'payee'),''),nullif(btrim(p_record->>'note'),''),'Manual / Fixed Operating Cost');
  else
    select * into old from finance_private.fixed_cost_templates where id=rid for update;
    if not found then raise exception 'Fixed operating cost no longer exists';end if;
    if p_action='STOP' then
      if p_month<old.effective_from then raise exception 'Stop month cannot be before the fixed cost starts';end if;
      update finance_private.fixed_cost_templates set effective_until=p_month,record_version=record_version+1 where id=rid;
      update finance_private.expenses e set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason='Fixed cost stopped',record_version=record_version+1
      from finance_private.fixed_cost_occurrences o join finance_private.months m on m.finance_month=o.finance_month
      where o.series_id=old.series_id and o.finance_month>p_month and o.expense_id=e.id and m.status<>'CLOSED' and e.cancelled_at is null;
      update finance_private.fixed_cost_occurrences o set cancelled_at=now()
      from finance_private.months m
      where o.series_id=old.series_id and o.finance_month>p_month and m.finance_month=o.finance_month and m.status<>'CLOSED';
    elsif p_action='DELETE' then
      update finance_private.fixed_cost_templates set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason='Deleted in Settings',record_version=record_version+1 where id=rid;
      update finance_private.expenses e set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason='Fixed cost deleted',record_version=record_version+1
      from finance_private.fixed_cost_occurrences o join finance_private.months m on m.finance_month=o.finance_month
      where o.series_id=old.series_id and o.expense_id=e.id and m.status<>'CLOSED' and e.cancelled_at is null;
      update finance_private.fixed_cost_occurrences o set cancelled_at=now()
      from finance_private.months m
      where o.series_id=old.series_id and m.finance_month=o.finance_month and m.status<>'CLOSED';
    elsif p_action='UPDATE_FUTURE' then
      if p_month<old.effective_from then raise exception 'Future update month cannot be before the fixed cost starts';end if;
      if p_month=old.effective_from then
        update finance_private.fixed_cost_templates
        set category=btrim(p_record->>'category'),
            monthly_amount=(p_record->>'monthly_amount')::numeric,
            effective_until=nullif(p_record->>'effective_until','')::date,
            payee=nullif(btrim(p_record->>'payee'),''),
            note=nullif(btrim(p_record->>'note'),''),
            record_version=record_version+1
        where id=rid;
        update finance_private.expenses e
        set fixed_cost_template_id=rid,
            category=btrim(p_record->>'category'),
            supplier=nullif(btrim(p_record->>'payee'),''),
            amount=(p_record->>'monthly_amount')::numeric,
            description=nullif(btrim(p_record->>'note'),''),
            notes=nullif(btrim(p_record->>'note'),''),
            start_month=old.effective_from,
            end_month=nullif(p_record->>'effective_until','')::date
        from finance_private.fixed_cost_occurrences o
        join finance_private.months m on m.finance_month=o.finance_month
        where o.series_id=old.series_id
          and o.template_id=rid
          and o.finance_month>=p_month
          and (nullif(p_record->>'effective_until','') is null or o.finance_month<=nullif(p_record->>'effective_until','')::date)
          and o.expense_id=e.id
          and o.cancelled_at is null
          and e.cancelled_at is null
          and e.record_version=1
          and m.status<>'CLOSED';
        new_template:=rid;
      else
        update finance_private.fixed_cost_templates set effective_until=(p_month-interval '1 month')::date,record_version=record_version+1 where id=rid;
        select old.series_id,max(version_no)+1 into series,ver from finance_private.fixed_cost_templates where series_id=old.series_id group by old.series_id;
        insert into finance_private.fixed_cost_templates(series_id,version_no,category,monthly_amount,effective_from,effective_until,payee,note,source)
        values(series,ver,btrim(p_record->>'category'),(p_record->>'monthly_amount')::numeric,p_month,nullif(p_record->>'effective_until','')::date,nullif(btrim(p_record->>'payee'),''),nullif(btrim(p_record->>'note'),''),old.source)
        returning id into new_template;
        for affected in
          select o.finance_month
          from finance_private.fixed_cost_occurrences o
          join finance_private.months m on m.finance_month=o.finance_month
          where o.series_id=old.series_id and o.finance_month>=p_month and m.status<>'CLOSED'
          order by o.finance_month
        loop
          perform finance_private.generate_fixed_costs_core(affected);
        end loop;
      end if;
    else
      raise exception 'Invalid fixed operating cost action';
    end if;
  end if;
  if p_action in ('ADD','UPDATE_FUTURE') then perform finance_private.generate_fixed_costs_core(p_month);end if;
  perform finance_private.mark_month_changed(p_month,true);
  insert into finance_private.audit(actor,finance_month,action,details)
  values(auth.uid(),p_month,'SAVE_FIXED_COST',jsonb_build_object('action',p_action,'id',rid,'before',case when rid is null then null else to_jsonb(old) end,'new_template_id',new_template));
  return finance_private.input(p_month);
end
$$;

do $$
declare
  before_rows jsonb;
  after_rows jsonb;
  changed integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(6727,202608);
  select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
  into before_rows
  from finance_private.fixed_cost_templates t
  where t.cancelled_at is null
    and t.version_no=1
    and t.effective_from=date '2026-08-01'
    and t.effective_until=date '2026-08-01'
    and t.linked_expense_id is not null
    and not exists (
      select 1 from finance_private.fixed_cost_templates later
      where later.series_id=t.series_id and later.version_no>t.version_no
    )
    and exists (
      select 1 from finance_private.expenses e
      where e.id=t.linked_expense_id
        and e.payment_source='Corporate Opex'
        and e.frequency='MONTHLY_RECURRING'
    );

  update finance_private.fixed_cost_templates t
  set effective_until=null,
      record_version=t.record_version+1
  where t.cancelled_at is null
    and t.version_no=1
    and t.effective_from=date '2026-08-01'
    and t.effective_until=date '2026-08-01'
    and t.linked_expense_id is not null
    and not exists (
      select 1 from finance_private.fixed_cost_templates later
      where later.series_id=t.series_id and later.version_no>t.version_no
    )
    and exists (
      select 1 from finance_private.expenses e
      where e.id=t.linked_expense_id
        and e.payment_source='Corporate Opex'
        and e.frequency='MONTHLY_RECURRING'
    );
  get diagnostics changed=row_count;

  update finance_private.expenses e
  set end_month=null
  from finance_private.fixed_cost_templates t
  join finance_private.months m on m.finance_month=date '2026-08-01'
  where changed>0
    and t.linked_expense_id=e.id
    and t.id::text in (select value->>'id' from jsonb_array_elements(before_rows))
    and t.cancelled_at is null
    and e.cancelled_at is null
    and e.record_version=1
    and e.payment_source='Corporate Opex'
    and e.frequency='MONTHLY_RECURRING'
    and m.status<>'CLOSED';

  if changed>0 then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
    into after_rows
    from finance_private.fixed_cost_templates t
    where (to_jsonb(t)->>'id') in (select value->>'id' from jsonb_array_elements(before_rows));
    perform finance_private.mark_month_changed(date '2026-08-01',true);
    insert into finance_private.audit(actor,finance_month,action,details)
    values(
      '00000000-0000-0000-0000-000000000000'::uuid,
      date '2026-08-01',
      'EXTEND_OPERATION_FIXED_COST_DEFAULTS',
      jsonb_build_object(
        'performed_by','migration 20260920111527',
        'authorization','Operation Fix Cost entries are recurring ongoing by default',
        'changed_count',changed,
        'before',before_rows,
        'after',after_rows
      )
    );
  end if;
end
$$;

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
  target_id uuid;
  next_version integer;
  before_state jsonb;
  after_state jsonb;
begin
  perform finance_private.assert_open_revision(p_month,p_revision);
  if p_action not in ('ADD','UPDATE_FUTURE','DELETE') then
    raise exception 'Invalid Operation Fix Cost action';
  end if;

  if p_action='ADD' then
    if nullif(btrim(p_record->>'category'),'') is null
       or nullif(p_record->>'monthly_amount','') is null
       or (p_record->>'monthly_amount')::numeric<0 then
      raise exception 'Category and a valid monthly amount are required';
    end if;
    insert into finance_private.fixed_cost_templates(
      category,monthly_amount,effective_from,effective_until,payee,note,source
    ) values(
      btrim(p_record->>'category'),
      (p_record->>'monthly_amount')::numeric,
      p_month,
      null,
      nullif(btrim(p_record->>'payee'),''),
      nullif(btrim(p_record->>'note'),''),
      'Manual / Operation Fix Cost'
    ) returning id into target_id;
  else
    select * into old
    from finance_private.fixed_cost_templates
    where id=rid and cancelled_at is null
    for update;
    if not found then raise exception 'Operation Fix Cost no longer exists';end if;
    if p_month<old.effective_from then
      raise exception 'Select a month when this Operation Fix Cost is active';
    end if;
    if old.effective_until is not null and old.effective_until<p_month then
      raise exception 'This Operation Fix Cost is not active in the selected month';
    end if;

    select jsonb_build_object(
      'templates',coalesce((select jsonb_agg(to_jsonb(t) order by t.version_no) from finance_private.fixed_cost_templates t where t.series_id=old.series_id),'[]'::jsonb),
      'occurrences',coalesce((select jsonb_agg(to_jsonb(o) order by o.finance_month) from finance_private.fixed_cost_occurrences o where o.series_id=old.series_id),'[]'::jsonb),
      'expenses',coalesce((select jsonb_agg(to_jsonb(e) order by e.finance_month,e.id) from finance_private.fixed_cost_occurrences o join finance_private.expenses e on e.id=o.expense_id where o.series_id=old.series_id),'[]'::jsonb)
    ) into before_state;

    if p_action='UPDATE_FUTURE' then
      if nullif(btrim(p_record->>'category'),'') is null
         or nullif(p_record->>'monthly_amount','') is null
         or (p_record->>'monthly_amount')::numeric<0 then
        raise exception 'Category and a valid monthly amount are required';
      end if;

      update finance_private.fixed_cost_templates t
      set cancelled_at=now(),
          cancelled_by=auth.uid(),
          cancellation_reason='Superseded by later Operation Fix Cost edit',
          record_version=t.record_version+1
      where t.series_id=old.series_id
        and t.id<>old.id
        and t.cancelled_at is null
        and t.effective_from>=p_month;

      if p_month=old.effective_from then
        update finance_private.fixed_cost_templates
        set category=btrim(p_record->>'category'),
            monthly_amount=(p_record->>'monthly_amount')::numeric,
            effective_until=null,
            payee=nullif(btrim(p_record->>'payee'),''),
            note=nullif(btrim(p_record->>'note'),''),
            record_version=record_version+1
        where id=old.id
        returning id into target_id;
      else
        update finance_private.fixed_cost_templates
        set effective_until=(p_month-interval '1 month')::date,
            record_version=record_version+1
        where id=old.id;
        select coalesce(max(version_no),0)+1 into next_version
        from finance_private.fixed_cost_templates where series_id=old.series_id;
        insert into finance_private.fixed_cost_templates(
          series_id,version_no,category,monthly_amount,effective_from,effective_until,payee,note,source
        ) values(
          old.series_id,
          next_version,
          btrim(p_record->>'category'),
          (p_record->>'monthly_amount')::numeric,
          p_month,
          null,
          nullif(btrim(p_record->>'payee'),''),
          nullif(btrim(p_record->>'note'),''),
          old.source
        ) returning id into target_id;
      end if;

      update finance_private.fixed_cost_occurrences o
      set template_id=target_id
      from finance_private.months m
      where o.series_id=old.series_id
        and o.finance_month>=p_month
        and o.finance_month=m.finance_month
        and m.status<>'CLOSED'
        and o.cancelled_at is null;

      update finance_private.expenses e
      set fixed_cost_template_id=target_id,
          category=btrim(p_record->>'category'),
          supplier=nullif(btrim(p_record->>'payee'),''),
          amount=(p_record->>'monthly_amount')::numeric,
          description=nullif(btrim(p_record->>'note'),''),
          notes=nullif(btrim(p_record->>'note'),''),
          start_month=p_month,
          end_month=null,
          record_version=e.record_version+1
      from finance_private.fixed_cost_occurrences o
      join finance_private.months m on m.finance_month=o.finance_month
      where o.series_id=old.series_id
        and o.finance_month>=p_month
        and o.expense_id=e.id
        and m.status<>'CLOSED'
        and o.cancelled_at is null
        and e.cancelled_at is null;

      perform finance_private.generate_fixed_costs_core(p_month);
    else
      if p_month=old.effective_from then
        update finance_private.fixed_cost_templates
        set cancelled_at=now(),
            cancelled_by=auth.uid(),
            cancellation_reason='Deleted from selected month forward',
            record_version=record_version+1
        where id=old.id;
      else
        update finance_private.fixed_cost_templates
        set effective_until=(p_month-interval '1 month')::date,
            record_version=record_version+1
        where id=old.id;
      end if;
      update finance_private.fixed_cost_templates t
      set cancelled_at=now(),
          cancelled_by=auth.uid(),
          cancellation_reason='Deleted from selected month forward',
          record_version=t.record_version+1
      where t.series_id=old.series_id
        and t.id<>old.id
        and t.cancelled_at is null
        and t.effective_from>=p_month;
      update finance_private.expenses e
      set cancelled_at=now(),
          cancelled_by=auth.uid(),
          cancellation_reason='Operation Fix Cost deleted from selected month forward',
          record_version=e.record_version+1
      from finance_private.fixed_cost_occurrences o
      join finance_private.months m on m.finance_month=o.finance_month
      where o.series_id=old.series_id
        and o.finance_month>=p_month
        and o.expense_id=e.id
        and m.status<>'CLOSED'
        and e.cancelled_at is null;
      update finance_private.fixed_cost_occurrences o
      set cancelled_at=now()
      from finance_private.months m
      where o.series_id=old.series_id
        and o.finance_month>=p_month
        and o.finance_month=m.finance_month
        and m.status<>'CLOSED'
        and o.cancelled_at is null;
    end if;
  end if;

  if p_action='ADD' then perform finance_private.generate_fixed_costs_core(p_month);end if;
  perform finance_private.mark_month_changed(p_month,true);

  if p_action='ADD' then
    select jsonb_build_object('template',to_jsonb(t)) into after_state
    from finance_private.fixed_cost_templates t where t.id=target_id;
  else
    select jsonb_build_object(
      'templates',coalesce((select jsonb_agg(to_jsonb(t) order by t.version_no) from finance_private.fixed_cost_templates t where t.series_id=old.series_id),'[]'::jsonb),
      'occurrences',coalesce((select jsonb_agg(to_jsonb(o) order by o.finance_month) from finance_private.fixed_cost_occurrences o where o.series_id=old.series_id),'[]'::jsonb),
      'expenses',coalesce((select jsonb_agg(to_jsonb(e) order by e.finance_month,e.id) from finance_private.fixed_cost_occurrences o join finance_private.expenses e on e.id=o.expense_id where o.series_id=old.series_id),'[]'::jsonb)
    ) into after_state;
  end if;

  insert into finance_private.audit(actor,finance_month,action,details)
  values(
    auth.uid(),
    p_month,
    'SAVE_OPERATION_FIXED_COST',
    jsonb_build_object('action',p_action,'record_id',coalesce(rid,target_id),'before',before_state,'after',after_state)
  );
  return finance_private.input(p_month);
end
$$;

revoke all on function finance_private.save_fixed_cost(text,jsonb,date,integer) from public,anon,authenticated;
grant execute on function finance_private.save_fixed_cost(text,jsonb,date,integer) to authenticated;

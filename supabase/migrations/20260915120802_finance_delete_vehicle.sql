-- Retain financial history while removing disposed vehicles from the current master.
alter table finance_private.vehicles add column deleted_at timestamptz;

create function finance_private.guard_deleted_vehicle() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.deleted_at is not null then
  raise exception 'This vehicle has been deleted; its Finance history is retained.';
 end if;
 return new;
end;
$$;
create trigger guard_deleted_vehicle before update on finance_private.vehicles
for each row execute function finance_private.guard_deleted_vehicle();
revoke all on function finance_private.guard_deleted_vehicle() from public,anon,authenticated;

create function finance_private.delete_vehicle(p_month date,p_plate text,p_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare original finance_private.vehicles%rowtype;
begin
 perform finance_private.lock_finance();
 perform finance_private.require_draft(p_month);
 if p_revision is distinct from (select revision from finance_private.months where finance_month=p_month) then
  raise exception 'Month changed. Reload and review before deleting the vehicle.';
 end if;
 select * into original from finance_private.vehicles where plate_key=p_plate for update;
 if not found then raise exception 'This vehicle no longer exists. Reload the Vehicle Master.';end if;
 if original.deleted_at is not null then raise exception 'This vehicle is already deleted.';end if;

 update finance_private.vehicles set deleted_at=now() where plate_key=original.plate_key;
 perform finance_private.touch_open_months();
 insert into finance_private.audit(actor,finance_month,action,details)
 values(auth.uid(),p_month,'DELETE_VEHICLE',jsonb_build_object('plate_key',original.plate_key,'vehicle',to_jsonb(original)));
 return finance_private.input(p_month);
end;
$$;
create function public.finance_delete_vehicle(p_month date,p_plate text,p_revision integer)
returns jsonb language sql security invoker set search_path='' as $$
 select finance_private.delete_vehicle(p_month,p_plate,p_revision)
$$;
revoke all on function finance_private.delete_vehicle(date,text,integer),public.finance_delete_vehicle(date,text,integer) from public,anon,authenticated;
grant execute on function finance_private.delete_vehicle(date,text,integer),public.finance_delete_vehicle(date,text,integer) to authenticated;

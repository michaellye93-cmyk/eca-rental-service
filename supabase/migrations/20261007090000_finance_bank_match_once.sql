-- A payment or a deposit receipt can be matched to one bank line only (the owner's decision of 2026-10-06). The
-- Reconcile screen already prevents a second match; this makes the database refuse it too, on posting a statement and
-- on amending a posted line. Rows already posted are not re-checked. Safe to run again.

create or replace function finance_private.guard_bank_match_once() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  payment_ids uuid[];
  deposit_ids uuid[];
begin
  if new.decision <> 'MATCHED' then return new; end if;
  payment_ids := case when new.matched_kind = 'payment' then coalesce(new.matched_ids, array[new.matched_id]) end;
  deposit_ids := new.matched_deposit_ids;
  if (payment_ids is not null and cardinality(payment_ids) <> (select count(distinct x) from unnest(payment_ids) x))
    or (deposit_ids is not null and cardinality(deposit_ids) <> (select count(distinct x) from unnest(deposit_ids) x)) then
    raise exception 'Bank row % lists the same payment twice', new.source_row;
  end if;
  if exists (
    select 1 from finance_private.bank_rows r
    where r.decision = 'MATCHED' and (r.import_id, r.source_row) is distinct from (new.import_id, new.source_row)
      and ((payment_ids is not null and r.matched_kind = 'payment' and coalesce(r.matched_ids, array[r.matched_id]) && payment_ids)
        or (deposit_ids is not null and r.matched_deposit_ids && deposit_ids))
  ) then
    raise exception 'Bank row %: that payment or deposit is already matched to another bank line', new.source_row;
  end if;
  return new;
end $$;
revoke all on function finance_private.guard_bank_match_once() from public, anon, authenticated;

drop trigger if exists bank_rows_match_once on finance_private.bank_rows;
create trigger bank_rows_match_once before insert or update of decision, matched_kind, matched_id, matched_ids, matched_deposit_ids
  on finance_private.bank_rows for each row execute function finance_private.guard_bank_match_once();

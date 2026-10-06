-- Bank reconciliation is a required Month close step (the owner's decision of 2026-10-06): a Finance month can be
-- marked Ready for review or Closed only after at least one bank statement for that month has been loaded and
-- reconciled on the Reconcile tab. Every statement line is decided when it is posted (matched, posted as an expense
-- or excluded with a reason), so a posted statement is a reconciled one.
--
-- Same as the 2026-09-15 version plus the first check. It runs only when a month is marked Ready or Closed.
-- Safe to run again.

create or replace function finance_private.validate_bank_links(p_month date) returns void language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from finance_private.bank_imports where finance_month=p_month) then
  raise exception 'Reconcile the bank statement for this month (Reconcile tab) before marking it ready or closing it';
 end if;
 if exists(select 1 from finance_private.bank_rows r join finance_private.bank_imports b on b.id=r.import_id where b.finance_month=p_month and r.decision='MATCHED' and not finance_private.bank_match_valid(p_month,r.matched_kind,r.matched_id,r.debit,r.credit)) then
  raise exception 'Review changed bank matches before marking this month ready or closing it';
 end if;
end$$;
revoke all on function finance_private.validate_bank_links(date) from public,anon,authenticated;

-- Bank confirmation on each payment (the owner's decision of 2026-10-06): the Drivers page shows "Bank ✓" on a payment
-- that a posted bank statement was matched to, and "Not in bank" on a payment in a month whose statement is posted but
-- that no bank line was matched to. Admins only; read only; safe to run again.

create or replace function finance_private.payment_bank_status(p_driver_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform finance_private.require_admin();
  return jsonb_build_object(
    'matched', coalesce((select jsonb_agg(distinct r.matched_id) from finance_private.bank_rows r
      join public.payments p on p.id = r.matched_id
      where r.decision = 'MATCHED' and r.matched_kind = 'payment' and p.driver_id = p_driver_id), '[]'::jsonb),
    'months', coalesce((select jsonb_agg(distinct to_char(b.finance_month, 'YYYY-MM')) from finance_private.bank_imports b), '[]'::jsonb));
end $$;

create or replace function public.finance_payment_bank_status(p_driver_id uuid) returns jsonb
  language sql security invoker set search_path = '' as $$select finance_private.payment_bank_status(p_driver_id)$$;

revoke all on function finance_private.payment_bank_status(uuid) from public, anon, authenticated;
grant execute on function finance_private.payment_bank_status(uuid) to authenticated;
revoke all on function public.finance_payment_bank_status(uuid) from public, anon, authenticated;
grant execute on function public.finance_payment_bank_status(uuid) to authenticated;

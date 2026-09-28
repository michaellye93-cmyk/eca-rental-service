import { supabase } from '../supabaseClient';
import type { PaymentChange } from './paymentLog';

/**
 * Reads and writes for the collections tables added by supabase/migrations/20260929090000_collections_support.sql.
 * Each call rejects when the table is not available yet (the file has not been run), so screens can carry on without it.
 */

/** Every logged change to this driver's payments, oldest first. */
export async function loadPaymentChanges(driverId: string): Promise<PaymentChange[]> {
  const { data, error } = await supabase
    .from('payment_changes')
    .select('id,payment_id,driver_id,action,changed_at,changed_by_name,changed_by_role,before,after')
    .eq('driver_id', driverId)
    .order('id');
  if (error) throw error;
  return (data ?? []) as PaymentChange[];
}

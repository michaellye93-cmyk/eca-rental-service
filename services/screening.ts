import { supabase } from '../supabaseClient';

/**
 * Daily screening shared between staff (table public.driver_screenings, from
 * supabase/migrations/20260927090100_driver_portal_phone_screening.sql). Each mark records who screened which driver
 * on which Kuala Lumpur calendar day.
 */

/** Driver ids screened on `day` (YYYY-MM-DD). Rejects when the table is not available. */
export async function loadScreenedDriverIds(day: string): Promise<string[]> {
  const { data, error } = await supabase.from('driver_screenings').select('driver_id').eq('screened_on', day);
  if (error) throw error;
  return (data ?? []).map(row => String(row.driver_id));
}

/** Marks a driver screened on `day`; marking twice is harmless. Rejects when the table is not available. */
export async function markScreened(driverId: string, day: string): Promise<void> {
  const { error } = await supabase
    .from('driver_screenings')
    .upsert({ driver_id: driverId, screened_on: day }, { onConflict: 'driver_id,screened_on', ignoreDuplicates: true });
  if (error) throw error;
}

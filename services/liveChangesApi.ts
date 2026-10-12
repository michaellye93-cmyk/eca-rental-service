import { supabase } from '../supabaseClient';
import type { DriverRow } from '../utils';
import {
  DRIVER_CHANGE_COLUMNS, PAYMENT_CHANGE_COLUMNS, changesFrom, isMissingTable, type DriverChangeRow, type LiveMode, type PaymentChangeRow,
} from './liveChanges';

/**
 * The reads behind live updates (see liveChanges.ts): small reads of the change logs, and of the few drivers that changed.
 * No Supabase Realtime: a read a minute is enough and stays within the free plan.
 */

/** The most rows one light read takes from a log; more (say, a bulk import) and the app reloads in full instead. */
export const LIGHT_READ_LIMIT = 500;

const latestChange = async (table: 'payment_changes' | 'driver_changes'): Promise<string | null> => {
  const { data, error } = await supabase.from(table).select('changed_at').order('changed_at', { ascending: false }).limit(1);
  if (error) throw error;
  return ((data ?? [])[0] as { changed_at?: string } | undefined)?.changed_at ?? null;
};

/**
 * Read just before a full load: the latest change in each log, where the next light read starts. Live updates are off
 * when the payment log cannot be read, and cover payments only when the driver log is not there yet.
 */
export async function readChangeCursors(): Promise<{ mode: LiveMode; payments: string | null; drivers: string | null }> {
  let payments: string | null;
  try {
    payments = await latestChange('payment_changes');
  } catch {
    return { mode: 'off', payments: null, drivers: null };
  }
  try {
    return { mode: 'all', payments, drivers: await latestChange('driver_changes') };
  } catch (error) {
    return isMissingTable(error) ? { mode: 'payments', payments, drivers: null } : { mode: 'off', payments: null, drivers: null };
  }
}

const readLog = async <T>(table: 'payment_changes' | 'driver_changes', columns: string, cursor: string | null): Promise<T[]> => {
  let query = supabase.from(table).select(columns);
  const from = changesFrom(cursor);
  if (from !== null) query = query.gt('changed_at', from);
  const { data, error } = await query.order('id').limit(LIGHT_READ_LIMIT + 1);
  if (error) throw error;
  return (data ?? []) as T[];
};

/** The changes logged since each cursor (a little before it, see changesFrom). `tooMany` when a log had more than the limit. */
export async function readLiveChanges(cursors: { payments: string | null; drivers: string | null }, withDrivers: boolean)
  : Promise<{ payments: PaymentChangeRow[]; drivers: DriverChangeRow[]; tooMany: boolean }> {
  const [payments, drivers] = await Promise.all([
    readLog<PaymentChangeRow>('payment_changes', PAYMENT_CHANGE_COLUMNS, cursors.payments),
    withDrivers ? readLog<DriverChangeRow>('driver_changes', DRIVER_CHANGE_COLUMNS, cursors.drivers) : Promise.resolve([]),
  ]);
  return { payments, drivers, tooMany: payments.length > LIGHT_READ_LIMIT || drivers.length > LIGHT_READ_LIMIT };
}

/** The drivers rows for these ids, read again; null for a driver no longer there. */
export async function readDriverRows(ids: string[]): Promise<Map<string, DriverRow | null>> {
  const rows = new Map<string, DriverRow | null>(ids.map(id => [id, null]));
  if (!ids.length) return rows;
  const { data, error } = await supabase.from('drivers').select('*').in('id', ids);
  if (error) throw error;
  for (const row of (data ?? []) as DriverRow[]) rows.set(row.id, row);
  return rows;
}

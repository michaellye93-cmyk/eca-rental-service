import { supabase } from '../supabaseClient';
import { readAllRows } from './pagedRead';
import type { PaymentChange } from './paymentLog';
import type { CatchUpPlan, CollectionContact, ContactKind, PaymentPromise } from './collections';
import type { DailyStatusRow } from './dailyStatus';
import type { CollectionRun, NewCollectionRun } from './collectionRuns';

/**
 * Reads and writes for the collections tables added by supabase/migrations/20260929090000_collections_support.sql.
 * Each call rejects when the table is not available yet (the file has not been run), so screens can carry on without it.
 */

/** Every logged change to this driver's payments, oldest first. */
/** Which of a driver's payments a posted bank statement matched, and the months that have a posted statement (admins). */
export async function loadPaymentBankStatus(driverId: string): Promise<{ matched: string[]; months: string[] }> {
  const { data, error } = await supabase.rpc('finance_payment_bank_status', { p_driver_id: driverId });
  if (error) throw error;
  return { matched: data?.matched ?? [], months: data?.months ?? [] };
}

export async function loadPaymentChanges(driverId: string): Promise<PaymentChange[]> {
  const { data, error } = await supabase
    .from('payment_changes')
    .select('id,payment_id,driver_id,action,changed_at,changed_by_name,changed_by_role,before,after')
    .eq('driver_id', driverId)
    .order('id');
  if (error) throw error;
  return (data ?? []) as PaymentChange[];
}

/** The bank-in line of WhatsApp statements for each rental category; null where none is set. */
export interface BankIn {
  SEWABELI: string | null;
  SEWA_BIASA: string | null;
}
const BANK_IN_KEYS: Record<keyof BankIn, string> = { SEWABELI: 'bank_in_sewabeli', SEWA_BIASA: 'bank_in_sewa_biasa' };

export async function loadBankIn(): Promise<BankIn> {
  const { data, error } = await supabase.from('collection_settings').select('key,value');
  if (error) throw error;
  const value = (key: string) => (data ?? []).find(row => row.key === key)?.value ?? null;
  return { SEWABELI: value(BANK_IN_KEYS.SEWABELI), SEWA_BIASA: value(BANK_IN_KEYS.SEWA_BIASA) };
}

/** Sets a category's bank-in line (Admins only); an empty text removes it. */
export async function saveBankIn(category: keyof BankIn, text: string): Promise<void> {
  const key = BANK_IN_KEYS[category];
  const value = text.trim();
  const { error } = value
    ? await supabase.from('collection_settings').upsert({ key, value }, { onConflict: 'key' })
    : await supabase.from('collection_settings').delete().eq('key', key);
  if (error) throw error;
}

/** Every promise to pay, newest first. */
export async function loadPromises(): Promise<PaymentPromise[]> {
  const { data, error } = await supabase.from('payment_promises').select('*').order('logged_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(row => ({ ...row, amount: Number(row.amount) || 0 }) as PaymentPromise);
}

/** Logs a promise under the signed-in account (the database stamps who and when). */
export async function logPromise(driverId: string, amount: number, promisedDate: string, note: string): Promise<void> {
  const { error } = await supabase.from('payment_promises').insert({ driver_id: driverId, amount, promised_date: promisedDate, note: note.trim() || null });
  if (error) throw error;
}

/** Removes a promise logged by mistake (Admins only). */
export async function removePromise(id: string): Promise<void> {
  const { error } = await supabase.from('payment_promises').delete().eq('id', id);
  if (error) throw error;
}

/** Every catch-up plan, running and stopped. */
export async function loadPlans(): Promise<CatchUpPlan[]> {
  const { data, error } = await supabase.from('catch_up_plans').select('*').order('start_date', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(row => ({ ...row, extra_per_cycle: Number(row.extra_per_cycle) || 0 }) as CatchUpPlan);
}

/** Starts a plan (Admins only). A running plan is stopped first, on `today`, because a driver has one at a time. */
export async function startPlan(plan: { driverId: string; extra: number; start: string; end: string | null; note: string }, runningPlanId: string | null, today: string): Promise<void> {
  if (runningPlanId) await stopPlan(runningPlanId, today);
  const { error } = await supabase.from('catch_up_plans').insert({
    driver_id: plan.driverId, extra_per_cycle: plan.extra, start_date: plan.start, end_date: plan.end, note: plan.note.trim() || null,
  });
  if (error) throw error;
}

/** Stops a running plan from `day` (Admins only). */
export async function stopPlan(id: string, day: string): Promise<void> {
  const { error } = await supabase.from('catch_up_plans').update({ stopped_on: day }).eq('id', id);
  if (error) throw error;
}

/** Every logged change to this driver's profile (newest last). Rejects when the change log is not available yet. */
export async function loadDriverChanges(driverId: string): Promise<import('./driverChanges').DriverChange[]> {
  const { data, error } = await supabase
    .from('driver_changes')
    .select('id,driver_id,action,changed_at,changed_by_name,changed_by_role,fields,before,after')
    .eq('driver_id', driverId)
    .order('id');
  if (error) throw error;
  return (data ?? []) as import('./driverChanges').DriverChange[];
}

/**
 * Every contact logged since `since` (an ISO time), newest first: one query for all drivers, read 1,000 rows a page (the
 * most Supabase returns at once). Rejects when the table is not there yet.
 */
export async function loadRecentContacts(since: string): Promise<CollectionContact[]> {
  return readAllRows<CollectionContact>(() => supabase
    .from('collection_contacts')
    .select('id,driver_id,contacted_at,run_slot,kind,message,logged_by_name,logged_by_role')
    .gte('contacted_at', since), 'contacted_at', false);
}

/** Logs a contact under the signed-in account (the database stamps who and when). */
export async function logContact(contact: { driverId: string; kind: ContactKind; runSlot: string | null; message: string }): Promise<void> {
  const { error } = await supabase.from('collection_contacts').insert({
    driver_id: contact.driverId, kind: contact.kind, run_slot: contact.runSlot || null, message: contact.message.trim(),
  });
  if (error) throw error;
}

/** Removes a contact logged by mistake (Admins only). */
export async function removeContact(id: string): Promise<void> {
  const { data, error } = await supabase.from('collection_contacts').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('only an admin can remove a contact');
}

/**
 * Saves today's status rows in one request. The first write of the Kuala Lumpur day wins: a repeat the same day is
 * ignored (insert ... on conflict do nothing; nobody may rewrite a row). Rejects when the table is not there yet.
 */
export async function saveDailyStatus(rows: DailyStatusRow[]): Promise<void> {
  const { error } = await supabase.from('driver_daily_status').upsert(rows, { onConflict: 'driver_id,day', ignoreDuplicates: true });
  if (error) throw error;
}

/** Every daily status row from `fromDay` (YYYY-MM-DD) on, oldest first. Rejects when the table is not there yet. */
export async function loadDailyStatus(fromDay: string): Promise<(DailyStatusRow & { written_at: string })[]> {
  // Read 1,000 rows a page, ordered by the table's key (it has no id column, so readAllRows cannot page it)
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('driver_daily_status')
      .select('driver_id,day,owed,overdue,cycles_owed,status,late_days,last_payment_date,written_at')
      .gte('day', fromDay)
      .order('day', { ascending: true })
      .order('driver_id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }
  return rows.map(row => ({
    ...(row as unknown as DailyStatusRow & { written_at: string }),
    owed: Number(row.owed) || 0, overdue: Number(row.overdue) || 0, cycles_owed: Number(row.cycles_owed) || 0,
  }));
}

/** Every payment change (added, edited, deleted) since `since` (an ISO time), oldest first. Rejects when the log is not there. */
export async function loadPaymentChangesSince(since: string): Promise<PaymentChange[]> {
  return readAllRows<PaymentChange>(() => supabase
    .from('payment_changes')
    .select('id,payment_id,driver_id,action,changed_at,changed_by_name,changed_by_role,before,after')
    .gte('changed_at', since), 'id', true);
}

/** The latest `limit` run summaries, newest first. Rejects when the table is not there yet (20261012230000_collection_runs.sql). */
export async function loadRecentRuns(limit = 7): Promise<CollectionRun[]> {
  const { data, error } = await supabase
    .from('collection_runs')
    .select('*')
    .order('run_date', { ascending: false })
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(row => ({ ...row, collected: Number(row.collected) || 0 }) as CollectionRun);
}

/** Records a run summary under the signed-in account (the database stamps who and when). */
export async function saveRun(run: NewCollectionRun): Promise<void> {
  const { error } = await supabase.from('collection_runs').insert(run);
  if (error) throw error;
}

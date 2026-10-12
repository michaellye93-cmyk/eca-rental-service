import type { Driver, PaymentTransaction } from '../types.ts';
import { calculateDriverMetrics } from '../utils.ts';
import { ASK_KINDS, type CollectionContact, type PaymentPromise } from './collections.ts';
import { cashOf } from './moneyDefinitions.ts';
import type { PaymentChange } from './paymentLog.ts';

/**
 * Collection run summaries (public.collection_runs, supabase/migrations/20261012230000_collection_runs.sql): what each
 * daily run did. The worklist pre-fills what the system recorded since the run started; the person adjusts and saves.
 */

export interface CategoryCounts { good: number; mid: number; bad: number }

export type RunSlot = '1PM' | '9PM';
export const RUN_SLOTS: RunSlot[] = ['1PM', '9PM'];

/** A row of public.collection_runs. */
export interface CollectionRun {
  id: string;
  run_date: string;
  run_slot: string;
  started_at: string;
  finished_at: string;
  payments_recorded: number;
  asks_sent: number;
  promises_logged: number;
  collected: number;
  categories_before: CategoryCounts | null;
  categories_after: CategoryCounts | null;
  blocks: string | null;
  summary: string | null;
  logged_at: string;
  logged_by_name: string;
  logged_by_role: string | null;
}

/** What is saved for a new summary (the database stamps who and when). */
export type NewCollectionRun = Omit<CollectionRun, 'id' | 'logged_at' | 'logged_by_name' | 'logged_by_role'>;

const SLOT_START: Record<RunSlot, string> = { '1PM': '13:00', '9PM': '21:00' };

/** When a run started, as the real moment: `time` (HH:MM, Kuala Lumpur) on `today`, else the slot's own time. */
export function runStartAt(today: string, slot: RunSlot, time?: string): Date {
  const clock = time && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : SLOT_START[slot];
  return new Date(`${today}T${clock}:00+08:00`);
}

/** The run being recorded at a Kuala Lumpur wall-clock time: the 9PM run from 8 pm, otherwise the 1PM run. */
export const defaultRunSlot = (klNow: Date): RunSlot => (klNow.getHours() >= 20 ? '9PM' : '1PM');

/** Active drivers by GOOD / MID / BAD at `now`, from the rent engine. */
export function categoryCounts(drivers: Driver[], now: Date): CategoryCounts {
  const counts: CategoryCounts = { good: 0, mid: 0, bad: 0 };
  for (const driver of drivers) {
    if (driver.isDelisted) continue;
    const status = calculateDriverMetrics(driver, now).status;
    if (status === 'GOOD') counts.good += 1; else if (status === 'MID') counts.mid += 1; else counts.bad += 1;
  }
  return counts;
}

export interface RunPrefill {
  payments_recorded: number;
  collected: number;
  asks_sent: number;
  promises_logged: number;
  categories_before: CategoryCounts | null;
  categories_after: CategoryCounts;
}

const round2 = (amount: number) => Math.round(amount * 100) / 100;
const since = (iso: string, start: Date) => Date.parse(iso) >= start.getTime();

/**
 * What the system recorded since the run started (`startedAt`, the real moment):
 * - payments: payments added since then and not deleted since (payment_changes INSERTs), and the cash among them as
 *   they stand now (bank transfer, cash deposit or cash; service claims are not cash);
 * - asks: statements, asks and follow-ups logged since then; promises logged since then;
 * - categories: before = today's daily status snapshot (null when none was written), after = now, from the rent engine.
 * Anything not available yet (null) counts as nothing.
 */
export function runSummaryPrefill(input: {
  startedAt: Date;
  /** Kuala Lumpur wall-clock time (kualaLumpurNow). */
  now: Date;
  drivers: Driver[];
  changes: PaymentChange[] | null;
  contacts: CollectionContact[] | null;
  promises: PaymentPromise[] | null;
  snapshot: { status: string }[] | null;
}): RunPrefill {
  const { startedAt } = input;
  const changes = (input.changes ?? []).filter(change => since(change.changed_at, startedAt)).sort((a, b) => a.id - b.id);
  const added = new Set(changes.filter(change => change.action === 'INSERT').map(change => change.payment_id));
  for (const change of changes) if (change.action === 'DELETE') added.delete(change.payment_id);
  // The payment as it stands now: its latest change since the run started
  const latest = new Map<string, Record<string, unknown>>();
  for (const change of changes) if (added.has(change.payment_id) && change.after) latest.set(change.payment_id, change.after);
  const collected = [...latest.values()].reduce((sum, row) => sum + cashOf({
    amount: Number(row.amount) || 0, serviceClaim: Number(row.service_claim) || 0, paymentMethod: (row.payment_method as PaymentTransaction['paymentMethod']) ?? undefined,
  }), 0);

  const snapshot = input.snapshot ?? [];
  const before: CategoryCounts | null = snapshot.length ? {
    good: snapshot.filter(row => row.status === 'GOOD').length,
    mid: snapshot.filter(row => row.status === 'MID').length,
    bad: snapshot.filter(row => row.status === 'BAD').length,
  } : null;
  return {
    payments_recorded: added.size,
    collected: round2(collected),
    asks_sent: (input.contacts ?? []).filter(contact => ASK_KINDS.includes(contact.kind) && since(contact.contacted_at, startedAt)).length,
    promises_logged: (input.promises ?? []).filter(promise => since(promise.logged_at, startedAt)).length,
    categories_before: before,
    categories_after: categoryCounts(input.drivers, input.now),
  };
}

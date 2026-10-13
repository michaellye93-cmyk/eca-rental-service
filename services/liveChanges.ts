import type { Driver, PaymentTransaction } from '../types.ts';
import { fromDriverRow, paymentFromRow, withPayments, type DriverRow, type PaymentRow } from '../utils.ts';

/**
 * Live updates for the office's driver list without reloading everything: every minute the app reads only what changed
 * since it last looked, from the change logs the database already keeps (public.payment_changes, every payment insert,
 * edit and delete with the whole row; public.driver_changes, every driver change), and applies it to the list in memory.
 * Everything here is pure; the reads are in liveChangesApi.ts.
 */

/** A row of public.payment_changes, as read for live updates (`after` is the whole payments row; null on delete). */
export interface PaymentChangeRow {
  id: number;
  payment_id: string;
  driver_id: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  changed_at: string;
  after: (PaymentRow & { driver_id: string }) | null;
}
export const PAYMENT_CHANGE_COLUMNS = 'id,payment_id,driver_id,action,changed_at,after';

/** A row of public.driver_changes, as read for live updates: which driver changed (the row itself is read again). */
export interface DriverChangeRow {
  id: number;
  driver_id: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  changed_at: string;
}
export const DRIVER_CHANGE_COLUMNS = 'id,driver_id,action,changed_at';

/** True when an error says the table is not there yet (its database update has not been run). */
export const isMissingTable = (error: unknown): boolean => {
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  return code === '42P01' || code === 'PGRST205' || /could not find the table|does not exist/i.test(message ?? '');
};

const samePayment = (a: PaymentTransaction, b: PaymentTransaction) =>
  a.id === b.id && a.date === b.date && a.amount === b.amount && (a.serviceClaim || 0) === (b.serviceClaim || 0)
  && (a.paymentMethod || 'BANK TRANSFER') === (b.paymentMethod || 'BANK TRANSFER') && (a.reference ?? null) === (b.reference ?? null);

/**
 * Applies changes to the driver list and returns the new list (the same list when nothing changed). `driverRows` holds
 * each changed driver as just read again: its details replace the old ones (its payments are kept), a driver not in the
 * list is added at the top (the list loads newest first), null removes it. Payment changes are then applied in the order
 * they were logged (by id): the payment leaves whichever driver held it and, unless deleted, joins the driver in its
 * row, so a change applied twice never makes two copies. A payment that ends up with a driver not in the list is left
 * out and its driver reported in `unknownDrivers` (the caller reloads in full), unless that driver was found deleted.
 * Changed drivers are new objects; untouched drivers keep theirs, so their rent figures stay cached.
 */
export function applyLiveChanges(
  drivers: Driver[],
  changes: { payments?: PaymentChangeRow[]; driverRows?: Map<string, DriverRow | null> },
): { drivers: Driver[]; unknownDrivers: string[] } {
  const order = drivers.map(driver => driver.id);
  const profiles = new Map<string, Omit<Driver, 'totalAmountPaid' | 'paymentHistory'>>(drivers.map(driver => [driver.id, driver]));
  const payments = new Map(drivers.map(driver => [driver.id, driver.paymentHistory]));
  const touched = new Set<string>();
  const removed = new Set<string>();
  /** Drivers read again and found gone (whether or not they were in the list). */
  const gone = new Set<string>();
  /** Payments last seen going to a driver not in the list, by payment id. */
  const strays = new Map<string, string>();
  let listChanged = false;

  for (const [id, row] of changes.driverRows ?? []) {
    if (!row) {
      gone.add(id);
      if (profiles.has(id) && !removed.has(id)) { removed.add(id); listChanged = true; }
      continue;
    }
    if (!profiles.has(id)) { order.unshift(id); payments.set(id, []); listChanged = true; }
    profiles.set(id, fromDriverRow(row));
    removed.delete(id);
    touched.add(id);
  }

  const holder = new Map<string, string>();
  for (const [driverId, list] of payments) for (const payment of list) holder.set(payment.id, driverId);
  const loaded = (driverId: string) => profiles.has(driverId) && !removed.has(driverId);

  for (const change of [...(changes.payments ?? [])].sort((a, b) => a.id - b.id)) {
    const paymentId = String(change.payment_id);
    const target = change.action !== 'DELETE' && change.after ? String(change.after.driver_id) : null;
    const next = target && change.after ? paymentFromRow(change.after) : null;
    const from = holder.get(paymentId) ?? null;
    strays.delete(paymentId);
    if (target && !loaded(target)) strays.set(paymentId, target);
    if (from && from === target && next) {
      const current = payments.get(from)!.find(payment => payment.id === paymentId);
      if (current && samePayment(current, next)) continue;
    }
    if (from) {
      payments.set(from, payments.get(from)!.filter(payment => payment.id !== paymentId));
      holder.delete(paymentId);
      touched.add(from);
    }
    if (target && next && loaded(target)) {
      payments.set(target, [next, ...payments.get(target)!]);
      holder.set(paymentId, target);
      touched.add(target);
    }
  }

  // Only a payment that ends up with a driver not in the list, and not deleted, needs a full reload
  const unknown = [...new Set([...strays.values()].filter(driverId => !gone.has(driverId)))];
  if (!listChanged && touched.size === 0) return { drivers, unknownDrivers: unknown };
  const byId = new Map(drivers.map(driver => [driver.id, driver]));
  const next = order
    .filter(id => !removed.has(id))
    .map(id => (touched.has(id) ? withPayments(profiles.get(id)!, payments.get(id)!) : byId.get(id)!));
  return { drivers: next, unknownDrivers: unknown };
}

/** How far before the last change seen each read starts, so a change saved just before it is not missed. */
export const CHANGE_OVERLAP_MS = 120_000;

/** Where the next read starts (an ISO time), or null to read from the beginning (nothing seen yet). */
export const changesFrom = (cursor: string | null, overlapMs = CHANGE_OVERLAP_MS): string | null =>
  cursor === null ? null : new Date(Date.parse(cursor) - overlapMs).toISOString();

/** The rows not applied before (the read window overlaps the last one). */
export const unseenChanges = <T extends { id: number }>(rows: T[], seen: Set<number>): T[] => rows.filter(row => !seen.has(row.id));

/** The latest change time among the rows and the current cursor (database times, never this computer's clock). */
export const latestChangedAt = (rows: { changed_at: string }[], current: string | null): string | null =>
  rows.reduce<string | null>((latest, row) => (latest === null || Date.parse(row.changed_at) > Date.parse(latest) ? row.changed_at : latest), current);

/** How live updates run: from both logs, payments only (no driver change log yet), or off (the old full reloads). */
export type LiveMode = 'all' | 'payments' | 'off';

const LIGHT_EVERY_MS = 60_000;
/** The old schedule, kept where a change log is missing: a full reload every 3 minutes, and on return at most once a minute. */
const FULL_EVERY_MS = 180_000;
const AWAY_FULL_RELOAD_MS = 10 * 60_000;

/**
 * What to do on the minute timer or when the tab comes back into view: read only the changes ('light'), reload
 * everything ('full') or nothing. A full reload on a new Kuala Lumpur day, on return after more than 10 minutes away,
 * and on the old 3-minute schedule for what has no change log.
 */
export function refreshKind(
  trigger: 'timer' | 'return',
  state: { now: number; lastFullLoad: number; fullLoadDay: string; today: string; live: LiveMode; awayMs: number },
): 'light' | 'full' | 'none' {
  const sinceFull = state.now - state.lastFullLoad;
  if (state.live === 'off') {
    // The 3-minute timer, run on the minute: allow a few seconds of timer drift
    if (trigger === 'timer') return sinceFull >= FULL_EVERY_MS - LIGHT_EVERY_MS / 12 ? 'full' : 'none';
    return sinceFull > LIGHT_EVERY_MS ? 'full' : 'none';
  }
  if (state.today !== state.fullLoadDay) return 'full';
  if (trigger === 'return' && state.awayMs > AWAY_FULL_RELOAD_MS) return 'full';
  if (state.live === 'payments' && sinceFull >= FULL_EVERY_MS - LIGHT_EVERY_MS / 12) return 'full';
  return 'light';
}

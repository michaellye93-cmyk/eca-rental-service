import type { Driver } from '../types.ts';
import { calculateDriverMetrics, lastPayment, lateAlertDays, overdueRent } from '../utils.ts';

/**
 * The daily status snapshot (public.driver_daily_status, supabase/migrations/20261012210000_collections_tools.sql): each
 * active driver's figures once a Kuala Lumpur day, so later tools can see how a driver moved over time. Every figure
 * comes from the shared rent engine in utils.ts; nothing is worked out a second way.
 */
export interface DailyStatusRow {
  driver_id: string;
  /** Kuala Lumpur calendar day, YYYY-MM-DD. */
  day: string;
  /** Rent owed (no late-payment penalty), as on the driver list. */
  owed: number;
  /** Rent that fell due before the day and is still unpaid. */
  overdue: number;
  cycles_owed: number;
  status: 'GOOD' | 'MID' | 'BAD';
  late_days: number | null;
  last_payment_date: string | null;
}

const round2 = (amount: number) => Math.round(amount * 100) / 100;
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** One row per active driver for `today`, figures as at `now` (Kuala Lumpur wall-clock time). */
export function buildDailyStatusRows(drivers: Driver[], now: Date, today: string): DailyStatusRow[] {
  return drivers.filter(driver => !driver.isDelisted).map(driver => {
    const metrics = calculateDriverMetrics(driver, now);
    const last = lastPayment(driver, now);
    return {
      driver_id: driver.id,
      day: today,
      owed: round2(metrics.principalOutstanding),
      overdue: round2(overdueRent(driver, now)),
      cycles_owed: round2(metrics.cyclesOwed),
      status: metrics.status,
      late_days: lateAlertDays(driver, now),
      last_payment_date: last ? iso(last.date) : null,
    };
  });
}

/** Where this browser remembers the last day it wrote the snapshot. */
export const DAILY_STATUS_KEY = 'eca.dailyStatus.writtenDay';

/**
 * Writes today's snapshot unless this browser already did today. Remembered only after the write succeeds; a failure
 * (for example the table is not there yet) is silent, and `attempted` (kept for the page's lifetime) stops it being
 * retried on every reload of the list that day. Safe to repeat: the database replaces the day's rows.
 */
export async function writeTodaysSnapshotOnce(input: {
  drivers: Driver[];
  now: Date;
  today: string;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  write: (rows: DailyStatusRow[]) => Promise<void>;
  attempted: { day: string | null };
}): Promise<'written' | 'already' | 'failed'> {
  const { today, storage, attempted } = input;
  let remembered: string | null = null;
  try { remembered = storage?.getItem(DAILY_STATUS_KEY) ?? null; } catch { /* storage blocked: rely on `attempted` */ }
  if (remembered === today || attempted.day === today) return 'already';
  attempted.day = today;
  try {
    const rows = buildDailyStatusRows(input.drivers, input.now, today);
    if (rows.length) await input.write(rows);
  } catch {
    return 'failed';
  }
  try { storage?.setItem(DAILY_STATUS_KEY, today); } catch { /* storage blocked */ }
  return 'written';
}

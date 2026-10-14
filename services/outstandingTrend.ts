/**
 * A driver's rent outstanding at each month-end, and whether it is rising, flat or falling. Every balance comes from the
 * shared rent schedule (calculateDriverMetrics), so it matches the outstanding shown everywhere else. No React, so tests
 * load it.
 */
import type { Driver } from '../types.ts';
import { calculateDriverMetrics, kualaLumpurNow, parseDate } from '../utils.ts';
import { isoDay, round2 } from './fmt.ts';

/** Month-ends shown: the last 12, this month included. */
export const TREND_MONTHS = 12;
/** The label compares today's balance with the month-end this many months back (or the first one, if later). */
export const DIRECTION_MONTHS = 3;

export interface MonthEndOutstanding {
  /** YYYY-MM */
  month: string;
  /** Rent owed at the month-end (this month: today), never counting the late-payment penalty. */
  outstanding: number;
  /** This month, measured today rather than at its month-end. */
  soFar: boolean;
}

/** Rent outstanding at the end of each of the last 12 months (from the contract's first month if later); this month as of today. */
export const monthlyOutstanding = (driver: Driver, now: Date = kualaLumpurNow()): MonthEndOutstanding[] => {
  const start = parseDate(driver.contractStartDate);
  if (isNaN(start.getTime()) || start > now) return [];
  const first = new Date(now.getFullYear(), now.getMonth() - (TREND_MONTHS - 1), 1);
  const from = start > first ? new Date(start.getFullYear(), start.getMonth(), 1) : first;
  const points: MonthEndOutstanding[] = [];
  for (let month = from; month <= now; month = new Date(month.getFullYear(), month.getMonth() + 1, 1)) {
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const soFar = monthEnd >= new Date(now.getFullYear(), now.getMonth(), now.getDate());
    points.push({
      month: isoDay(month).slice(0, 7),
      outstanding: round2(calculateDriverMetrics(driver, soFar ? now : monthEnd).principalOutstanding),
      soFar,
    });
  }
  return points;
};

export type OutstandingDirection = 'RISING' | 'FLAT' | 'FALLING' | 'NEW';

/**
 * Compares the last finished month-end with the month-end 3 months before it (or the first one, if later); this month's
 * point (as of today) is left out, since a few days' lateness on rent just fallen due would swing it. Rising or falling
 * once the balance has moved by more than a week's rent: more than one weekly rent (month-ends land on different
 * weekdays, so one weekly rent either way is a driver's usual few days' lateness), or at least monthly rent × 12 / 52.
 * NEW: fewer than two finished month-ends.
 */
export const outstandingDirection = (driver: Pick<Driver, 'rentalCycle' | 'rentalRate'>, points: MonthEndOutstanding[]): {
  direction: OutstandingDirection; change: number; months: number; from: string | null; to: string | null;
} => {
  const finished = points.filter(point => !point.soFar);
  if (finished.length < 2) return { direction: 'NEW', change: 0, months: 0, from: null, to: null };
  const latest = finished[finished.length - 1];
  const earlierIndex = Math.max(0, finished.length - 1 - DIRECTION_MONTHS);
  const earlier = finished[earlierIndex];
  const change = round2(latest.outstanding - earlier.outstanding);
  const rising = driver.rentalCycle === 'MONTHLY' ? change >= (driver.rentalRate * 12) / 52 : change > driver.rentalRate;
  const falling = driver.rentalCycle === 'MONTHLY' ? change <= -(driver.rentalRate * 12) / 52 : change < -driver.rentalRate;
  const direction: OutstandingDirection = change !== 0 && rising ? 'RISING' : change !== 0 && falling ? 'FALLING' : 'FLAT';
  return { direction, change, months: finished.length - 1 - earlierIndex, from: earlier.month, to: latest.month };
};

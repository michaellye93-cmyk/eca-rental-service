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
 * Rising or falling once the balance has moved by at least a week's rent (weekly rent, or monthly rent × 12 / 52) since
 * the month-end 3 months back, so falling one more rent behind reads as Rising on either cycle. NEW: one month only.
 */
export const outstandingDirection = (driver: Pick<Driver, 'rentalCycle' | 'rentalRate'>, points: MonthEndOutstanding[]): {
  direction: OutstandingDirection; change: number; months: number;
} => {
  if (points.length < 2) return { direction: 'NEW', change: 0, months: 0 };
  const latest = points[points.length - 1];
  const earlier = points[Math.max(0, points.length - 1 - DIRECTION_MONTHS)];
  const months = points.length - 1 - points.indexOf(earlier);
  const change = round2(latest.outstanding - earlier.outstanding);
  const weekOfRent = driver.rentalCycle === 'MONTHLY' ? (driver.rentalRate * 12) / 52 : driver.rentalRate;
  const threshold = Math.max(weekOfRent, 1);
  const direction: OutstandingDirection = change >= threshold ? 'RISING' : change <= -threshold ? 'FALLING' : 'FLAT';
  return { direction, change, months };
};

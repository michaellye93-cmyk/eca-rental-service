import { useMemo } from 'react';
import { Driver, DriverMetrics, DriverStatus } from '../../types';
import { calculateDriverMetrics, cashAtRiskOrder, kualaLumpurNow, outstandingDaysAgo, startOfMonthBaseline } from '../../utils';
import { driverAccount, type DriverAccount } from '../../services/driverAccount';

/** One driver as the admin list shows it: the account facts plus the row's balance, recovery and 7-day trend. */
export type DriverListItem = Driver & {
  account: DriverAccount;
  metrics: DriverMetrics;
  activeBalance: { baseValue: number; accruedInterest: number };
  recoveryBaseline: number;
  lateDays: number | null;
  debtTrend: { value: number; direction: 'UP' | 'DOWN' | 'FLAT'; raw: number; isStreak: boolean };
};

export type ListSort = { key: 'RISK_STATUS' | 'OUTSTANDING' | 'DEFAULT'; direction: 'asc' | 'desc' };
export const DEFAULT_LIST_SORT: ListSort = { key: 'DEFAULT', direction: 'desc' };
const STATUS_PRIORITY = { [DriverStatus.BAD]: 3, [DriverStatus.MID]: 2, [DriverStatus.GOOD]: 1 };

/** The driver list's order: by risk, by outstanding, or by default (cash at risk first: late alerts, then amount owed). */
export function compareForList(
  a: { name: string; lateDays: number | null; metrics: DriverMetrics; activeBalance: { baseValue: number } },
  b: { name: string; lateDays: number | null; metrics: DriverMetrics; activeBalance: { baseValue: number } },
  sort: ListSort,
): number {
  if (sort.key === 'RISK_STATUS') {
    const diff = STATUS_PRIORITY[b.metrics.status] - STATUS_PRIORITY[a.metrics.status];
    if (diff !== 0) return sort.direction === 'desc' ? diff : -diff;
    return b.metrics.cyclesOwed - a.metrics.cyclesOwed;
  }
  if (sort.key === 'OUTSTANDING') {
    const diff = b.activeBalance.baseValue - a.activeBalance.baseValue;
    if (diff !== 0) return sort.direction === 'desc' ? diff : -diff;
    return b.metrics.cyclesOwed - a.metrics.cyclesOwed;
  }
  // Default: cash at risk first (late alerts, longest late at the top), then amount owed
  return cashAtRiskOrder(
    { name: a.name, lateDays: a.lateDays, outstanding: a.activeBalance.baseValue },
    { name: b.name, lateDays: b.lateDays, outstanding: b.activeBalance.baseValue },
  );
}

/**
 * Every driver with the figures the list shows. Worked out again when the Kuala Lumpur day rolls over (`screeningDate`),
 * so days late and due dates move on overnight.
 */
export function useDriverListData(drivers: Driver[], screeningDate: string): DriverListItem[] {
  return useMemo(() => drivers.map((d): DriverListItem => {
    // The driver's account facts (the same ones the driver's phone page reads): status, weeks owed, last pay, due date
    const now = kualaLumpurNow();
    const account = driverAccount(d, now);
    const metrics = account.metrics;
    const activeBalance = { baseValue: metrics.principalOutstanding, accruedInterest: metrics.penaltyAmount };
    // The recovery bar compares today's balance with the balance at the end of last month
    const recoveryBaseline = calculateDriverMetrics(d, startOfMonthBaseline(now)).principalOutstanding;
    // Late-alert days drive the list's default order (delisted drivers are never late alerts)
    const lateDays = account.lateDays;


    // --- DEBT TREND INDICATOR (VIRTUAL SNAPSHOT LOGIC) ---
    // Role: Senior Database Engineer
    // Action: Simulating a "Snapshot Table" by calculating historical state on-the-fly.
    // This ensures immediate trend availability without waiting for a cron job.

    // 1. Current Snapshot (Base Only)
    const currentDebt = metrics.principalOutstanding;

    // 2. Historical Snapshot (7 Days Ago): base principal at the end of that day
    const lastWeekDebt = outstandingDaysAgo(d, 7);

    // 3. Trend Calculation
    const trendValue = currentDebt - lastWeekDebt;
    const isDebtIncreasing = trendValue > 0;
    const isDebtDecreasing = trendValue < 0;

    // 4. Debt Streak Calculation (3-Week Increase)
    const debt14 = outstandingDaysAgo(d, 14);
    const debt21 = outstandingDaysAgo(d, 21);

    // Logic: Debt must be strictly increasing week-over-week
    const inc1 = currentDebt > lastWeekDebt;
    const inc2 = lastWeekDebt > debt14;
    const inc3 = debt14 > debt21;

    // Trigger warning if debt has increased for 3 consecutive weeks AND current debt is significant (> 0)
    const isDebtStreak = inc1 && inc2 && inc3 && currentDebt > 0;

    return {
        ...d,
        account,
        metrics,
        activeBalance, // Exposed for UI
        recoveryBaseline,
        lateDays,
        debtTrend: {
            value: Math.abs(trendValue),
            direction: isDebtIncreasing ? 'UP' : isDebtDecreasing ? 'DOWN' : 'FLAT',
            raw: trendValue,
            isStreak: isDebtStreak
        }
    };
    // screeningDate is the Kuala Lumpur day: a new day works the figures out again
  }), [drivers, screeningDate]);
}

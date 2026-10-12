import type { Driver, DriverMetrics, DriverStatus } from '../types.ts';
import {
  calculateDriverMetrics, generateDriverInvoices, getNextDueDate, lastPayment as latestPayment, lastPayWarning, lateAlertDays, overdueRent,
  parseDate, portalPenalty,
} from '../utils.ts';

/**
 * One driver's account position, worked out once from the shared rent schedule in utils.ts: the facts the driver's phone
 * page (driverPortalView, in its three languages), the admin driver row and the collection worklist all read, so they
 * show the same numbers and dates. It holds no sentences: each screen words the facts itself. Calendar days are
 * YYYY-MM-DD, so the facts are the same whatever the time of day they are read.
 */
export interface DriverAccount {
  /** The rent engine's own figures (the admin list sorts on them; the penalty projection comes from them). */
  metrics: DriverMetrics;
  /** Rent owed now, rent falling due today included (never the penalty). */
  owed: number;
  /** Rent that fell due before today and is still unpaid. */
  overdue: number;
  status: DriverStatus;
  /** Rent cycles owed (owed / rent), unrounded. */
  cyclesOwed: number;
  /** The oldest rent due on or before today that is unpaid or part-paid; null when none is. */
  oldestUnpaidDueDate: string | null;
  /** When rent is next due: the oldest rent still unpaid, else the next cycle while the contract runs (the admin row's
   * "Due" date and the phone page's up-to-date message). */
  dueDate: string | null;
  /** Rent falling due today and what is still unpaid of it; null when none falls due today. */
  dueToday: { amount: number; unpaid: number } | null;
  /** The next rents due after today and still to pay (part-paid ones at what is left), up to three; none once delisted. */
  upcoming: { date: string; amount: number }[];
  /** The first of `upcoming`. */
  nextDue: { date: string; amount: number } | null;
  /** Days late as the late alerts count them; null when delisted or no rent is late yet. */
  lateDays: number | null;
  /** The latest payment record of any kind (it can be dated after today), and whole days since it. */
  lastPayment: { date: string; days: number } | null;
  /** The admin row's "Last pay" warning (see lastPayWarning). */
  payWarning: { days: number; kind: 'overdue' | 'withoutPayment' } | null;
  /** The latest day the driver paid cash, up to today, with that day's transfers added together (a service claim alone
   * is not a payment the driver made): the phone page thanks it. */
  lastCashPayment: { date: string; amount: number } | null;
  /** One manageable step while rent is owed: pay `amount` to bring the balance down to `leaves`, the next whole rent
   * (0 when it clears everything). */
  nextStep: { amount: number; leaves: number } | null;
  /** Contract progress, never counting past the contract length; null when delisted or no length is recorded. */
  progress: { shown: number; length: number; percent: number; pastLength: boolean } | null;
  /** The late-payment penalty (18% p.a. projection) the phone page shows while rent is owed; never in the office figures. */
  penalty: { total: number; addedToday: number } | null;
}

const UPCOMING_COUNT = 3;

const isoDay = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const endOfDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
const round2 = (amount: number) => Math.round(amount * 100) / 100;

/** The driver's account position at `now` (Kuala Lumpur wall-clock time; only its calendar day matters). */
export function driverAccount(driver: Driver, now: Date): DriverAccount {
  const metrics = calculateDriverMetrics(driver, now);
  const owed = Math.max(0, metrics.principalOutstanding);
  const today = isoDay(now);
  const todayEnd = endOfDay(now);
  const rate = driver.rentalRate;

  const due = getNextDueDate(driver, now);
  const dueDate = due ? isoDay(due) : null;
  const cycles = generateDriverInvoices(driver, now);
  const dueTodayCycle = cycles.find(invoice => invoice.dueDate === today) ?? null;

  let nextStep: DriverAccount['nextStep'] = null;
  if (owed > 0.01 && rate > 0) {
    const nextLevel = (Math.ceil(owed / rate - 1e-9) - 1) * rate;
    nextStep = nextLevel <= 0.01 ? { amount: owed, leaves: 0 } : { amount: owed - nextLevel, leaves: nextLevel };
  }

  let upcoming: DriverAccount['upcoming'] = [];
  if (!driver.isDelisted && !isNaN(parseDate(driver.contractStartDate).getTime())) {
    const horizon = new Date(todayEnd);
    if (driver.rentalCycle === 'MONTHLY') horizon.setMonth(horizon.getMonth() + UPCOMING_COUNT + 1);
    else horizon.setDate(horizon.getDate() + 7 * (UPCOMING_COUNT + 1));
    upcoming = generateDriverInvoices(driver, now, horizon)
      // Rent already paid ahead is not due again; a part-paid cycle shows what is left
      .filter(invoice => parseDate(invoice.dueDate) > todayEnd && invoice.remainingBalance > 0.01)
      .slice(0, UPCOMING_COUNT)
      .map(invoice => ({ date: invoice.dueDate, amount: invoice.remainingBalance }));
  }

  const cashByDay = new Map<string, number>();
  for (const payment of driver.paymentHistory || []) {
    const day = parseDate(payment.date);
    if (payment.amount > 0 && !isNaN(day.getTime()) && day <= todayEnd) {
      cashByDay.set(payment.date, (cashByDay.get(payment.date) ?? 0) + payment.amount);
    }
  }
  const latestCashDay = [...cashByDay.keys()].sort((a, b) => parseDate(b).getTime() - parseDate(a).getTime())[0];

  const last = latestPayment(driver, now);
  return {
    metrics,
    owed,
    overdue: overdueRent(driver, now),
    status: metrics.status,
    cyclesOwed: metrics.cyclesOwed,
    oldestUnpaidDueDate: cycles.find(invoice => invoice.remainingBalance > 0.01 && parseDate(invoice.dueDate) <= todayEnd)?.dueDate ?? null,
    dueDate,
    dueToday: dueTodayCycle ? { amount: dueTodayCycle.amount, unpaid: round2(dueTodayCycle.remainingBalance) } : null,
    upcoming,
    nextDue: upcoming[0] ?? null,
    lateDays: driver.isDelisted ? null : lateAlertDays(driver, now),
    lastPayment: last ? { date: isoDay(last.date), days: last.days } : null,
    payWarning: lastPayWarning(driver, now),
    lastCashPayment: latestCashDay ? { date: isoDay(parseDate(latestCashDay)), amount: cashByDay.get(latestCashDay)! } : null,
    nextStep,
    progress: !driver.isDelisted && driver.contractDuration > 0 ? {
      shown: Math.min(metrics.cyclesElapsed, driver.contractDuration),
      length: driver.contractDuration,
      percent: Math.round(metrics.progressPercent),
      pastLength: metrics.cyclesElapsed > driver.contractDuration,
    } : null,
    penalty: portalPenalty(metrics),
  };
}

import { DriverStatus } from './types.ts';
import type { Driver, DriverMetrics, Invoice, PaymentTransaction } from './types.ts';

export const parseDate = (dateVal: string | Date | number | null | undefined): Date => {
  if (!dateVal) return new Date(NaN);
  if (dateVal instanceof Date) return dateVal;
  const str = String(dateVal).trim();
  if (!str) return new Date(NaN);
  if (str.length === 10 && !str.includes('T')) {
    return new Date(str + 'T00:00:00');
  }
  return new Date(str);
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The current wall-clock time in Kuala Lumpur as a local Date: the app's business clock. */
export const kualaLumpurNow = (): Date => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));

/** Today's calendar date in Kuala Lumpur as YYYY-MM-DD, whatever time zone the computer is set to. */
export const kualaLumpurToday = (now: Date = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};

/** The calendar month before the one containing `isoDate` (YYYY-MM-DD), as YYYY-MM. */
export const previousMonth = (isoDate: string): string => {
  const [year, month] = isoDate.split('-').map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
};

/** A calendar date as shown on screen, e.g. "04 Sept 2026"; `fallback` when the value is missing or invalid. */
export const formatDate = (value: string | Date | null | undefined, fallback = '—'): string => {
  const date = parseDate(value);
  return isNaN(date.getTime()) ? fallback : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const endOfDay = (value: Date): Date => {
  const end = new Date(value);
  end.setHours(23, 59, 59, 999);
  return end;
};

/**
 * Due date of rent cycle `index`, anchored to the contract start: weekly every 7 days; monthly on the start date's day
 * each month, or the last day of a month without that day (a 31 Jan start falls due 28 Feb, 31 Mar, 30 Apr, ...).
 */
const dueDateOf = (start: Date, cycle: Driver['rentalCycle'], index: number): Date => {
  if (cycle === 'MONTHLY') {
    const lastDay = new Date(start.getFullYear(), start.getMonth() + index + 1, 0).getDate();
    return new Date(start.getFullYear(), start.getMonth() + index, Math.min(start.getDate(), lastDay));
  }
  const due = new Date(start);
  due.setDate(start.getDate() + index * 7);
  return due;
};

/** Rent stops before the contract end date or the effective delist date, whichever comes first. */
const accrualStop = (driver: Driver): Date | null => {
  const candidates = [driver.contractEndDate];
  if (driver.isDelisted) candidates.push(driver.delistDate || driver.contractEndDate || driver.contractStartDate);
  const stops = candidates.filter(Boolean).map(parseDate).filter(date => !isNaN(date.getTime()));
  return stops.length ? new Date(Math.min(...stops.map(date => date.getTime()))) : null;
};

interface RentObligation {
  index: number;
  dueDate: Date;
  allocations: { date: Date; amount: number }[];
  remaining: number;
}

const MAX_RENT_CYCLES = 5000;

/**
 * The single rent schedule behind balances, invoices and due dates.
 * Rent falls due each cycle from the contract start and keeps accruing past the recorded contract
 * length until an end date or delist. Cash and service claims dated on or before the reference day
 * settle the oldest obligations first. With `includeUpcoming`, obligations not yet due within the
 * recorded contract length are listed too and receive any advance payment. A `horizon` also lists every
 * obligation falling due up to that day (past the recorded length too, until an end date or delist); payments
 * still count only up to the reference day.
 */
const buildRentSchedule = (driver: Driver, referenceDate: Date, includeUpcoming: boolean, horizon?: Date): RentObligation[] => {
  const start = parseDate(driver.contractStartDate);
  if (isNaN(start.getTime())) return [];
  const referenceEnd = endOfDay(referenceDate);
  const horizonEnd = horizon ? endOfDay(horizon) : null;
  const stop = accrualStop(driver);
  const recordedLength = Number.isFinite(driver.contractDuration) ? driver.contractDuration : 0;
  const payments = (driver.paymentHistory || [])
    .map(p => ({ date: parseDate(p.date), amount: p.amount + (p.serviceClaim || 0) }))
    .filter(p => p.date <= referenceEnd)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const obligations: RentObligation[] = [];
  for (let index = 0; index < MAX_RENT_CYCLES; index++) {
    const dueDate = dueDateOf(start, driver.rentalCycle, index);
    if (stop && dueDate >= stop) break;
    const withinHorizon = horizonEnd !== null && dueDate <= horizonEnd;
    if (dueDate > referenceEnd && !withinHorizon && (!includeUpcoming || index >= recordedLength)) break;
    let remaining = driver.rentalRate;
    const allocations: RentObligation['allocations'] = [];
    while (remaining > 0.01 && payments.length) {
      const payment = payments[0];
      const amount = Math.min(remaining, payment.amount);
      allocations.push({ date: payment.date, amount });
      remaining -= amount;
      payment.amount -= amount;
      if (payment.amount <= 0.01) payments.shift();
    }
    obligations.push({ index, dueDate, allocations, remaining });
  }
  return obligations;
};

const isoDay = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export interface RentAllocation { paymentDate: string; dueDate: string | null; amount: number }

/**
 * What each payment (cash plus service claim) settled under the rent schedule, as of the reference day: the due date of
 * the rent it paid, oldest first. Money left over once every listed cycle is paid has no due date (paid ahead).
 */
export const rentAllocations = (driver: Driver, referenceDate: Date = kualaLumpurNow()): RentAllocation[] => {
  const settled: RentAllocation[] = buildRentSchedule(driver, referenceDate, true).flatMap(obligation =>
    obligation.allocations.map(allocation => ({ paymentDate: isoDay(allocation.date), dueDate: isoDay(obligation.dueDate), amount: allocation.amount })));
  const referenceEnd = endOfDay(referenceDate);
  const paidByDay = new Map<string, number>();
  for (const payment of driver.paymentHistory || []) {
    const date = parseDate(payment.date);
    if (isNaN(date.getTime()) || date > referenceEnd) continue;
    paidByDay.set(isoDay(date), (paidByDay.get(isoDay(date)) ?? 0) + payment.amount + (payment.serviceClaim || 0));
  }
  for (const allocation of settled) paidByDay.set(allocation.paymentDate, (paidByDay.get(allocation.paymentDate) ?? 0) - allocation.amount);
  const leftover = [...paidByDay].filter(([, amount]) => amount > 0.01).map(([paymentDate, amount]) => ({ paymentDate, dueDate: null, amount: Math.round(amount * 100) / 100 }));
  return [...settled, ...leftover].sort((a, b) => a.paymentDate.localeCompare(b.paymentDate) || Number(a.dueDate === null) - Number(b.dueDate === null));
};

/** Rent cycles owed at which a driver turns BAD: 3 weeks of weekly rent, 1.1 months of monthly rent (MID below it). */
export const badThresholdCycles = (cycle: Driver['rentalCycle']): number => (cycle === 'MONTHLY' ? 1.1 : 3);

export const calculateDriverMetrics = (driver: Driver, referenceDate: Date = kualaLumpurNow()): DriverMetrics => {
  const now = endOfDay(referenceDate);
  const obligations = buildRentSchedule(driver, referenceDate, false);
  const cyclesElapsed = obligations.length;

  // The penalty is a projection compounding daily at 18% p.a. It starts on the second day after the
  // due date (due 1 Jan: first penalty day 3 Jan) and is never part of totalOutstanding.
  const dailyRate = 0.18 / 365;
  const gracePeriodDays = 1;
  let totalPenalty = 0;
  let totalDailyInterest = 0;
  let principalOutstanding = 0;

  for (const obligation of obligations) {
    const penaltyStartDate = new Date(obligation.dueDate);
    penaltyStartDate.setDate(penaltyStartDate.getDate() + gracePeriodDays);
    for (const allocation of obligation.allocations) {
      const daysLate = Math.ceil((allocation.date.getTime() - penaltyStartDate.getTime()) / DAY_MS);
      if (allocation.date > penaltyStartDate && daysLate > 0) {
        totalPenalty += allocation.amount * (Math.pow(1 + dailyRate, daysLate) - 1);
      }
    }
    if (obligation.remaining > 0.01) {
      principalOutstanding += obligation.remaining;
      const daysLate = Math.ceil((now.getTime() - penaltyStartDate.getTime()) / DAY_MS);
      if (now > penaltyStartDate && daysLate > 0) {
        const currentDebt = obligation.remaining * Math.pow(1 + dailyRate, daysLate);
        totalPenalty += currentDebt - obligation.remaining;
        totalDailyInterest += currentDebt * dailyRate;
      }
    }
  }

  const cyclesOwed = driver.rentalRate > 0 ? principalOutstanding / driver.rentalRate : 0;
  const badThreshold = badThresholdCycles(driver.rentalCycle);
  let status: DriverStatus = DriverStatus.GOOD;
  if (cyclesOwed >= badThreshold) status = DriverStatus.BAD;
  else if (cyclesOwed > 0) status = DriverStatus.MID;

  return {
    cyclesElapsed,
    expectedPayment: cyclesElapsed * driver.rentalRate,
    principalOutstanding,
    penaltyAmount: totalPenalty,
    totalOutstanding: principalOutstanding, // Base only: the admin view never includes the penalty projection
    cyclesOwed,
    status,
    progressPercent: Math.min(100, Math.max(0, (cyclesElapsed / driver.contractDuration) * 100)),
    dailyInterest: totalDailyInterest
  };
};

/** A normal rental (SEWA BIASA), however the category is written. No category counts as rent-to-own (SEWABELI). */
export const isSewaBiasa = (driver: Pick<Driver, 'category'>) => (driver.category || '').toUpperCase().replace(/\s+/g, '_') === 'SEWA_BIASA';

/**
 * The late-payment penalty every driver sees in their portal while rent is owed, whatever the rental category: the
 * 18% p.a. projection above and what it adds today. The office's figures never include it.
 */
export const portalPenalty = (metrics: Pick<DriverMetrics, 'principalOutstanding' | 'penaltyAmount' | 'dailyInterest'>) =>
  metrics.principalOutstanding <= 0 ? null : { total: metrics.penaltyAmount, addedToday: metrics.dailyInterest };

const ringgit = new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', minimumFractionDigits: 2 });

export const formatCurrency = (amount: number) => ringgit.format(amount);

export const calculateMomentum = (driver: Driver) => {
    // 1. Sort Payments by Date Ascending
    const payments = [...driver.paymentHistory].sort((a,b) => parseDate(a.date).getTime() - parseDate(b.date).getTime());
    
    // Default safe values for new drivers
    if (payments.length === 0) return { avgLateness: 0, lastLateness: 0, velocity: 0, isSlipping: false, trend: 'STAGNANT', isPerfect: false };

    const startDate = parseDate(driver.contractStartDate);
    
    // LOGIC: Map N-th payment transaction to N-th cycle due date
    const latenessData = payments.map((p, index) => {
        // Expected due date: the schedule's due date for the N-th cycle
        const expectedDate = dueDateOf(startDate, driver.rentalCycle, index);
        
        const actualDate = parseDate(p.date);
        const diffTime = actualDate.getTime() - expectedDate.getTime();
        // Calculate days late (can be negative if paid early)
        return Math.ceil(diffTime / (1000 * 3600 * 24));
    });

    const totalLateness = latenessData.reduce((acc, val) => acc + val, 0);
    const avgLateness = latenessData.length > 0 ? totalLateness / latenessData.length : 0;
    const lastLateness = latenessData.length > 0 ? latenessData[latenessData.length - 1] : 0;
    
    // Velocity: How much worse (or better) the last payment was compared to average
    const velocity = lastLateness - avgLateness;
    
    // Trigger: If last payment is 3+ days later than their average
    const isSlipping = velocity >= 3; 

    // Trend Icon Logic
    let trend = 'STAGNANT'; // ➡️
    if (velocity >= 3) trend = 'DETERIORATING'; // 📉 Paying later than avg
    else if (velocity <= -3) trend = 'IMPROVING'; // 📈 Paying earlier than avg
    else trend = 'STAGNANT';
    
    // Perfect check: Avg lateness is <= 0 (mostly early/on-time) AND not currently slipping
    const isPerfect = avgLateness <= 0 && velocity <= 0;
    if (isPerfect) trend = 'PERFECT';

    return { avgLateness, lastLateness, velocity, isSlipping, trend, isPerfect };
};

/**
 * The driver's rent cycles with what has been paid on each, as of the reference day. With a `horizon`, cycles falling
 * due after today up to that day are listed too (FUTURE unless paid in advance), for targets and forecasts.
 */
export const generateDriverInvoices = (driver: Driver, referenceDate: Date = kualaLumpurNow(), horizon?: Date): Invoice[] => {
  const referenceEnd = endOfDay(referenceDate);
  return buildRentSchedule(driver, referenceDate, true, horizon).map(obligation => {
    const amountPaid = obligation.allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
    let status: Invoice['status'] = 'UNPAID';
    if (obligation.remaining <= 0.01) status = 'PAID';
    else if (amountPaid > 0) status = 'PARTIAL';
    else if (obligation.dueDate > referenceEnd) status = 'FUTURE';
    const due = obligation.dueDate;
    return {
      id: `${driver.id}_${obligation.index}`,
      driverId: driver.id,
      cycleIndex: obligation.index,
      dueDate: `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`,
      amount: driver.rentalRate,
      amountPaid,
      remainingBalance: obligation.remaining > 0.01 ? obligation.remaining : 0,
      status
    };
  });
};

/**
 * The principal outstanding at the end of the day `days` days before `now`: the driver list's "in 7 days" change is
 * today's outstanding less this.
 */
export const outstandingDaysAgo = (driver: Driver, days: number, now: Date = kualaLumpurNow()): number => {
  const then = new Date(now);
  then.setDate(then.getDate() - days);
  then.setHours(23, 59, 59, 999);
  return calculateDriverMetrics(driver, then).principalOutstanding;
};

/** The Monday-to-Sunday week containing `day`, as calendar days (midnight): the weekly target's period. */
export const mondayToSunday = (day: Date): { start: Date; end: Date } => {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate() - ((day.getDay() + 6) % 7));
  return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6) };
};

/** The next rent due date: the oldest obligation not fully paid, or the next cycle while the contract continues. */
export const getNextDueDate = (driver: Driver, referenceDate: Date = kualaLumpurNow()): Date | null => {
  const schedule = buildRentSchedule(driver, referenceDate, true);
  const unpaid = schedule.find(obligation => obligation.remaining > 0.01);
  if (unpaid) return unpaid.dueDate;
  const start = parseDate(driver.contractStartDate);
  if (isNaN(start.getTime())) return null;
  const next = dueDateOf(start, driver.rentalCycle, schedule.length ? schedule[schedule.length - 1].index + 1 : 0);
  const stop = accrualStop(driver);
  return stop && next >= stop ? null : next;
};

/** The `count` most recent obligations due on or before the reference day, newest first. */
export const latestInvoices = (driver: Driver, referenceDate: Date = kualaLumpurNow(), count = 6): Invoice[] => {
  const referenceEnd = endOfDay(referenceDate);
  return generateDriverInvoices(driver, referenceDate)
    .filter(invoice => parseDate(invoice.dueDate) <= referenceEnd)
    .slice(-count)
    .reverse();
};

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
const daysBetween = (from: Date, to: Date): number =>
  Math.round((new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime() - new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()) / DAY_MS);

/** Late alerts, and the driver list's warning on monthly rent, start this many days late. */
export const LATE_ALERT_DAYS = 8;

/**
 * Monthly rent: whole days since the oldest rent still unpaid or part-paid fell due, from the shared rent schedule.
 * Null when no rent is owed yet.
 */
export const monthlyOverdueDays = (driver: Driver, referenceDate: Date = kualaLumpurNow()): number | null => {
  const referenceEnd = endOfDay(referenceDate);
  const oldestUnpaid = generateDriverInvoices(driver, referenceDate)
    .find(invoice => invoice.remainingBalance > 0.01 && parseDate(invoice.dueDate) <= referenceEnd);
  return oldestUnpaid ? daysBetween(parseDate(oldestUnpaid.dueDate), referenceDate) : null;
};

export interface LastPayment {
  /** The latest readable payment date, whatever order the payments are listed in (it can be later than today). */
  date: Date;
  /** Whole days from that date to the reference day (negative when it is later). */
  days: number;
}

/** The driver's latest payment with a readable date, or null when there is none. */
export const lastPayment = (driver: Driver, referenceDate: Date = kualaLumpurNow()): LastPayment | null => {
  const date = (driver.paymentHistory || []).reduce<Date | null>((latest, payment) => {
    const paid = parseDate(payment.date);
    return !isNaN(paid.getTime()) && (!latest || paid > latest) ? paid : latest;
  }, null);
  if (!date) return null;
  return { date, days: daysBetween(date, referenceDate) };
};

/**
 * The driver list's "Last pay" warning, or null when there is none. Weekly rent: LATE_ALERT_DAYS or more days since the
 * latest payment, the day the driver joins the late alerts (none before the first payment). Monthly rent: the late-alert rule, the oldest rent still unpaid or
 * part-paid is LATE_ALERT_DAYS or more past its due date, with or without a payment.
 */
export const lastPayWarning = (driver: Driver, referenceDate: Date = kualaLumpurNow()): { days: number; kind: 'overdue' | 'withoutPayment' } | null => {
  if (driver.rentalCycle === 'MONTHLY') {
    const overdue = monthlyOverdueDays(driver, referenceDate);
    return overdue !== null && overdue >= LATE_ALERT_DAYS ? { days: overdue, kind: 'overdue' } : null;
  }
  const last = lastPayment(driver, referenceDate);
  return last && last.days >= LATE_ALERT_DAYS ? { days: last.days, kind: 'withoutPayment' } : null;
};

/**
 * Whole days since the driver's latest payment (as lastPayment counts them), or since the contract start when none
 * has been made (negative for a contract that has not started). Null when neither date is valid.
 */
export const daysSinceLastPayment = (driver: Driver, referenceDate: Date = kualaLumpurNow()): number | null => {
  const last = lastPayment(driver, referenceDate);
  if (last) return last.days;
  const start = parseDate(driver.contractStartDate);
  return isNaN(start.getTime()) ? null : daysBetween(start, referenceDate);
};

/**
 * How long a driver has been late, as the dashboard's late alerts count it. Monthly rent: days since the oldest rent
 * still unpaid or part-paid fell due (null when none is due yet). Weekly rent: days since the latest payment, or since
 * the contract start when none has been made.
 */
export const lateAlertDays = (driver: Driver, referenceDate: Date = kualaLumpurNow()): number | null =>
  driver.rentalCycle === 'MONTHLY' ? monthlyOverdueDays(driver, referenceDate) : daysSinceLastPayment(driver, referenceDate);

/** The dashboard's late alerts: active drivers late by LATE_ALERT_DAYS or more (see lateAlertDays), longest first. */
export const buildLateAlerts = <T extends Driver>(drivers: T[], referenceDate: Date = kualaLumpurNow()): { driver: T; days: number }[] =>
  drivers
    .flatMap(driver => {
      const days = driver.isDelisted ? null : lateAlertDays(driver, referenceDate);
      return days !== null && days >= LATE_ALERT_DAYS ? [{ driver, days }] : [];
    })
    .sort((a, b) => b.days - a.days);

/**
 * Rent that fell due before the reference day and is still unpaid, from the shared rent schedule. Rent falling due on the
 * day itself is not overdue yet, so a due day does not look like growth before the day's transfers arrive.
 */
export const overdueRent = (driver: Driver, referenceDate: Date = kualaLumpurNow()): number => {
  const dayStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  return generateDriverInvoices(driver, referenceDate)
    .filter(invoice => parseDate(invoice.dueDate) < dayStart)
    .reduce((sum, invoice) => sum + invoice.remainingBalance, 0);
};

/** What the driver list's default order needs about a driver: late-alert days (null when delisted or unknown) and balance. */
export interface CashAtRiskKey {
  name: string;
  lateDays: number | null;
  outstanding: number;
}

/**
 * The driver list's default order, cash at risk first: late alerts (LATE_ALERT_DAYS or more) with the longest late at
 * the top, then everyone else by amount owed, then by name.
 */
export const cashAtRiskOrder = (a: CashAtRiskKey, b: CashAtRiskKey): number => {
  const aLate = a.lateDays !== null && a.lateDays >= LATE_ALERT_DAYS;
  const bLate = b.lateDays !== null && b.lateDays >= LATE_ALERT_DAYS;
  if (aLate !== bLate) return aLate ? -1 : 1;
  if (aLate && bLate && a.lateDays !== b.lateDays) return (b.lateDays as number) - (a.lateDays as number);
  if (b.outstanding !== a.outstanding) return b.outstanding - a.outstanding;
  return a.name.localeCompare(b.name);
};

/** The moment the driver list's recovery bar measures from: the end of the month before the reference day. */
export const startOfMonthBaseline = (referenceDate: Date): Date =>
  new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 0, 23, 59, 59, 999);

/**
 * Rent of active drivers falling due between `from` and `to` (inclusive days), and how much of it has been paid by the
 * reference day. Every cycle due in the period counts from day one, including cycles after the recorded contract length.
 */
export const rentDueAndPaid = (drivers: Driver[], from: Date, to: Date, referenceDate: Date = kualaLumpurNow()): { due: number; paid: number } => {
  let due = 0;
  let paid = 0;
  for (const driver of drivers) {
    if (driver.isDelisted) continue;
    for (const invoice of generateDriverInvoices(driver, referenceDate, to)) {
      const date = parseDate(invoice.dueDate);
      if (date >= from && date <= to) {
        due += invoice.amount;
        paid += invoice.amountPaid;
      }
    }
  }
  return { due, paid };
};

/** Recorded contract length implied by the start and end dates (months approximated as 30 days). */
export const contractCyclesBetween = (startDate: string, endDate: string, cycle: Driver['rentalCycle']): number | null => {
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  if (!startDate || !endDate || isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return null;
  const days = Math.ceil((end.getTime() - start.getTime()) / DAY_MS);
  return Math.ceil(days / (cycle === 'MONTHLY' ? 30 : 7));
};

/** Malaysian NRIC as typed: digits only, at most 12, hyphenated as XXXXXX-XX-XXXX. */
export const formatNric = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 12);
  if (digits.length > 8) return `${digits.slice(0, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`;
  if (digits.length > 6) return `${digits.slice(0, 6)}-${digits.slice(6)}`;
  return digits;
};

/** The driver (active or delisted) whose NRIC has the same digits, ignoring dashes and spaces. */
export const driverWithNric = <T extends { nric: string }>(drivers: T[], nric: string): T | undefined => {
  const digits = (nric || '').replace(/\D/g, '');
  return digits ? drivers.find(d => (d.nric || '').replace(/\D/g, '') === digits) : undefined;
};

/** A row of the payments table (only the columns the app reads). */
export interface PaymentRow {
  id: string;
  date: string;
  amount: number | string;
  service_claim?: number | string | null;
  payment_method?: string | null;
  reference?: string | null;
}

/** A payments row as the app's payment: no claim and bank transfer when those columns are empty; a reference only when typed. */
export const paymentFromRow = (row: PaymentRow): PaymentTransaction => ({
  id: String(row.id),
  date: row.date,
  amount: Number(row.amount) || 0,
  serviceClaim: Number(row.service_claim ?? 0) || 0,
  paymentMethod: (row.payment_method || 'BANK TRANSFER') as PaymentTransaction['paymentMethod'],
  ...(row.reference ? { reference: row.reference } : {}),
});

/**
 * A driver profile with its payments attached: newest first, the cash-plus-claims total, and the payment-timing
 * figures the list sorts on. Used for the full load and for updating one driver after a payment is saved.
 */
export const withPayments = (profile: Omit<Driver, 'totalAmountPaid' | 'paymentHistory'>, payments: PaymentTransaction[]): Driver => {
  const paymentHistory = [...payments].sort((a, b) => parseDate(b.date).getTime() - parseDate(a.date).getTime());
  const driver: Driver = {
    ...profile,
    totalAmountPaid: paymentHistory.reduce((sum, p) => sum + p.amount + (p.serviceClaim || 0), 0),
    paymentHistory,
  };
  const momentum = calculateMomentum(driver);
  return { ...driver, avgDaysLate: momentum.avgLateness, lastDaysLate: momentum.lastLateness, performanceVelocity: momentum.velocity };
};

/** A row of the drivers table (only the columns the app reads or writes). */
export interface DriverRow {
  id: string;
  nric: string;
  email?: string | null;
  phone?: string | null;
  name: string;
  address?: string | null;
  car_plate: string;
  contract_start_date: string;
  contract_end_date?: string | null;
  category?: Driver['category'] | null;
  rental_cycle?: Driver['rentalCycle'] | null;
  contract_duration_weeks: number;
  rental_rate: number;
  is_delisted?: boolean | null;
  delist_date?: string | null;
  tags?: string[] | null;
  whatsapp_group?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
}

/** The profile and contract columns written when a driver is created or edited. */
export const toDriverRow = (driver: Driver) => ({
  nric: driver.nric,
  email: driver.email || null,
  name: driver.name,
  address: driver.address || null,
  car_plate: normalizePlate(driver.carPlate),
  contract_start_date: driver.contractStartDate,
  contract_end_date: driver.contractEndDate || null,
  category: driver.category || 'SEWABELI',
  rental_cycle: driver.rentalCycle,
  contract_duration_weeks: driver.contractDuration,
  rental_rate: driver.rentalRate,
  tags: driver.tags,
  // Written only when set or being cleared, so saving a driver never depends on these columns otherwise
  ...(driver.phone !== undefined ? { phone: driver.phone || null } : {}),
  ...(driver.whatsappGroup !== undefined ? { whatsapp_group: driver.whatsappGroup.trim() || null } : {}),
  ...(driver.emergencyContactName !== undefined ? { emergency_contact_name: driver.emergencyContactName.trim() || null } : {}),
  ...(driver.emergencyContactPhone !== undefined ? { emergency_contact_phone: driver.emergencyContactPhone.trim() || null } : {}),
});

/** A drivers row as the app's driver profile; payments and totals are attached by the caller. */
export const fromDriverRow = (row: DriverRow): Omit<Driver, 'totalAmountPaid' | 'paymentHistory'> => ({
  id: row.id,
  nric: row.nric,
  email: row.email ?? undefined,
  name: row.name,
  address: row.address ?? undefined,
  carPlate: row.car_plate,
  contractStartDate: row.contract_start_date,
  contractEndDate: row.contract_end_date ?? undefined,
  category: row.category ?? undefined,
  rentalCycle: row.rental_cycle || 'WEEKLY',
  contractDuration: row.contract_duration_weeks,
  rentalRate: row.rental_rate,
  isDelisted: row.is_delisted ?? undefined,
  delistDate: row.delist_date ?? undefined,
  tags: row.tags || [],
  ...(row.phone ? { phone: row.phone } : {}),
  ...(row.whatsapp_group ? { whatsappGroup: row.whatsapp_group } : {}),
  ...(row.emergency_contact_name ? { emergencyContactName: row.emergency_contact_name } : {}),
  ...(row.emergency_contact_phone ? { emergencyContactPhone: row.emergency_contact_phone } : {}),
});

/**
 * A Malaysian phone number as stored for WhatsApp: 60 followed by 8 to 11 digits. Accepts 012-345 6789, +60 12-345 6789,
 * 60123456789 and similar; returns null for anything else.
 */
export const normalizeMalaysianPhone = (typed: string): string | null => {
  const digits = typed.replace(/\D/g, '');
  const rest = digits.startsWith('60') ? digits.slice(2) : digits.startsWith('0') ? digits.slice(1) : digits;
  return rest.length >= 8 && rest.length <= 11 && /^[1-9]/.test(rest) ? `60${rest}` : null;
};

/** A stored number for display: mobile numbers as +60 12-345 6789 or +60 11-2345 6789, others as +60 and the digits. */
export const formatPhone = (stored: string): string => {
  const rest = stored.startsWith('60') ? stored.slice(2) : stored;
  if (/^1\d{8}$/.test(rest)) return `+60 ${rest.slice(0, 2)}-${rest.slice(2, 5)} ${rest.slice(5)}`;
  if (/^1\d{9}$/.test(rest)) return `+60 ${rest.slice(0, 2)}-${rest.slice(2, 6)} ${rest.slice(6)}`;
  return `+60 ${rest}`;
};

/** A WhatsApp chat link for a stored number, with an optional message the sender can edit before sending. */
export const whatsappLink = (stored: string, message?: string): string =>
  `https://wa.me/${stored}${message ? `?text=${encodeURIComponent(message)}` : ''}`;

/**
 * A car plate as stored: capitals without spaces, e.g. "xaa 1001" as XAA1001. This is also Finance's vehicle key
 * (upper case, whitespace removed), so hyphens and other characters are kept.
 */
export const normalizePlate = (typed: string): string => (typed || '').toUpperCase().replace(/\s+/g, '');

/** A plate for reading, with a space where letters meet digits: XAA1001 as "XAA 1001". */
export const displayPlate = (plate: string): string => normalizePlate(plate).replace(/(?<=[A-Z])(?=\d)|(?<=\d)(?=[A-Z])/g, ' ');

/** Whether a search term matches a plate, either typed with or without spaces. */
export const plateMatches = (plate: string, term: string): boolean => {
  const wanted = normalizePlate(term);
  return wanted !== '' && normalizePlate(plate).includes(wanted);
};

const WEEKDAY_TAGS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const isDayTag = (tag: string) => tag.trim().toUpperCase() === 'MONTHLY' || (WEEKDAY_TAGS as readonly string[]).includes(tag.trim().toUpperCase());

/**
 * The day tag a driver's rent calls for: weekly rent falls due every 7 days from the contract start, so its weekday
 * (SAT); monthly rent is tagged MONTHLY. Null without a valid start date.
 */
export const rentDayTag = (driver: Pick<Driver, 'contractStartDate' | 'rentalCycle'>): string | null => {
  if (driver.rentalCycle === 'MONTHLY') return 'MONTHLY';
  const start = parseDate(driver.contractStartDate);
  return isNaN(start.getTime()) ? null : WEEKDAY_TAGS[start.getDay()];
};

export interface DayTagCheck {
  /** The tag the rent day calls for. */
  expected: string;
  /** The day tags the driver has (weekdays and MONTHLY), in capitals. */
  tagged: string[];
  /** Exactly one day tag, and it is the expected one. */
  ok: boolean;
}

/** Whether the driver's day tag matches the day their rent falls due (a missing tag does not); null when that day is unknown. */
export const dayTagCheck = (driver: Pick<Driver, 'contractStartDate' | 'rentalCycle' | 'tags'>): DayTagCheck | null => {
  const expected = rentDayTag(driver);
  if (!expected) return null;
  const tagged = (driver.tags || []).filter(isDayTag).map(tag => tag.trim().toUpperCase());
  return { expected, tagged, ok: tagged.length === 1 && tagged[0] === expected };
};

/** The tags with `dayTag` as the only day tag, placed first; other tags keep their order. */
export const withDayTag = (tags: string[] | undefined, dayTag: string): string[] => [dayTag, ...(tags || []).filter(tag => !isDayTag(tag))];

/** A short form of a driver's name: the first two words, stopping before bin, binti, a/l, a/p and similar. */
export const shortName = (name: string): string => {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  const stop = words.findIndex(word => /^(BIN|BINTI|BT|BTE|A\/L|A\/P|S\/O|D\/O|@)$/i.test(word));
  return words.slice(0, Math.max(1, Math.min(2, stop === -1 ? words.length : stop))).join(' ');
};

/** The rental category as the office writes it: Sewa Biasa, or Sewa Beli (rent-to-own, also when no category is set). */
export const categoryLabel = (driver: Pick<Driver, 'category'>): 'Sewa Beli' | 'Sewa Biasa' => (isSewaBiasa(driver) ? 'Sewa Biasa' : 'Sewa Beli');

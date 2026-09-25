import { DriverStatus } from './types.ts';
import type { Driver, DriverMetrics, Invoice } from './types.ts';

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

/** Due date of rent cycle `index`, anchored to the contract start (months use calendar rollover). */
const dueDateOf = (start: Date, cycle: Driver['rentalCycle'], index: number): Date => {
  const due = new Date(start);
  if (cycle === 'MONTHLY') due.setMonth(start.getMonth() + index);
  else due.setDate(start.getDate() + index * 7);
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
 * recorded contract length are listed too and receive any advance payment.
 */
const buildRentSchedule = (driver: Driver, referenceDate: Date, includeUpcoming: boolean): RentObligation[] => {
  const start = parseDate(driver.contractStartDate);
  if (isNaN(start.getTime())) return [];
  const referenceEnd = endOfDay(referenceDate);
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
    if (dueDate > referenceEnd && (!includeUpcoming || index >= recordedLength)) break;
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
  const badThreshold = driver.rentalCycle === 'MONTHLY' ? 1.1 : 3;
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
        // Expected Due Date = Start Date + (index * CycleInterval)
        const expectedDate = new Date(startDate);
        if (driver.rentalCycle === 'MONTHLY') {
            expectedDate.setMonth(startDate.getMonth() + index);
        } else {
            expectedDate.setDate(startDate.getDate() + (index * 7));
        }
        
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

export const generateDriverInvoices = (driver: Driver, referenceDate: Date = kualaLumpurNow()): Invoice[] => {
  const referenceEnd = endOfDay(referenceDate);
  return buildRentSchedule(driver, referenceDate, true).map(obligation => {
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

export interface WeeklyFinancials {
  start: Date;
  end: Date;
  label: string;
  expected: number;
  performanceCollected: number;
  cashFlowCollected: number;
}

/**
 * Monday-to-Sunday rent performance for the `weekCount` weeks ending with the reference week, oldest first.
 * `expected` and `performanceCollected` come from the shared schedule (rent due that week and what has been
 * allocated to it); `cashFlowCollected` is cash plus service claims by payment date.
 */
export const buildWeeklyFinancials = (drivers: Driver[], referenceDate: Date = kualaLumpurNow(), weekCount = 12): WeeklyFinancials[] => {
  const monday = new Date(referenceDate);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weeks: WeeklyFinancials[] = Array.from({ length: weekCount }, (_, i) => {
    const start = new Date(monday);
    start.setDate(monday.getDate() - (weekCount - 1 - i) * 7);
    const end = endOfDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6));
    const label = `${start.getDate()}/${start.getMonth() + 1} - ${end.getDate()}/${end.getMonth() + 1}`;
    return { start, end, label, expected: 0, performanceCollected: 0, cashFlowCollected: 0 };
  });
  const weekOf = (date: Date) => weeks.find(week => date >= week.start && date <= week.end);
  for (const driver of drivers) {
    for (const invoice of generateDriverInvoices(driver, referenceDate)) {
      const week = weekOf(parseDate(invoice.dueDate));
      if (week) {
        week.expected += invoice.amount;
        week.performanceCollected += invoice.amountPaid;
      }
    }
    for (const payment of driver.paymentHistory || []) {
      const week = weekOf(parseDate(payment.date));
      if (week) week.cashFlowCollected += payment.amount + (payment.serviceClaim || 0);
    }
  }
  return weeks;
};

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
const daysBetween = (from: Date, to: Date): number =>
  Math.round((new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime() - new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()) / DAY_MS);

/**
 * Whole days since the driver's latest payment, or since the contract start when none has been made
 * (negative for a contract that has not started). Null when neither date is valid.
 */
export const daysSinceLastPayment = (driver: Driver, referenceDate: Date = kualaLumpurNow()): number | null => {
  const lastPaid = (driver.paymentHistory || []).reduce<Date | null>((latest, payment) => {
    const date = parseDate(payment.date);
    return !isNaN(date.getTime()) && (!latest || date > latest) ? date : latest;
  }, null);
  const since = lastPaid ?? parseDate(driver.contractStartDate);
  return isNaN(since.getTime()) ? null : daysBetween(since, referenceDate);
};

export interface CollectionQueues {
  /** Oldest unpaid rent is due today. */
  dueToday: Set<string>;
  /** Oldest unpaid rent was due 1 to 3 days ago. */
  late1to3: Set<string>;
  /** Oldest unpaid rent was due 4 or more days ago. */
  late4plus: Set<string>;
  /** No payment for 8 or more days (or none since a contract that started 8 or more days ago). */
  noPayment8plus: Set<string>;
}

/**
 * Lateness groups for active drivers, from the shared rent schedule: each driver sits in one group, set by their
 * oldest rent still unpaid on the reference day. The no-payment flag (8 or more days without a payment, behind the
 * dashboard's late alerts) is separate.
 */
export const buildCollectionQueues = (drivers: Driver[], referenceDate: Date = kualaLumpurNow()): CollectionQueues => {
  const queues: CollectionQueues = { dueToday: new Set(), late1to3: new Set(), late4plus: new Set(), noPayment8plus: new Set() };
  const referenceEnd = endOfDay(referenceDate);
  for (const driver of drivers) {
    if (driver.isDelisted) continue;
    const oldestUnpaid = generateDriverInvoices(driver, referenceDate)
      .find(invoice => invoice.remainingBalance > 0.01 && parseDate(invoice.dueDate) <= referenceEnd);
    if (oldestUnpaid) {
      const daysLate = daysBetween(parseDate(oldestUnpaid.dueDate), referenceDate);
      if (daysLate <= 0) queues.dueToday.add(driver.id);
      else if (daysLate <= 3) queues.late1to3.add(driver.id);
      else queues.late4plus.add(driver.id);
    }
    const quietDays = daysSinceLastPayment(driver, referenceDate);
    if (quietDays !== null && quietDays >= 8) queues.noPayment8plus.add(driver.id);
  }
  return queues;
};

/** Rent of active drivers falling due between `from` and `to` (inclusive days), and how much of it has been paid. */
export const rentDueAndPaid = (drivers: Driver[], from: Date, to: Date, referenceDate: Date = kualaLumpurNow()): { due: number; paid: number } => {
  let due = 0;
  let paid = 0;
  for (const driver of drivers) {
    if (driver.isDelisted) continue;
    for (const invoice of generateDriverInvoices(driver, referenceDate)) {
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

/** A row of the drivers table (only the columns the app reads or writes). */
export interface DriverRow {
  id: string;
  nric: string;
  email?: string | null;
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
}

/** The profile and contract columns written when a driver is created or edited. */
export const toDriverRow = (driver: Driver) => ({
  nric: driver.nric,
  email: driver.email || null,
  name: driver.name,
  address: driver.address || null,
  car_plate: driver.carPlate,
  contract_start_date: driver.contractStartDate,
  contract_end_date: driver.contractEndDate || null,
  category: driver.category || 'SEWABELI',
  rental_cycle: driver.rentalCycle,
  contract_duration_weeks: driver.contractDuration,
  rental_rate: driver.rentalRate,
  tags: driver.tags,
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
});

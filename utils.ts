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

export const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
    minimumFractionDigits: 2
  }).format(amount);
};

export const analyzePaymentHabit = (driver: Driver) => {
  if (!driver.paymentHistory || driver.paymentHistory.length < 2) {
    return { type: 'NEW', label: 'New / No Data', color: 'bg-gray-100 text-gray-600' };
  }

  const recentPayments = driver.paymentHistory.slice(0, 3);
  let totalGapDays = 0;
  let count = 0;

  for (let i = 0; i < recentPayments.length - 1; i++) {
    const d1 = parseDate(recentPayments[i].date);
    const d2 = parseDate(recentPayments[i+1].date);
    const diffTime = Math.abs(d1.getTime() - d2.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    totalGapDays += diffDays;
    count++;
  }

  const avgInterval = count > 0 ? totalGapDays / count : 0;
  
  const targetInterval = driver.rentalCycle === 'MONTHLY' ? 30 : 7;
  const buffer = driver.rentalCycle === 'MONTHLY' ? 5 : 2; // Allow +X days slip

  if (avgInterval > (targetInterval * 2)) {
    return { type: 'ERRATIC', label: 'Erratic Payer', color: 'bg-purple-100 text-purple-700 border-purple-200' };
  }
  if (avgInterval > (targetInterval + buffer)) {
    return { type: 'LATE_CYCLE', label: 'Habitual Late', color: 'bg-orange-100 text-orange-700 border-orange-200' };
  }
  return { type: 'CONSISTENT', label: 'Consistent', color: 'bg-blue-50 text-blue-700 border-blue-200' };
};

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

/** Malaysian NRIC as typed: digits only, at most 12, hyphenated as XXXXXX-XX-XXXX. */
export const formatNric = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 12);
  if (digits.length > 8) return `${digits.slice(0, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`;
  if (digits.length > 6) return `${digits.slice(0, 6)}-${digits.slice(6)}`;
  return digits;
};

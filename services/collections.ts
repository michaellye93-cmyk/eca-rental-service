import type { Driver, Invoice } from '../types.ts';
import {
  badThresholdCycles, buildLateAlerts, calculateDriverMetrics, cashAtRiskOrder, categoryLabel, dayTagCheck, displayPlate, generateDriverInvoices,
  getNextDueDate, isSewaBiasa, lastPayment, lateAlertDays, mondayToSunday, normalizePlate, outstandingDaysAgo, overdueRent, parseDate,
  rentDayTag, rentDueAndPaid, shortName,
} from '../utils.ts';
import { whoLabel } from './paymentLog.ts';

/**
 * The collections tools behind the daily run: WhatsApp statements, promises to pay, catch-up plans, the improving flag,
 * the weekly GOOD / MID / BAD counts and the read-only data view. Every rent figure comes from the shared rent schedule
 * in utils.ts (generateDriverInvoices, calculateDriverMetrics and the helpers built on them).
 */

/** A row of public.payment_promises (supabase/migrations/20260929090000_collections_support.sql). */
export interface PaymentPromise {
  id: string;
  driver_id: string;
  amount: number;
  promised_date: string;
  note: string | null;
  /** The Kuala Lumpur day it was logged: payments from this day count towards it. */
  logged_on: string;
  logged_at: string;
  logged_by_name: string;
  logged_by_role: string | null;
}

/** A row of public.catch_up_plans: an extra amount each rent cycle on top of rent. */
export interface CatchUpPlan {
  id: string;
  driver_id: string;
  extra_per_cycle: number;
  start_date: string;
  end_date: string | null;
  note: string | null;
  stopped_on: string | null;
  created_at: string;
  created_by_name: string;
  created_by_role: string | null;
}

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const endOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const round2 = (amount: number) => Math.round(amount * 100) / 100;
const cents = (amount: number) => Math.round(amount * 100);

/** The driver's rent cycles due up to today and the upcoming ones for about two months (rent paid in advance included). */
const cyclesAround = (driver: Driver, now: Date): Invoice[] => generateDriverInvoices(driver, now, addDays(now, 62));

/** Amounts as WhatsApp statements write them: RM450, RM1,400, RM450.50. */
export const statementMoney = (amount: number): string => {
  const value = round2(amount);
  return `RM${value.toLocaleString('en-MY', { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })}`;
};

const dayMonth = (isoDate: string) => {
  const [, month, day] = isoDate.split('-').map(Number);
  return `${day}/${month}`;
};

const statementLine = (invoice: Invoice) => {
  const head = `${dayMonth(invoice.dueDate)} ${statementMoney(invoice.amount)}`;
  if (invoice.remainingBalance <= 0.01) return `✅ ${head} – selesai`;
  if (invoice.amountPaid > 0.01) return `⏳ ${head} – dibayar ${statementMoney(invoice.amountPaid)}, baki ${statementMoney(invoice.remainingBalance)}`;
  return `⏳ ${head} – belum dibayar`;
};

/**
 * The agreed WhatsApp statement: the last 4 paid rent cycles, every cycle due so far that is unpaid or part-paid, the
 * balance owed (rent only, as on the driver list), the next rent not yet paid, and the bank-in line for the category.
 */
export function whatsappStatement(driver: Driver, now: Date, bankIn: string): string {
  const todayEnd = endOfDay(now);
  const cycles = cyclesAround(driver, now);
  const nextIndex = cycles.findIndex(invoice => parseDate(invoice.dueDate) > todayEnd && invoice.remainingBalance > 0.01);
  const shown = nextIndex === -1 ? cycles : cycles.slice(0, nextIndex);
  const paid = shown.filter(invoice => invoice.remainingBalance <= 0.01).slice(-4);
  const owed = shown.filter(invoice => invoice.remainingBalance > 0.01 && parseDate(invoice.dueDate) <= todayEnd);
  const lines = [`Sewa ${normalizePlate(driver.carPlate)}:`];
  for (const invoice of [...paid, ...owed].sort((a, b) => a.cycleIndex - b.cycleIndex)) lines.push(statementLine(invoice));
  lines.push(`Baki tertunggak: ${statementMoney(calculateDriverMetrics(driver, now).principalOutstanding)}`);
  const next = nextIndex === -1 ? null : cycles[nextIndex];
  if (next) {
    const partly = next.amountPaid > 0.01 ? ` – dibayar ${statementMoney(next.amountPaid)}, baki ${statementMoney(next.remainingBalance)}` : '';
    lines.push(`Sewa seterusnya: ${dayMonth(next.dueDate)} ${statementMoney(next.amount)}${partly}`);
  }
  lines.push(`Bank in: ${bankIn}`);
  return lines.join('\n');
}

export type PromiseState = 'OPEN' | 'KEPT' | 'MISSED';

/**
 * Kept when the driver's payments (cash and claims) dated from the day the promise was logged to the promised date add up
 * to the promised amount; missed once `today` (YYYY-MM-DD, Kuala Lumpur) is past the promised date without that.
 */
export function promiseStatus(promise: PaymentPromise, driver: Driver, today: string): { state: PromiseState; paid: number; left: number } {
  const paid = round2((driver.paymentHistory || [])
    .filter(payment => payment.date.slice(0, 10) >= promise.logged_on && payment.date.slice(0, 10) <= promise.promised_date)
    .reduce((sum, payment) => sum + payment.amount + (payment.serviceClaim || 0), 0));
  const left = round2(Math.max(0, promise.amount - paid));
  return { state: left <= 0.005 ? 'KEPT' : today > promise.promised_date ? 'MISSED' : 'OPEN', paid, left };
}

/** The driver's most recently logged promise, or null. */
export const latestPromise = (promises: PaymentPromise[], driverId: string): PaymentPromise | null =>
  promises.filter(promise => promise.driver_id === driverId).sort((a, b) => b.logged_at.localeCompare(a.logged_at))[0] ?? null;

/** The driver's running plan (not stopped by `today`), or null. */
export const runningPlan = (plans: CatchUpPlan[], driverId: string, today: string): CatchUpPlan | null =>
  plans.filter(plan => plan.driver_id === driverId && !(plan.stopped_on && plan.stopped_on <= today)).sort((a, b) => b.start_date.localeCompare(a.start_date))[0] ?? null;

export interface CatchUpStatus {
  state: 'NOT_STARTED' | 'ON_TRACK' | 'BEHIND' | 'STOPPED' | 'ENDED';
  /** Rent owed at the end of the day before the plan started. */
  startBalance: number;
  /** Rent cycles that have fallen due since the start (before today, and not after the plan's end date). */
  cyclesCounted: number;
  /** Where rent plus the extra on each of those cycles would have brought the balance. */
  target: number;
  /** Rent that fell due before today and is still unpaid. */
  overdue: number;
  behindBy: number;
  /** The last six rent due dates, each checked at the end of the next day. */
  checkpoints: { due: string; target: number; overdue: number; onTrack: boolean }[];
  /** The rent due date by which the driver is under the BAD line, or no longer owes anything, paying rent plus the extra
   * every cycle from now (from the plan start if it has not started): NOW when already there, null when the contract
   * stops first. */
  reachesMid: string | null;
  reachesGood: string | null;
  endsBeforeGood: boolean;
}

/** How a catch-up plan is going (see CatchUpStatus). */
export function catchUpStatus(plan: CatchUpPlan, driver: Driver, now: Date): CatchUpStatus {
  const today = iso(now);
  const start = parseDate(plan.start_date);
  const extra = plan.extra_per_cycle;
  const startBalance = round2(calculateDriverMetrics(driver, addDays(start, -1)).principalOutstanding);
  const dues = generateDriverInvoices(driver, now)
    .filter(invoice => invoice.dueDate >= plan.start_date && invoice.dueDate < today && (!plan.end_date || invoice.dueDate <= plan.end_date));
  const targetAfter = (cycles: number) => round2(Math.max(0, startBalance - cycles * extra));
  const firstShown = Math.max(0, dues.length - 6);
  const checkpoints = dues.slice(firstShown).map((invoice, i) => {
    const overdue = round2(overdueRent(driver, addDays(parseDate(invoice.dueDate), 1)));
    const target = targetAfter(firstShown + i + 1);
    return { due: invoice.dueDate, target, overdue, onTrack: overdue <= target + 0.005 };
  });
  const overdue = round2(overdueRent(driver, now));
  const target = targetAfter(dues.length);
  const behindBy = round2(Math.max(0, overdue - target));
  const state: CatchUpStatus['state'] = plan.stopped_on && plan.stopped_on <= today ? 'STOPPED'
    : today < plan.start_date ? 'NOT_STARTED'
      : plan.end_date && plan.end_date < today ? 'ENDED'
        : behindBy > 0.005 ? 'BEHIND' : 'ON_TRACK';

  // Paying rent plus the extra, the balance falls by the extra on each rent due date from now (or from the start).
  const owedNow = cents(calculateDriverMetrics(driver, now).principalOutstanding);
  const badLine = cents(badThresholdCycles(driver.rentalCycle) * driver.rentalRate);
  const step = cents(extra);
  const cyclesToMid = owedNow < badLine ? 0 : step > 0 ? Math.floor((owedNow - badLine) / step) + 1 : Infinity;
  const cyclesToGood = owedNow <= 0 ? 0 : step > 0 ? Math.ceil(owedNow / step) : Infinity;
  const from = today < plan.start_date ? start : now;
  const longest = Number.isFinite(cyclesToGood) ? cyclesToGood : 0;
  const horizon = addDays(from, (longest + 1) * (driver.rentalCycle === 'MONTHLY' ? 31 : 7));
  const todayEnd = endOfDay(now);
  const upcoming = generateDriverInvoices(driver, now, horizon).filter(invoice => parseDate(invoice.dueDate) > todayEnd && invoice.dueDate >= plan.start_date);
  const dueDateAfter = (cycles: number) => (cycles === 0 ? 'NOW' : Number.isFinite(cycles) ? upcoming[cycles - 1]?.dueDate ?? null : null);
  const reachesGood = dueDateAfter(cyclesToGood);
  return {
    state, startBalance, cyclesCounted: dues.length, target, overdue, behindBy, checkpoints,
    reachesMid: dueDateAfter(cyclesToMid), reachesGood,
    endsBeforeGood: Boolean(plan.end_date && reachesGood && reachesGood !== 'NOW' && reachesGood > plan.end_date),
  };
}

export type Trend = 'UP_TO_DATE' | 'IMPROVING' | 'NOT_IMPROVING';

/**
 * The balance now and its change over 7 and 28 days (the driver list's "in 7 days" figure). Improving: the driver owes,
 * the balance fell over 28 days and did not rise over 7. Anyone else who owes is not improving.
 */
export function balanceTrend(driver: Driver, now: Date): { outstanding: number; change7: number; change28: number; trend: Trend } {
  const outstanding = round2(calculateDriverMetrics(driver, now).principalOutstanding);
  const change7 = round2(outstanding - outstandingDaysAgo(driver, 7, now));
  const change28 = round2(outstanding - outstandingDaysAgo(driver, 28, now));
  const trend: Trend = outstanding <= 0.005 ? 'UP_TO_DATE' : change28 < -0.005 && change7 <= 0.005 ? 'IMPROVING' : 'NOT_IMPROVING';
  return { outstanding, change7, change28, trend };
}

/** Whether the driver was renting at that moment: started, and not yet delisted (a delisted driver without a date never counts). */
const rentingAt = (driver: Driver, moment: Date) => {
  const start = parseDate(driver.contractStartDate);
  if (isNaN(start.getTime()) || start > moment) return false;
  if (!driver.isDelisted) return true;
  const left = parseDate(driver.delistDate);
  return !isNaN(left.getTime()) && left > moment;
};

export interface SegmentWeek { week: string; GOOD: number; MID: number; BAD: number }

/**
 * GOOD, MID and BAD drivers at the end of each of the last `weeks` Monday-to-Sunday weeks (this week: now), oldest
 * first, labelled by the week's Monday. Drivers count while they were renting, delisted ones included.
 */
export function segmentHistory(drivers: Driver[], now: Date, weeks = 12): SegmentWeek[] {
  const { start: monday } = mondayToSunday(now);
  return Array.from({ length: weeks }, (_, i) => {
    const weekStart = addDays(monday, -7 * (weeks - 1 - i));
    const moment = i === weeks - 1 ? now : endOfDay(addDays(weekStart, 6));
    const counts: SegmentWeek = { week: `${weekStart.getDate()}/${weekStart.getMonth() + 1}`, GOOD: 0, MID: 0, BAD: 0 };
    for (const driver of drivers) if (rentingAt(driver, moment)) counts[calculateDriverMetrics(driver, moment).status] += 1;
    return counts;
  });
}

const ordinal = (day: number) => {
  const tens = day % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
  return `${day}${suffix}`;
};

export interface CollectionsInput {
  drivers: Driver[];
  /** Kuala Lumpur wall-clock time (kualaLumpurNow). */
  now: Date;
  /** Kuala Lumpur calendar day, YYYY-MM-DD. */
  today: string;
  /** The bank-in line per category; null when the settings could not be read. */
  bankIn: { SEWABELI: string | null; SEWA_BIASA: string | null } | null;
  /** Null when the table is not available yet. */
  promises: PaymentPromise[] | null;
  plans: CatchUpPlan[] | null;
}

/** One active driver in the data view. Built field by field: NRIC, phone, email and address are never included. */
export interface CollectionsDriver {
  id: string;
  plate: string;
  plate_display: string;
  short_name: string;
  category: 'SEWA BELI' | 'SEWA BIASA';
  day_tag: string | null;
  day_tag_ok: boolean;
  whatsapp_group: string | null;
  rent: { cycle: Driver['rentalCycle']; amount: number; due_day: string | null; next_due_date: string | null; oldest_unpaid_due_date: string | null };
  status: { risk: string; outstanding: number; cycles_owed: number; last_payment_date: string | null; late_days: number | null; balance_change_7d: number; balance_change_28d: number; trend: Trend };
  last_cycles: { due: string; amount: number; status: Invoice['status']; paid: number }[];
  payments_60d: { date: string; amount: number; claim: number; method: string; reference: string | null }[];
  promise: { amount: number; date: string; note: string | null; logged_on: string; logged_by: string; status: PromiseState; paid_so_far: number } | null;
  catch_up_plan: {
    extra_per_cycle: number; start: string; end: string | null; status: CatchUpStatus['state']; target_balance: number; overdue: number;
    behind_by: number; reaches_mid: string | null; reaches_good: string | null; ends_before_good: boolean; note: string | null;
  } | null;
  statement: string | null;
}

export interface CollectionsData {
  generated_at: string;
  today: string;
  about: string;
  summary: {
    active_drivers: number; good: number; mid: number; bad: number; total_outstanding: number;
    week: { from: string; to: string; target: number; settled: number; percent: number; cash_received: number };
    late_alerts: number; not_improving: number;
  };
  warnings: string[];
  drivers: CollectionsDriver[];
}

/** The read-only collections data view: every active driver in the driver list's default order, and a summary. */
export function buildCollectionsData(input: CollectionsInput): CollectionsData {
  const { now, today } = input;
  const todayDate = parseDate(today);
  const todayEnd = endOfDay(now);
  const active = input.drivers.filter(driver => !driver.isDelisted);
  const warnings: string[] = [];
  const bankIn = { SEWABELI: input.bankIn?.SEWABELI ?? null, SEWA_BIASA: input.bankIn?.SEWA_BIASA ?? null };
  if (!bankIn.SEWABELI) warnings.push('Bank-in details for Sewa Beli are not set, so Sewa Beli drivers have no statement.');
  if (!bankIn.SEWA_BIASA) warnings.push('Bank-in details for Sewa Biasa are not set, so Sewa Biasa drivers have no statement.');
  if (input.promises === null) warnings.push('Promises to pay are not available yet: the database update has not been run.');
  if (input.plans === null) warnings.push('Catch-up plans are not available yet: the database update has not been run.');
  const cutoff = iso(addDays(todayDate, -60));

  const rows = active
    .map(driver => ({ driver, metrics: calculateDriverMetrics(driver, now), lateDays: lateAlertDays(driver, now) }))
    .sort((a, b) => cashAtRiskOrder(
      { name: a.driver.name, lateDays: a.lateDays, outstanding: a.metrics.principalOutstanding },
      { name: b.driver.name, lateDays: b.lateDays, outstanding: b.metrics.principalOutstanding },
    ));

  const drivers = rows.map(({ driver, metrics, lateDays }): CollectionsDriver => {
    const tagCheck = dayTagCheck(driver);
    const cycles = cyclesAround(driver, now);
    const dueSoFar = cycles.filter(invoice => parseDate(invoice.dueDate) <= todayEnd);
    const nextCycle = cycles.find(invoice => parseDate(invoice.dueDate) > todayEnd);
    const nextUnpaid = cycles.find(invoice => parseDate(invoice.dueDate) > todayEnd && invoice.remainingBalance > 0.01);
    const oldestUnpaid = getNextDueDate(driver, now);
    const trend = balanceTrend(driver, now);
    const last = lastPayment(driver, now);
    const promise = input.promises ? latestPromise(input.promises, driver.id) : null;
    const plan = input.plans ? runningPlan(input.plans, driver.id, today) : null;
    const planStatus = plan ? catchUpStatus(plan, driver, now) : null;
    const bank = isSewaBiasa(driver) ? bankIn.SEWA_BIASA : bankIn.SEWABELI;
    const promiseState = promise ? promiseStatus(promise, driver, today) : null;
    return {
      id: driver.id,
      plate: normalizePlate(driver.carPlate),
      plate_display: displayPlate(driver.carPlate),
      short_name: shortName(driver.name),
      category: categoryLabel(driver) === 'Sewa Biasa' ? 'SEWA BIASA' : 'SEWA BELI',
      day_tag: tagCheck?.tagged.join('/') || null,
      day_tag_ok: tagCheck?.ok ?? false,
      whatsapp_group: driver.whatsappGroup ?? null,
      rent: {
        cycle: driver.rentalCycle,
        amount: driver.rentalRate,
        due_day: driver.rentalCycle === 'MONTHLY'
          ? (isNaN(parseDate(driver.contractStartDate).getTime()) ? null : `${ordinal(parseDate(driver.contractStartDate).getDate())} of each month`)
          : rentDayTag(driver),
        next_due_date: nextUnpaid?.dueDate ?? null,
        oldest_unpaid_due_date: oldestUnpaid && oldestUnpaid <= todayEnd ? iso(oldestUnpaid) : null,
      },
      status: {
        risk: metrics.status,
        outstanding: round2(metrics.principalOutstanding),
        cycles_owed: Math.round(metrics.cyclesOwed * 10) / 10,
        last_payment_date: last ? iso(last.date) : null,
        late_days: lateDays,
        balance_change_7d: trend.change7,
        balance_change_28d: trend.change28,
        trend: trend.trend,
      },
      last_cycles: [...dueSoFar.slice(-7), ...(nextCycle ? [nextCycle] : [])]
        .map(invoice => ({ due: invoice.dueDate, amount: invoice.amount, status: invoice.status, paid: round2(invoice.amountPaid) })),
      payments_60d: (driver.paymentHistory || [])
        .filter(payment => payment.date.slice(0, 10) >= cutoff)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(payment => ({ date: payment.date.slice(0, 10), amount: payment.amount, claim: payment.serviceClaim || 0, method: payment.paymentMethod || 'BANK TRANSFER', reference: payment.reference ?? null })),
      promise: promise && promiseState ? {
        amount: promise.amount, date: promise.promised_date, note: promise.note, logged_on: promise.logged_on,
        logged_by: whoLabel(promise.logged_by_role, promise.logged_by_name), status: promiseState.state, paid_so_far: promiseState.paid,
      } : null,
      catch_up_plan: plan && planStatus ? {
        extra_per_cycle: plan.extra_per_cycle, start: plan.start_date, end: plan.end_date, status: planStatus.state, target_balance: planStatus.target,
        overdue: planStatus.overdue, behind_by: planStatus.behindBy, reaches_mid: planStatus.reachesMid, reaches_good: planStatus.reachesGood,
        ends_before_good: planStatus.endsBeforeGood, note: plan.note,
      } : null,
      statement: bank ? whatsappStatement(driver, now, bank) : null,
    };
  });

  const { start, end } = mondayToSunday(todayDate);
  const week = rentDueAndPaid(input.drivers, start, end, todayDate);
  const cashReceived = input.drivers
    .flatMap(driver => driver.paymentHistory || [])
    .filter(payment => payment.date.slice(0, 10) >= iso(start) && payment.date.slice(0, 10) <= iso(end))
    .reduce((sum, payment) => sum + payment.amount, 0);
  const count = (risk: string) => drivers.filter(driver => driver.status.risk === risk).length;
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  return {
    generated_at: `${iso(now)}T${time}+08:00`,
    today,
    about: 'Read-only list of active drivers from the ECA admin site. Money in RM; rent only, no late-payment penalty. Record payments and changes in the normal screens.',
    summary: {
      active_drivers: drivers.length,
      good: count('GOOD'),
      mid: count('MID'),
      bad: count('BAD'),
      total_outstanding: round2(drivers.reduce((sum, driver) => sum + driver.status.outstanding, 0)),
      week: {
        from: iso(start), to: iso(end), target: round2(week.due), settled: round2(week.paid),
        percent: week.due > 0 ? Math.round((week.paid / week.due) * 100) : 0, cash_received: round2(cashReceived),
      },
      late_alerts: buildLateAlerts(active, todayDate).length,
      not_improving: drivers.filter(driver => driver.status.trend === 'NOT_IMPROVING').length,
    },
    warnings,
    drivers,
  };
}

/** The data view as JSON text: the summary on a few lines, then one line per driver (valid JSON, easy to read). */
export function collectionsJson(data: CollectionsData): string {
  const { drivers, ...head } = data;
  const top = Object.entries(head).map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)}`);
  return `{\n${top.join(',\n')},\n"drivers":[\n${drivers.map(driver => JSON.stringify(driver)).join(',\n')}\n]}`;
}

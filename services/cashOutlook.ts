import type { Driver } from '../types.ts';
import { formatCurrency, parseDate, rentDueAndPaid } from '../utils.ts';

// What finance_cash_outlook(today) returns (see supabase/migrations/20260927090000_cash_position_and_outlook.sql).
export interface CashBalanceEntry { id: string; account_label: string; balance: number; as_of: string; note: string | null; entered_at: string }
export interface OutlookMonth { month: string; recurring: number; fixed: number }
export interface InsuranceDue { plate_key: string; display_plate: string; due_date: string; amount: number; kind: 'PAYMENT' | 'RENEWAL' }
export interface OutlookHistoryMonth {
  month: string; has_data: boolean;
  workshop: number; vehicle_costs: number; one_off_opex: number; smart_drive_net: number; other_income: number;
}
export interface CashOutlookData {
  today: string;
  balances: CashBalanceEntry[];
  months: OutlookMonth[];
  insurance: InsuranceDue[];
  history: OutlookHistoryMonth[];
  duplicate_recurring: { vehicles: number; monthly_amount: number };
}

/** The cash line looks this many days ahead, starting today. */
export const WINDOW_DAYS = 30;
/** Tight: what is left after the window's bills covers fewer than this many days of bills. */
export const TIGHT_DAYS = 7;
/** Watch: a bank balance older than this many days. */
export const STALE_BALANCE_DAYS = 7;
/** The recent collection rate is measured over this many weeks up to today. */
export const COLLECTION_WEEKS = 8;

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayNumber = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY;
};
const isoOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
/** A YYYY-MM-DD date moved by a number of days. */
export const addDays = (iso: string, days: number) => isoOf(dayNumber(iso) + days);
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const daysInMonth = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const nextMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};
const cents = (n: number) => Math.round(n * 100) / 100;
const num = (value: unknown) => Number(value) || 0;
const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}/.test(value);

export interface CurrentCash {
  total: number;
  /** Days since the oldest of the accounts' latest balances. */
  ageDays: number;
  accounts: { label: string; balance: number; asOf: string; ageDays: number }[];
}

/** Cash in bank: the latest balance entered for each account, added up. Null when no balance has been entered. */
export function currentCash(balances: CashBalanceEntry[], today: string): CurrentCash | null {
  const latest = new Map<string, CashBalanceEntry>();
  const newestFirst = [...balances].sort((a, b) => b.as_of.localeCompare(a.as_of) || String(b.entered_at).localeCompare(String(a.entered_at)));
  for (const entry of newestFirst) if (!latest.has(entry.account_label)) latest.set(entry.account_label, entry);
  if (!latest.size) return null;
  const accounts = [...latest.values()].map(entry => ({
    label: entry.account_label,
    balance: num(entry.balance),
    asOf: entry.as_of.slice(0, 10),
    ageDays: Math.max(0, dayNumber(today) - dayNumber(entry.as_of)),
  }));
  return { total: cents(accounts.reduce((sum, a) => sum + a.balance, 0)), ageDays: Math.max(...accounts.map(a => a.ageDays)), accounts };
}

/**
 * Cash received over rent due in the last COLLECTION_WEEKS weeks, for active drivers, between 0 and 1. Repair credits
 * are not cash. With no rent due the rate is 1.
 */
export function collectionRate(drivers: Driver[], today: string): { rate: number; cash: number; due: number } {
  const active = drivers.filter(d => !d.isDelisted);
  const from = addDays(today, -(COLLECTION_WEEKS * 7 - 1));
  const { due } = rentDueAndPaid(active, parseDate(from), parseDate(today), parseDate(today));
  let cash = 0;
  for (const driver of active) {
    for (const payment of driver.paymentHistory || []) {
      if (!isIsoDate(payment.date)) continue;
      const day = dayNumber(payment.date);
      if (day >= dayNumber(from) && day <= dayNumber(today)) cash += payment.amount;
    }
  }
  return { rate: due > 0 ? Math.min(1, Math.max(0, cash / due)) : 1, cash: cents(cash), due: cents(due) };
}

export interface WindowRent { due: number; prepaid: number; full: number; expected: number }

/**
 * Rent of active drivers falling due between `from` and `to` (the one rent schedule, counted to `to`). `prepaid` was paid
 * in advance and is already in the bank; `full` is what is still to come in if everyone pays; `expected` applies the rate.
 */
export function windowRent(drivers: Driver[], from: string, to: string, today: string, rate: number): WindowRent {
  const { due, paid } = rentDueAndPaid(drivers, parseDate(from), parseDate(to), parseDate(today));
  const full = Math.max(0, due - paid);
  return { due: cents(due), prepaid: cents(paid), full: cents(full), expected: cents(full * rate) };
}

/** Each calendar month a window touches, with the share of that month the window covers. */
function monthShares(from: string, to: string): { month: string; share: number }[] {
  const shares: { month: string; share: number }[] = [];
  for (let month = monthStart(from); month <= to; month = nextMonth(month)) {
    const first = Math.max(dayNumber(month), dayNumber(from));
    const last = Math.min(dayNumber(month) + daysInMonth(month) - 1, dayNumber(to));
    if (last >= first) shares.push({ month, share: (last - first + 1) / daysInMonth(month) });
  }
  return shares;
}

/** The monthly obligations for a month; past the last month Finance returned, the last month's figures carry on. */
function obligationsFor(outlook: CashOutlookData, month: string): OutlookMonth | undefined {
  const months = [...outlook.months].sort((a, b) => a.month.localeCompare(b.month));
  return [...months].reverse().find(m => m.month.slice(0, 10) <= month) ?? months[0];
}

/** Monthly averages of the variable figures, over the history months that have Finance data. */
function averages(outlook: CashOutlookData) {
  const months = outlook.history.filter(h => h.has_data);
  const average = (key: keyof Omit<OutlookHistoryMonth, 'month' | 'has_data'>) =>
    months.length ? months.reduce((sum, h) => sum + num(h[key]), 0) / months.length : 0;
  return {
    workshop: average('workshop'),
    vehicleCosts: average('vehicle_costs'),
    oneOffOpex: average('one_off_opex'),
    smartDriveNet: average('smart_drive_net'),
    otherIncome: average('other_income'),
  };
}

export interface WindowBills { financing: number; fixed: number; insurance: number; workshop: number; vehicleCosts: number; oneOffOpex: number; total: number }

/**
 * Bills between `from` and `to`: monthly vehicle costs and operation fix costs weighted by the days of each month the
 * window covers, insurance falling due in the window, and 3-month averages for workshop, other vehicle costs and one-off
 * company costs.
 */
export function windowBills(outlook: CashOutlookData, from: string, to: string): WindowBills {
  const avg = averages(outlook);
  let financing = 0;
  let fixed = 0;
  let months = 0;
  for (const { month, share } of monthShares(from, to)) {
    const figures = obligationsFor(outlook, month);
    financing += num(figures?.recurring) * share;
    fixed += num(figures?.fixed) * share;
    months += share;
  }
  const insurance = outlook.insurance
    .filter(item => item.due_date.slice(0, 10) >= from && item.due_date.slice(0, 10) <= to)
    .reduce((sum, item) => sum + num(item.amount), 0);
  const bills = {
    financing: cents(financing),
    fixed: cents(fixed),
    insurance: cents(insurance),
    workshop: cents(avg.workshop * months),
    vehicleCosts: cents(avg.vehicleCosts * months),
    oneOffOpex: cents(avg.oneOffOpex * months),
  };
  return { ...bills, total: cents(Object.values(bills).reduce((sum, value) => sum + value, 0)) };
}

/** Money expected in besides rent: Smart Drive (net of commission) and other income, as 3-month averages. */
export function windowOtherIncome(outlook: CashOutlookData, from: string, to: string): number {
  const avg = averages(outlook);
  const months = monthShares(from, to).reduce((sum, m) => sum + m.share, 0);
  return cents((avg.smartDriveNet + avg.otherIncome) * months);
}

export type CashStatus = 'SHORT' | 'TIGHT' | 'WATCH' | 'COVERED';

export interface CashLineInput {
  today: string;
  outlook: CashOutlookData;
  drivers: Driver[];
  /** Rent owed by active drivers that fell due before today (overdueRent added up). */
  overdue: number;
  /** How much that figure changed since the same day last week. */
  overdueChange: number;
}

export interface CashLineSummary {
  window: { from: string; to: string };
  cash: CurrentCash | null;
  rate: number;
  rent: WindowRent;
  otherIncome: number;
  bills: WindowBills;
  expectedIn: number;
  net: number;
  /** Cash in bank plus money expected in, less bills, at the end of the window. Null without a bank balance. */
  left: number | null;
  daysLeft: number | null;
  overdue: number;
  overdueChange: number;
  status: CashStatus;
  sentence: string;
  notes: string[];
  /** Extra cash in the window if 10 more points of the rent due were collected (to at most 100%). */
  leverPerTenPoints: number;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/**
 * The always-on cash line: the next WINDOW_DAYS days of bills against cash in bank and the money expected in, and one
 * plain sentence. Short: bills exceed cash plus money in. Tight: fewer than TIGHT_DAYS days of bills left. Watch: the
 * bank balance is missing or older than STALE_BALANCE_DAYS days, or overdue rent grew this week. Otherwise Covered.
 */
export function cashLine(input: CashLineInput): CashLineSummary {
  const from = input.today;
  const to = addDays(from, WINDOW_DAYS - 1);
  const cash = currentCash(input.outlook.balances, input.today);
  const { rate } = collectionRate(input.drivers, input.today);
  const rent = windowRent(input.drivers, from, to, input.today, rate);
  const otherIncome = windowOtherIncome(input.outlook, from, to);
  const bills = windowBills(input.outlook, from, to);
  const expectedIn = cents(rent.expected + otherIncome);
  const net = cents(expectedIn - bills.total);
  const left = cash ? cents(cash.total + net) : null;
  const dailyBills = bills.total / WINDOW_DAYS;
  const daysLeft = left !== null && dailyBills > 0 ? left / dailyBills : null;
  const leverPerTenPoints = cents(rent.full * Math.min(0.1, Math.max(0, 1 - rate)));

  const stale = cash !== null && cash.ageDays > STALE_BALANCE_DAYS;
  const staleText = cash ? `The bank balance is ${cash.ageDays} days old. Update it on the Cash page.` : '';
  const grew = input.overdueChange > 0.005;
  const grewText = `Overdue rent grew ${formatCurrency(input.overdueChange)} this week.`;

  let status: CashStatus;
  let sentence: string;
  let sentenceFact: 'stale' | 'grew' | null = null;
  if (!cash || left === null) {
    status = 'WATCH';
    sentence = `Enter your bank balance on the Cash page to see how long cash lasts. The next 30 days bring about ${formatCurrency(expectedIn)} in and ${formatCurrency(bills.total)} of bills.`;
  } else if (left < 0) {
    status = 'SHORT';
    sentence = `Short: the next 30 days of bills are ${formatCurrency(-left)} more than your cash plus the money expected in.`;
  } else if (bills.total === 0) {
    status = 'WATCH';
    sentence = 'Watch: no bills are recorded in Finance for the next 30 days, so the cash line cannot tell how long cash lasts. Add your monthly costs in Money → Expenses.';
  } else if (daysLeft !== null && daysLeft < TIGHT_DAYS) {
    status = 'TIGHT';
    const days = daysLeft < 1 ? 'less than a day' : `under ${Math.floor(daysLeft) + 1} days`;
    sentence = `Tight: after the next 30 days of bills you would have ${formatCurrency(left)} left, ${days} of bills.`;
  } else if (stale || grew) {
    status = 'WATCH';
    sentenceFact = stale ? 'stale' : 'grew';
    sentence = stale ? `Watch: the bank balance is ${cash.ageDays} days old. Update it on the Cash page.` : `Watch: overdue rent grew ${formatCurrency(input.overdueChange)} this week.`;
  } else {
    status = 'COVERED';
    sentence = `Covered: ${formatCurrency(left)} left after the next 30 days of bills, about ${Math.floor(daysLeft ?? 0)} days of bills.`;
  }

  const notes: string[] = [];
  if (stale && sentenceFact !== 'stale') notes.push(staleText);
  if (grew && sentenceFact !== 'grew') notes.push(grewText);
  if (leverPerTenPoints > 0) {
    notes.push(`Collecting ${percent(Math.min(1, rate + 0.1))} of rent due instead of ${percent(rate)} would add ${formatCurrency(leverPerTenPoints)}.`);
  }
  const duplicates = input.outlook.duplicate_recurring;
  if (num(duplicates?.vehicles) > 0) {
    const n = num(duplicates.vehicles);
    notes.push(`${n} ${n === 1 ? 'vehicle carries' : 'vehicles carry'} the same monthly cost twice (${formatCurrency(num(duplicates.monthly_amount))} a month), so bills may be overstated. Check Finance → Expenses → Monthly Vehicle Costs.`);
  }
  if (bills.total === 0 && !cash) notes.push('No bills are recorded in Finance for the next 30 days.');

  return {
    window: { from, to }, cash, rate, rent, otherIncome, bills, expectedIn, net, left, daysLeft,
    overdue: cents(input.overdue), overdueChange: cents(input.overdueChange), status, sentence, notes, leverPerTenPoints,
  };
}

export interface OutlookBucket {
  label: string;
  from: string;
  to: string;
  opening: number;
  rent: WindowRent;
  otherIncome: number;
  moneyIn: number;
  bills: WindowBills;
  closing: number;
  closingIfAllRentPaid: number;
}

/**
 * The Cash page's month-by-month outlook: the rest of this month and the next three months, each starting with the
 * previous one's closing cash. The first opening is cash in bank (0 when none has been entered).
 */
export function monthlyOutlook(input: {
  today: string; outlook: CashOutlookData; drivers: Driver[];
  /** Share of rent still to come that gets collected; defaults to the recent collection rate. */
  rate?: number;
  /** Overdue rent recovered in each full month, on top of the rent (counted pro rata in a part month). */
  arrearsPerMonth?: number;
}): OutlookBucket[] {
  const cash = currentCash(input.outlook.balances, input.today);
  const rate = input.rate ?? collectionRate(input.drivers, input.today).rate;
  const arrearsPerMonth = input.arrearsPerMonth ?? 0;
  const buckets: OutlookBucket[] = [];
  let opening = cash?.total ?? 0;
  let openingIfAllPaid = opening;
  let from = input.today;
  for (let i = 0; i < 4; i++) {
    const month = monthStart(from);
    const to = addDays(month, daysInMonth(month) - 1);
    const rent = windowRent(input.drivers, from, to, input.today, rate);
    const otherIncome = windowOtherIncome(input.outlook, from, to);
    const bills = windowBills(input.outlook, from, to);
    const arrears = arrearsPerMonth * ((dayNumber(to) - dayNumber(from) + 1) / daysInMonth(month));
    const moneyIn = cents(rent.expected + otherIncome + arrears);
    const closing = cents(opening + moneyIn - bills.total);
    const closingIfAllRentPaid = cents(openingIfAllPaid + rent.full + otherIncome + arrears - bills.total);
    const [year, monthNumber] = month.split('-').map(Number);
    const label = from !== month ? `Rest of ${MONTHS[monthNumber - 1]}` : `${MONTHS[monthNumber - 1]} ${year}`;
    buckets.push({ label, from, to, opening, rent, otherIncome, moneyIn, bills, closing, closingIfAllRentPaid });
    opening = closing;
    openingIfAllPaid = closingIfAllRentPaid;
    from = nextMonth(month);
  }
  return buckets;
}

export interface CashScenario {
  key: 'current' | 'rate85' | 'all' | 'allPlusArrears';
  label: string;
  /** Closing cash at the end of each outlook period, same periods as monthlyOutlook. */
  closing: number[];
  months: string[];
}

/**
 * Closing cash under four collection scenarios: today's pace, 85% of rent, all rent, and all rent plus recovering
 * 10% of today's overdue rent each month.
 */
export function arrearsScenarios(input: { today: string; outlook: CashOutlookData; drivers: Driver[]; overdue: number }): CashScenario[] {
  const { rate } = collectionRate(input.drivers, input.today);
  const run = (key: CashScenario['key'], label: string, scenarioRate: number, arrearsPerMonth = 0): CashScenario => {
    const months = monthlyOutlook({ today: input.today, outlook: input.outlook, drivers: input.drivers, rate: scenarioRate, arrearsPerMonth });
    return { key, label, closing: months.map((m) => m.closing), months: months.map((m) => m.label) };
  };
  return [
    run('current', `Today's pace (${percent(rate)} of rent)`, rate),
    run('rate85', 'Collect 85% of rent', 0.85),
    run('all', 'Collect all rent', 1),
    run('allPlusArrears', 'All rent + 10% of arrears a month', 1, cents(Math.max(0, input.overdue) * 0.1)),
  ];
}

import type { Driver } from '../types.ts';
import { formatCurrency, parseDate, rentDueAndPaid } from '../utils.ts';
import { cashOf } from './moneyDefinitions.ts';
import { addDays, MONTH_SHORT, monthStart, percent, round2 } from './fmt.ts';
import { sameBankAccount } from './finance/statementBalances.ts';

// What finance_cash_outlook(today) returns (see supabase/migrations/20260927090000_cash_position_and_outlook.sql and,
// for recurring Other Income, 20261021180000_other_income_recurring.sql).
export interface CashBalanceEntry { id: string; account_label: string; balance: number; as_of: string; note: string | null; entered_at: string }
export interface OutlookMonth { month: string; recurring: number; fixed: number }
export interface InsuranceDue { plate_key: string; display_plate: string; due_date: string; amount: number; kind: 'PAYMENT' | 'RENEWAL' }
export interface OutlookHistoryMonth {
  month: string; has_data: boolean;
  workshop: number; vehicle_costs: number; one_off_opex: number; smart_drive_net: number; other_income: number;
  /** Of other_income, the confirmed lines made from a monthly recurring series. Absent from servers before 20261021180000. */
  recurring_other_income?: number;
}
/** The active monthly recurring Other Income series added up for one month. */
export interface RecurringIncomeMonth { month: string; amount: number }
export interface CashOutlookData {
  today: string;
  balances: CashBalanceEntry[];
  months: OutlookMonth[];
  insurance: InsuranceDue[];
  history: OutlookHistoryMonth[];
  duplicate_recurring: { vehicles: number; monthly_amount: number };
  /** Monthly recurring Other Income for this month and the next five. Absent from servers before 20261021180000. */
  recurring_ahead?: RecurringIncomeMonth[];
  /**
   * Deposits held per driver id, read from the deposit ledger (public.driver_deposits) when the outlook is loaded; not
   * part of finance_cash_outlook. Absent when the ledger could not be read: no deposit figures are shown then.
   */
  deposits_held?: Record<string, number>;
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
const dayNumber = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY;
};
const daysInMonth = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const nextMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};
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
  return { total: round2(accounts.reduce((sum, a) => sum + a.balance, 0)), ageDays: Math.max(...accounts.map(a => a.ageDays)), accounts };
}

/**
 * Cash received (see moneyDefinitions: no service claims, no deposit forfeits) over rent due in the last COLLECTION_WEEKS
 * weeks, for active drivers, between 0 and 1. With no rent due the rate is 1.
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
      if (day >= dayNumber(from) && day <= dayNumber(today)) cash += cashOf(payment);
    }
  }
  return { rate: due > 0 ? Math.min(1, Math.max(0, cash / due)) : 1, cash: round2(cash), due: round2(due) };
}

export interface WindowRent { due: number; prepaid: number; full: number; expected: number }

/**
 * Rent of active drivers falling due between `from` and `to` (the one rent schedule, counted to `to`). `prepaid` was paid
 * in advance and is already in the bank; `full` is what is still to come in if everyone pays; `expected` applies the rate.
 */
export function windowRent(drivers: Driver[], from: string, to: string, today: string, rate: number): WindowRent {
  const { due, paid } = rentDueAndPaid(drivers, parseDate(from), parseDate(to), parseDate(today));
  const full = Math.max(0, due - paid);
  return { due: round2(due), prepaid: round2(paid), full: round2(full), expected: round2(full * rate) };
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
    /** Other income less the part made from monthly recurring series (counted at its amount instead). */
    oneOffOtherIncome: Math.max(0, average('other_income') - average('recurring_other_income')),
  };
}

/** A line of the deposit ledger (public.driver_deposits). */
export interface DepositLedgerRow { driver_id: string; kind: string; entry: string; amount: number | string }

/**
 * Deposits still held per driver: Sewa Biasa deposits received, less those used for rent, refunded or forfeited.
 * Downpayments (Sewa Beli) are never held. Drivers with nothing held are left out.
 */
export function depositsHeldByDriver(rows: DepositLedgerRow[]): Record<string, number> {
  const held = new Map<string, number>();
  for (const row of rows) {
    if (row.kind !== 'DEPOSIT') continue;
    held.set(row.driver_id, (held.get(row.driver_id) ?? 0) + (row.entry === 'RECEIVED' ? 1 : -1) * num(row.amount));
  }
  return Object.fromEntries([...held].map(([id, amount]) => [id, round2(amount)] as [string, number]).filter(([, amount]) => amount > 0));
}

/** All drivers' deposits held, or null when the deposit ledger was not read. */
export const depositsHeldTotal = (held: Record<string, number> | undefined) =>
  held ? round2(Object.values(held).reduce((sum, amount) => sum + amount, 0)) : null;

export interface DepositRefundDue {
  driver_id: string; name: string; plate: string; due_date: string; amount: number;
  /** Set for an overdue refund: the contract ended (on `ended`) before today and the deposit is still held. */
  overdue?: true; ended?: string;
}

/**
 * Expected deposit refunds between `from` and `to`: each active driver with a deposit held whose contract end date falls
 * in the window, on the end date. Given `today`, a contract that ended before it with the deposit still held is an overdue
 * refund, counted on today (so only in the window holding today, never again in a later one); without `today`, only end
 * dates in the window count. The deposit may be forfeited instead.
 */
export function depositRefundsDue(drivers: Driver[], held: Record<string, number> | undefined, from: string, to: string, today?: string): DepositRefundDue[] {
  if (!held) return [];
  return drivers
    .filter(d => !d.isDelisted && isIsoDate(d.contractEndDate ?? '') && (held[d.id] ?? 0) > 0)
    .map((d): DepositRefundDue => {
      const ended = String(d.contractEndDate).slice(0, 10);
      const base = { driver_id: d.id, name: d.name, plate: d.carPlate, amount: held[d.id] };
      return today && ended < today ? { ...base, due_date: today, overdue: true, ended } : { ...base, due_date: ended };
    })
    .filter(r => r.due_date >= from && r.due_date <= to)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.name.localeCompare(b.name));
}

export interface WindowBills { financing: number; fixed: number; insurance: number; workshop: number; vehicleCosts: number; oneOffOpex: number; depositRefunds: number; total: number }

/**
 * Bills between `from` and `to`: monthly vehicle costs and operation fix costs weighted by the days of each month the
 * window covers, insurance falling due in the window, and 3-month averages for workshop, other vehicle costs and one-off
 * company costs, and the deposit refunds expected in the window (see depositRefundsDue; `today` places overdue ones).
 */
export function windowBills(outlook: CashOutlookData, from: string, to: string, drivers: Driver[] = [], today?: string): WindowBills {
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
    financing: round2(financing),
    fixed: round2(fixed),
    insurance: round2(insurance),
    workshop: round2(avg.workshop * months),
    vehicleCosts: round2(avg.vehicleCosts * months),
    oneOffOpex: round2(avg.oneOffOpex * months),
    depositRefunds: round2(depositRefundsDue(drivers, outlook.deposits_held, from, to, today).reduce((sum, r) => sum + r.amount, 0)),
  };
  return { ...bills, total: round2(Object.values(bills).reduce((sum, value) => sum + value, 0)) };
}

/**
 * Money expected in besides rent: Smart Drive (net of commission) and one-off other income as 3-month averages, plus
 * monthly recurring other income at its amount for each month the window covers (weighted by the days covered, like
 * the monthly bills); a month whose recurring line is already Confirmed is in the balance, so the server leaves it out
 * of recurring_ahead. Without recurring_ahead (an older server) all other income is averaged, as before.
 */
export function windowOtherIncome(outlook: CashOutlookData, from: string, to: string): number {
  const avg = averages(outlook);
  const shares = monthShares(from, to);
  const months = shares.reduce((sum, m) => sum + m.share, 0);
  if (!outlook.recurring_ahead) return round2((avg.smartDriveNet + avg.otherIncome) * months);
  const ahead = new Map(outlook.recurring_ahead.map(r => [r.month.slice(0, 10), num(r.amount)] as [string, number]));
  const recurring = shares.reduce((sum, { month, share }) => sum + (ahead.get(month) ?? 0) * share, 0);
  return round2((avg.smartDriveNet + avg.oneOffOtherIncome) * months + recurring);
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
  /** Of the cash in bank, drivers' deposits held (owed back to them); null when the deposit ledger was not read. */
  depositsHeld: number | null;
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
  const bills = windowBills(input.outlook, from, to, input.drivers, input.today);
  const expectedIn = round2(rent.expected + otherIncome);
  const net = round2(expectedIn - bills.total);
  const left = cash ? round2(cash.total + net) : null;
  const dailyBills = bills.total / WINDOW_DAYS;
  const daysLeft = left !== null && dailyBills > 0 ? left / dailyBills : null;
  const leverPerTenPoints = round2(rent.full * Math.min(0.1, Math.max(0, 1 - rate)));

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
    sentence = 'Watch: no bills are recorded in Finance for the next 30 days, so the cash line cannot tell how long cash lasts. Add your monthly costs in Finance → Records.';
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
    notes.push(`Collecting ${percent(Math.min(1, rate + 0.1))} of rent due instead of ${percent(rate)} (cash collection rate, last ${COLLECTION_WEEKS} weeks) would add ${formatCurrency(leverPerTenPoints)}.`);
  }
  const duplicates = input.outlook.duplicate_recurring;
  if (num(duplicates?.vehicles) > 0) {
    const n = num(duplicates.vehicles);
    notes.push(`${n} ${n === 1 ? 'vehicle carries' : 'vehicles carry'} the same monthly cost twice (${formatCurrency(num(duplicates.monthly_amount))} a month), so bills may be overstated. Check Finance → Records → Monthly Vehicle Costs.`);
  }
  if (bills.total === 0 && !cash) notes.push('No bills are recorded in Finance for the next 30 days.');

  return {
    window: { from, to }, cash, depositsHeld: depositsHeldTotal(input.outlook.deposits_held), rate, rent, otherIncome, bills, expectedIn, net, left, daysLeft,
    overdue: round2(input.overdue), overdueChange: round2(input.overdueChange), status, sentence, notes, leverPerTenPoints,
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
    const bills = windowBills(input.outlook, from, to, input.drivers, input.today);
    const arrears = arrearsPerMonth * ((dayNumber(to) - dayNumber(from) + 1) / daysInMonth(month));
    const moneyIn = round2(rent.expected + otherIncome + arrears);
    const closing = round2(opening + moneyIn - bills.total);
    const closingIfAllRentPaid = round2(openingIfAllPaid + rent.full + otherIncome + arrears - bills.total);
    const [year, monthNumber] = month.split('-').map(Number);
    const label = from !== month ? `Rest of ${MONTH_SHORT[monthNumber - 1]}` : `${MONTH_SHORT[monthNumber - 1]} ${year}`;
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
    run('allPlusArrears', 'All rent + 10% of arrears a month', 1, round2(Math.max(0, input.overdue) * 0.1)),
  ];
}

/** Unexplained differences above this many ringgit are flagged on the bank check. */
export const BANK_CHECK_TOLERANCE = 500;

export interface BankCheck {
  month: string;
  /** All accounts at the start of the month, or null while one is missing. */
  opening: number | null;
  netCashFlow: number;
  /** Opening plus the month's net cash flow: what the bank should hold at month end. */
  expected: number | null;
  /** All accounts at month end, or null while one is missing. */
  closing: number | null;
  /** Closing less expected (negative: less money than the records explain). */
  unexplained: number | null;
  flagged: boolean;
  missing: { account: string; when: 'start' | 'end' }[];
}

/** An account counts as in use for a month when it has a balance dated within 45 days of the month (a closed or old one does not). */
export const IN_USE_DAYS = 45;
function accountsInUse(balances: CashBalanceEntry[], month: string): string[] {
  const first = `${month}-01`;
  const [year, number] = month.split('-').map(Number);
  const nextFirst = `${number === 12 ? year + 1 : year}-${String(number === 12 ? 1 : number + 1).padStart(2, '0')}-01`;
  const from = dayNumber(first) - IN_USE_DAYS;
  const to = dayNumber(nextFirst) + IN_USE_DAYS;
  return [...new Set(balances.filter(entry => isIsoDate(entry.as_of) && dayNumber(entry.as_of) >= from && dayNumber(entry.as_of) <= to).map(entry => entry.account_label))].sort();
}

/**
 * The bank accounts in use for the month (as above) with no posted bank statement for it. A statement belongs to an
 * account when sameBankAccount says so (same name, or the same last four digits).
 */
export function accountsWithoutStatement(balances: CashBalanceEntry[], imports: { account_label: string }[], month: string): string[] {
  return accountsInUse(balances, month).filter(account => !imports.some(item => sameBankAccount(item.account_label, account)));
}

export interface BankCloseState {
  /** checking: Cash balances still loading; missing: no statement posted; needs-ack: some accounts in use have none. */
  status: 'checking' | 'missing' | 'needs-ack' | 'reconciled';
  /** The checklist line is ticked: at least one statement is posted (and Cash is not still loading). */
  ready: boolean;
  accounts: string[];
  label: string;
  /** What Admin ticks before closing when some accounts have no statement. */
  acknowledgement: string | null;
}

/**
 * The bank line of Month close. At least one posted statement is required. An account in use with no statement of its
 * own (cash in hand, an e-wallet, a new account) does not block the close: it is listed and Admin ticks that it was
 * checked. `balances`: Cash's balances, undefined while loading, null when they could not be read (one statement will do).
 */
export function bankCloseState(balances: CashBalanceEntry[] | null | undefined, imports: { account_label: string }[], month: string, monthName: string): BankCloseState {
  const label = 'Bank statement reconciled (Reconcile tab)';
  if (balances === undefined) return { status: 'checking', ready: false, accounts: [], label: `${label}: checking…`, acknowledgement: null };
  if (!imports.length) return { status: 'missing', ready: false, accounts: [], label, acknowledgement: null };
  const accounts = balances ? accountsWithoutStatement(balances, imports, month) : [];
  if (!accounts.length) return { status: 'reconciled', ready: true, accounts, label, acknowledgement: null };
  const names = accounts.join(', ');
  return {
    status: 'needs-ack', ready: true, accounts,
    label: `${label}. No statement for ${names}: confirm them before closing`,
    acknowledgement: `These accounts have no bank statement for ${monthName}: ${names}. I have checked them.`,
  };
}

/**
 * The bank check for month YYYY-MM: the balances at the start of the month plus the month's net cash flow should equal
 * the balances at month end. A balance counts for a month boundary when it is dated the last day of the month or the
 * 1st of the next; the later date wins, then the later entry. Every account in use that month (see accountsInUse) needs
 * both boundaries.
 */
export function bankCheck(balances: CashBalanceEntry[], month: string, netCashFlow: number): BankCheck {
  const first = `${month}-01`;
  const lastOfPrevious = addDays(first, -1);
  const [year, number] = month.split('-').map(Number);
  const nextFirst = `${number === 12 ? year + 1 : year}-${String(number === 12 ? 1 : number + 1).padStart(2, '0')}-01`;
  const last = addDays(nextFirst, -1);
  const accounts = accountsInUse(balances, month);
  const missing: BankCheck['missing'] = [];
  const at = (account: string, dates: string[], when: 'start' | 'end') => {
    const found = balances.filter(entry => entry.account_label === account && dates.includes(entry.as_of.slice(0, 10)))
      .sort((a, b) => b.as_of.localeCompare(a.as_of) || String(b.entered_at).localeCompare(String(a.entered_at)))[0];
    if (!found) missing.push({ account, when });
    return found ? num(found.balance) : 0;
  };
  let opening = 0;
  let closing = 0;
  for (const account of accounts) {
    opening += at(account, [lastOfPrevious, first], 'start');
    closing += at(account, [last, nextFirst], 'end');
  }
  const startMissing = missing.some(m => m.when === 'start');
  const endMissing = missing.some(m => m.when === 'end');
  const expected = startMissing || !accounts.length ? null : round2(opening + netCashFlow);
  const closingTotal = endMissing || !accounts.length ? null : round2(closing);
  const unexplained = expected === null || closingTotal === null ? null : round2(closingTotal - expected);
  return {
    month, opening: startMissing || !accounts.length ? null : round2(opening), netCashFlow: round2(netCashFlow), expected, closing: closingTotal,
    unexplained, flagged: unexplained !== null && Math.abs(unexplained) > BANK_CHECK_TOLERANCE, missing,
  };
}

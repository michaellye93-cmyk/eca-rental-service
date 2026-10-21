/**
 * Vehicle loans (Finance, admin only): each own-fleet car's hire-purchase loan, how far it has run and what all of them
 * cost per month. Pure functions, no React, so tests load them. Dates are YYYY-MM-DD strings and months are worked out
 * from the text alone, so the computer's time zone plays no part.
 *
 * The loan record is the master of its Finance "Hire Purchase / Loan" monthly cost: the database works that cost's
 * start and end months out when a loan is saved (supabase/migrations/20261021090000_vehicle_loans.sql). Progress here
 * assumes every instalment is paid on time; the bank statement is the record.
 */

export type LoanStatus = 'ACTIVE' | 'SETTLED' | 'SOLD';
/** How the bank charges interest: flat (Malaysian HP, worked out here) or variable (the bank's statement gives it). */
export type RateType = 'FLAT' | 'VARIABLE';

export const RATE_TYPE_LABELS: Record<RateType, string> = { FLAT: 'Flat', VARIABLE: 'Variable' };
export const NO_HIRER = 'Ownership not set';
export const VARIABLE_NOTE = "Variable rate: the bank's statement gives the interest split";

export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = { ACTIVE: 'Active', SETTLED: 'Settled', SOLD: 'Car sold' };

/** One loan as finance_vehicle_loans() returns it (numbers as numbers, dates as YYYY-MM-DD). */
export interface VehicleLoan {
  id?: string;
  plate_key: string;
  display_plate: string;
  bank: string;
  finance_amount: number;
  /** Interest rate, % per year (flat unless rate_type is VARIABLE). */
  flat_rate_percent: number;
  /** FLAT unless given; rows saved before 20261021150000 read back FLAT. */
  rate_type?: RateType;
  /** The letter's "Cost" (cash price), RM; null when not typed. */
  cash_price?: number | null;
  /** The agreement's commencement date; the first instalment date is its own line. */
  commencement_date?: string | null;
  /** The hirer on the HP agreement (the registered owner); the list is grouped by it. */
  hirer?: string | null;
  tenure_months: number;
  first_payment_date: string;
  downpayment: number;
  /** Worked out in the browser (instalment below) unless overridden for the bank's rounding; stored. */
  monthly_instalment: number;
  status: LoanStatus;
  /** The day it was settled or the car sold; null while active. */
  closed_on: string | null;
  notes: string | null;
  recurring_cost_id?: string | null;
  record_version?: number;
}

/** A loan being weighed up on the page (browser state only, never stored). */
export interface WhatIfLoan {
  finance_amount: number;
  flat_rate_percent: number;
  tenure_months: number;
  /** YYYY-MM or YYYY-MM-DD. */
  first_payment_month: string;
}

export interface LoanProgress {
  /** Instalments paid so far (assumed on time). */
  paid: number;
  left: number;
  /** paid ÷ tenure as a whole percentage. */
  percent: number;
  /** The last instalment month, YYYY-MM-01. */
  finishes: string;
}

/** A running loan's last instalment month inside the chart window: where the line steps down. */
export interface LoanEnd {
  plate_key: string;
  plate: string;
  month: string;
  /** Position of that month in the series (0 is this month). */
  index: number;
}

export interface CommitmentSeries {
  /** Each month of the window, YYYY-MM-01, starting with this month. */
  months: string[];
  /** Instalments due each month from the active loans. */
  committed: number[];
  /** The same with the what-if loan added; null without a complete what-if. */
  withWhatIf: number[] | null;
  whatIfInstalment: number;
  ends: LoanEnd[];
}

export interface LoanSummary {
  /** Hire-purchase instalments due this month. */
  thisMonth: number;
  /** Active loans with instalments still to pay, or paying their last one this month. */
  activeCount: number;
  nextFinish: { plate: string; month: string } | null;
  /** Instalments still to pay on every active loan, no early settlement. */
  balanceLeft: number;
  nearPayoffCount: number;
}

/** Months since year 0 for a YYYY-MM or YYYY-MM-DD text, else null. */
export const monthIndex = (value: string | null | undefined): number | null => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(value ?? '');
  return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : null;
};

/** The YYYY-MM-01 text of a month index. */
export const monthOf = (index: number): string => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;

/**
 * Malaysian hire purchase is flat rate: the interest is finance amount × rate × years, and the instalment is the
 * total over the tenure, rounded up to the next whole ringgit. 0 until the three figures are given.
 */
export function instalment(financeAmount: number, flatRatePercent: number, tenureMonths: number): number {
  if (!(financeAmount > 0) || !(tenureMonths > 0) || !(flatRatePercent >= 0)) return 0;
  const total = financeAmount + (financeAmount * flatRatePercent * tenureMonths) / 1200;
  // Rounded to the sen first, so floating-point dust (200.00000001) never adds a ringgit.
  return Math.ceil(Math.round((total / tenureMonths) * 100) / 100);
}

/** The month of the last instalment, YYYY-MM-01: the first payment month plus the tenure, less one. */
export function lastInstalmentMonth(firstPaymentDate: string, tenureMonths: number): string {
  const first = monthIndex(firstPaymentDate);
  if (first === null) return '';
  return monthOf(first + Math.max(1, tenureMonths) - 1);
}

const isActive = (loan: VehicleLoan) => loan.status === 'ACTIVE';
/**
 * Whether the letter-fields database update (20261021150000) has not been run: a loan read from the database then has
 * no rate_type at all (the first SQL file never returned one). With no loans nothing can be told.
 */
export const letterFieldsMissing = (loans: VehicleLoan[]): boolean => loans.length > 0 && loans.every((loan) => loan.rate_type === undefined);

const isVariable = (loan: Pick<VehicleLoan, 'rate_type'>) => loan.rate_type === 'VARIABLE';
const toSen = (value: unknown) => Math.round(Number(value || 0) * 100);
const fromSen = (value: number) => value / 100;

/**
 * The first instalment date the letter implies: the commencement date plus one month, the same day capped at that
 * month's end (31 Jan -> 28 or 29 Feb). '' for anything that is not a YYYY-MM-DD date.
 */
export function firstInstalmentDate(commencement: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(commencement ?? '');
  if (!match) return '';
  const index = Number(match[1]) * 12 + Number(match[2]); // the next month, counted from 0
  const year = Math.floor(index / 12), month = (index % 12) + 1;
  const day = Math.min(Number(match[3]), new Date(Date.UTC(year, month, 0)).getUTCDate());
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The letter's read-only lines for a flat-rate loan, to the sen: interest = financing × rate × years, total =
 * financing + interest, final instalment = total − (instalments − 1) × monthly instalment (what hpSchedule's last row
 * pays). All null for a variable rate, or until financing and tenure are given (final also needs the instalment).
 */
export function letterFigures(loan: Pick<VehicleLoan, 'finance_amount' | 'flat_rate_percent' | 'tenure_months' | 'monthly_instalment' | 'rate_type'>): { interest: number | null; total: number | null; final: number | null } {
  const finance = toSen(loan.finance_amount);
  const n = Math.floor(Number(loan.tenure_months) || 0);
  const rate = Number(loan.flat_rate_percent || 0);
  if (isVariable(loan) || !(finance > 0) || !(n > 0) || !(rate >= 0)) return { interest: null, total: null, final: null };
  const interest = Math.round((finance * rate * n) / 1200);
  const total = finance + interest;
  const monthly = toSen(loan.monthly_instalment);
  return { interest: fromSen(interest), total: fromSen(total), final: monthly > 0 ? fromSen(total - (n - 1) * monthly) : null };
}

/**
 * How far a loan has run on `today`: whole months from the first payment month to this month, both counted, capped at
 * the tenure and 0 before the first payment month. A settled or sold loan shows as paid in full.
 */
export function progress(loan: VehicleLoan, today: string): LoanProgress {
  const tenure = Math.max(1, loan.tenure_months);
  const first = monthIndex(loan.first_payment_date);
  const now = monthIndex(today);
  const finishes = lastInstalmentMonth(loan.first_payment_date, tenure);
  const paid = !isActive(loan) ? tenure
    : first === null || now === null ? 0
      : Math.min(tenure, Math.max(0, now - first + 1));
  return { paid, left: tenure - paid, percent: Math.round((paid / tenure) * 100), finishes };
}

/** An active loan with instalments still to pay, or paying its last one this month. */
const isRunning = (loan: VehicleLoan, today: string) => {
  const run = progress(loan, today);
  return isActive(loan) && (run.left > 0 || run.finishes.slice(0, 7) === today.slice(0, 7));
};

/** Six or fewer instalments left on a loan still running, its last month included (its bar shows amber). */
export function nearPayoff(loan: VehicleLoan, today: string): boolean {
  return isRunning(loan, today) && progress(loan, today).left <= 6;
}

/** Instalments still to pay (instalment × months left); 0 once settled or sold. */
export const balanceLeft = (loan: VehicleLoan, today: string) => (isActive(loan) ? loan.monthly_instalment * progress(loan, today).left : 0);

/**
 * Monthly hire-purchase commitment for `months` months from this month: the sum of active loans' instalments due in
 * each month, and the same with a what-if loan added when one is typed in full.
 */
export function commitmentSeries(loans: VehicleLoan[], today: string, months = 36, whatIf?: WhatIfLoan | null): CommitmentSeries {
  const start = monthIndex(today) ?? 0;
  const indexes = Array.from({ length: months }, (_, i) => start + i);
  const running = loans.filter(isActive).flatMap((loan) => {
    const first = monthIndex(loan.first_payment_date);
    return first === null ? [] : [{ loan, first, last: first + Math.max(1, loan.tenure_months) - 1 }];
  });
  const committed = indexes.map((month) => running.reduce((sum, { loan, first, last }) => (month >= first && month <= last ? sum + loan.monthly_instalment : sum), 0));
  const whatIfFirst = whatIf ? monthIndex(whatIf.first_payment_month) : null;
  const whatIfInstalment = whatIf ? instalment(whatIf.finance_amount, whatIf.flat_rate_percent, whatIf.tenure_months) : 0;
  const withWhatIf = whatIf && whatIfFirst !== null && whatIfInstalment > 0
    ? committed.map((value, i) => (indexes[i] >= whatIfFirst && indexes[i] < whatIfFirst + whatIf.tenure_months ? value + whatIfInstalment : value))
    : null;
  const ends = running
    .map(({ loan, last }) => ({ plate_key: loan.plate_key, plate: loan.display_plate, month: monthOf(last), index: last - start }))
    .filter((end) => end.index >= 0 && end.index < months - 1)
    .sort((a, b) => a.index - b.index || a.plate_key.localeCompare(b.plate_key));
  return { months: indexes.map(monthOf), committed, withWhatIf, whatIfInstalment: withWhatIf ? whatIfInstalment : 0, ends };
}

/**
 * Loans most paid off first (the share of instalments paid, the owner's choice: a long loan that has run far sits above
 * a short one that finishes sooner), ties by fewest instalments left, then plate; settled and sold loans last.
 */
export function sortLoans(loans: VehicleLoan[], today: string): VehicleLoan[] {
  return loans
    .map((loan) => { const run = progress(loan, today); return { loan, share: run.paid / Math.max(1, loan.tenure_months), left: run.left, active: isActive(loan) }; })
    .sort((a, b) => Number(b.active) - Number(a.active) || b.share - a.share || a.left - b.left || a.loan.plate_key.localeCompare(b.loan.plate_key))
    .map(({ loan }) => loan);
}

/** The running loan with the fewest instalments left (the one that finishes next). */
const soonestToFinish = (running: VehicleLoan[], today: string): VehicleLoan | undefined =>
  running.map((loan) => ({ loan, left: progress(loan, today).left })).sort((a, b) => a.left - b.left || a.loan.plate_key.localeCompare(b.loan.plate_key))[0]?.loan;

/** The cars as assets: what they cost, what was paid down, and what they are worth at the owner's depreciation rate. */
export interface AssetSummary {
  /** Cars still owned (every loan not marked Car sold). */
  count: number;
  /** Cash price of those cars (financing + downpayment when no cash price was typed). */
  cost: number;
  downpayment: number;
  /** Net book value today: cost less ratePercent a year on the reducing balance since commencement. */
  valueToday: number;
  /** The same at each loan's last instalment (today for a loan already settled): roughly what the cars fetch once paid off. */
  disposalAtPayoff: number;
  ratePercent: number;
}

/** What a car cost: the letter's cash price, or financing + downpayment when none was typed. */
export const vehicleCost = (loan: Pick<VehicleLoan, 'cash_price' | 'finance_amount' | 'downpayment'>): number =>
  Math.round((loan.cash_price != null && Number(loan.cash_price) > 0 ? Number(loan.cash_price) : Number(loan.finance_amount) + Number(loan.downpayment ?? 0)) * 100) / 100;

/** The month the loan commenced: the commencement date, else one month before the first instalment. */
const commencementIndex = (loan: VehicleLoan): number | null => {
  const commenced = monthIndex(loan.commencement_date);
  if (commenced !== null) return commenced;
  const first = monthIndex(loan.first_payment_date);
  return first === null ? null : first - 1;
};

/** Net book value after `months` months: cost less ratePercent a year on the reducing balance (never negative months). */
const bookValue = (cost: number, months: number, ratePercent: number): number => cost * Math.pow(1 - ratePercent / 100, Math.max(0, months) / 12);

/**
 * The asset figures for the page: cost and downpayment of the cars still owned, their net book value today, and the
 * projected disposal value once each loan is paid off (ratePercent a year off the reducing balance from commencement).
 */
export function assetSummary(loans: VehicleLoan[], today: string, ratePercent = 5): AssetSummary {
  const owned = loans.filter((loan) => loan.status !== 'SOLD');
  const now = monthIndex(today) ?? 0;
  let cost = 0, downpayment = 0, valueToday = 0, disposalAtPayoff = 0;
  for (const loan of owned) {
    const price = vehicleCost(loan);
    cost += price;
    downpayment += Number(loan.downpayment ?? 0);
    const start = commencementIndex(loan);
    if (start === null) { valueToday += price; disposalAtPayoff += price; continue; }
    const last = start + 1 + Math.max(1, loan.tenure_months) - 1;
    const payoffAt = isActive(loan) ? Math.max(last, now) : now;
    valueToday += bookValue(price, now - start, ratePercent);
    disposalAtPayoff += bookValue(price, payoffAt - start, ratePercent);
  }
  const round2 = (value: number) => Math.round(value * 100) / 100;
  return { count: owned.length, cost: round2(cost), downpayment: round2(downpayment), valueToday: round2(valueToday), disposalAtPayoff: round2(disposalAtPayoff), ratePercent };
}

/** The page's three tiles. */
export function loanSummary(loans: VehicleLoan[], today: string): LoanSummary {
  const running = loans.filter((loan) => isRunning(loan, today));
  const soonest = soonestToFinish(running, today);
  return {
    thisMonth: commitmentSeries(loans, today, 1).committed[0],
    activeCount: running.length,
    nextFinish: soonest ? { plate: soonest.display_plate, month: progress(soonest, today).finishes } : null,
    balanceLeft: running.reduce((sum, loan) => sum + balanceLeft(loan, today), 0),
    nearPayoffCount: running.filter((loan) => nearPayoff(loan, today)).length,
  };
}

export interface HirerGroup {
  /** The hirer as typed on the loans; null for loans without one. */
  hirer: string | null;
  /** The heading: the hirer, or "Ownership not set". */
  label: string;
  /** Most paid off first, settled and sold last (sortLoans). */
  loans: VehicleLoan[];
  /** Loans still running this month (as the page's tile counts them). */
  activeCount: number;
  /** This month's instalments for the group (as the page's tile adds them). */
  monthlyTotal: number;
}

/** The loan list grouped by hirer, the biggest monthly total first (then by name, the unset group last on a tie). */
export function groupLoansByHirer(loans: VehicleLoan[], today: string): HirerGroup[] {
  const byHirer = new Map<string | null, VehicleLoan[]>();
  for (const loan of loans) {
    const hirer = loan.hirer?.trim() || null;
    byHirer.set(hirer, [...(byHirer.get(hirer) ?? []), loan]);
  }
  return [...byHirer].map(([hirer, members]) => {
    const summary = loanSummary(members, today);
    return { hirer, label: hirer ?? NO_HIRER, loans: sortLoans(members, today), activeCount: summary.activeCount, monthlyTotal: summary.thisMonth };
  }).sort((a, b) => b.monthlyTotal - a.monthlyTotal || Number(a.hirer === null) - Number(b.hirer === null) || a.label.localeCompare(b.label));
}

/** A financial year's figures, on the row that closes it (each 31 March, and the last instalment). */
export interface HpYearEnd {
  /** 31.03.YYYY, or the last instalment's own date (DD.MM.YYYY) when it is not in March. */
  label: string;
  /** Instalments, interest and principal of the financial year, since the previous year-end row (no split, null, for a variable rate). */
  instalments: number;
  interest: number | null;
  principal: number | null;
  /** Finance amount less every instalment's principal so far; 0 on the last row. Variable: less every instalment, floor 0. */
  balance: number;
}

export interface HpScheduleRow {
  /** YYYY-MM-DD */
  date: string;
  /** Instalment number, 1 to the tenure. */
  number: number;
  /** Rule of 78 digit: tenure − number + 1. */
  digit: number;
  amount: number;
  /** null for a variable rate: the bank's statement gives the split. */
  interest: number | null;
  principal: number | null;
  yearEnd: HpYearEnd | null;
}

export interface HpSchedule {
  rows: HpScheduleRow[];
  /** null for a variable rate. */
  totalInterest: number | null;
  totalPayable: number | null;
  sumOfDigits: number;
}

const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * The hire-purchase schedule the bank issues: total interest = finance × flat rate × years; each instalment is the
 * stored monthly instalment, and the last one is the total payable less the others (how the bank absorbs rounding).
 * Interest is split by the Rule of 78 (sum of digits), the last instalment taking the rounding residual, so interest
 * sums to the total and principal to the finance amount, to the sen. The financial year ends on 31 March.
 * Worked in whole sen, and dates from the text alone.
 *
 * A variable rate has no interest worked out here: every row is the typed instalment, interest and principal are null,
 * the year-end rows total the instalments only, and the balance is the finance amount less the instalments so far
 * (never below nil).
 */
export function hpSchedule(loan: Pick<VehicleLoan, 'finance_amount' | 'flat_rate_percent' | 'tenure_months' | 'first_payment_date' | 'monthly_instalment' | 'rate_type'>): HpSchedule {
  const variable = isVariable(loan);
  const n = Math.max(0, Math.floor(Number(loan.tenure_months) || 0));
  const finance = toSen(loan.finance_amount);
  const totalInterest = Math.round((finance * Number(loan.flat_rate_percent || 0) * n) / 1200);
  const totalPayable = finance + totalInterest;
  const monthly = toSen(loan.monthly_instalment);
  const sumOfDigits = (n * (n + 1)) / 2;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(loan.first_payment_date ?? '');
  const rows: HpScheduleRow[] = [];
  const totals = variable ? { totalInterest: null, totalPayable: null } : { totalInterest: fromSen(totalInterest), totalPayable: fromSen(totalPayable) };
  if (!match || n === 0) return { rows, ...totals, sumOfDigits };
  const [year0, month0, day0] = [Number(match[1]), Number(match[2]), Number(match[3])];
  let interestSoFar = 0, principalSoFar = 0, paidSoFar = 0;
  let yearAmount = 0, yearInterest = 0, yearPrincipal = 0;
  for (let i = 1; i <= n; i++) {
    const index = year0 * 12 + month0 - 1 + i - 1;
    const year = Math.floor(index / 12), month = (index % 12) + 1;
    const day = Math.min(day0, lastDay(year, month));
    const pad = (value: number) => String(value).padStart(2, '0');
    const digit = n - i + 1;
    const last = i === n;
    const amount = last && !variable ? totalPayable - (n - 1) * monthly : monthly;
    paidSoFar += amount;
    const interest = last ? totalInterest - interestSoFar : Math.round((totalInterest * digit) / sumOfDigits);
    const principal = amount - interest;
    interestSoFar += interest;
    principalSoFar += principal;
    yearAmount += amount;
    yearInterest += interest;
    yearPrincipal += principal;
    let yearEnd: HpYearEnd | null = null;
    if (month === 3 || last) {
      yearEnd = {
        label: month === 3 ? `31.03.${year}` : `${pad(day)}.${pad(month)}.${year}`,
        instalments: fromSen(yearAmount),
        interest: variable ? null : fromSen(yearInterest),
        principal: variable ? null : fromSen(yearPrincipal),
        balance: variable ? fromSen(Math.max(0, finance - paidSoFar)) : last ? 0 : fromSen(finance - principalSoFar),
      };
      yearAmount = yearInterest = yearPrincipal = 0;
    }
    rows.push({ date: `${year}-${pad(month)}-${pad(day)}`, number: i, digit, amount: fromSen(amount), interest: variable ? null : fromSen(interest), principal: variable ? null : fromSen(principal), yearEnd });
  }
  return { rows, ...totals, sumOfDigits };
}

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

export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = { ACTIVE: 'Active', SETTLED: 'Settled', SOLD: 'Car sold' };

/** One loan as finance_vehicle_loans() returns it (numbers as numbers, dates as YYYY-MM-DD). */
export interface VehicleLoan {
  id?: string;
  plate_key: string;
  display_plate: string;
  bank: string;
  finance_amount: number;
  /** Flat interest rate, % per year. */
  flat_rate_percent: number;
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

/** Loans soonest to finish first (fewest instalments left), settled and sold loans last. */
export function sortLoans(loans: VehicleLoan[], today: string): VehicleLoan[] {
  return loans
    .map((loan) => ({ loan, left: progress(loan, today).left, active: isActive(loan) }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.left - b.left || a.loan.plate_key.localeCompare(b.loan.plate_key))
    .map(({ loan }) => loan);
}

/** The page's three tiles. */
export function loanSummary(loans: VehicleLoan[], today: string): LoanSummary {
  const running = loans.filter((loan) => isRunning(loan, today));
  const soonest = sortLoans(running, today)[0];
  return {
    thisMonth: commitmentSeries(loans, today, 1).committed[0],
    activeCount: running.length,
    nextFinish: soonest ? { plate: soonest.display_plate, month: progress(soonest, today).finishes } : null,
    balanceLeft: running.reduce((sum, loan) => sum + balanceLeft(loan, today), 0),
    nearPayoffCount: running.filter((loan) => nearPayoff(loan, today)).length,
  };
}

/** A financial year's figures, on the row that closes it (each 31 March, and the last instalment). */
export interface HpYearEnd {
  /** 31.03.YYYY, or the last instalment's own date (DD.MM.YYYY) when it is not in March. */
  label: string;
  /** Instalments, interest and principal of the financial year, since the previous year-end row. */
  instalments: number;
  interest: number;
  principal: number;
  /** Finance amount less every instalment's principal so far; 0 on the last row. */
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
  interest: number;
  principal: number;
  yearEnd: HpYearEnd | null;
}

export interface HpSchedule {
  rows: HpScheduleRow[];
  totalInterest: number;
  totalPayable: number;
  sumOfDigits: number;
}

const toSen = (value: unknown) => Math.round(Number(value || 0) * 100);
const fromSen = (value: number) => value / 100;
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * The hire-purchase schedule the bank issues: total interest = finance × flat rate × years; each instalment is the
 * stored monthly instalment, and the last one is the total payable less the others (how the bank absorbs rounding).
 * Interest is split by the Rule of 78 (sum of digits), the last instalment taking the rounding residual, so interest
 * sums to the total and principal to the finance amount, to the sen. The financial year ends on 31 March.
 * Worked in whole sen, and dates from the text alone.
 */
export function hpSchedule(loan: Pick<VehicleLoan, 'finance_amount' | 'flat_rate_percent' | 'tenure_months' | 'first_payment_date' | 'monthly_instalment'>): HpSchedule {
  const n = Math.max(0, Math.floor(Number(loan.tenure_months) || 0));
  const finance = toSen(loan.finance_amount);
  const totalInterest = Math.round((finance * Number(loan.flat_rate_percent || 0) * n) / 1200);
  const totalPayable = finance + totalInterest;
  const monthly = toSen(loan.monthly_instalment);
  const sumOfDigits = (n * (n + 1)) / 2;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(loan.first_payment_date ?? '');
  const rows: HpScheduleRow[] = [];
  if (!match || n === 0) return { rows, totalInterest: fromSen(totalInterest), totalPayable: fromSen(totalPayable), sumOfDigits };
  const [year0, month0, day0] = [Number(match[1]), Number(match[2]), Number(match[3])];
  let interestSoFar = 0, principalSoFar = 0;
  let yearAmount = 0, yearInterest = 0, yearPrincipal = 0;
  for (let i = 1; i <= n; i++) {
    const index = year0 * 12 + month0 - 1 + i - 1;
    const year = Math.floor(index / 12), month = (index % 12) + 1;
    const day = Math.min(day0, lastDay(year, month));
    const pad = (value: number) => String(value).padStart(2, '0');
    const digit = n - i + 1;
    const last = i === n;
    const amount = last ? totalPayable - (n - 1) * monthly : monthly;
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
        interest: fromSen(yearInterest),
        principal: fromSen(yearPrincipal),
        balance: last ? 0 : fromSen(finance - principalSoFar),
      };
      yearAmount = yearInterest = yearPrincipal = 0;
    }
    rows.push({ date: `${year}-${pad(month)}-${pad(day)}`, number: i, digit, amount: fromSen(amount), interest: fromSen(interest), principal: fromSen(principal), yearEnd });
  }
  return { rows, totalInterest: fromSen(totalInterest), totalPayable: fromSen(totalPayable), sumOfDigits };
}

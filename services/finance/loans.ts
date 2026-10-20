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

/** Six or fewer instalments left on a loan still running (its bar shows amber). */
export function nearPayoff(loan: VehicleLoan, today: string): boolean {
  const { left } = progress(loan, today);
  return isActive(loan) && left > 0 && left <= 6;
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
  // Active loans with instalments still to pay, or paying their last one this month.
  const running = loans.filter((loan) => {
    const run = progress(loan, today);
    return isActive(loan) && (run.left > 0 || run.finishes.slice(0, 7) === today.slice(0, 7));
  });
  const soonest = sortLoans(running, today)[0];
  return {
    thisMonth: commitmentSeries(loans, today, 1).committed[0],
    activeCount: running.length,
    nextFinish: soonest ? { plate: soonest.display_plate, month: progress(soonest, today).finishes } : null,
    balanceLeft: running.reduce((sum, loan) => sum + balanceLeft(loan, today), 0),
    nearPayoffCount: running.filter((loan) => nearPayoff(loan, today)).length,
  };
}

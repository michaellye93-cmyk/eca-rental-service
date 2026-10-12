import type { FinanceInput, FinanceReport } from '../../types/finance.ts';
import { insuranceCashOutflow } from './insurance.ts';
import { isCashMethod } from '../moneyDefinitions.ts';

const cents = (value: number) => Math.round(value * 100) / 100;
const monthKey = (value: string) => value.slice(0, 7);

export interface MonthCashFlow {
  /** deposits: Sewa Biasa deposits received (held for the driver). downpayments: Sewa Beli downpayments (extra income). */
  in: { rent_cash: number; smart_drive_net: number; other_income: number; deposits: number; downpayments: number; total: number };
  out: { monthly_vehicle: number; workshop: number; other_vehicle: number; insurance: number; operation_fix: number; cash_flow_only: number; deposits_refunded: number; total: number };
  net: number;
}

/**
 * The month seen as cash rather than profit. Service claims are not cash, so they are left out on both sides; insurance
 * is the premium paid in the month instead of its monthly share; costs marked cash flow only (tax instalments) are in.
 * It is a view of the month's records, so it will not match the bank to the ringgit (deposits, timing, purchases).
 */
export function monthCashFlow(input: FinanceInput, report: FinanceReport): MonthCashFlow {
  const month = monthKey(input.month.finance_month);
  // Rent settled from a deposit (contra) moves no cash this month: the cash came in as the deposit.
  // Only money that reached the business (see moneyDefinitions): no deposit forfeits; claims are never in cash_amount.
  const rent_cash = cents(input.ehailing.filter((payment) => isCashMethod(payment.payment_method)).reduce((sum, payment) => sum + payment.cash_amount, 0));
  const smart_drive_net = cents(input.smart_rows.reduce((sum, row) => sum + row.gross_revenue - row.commission, 0));
  const other_income = cents((input.other_income ?? [])
    .filter((row) => row.status === 'CONFIRMED' && !row.cancelled_at && monthKey(row.finance_month) === month)
    .reduce((sum, row) => sum + row.amount, 0));
  const insurance = cents(input.insurance.filter((policy) => !policy.cancelled_at).reduce((sum, policy) => {
    const outflow = insuranceCashOutflow(policy, input.calculation_version ?? 1);
    return outflow.date && monthKey(outflow.date) === month ? sum + outflow.amount : sum;
  }, 0));
  const depositsOf = (entry: string, kind: string) => cents((input.deposits ?? []).filter((row) => row.entry === entry && row.kind === kind && monthKey(row.entry_date) === month).reduce((sum, row) => sum + Number(row.amount), 0));
  // A downpayment is not a deposit: it is never held or refunded, it is extra income when received.
  const deposits = depositsOf('RECEIVED', 'DEPOSIT');
  const downpayments = depositsOf('RECEIVED', 'DOWNPAYMENT');
  const cashIn = { rent_cash, smart_drive_net, other_income, deposits, downpayments, total: cents(rent_cash + smart_drive_net + other_income + deposits + downpayments) };
  const out = {
    monthly_vehicle: cents(report.totals.recurring),
    workshop: cents(report.totals.workshop),
    other_vehicle: cents(report.totals.direct_costs),
    insurance,
    operation_fix: cents(report.corporate_opex),
    cash_flow_only: cents(report.cash_flow_only ?? 0),
    deposits_refunded: depositsOf('REFUNDED', 'DEPOSIT'),
    total: 0,
  };
  out.total = cents(out.monthly_vehicle + out.workshop + out.other_vehicle + out.insurance + out.operation_fix + out.cash_flow_only + out.deposits_refunded);
  return { in: cashIn, out, net: cents(cashIn.total - out.total) };
}

export interface MarginTarget {
  revenue: number;
  profit: number;
  /** Net margin (management profit ÷ revenue), or null with no revenue. */
  margin: number | null;
  contribution_margin: number | null;
  target: number;
  target_profit: number;
  /** RM still needed to reach the target at this month's revenue (0 once reached). */
  gap: number;
  /** Cars that earned nothing this month but still cost money. */
  idle: { count: number; cost: number; plates: string[] };
}

export function marginTarget(report: FinanceReport, target = 0.2): MarginTarget {
  const revenue = report.totals.revenue;
  const profit = report.management_profit;
  const target_profit = cents(revenue * target);
  const idleCars = report.vehicles.filter((vehicle) => vehicle.revenue === 0 && vehicle.contribution < 0);
  return {
    revenue,
    profit,
    margin: revenue ? profit / revenue : null,
    contribution_margin: revenue ? report.totals.contribution / revenue : null,
    target,
    target_profit,
    gap: cents(Math.max(0, target_profit - profit)),
    idle: {
      count: idleCars.length,
      cost: cents(idleCars.reduce((sum, vehicle) => sum - vehicle.contribution, 0)),
      plates: idleCars.map((vehicle) => vehicle.plate_key).sort(),
    },
  };
}

/** Finance is kept from August 2026; the trend shows at most the last 12 months up to the chosen one, oldest first. */
export const FINANCE_START = '2026-08';
export function trendMonths(month: string, start = FINANCE_START): string[] {
  const months: string[] = [];
  let [year, number] = month.slice(0, 7).split('-').map(Number);
  while (months.length < 12) {
    const key = `${year}-${String(number).padStart(2, '0')}`;
    if (key < start) break;
    months.unshift(key);
    number -= 1;
    if (number === 0) { number = 12; year -= 1; }
  }
  return months;
}

/**
 * The version of the P&L and trend rules that trendRow's figures come from. Stored figures of closed months carry it,
 * and figures stored under another version are read live again (and stored anew). Raise it whenever the P&L rules
 * (calculations, revenue, costs, contribution, management profit) or the trend rules below change.
 */
export const TREND_RULES_VERSION = 1;

export interface TrendRow { month: string; status: string; revenue: number; contribution: number; profit: number; margin: number | null }
export const trendRow = (month: string, status: string, report: FinanceReport): TrendRow => ({
  month,
  status,
  revenue: report.totals.revenue,
  contribution: report.totals.contribution,
  profit: report.management_profit,
  margin: report.totals.revenue ? report.management_profit / report.totals.revenue : null,
});

/** A closed month's trend figures as stored by finance_save_month_totals (supabase/migrations/20261012200000_money_review.sql). */
export interface StoredMonthTotals {
  month: string; revision: number;
  /** rules_version: the TREND_RULES_VERSION the figures were worked out by; a row without it counts as not stored. */
  totals: { revenue: number; contribution: number; profit: number; margin: number | null; rules_version?: number };
}

/** What is stored for a month: the trend row's figures, worked out by the P&L rules above, and their rules version. */
export const storedTotals = (row: TrendRow): StoredMonthTotals['totals'] =>
  ({ revenue: row.revenue, contribution: row.contribution, profit: row.profit, margin: row.margin, rules_version: TREND_RULES_VERSION });

/** Stored figures worked out by the current rules; any others count as not stored. */
const currentRules = (stored: StoredMonthTotals[] | null) => (stored ?? []).filter((row) => row.totals?.rules_version === TREND_RULES_VERSION);

/** Month (YYYY-MM) to the revision whose figures are stored by the current rules (see needsStoredTotals). */
export const storedRevisionMap = (stored: StoredMonthTotals[]): Map<string, number> =>
  new Map(currentRules(stored).map((row) => [row.month.slice(0, 7), row.revision] as [string, number]));

/**
 * Trend rows for `months` (YYYY-MM): closed months with figures stored by the current rules are taken from them; the
 * others (Draft and Ready months, figures from other rules, or every month while nothing is stored, `stored` null) are
 * listed in `live` to be read in full.
 */
export function planTrend(months: string[], stored: StoredMonthTotals[] | null): { rows: Map<string, TrendRow>; live: string[] } {
  const byMonth = new Map(currentRules(stored).map((row) => [row.month.slice(0, 7), row] as const));
  const rows = new Map<string, TrendRow>();
  const live: string[] = [];
  for (const month of months) {
    const row = byMonth.get(month);
    if (row) rows.set(month, { month, status: 'CLOSED', revenue: row.totals.revenue, contribution: row.totals.contribution, profit: row.totals.profit, margin: row.totals.margin ?? null });
    else live.push(month);
  }
  return { rows, live };
}

/**
 * Whether a month just read should have its figures stored: it is closed, and nothing is stored for it at this revision
 * (`stored`: month YYYY-MM to stored revision; null while the stored figures are unavailable).
 */
export const needsStoredTotals = (month: { finance_month: string; status: string; revision: number }, stored: Map<string, number> | null) =>
  !!stored && month.status === 'CLOSED' && stored.get(month.finance_month.slice(0, 7)) !== month.revision;

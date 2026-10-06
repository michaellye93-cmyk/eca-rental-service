import type { FinanceInput, FinanceReport } from '../../types/finance.ts';
import { insuranceCashOutflow } from './insurance.ts';

const cents = (value: number) => Math.round(value * 100) / 100;
const monthKey = (value: string) => value.slice(0, 7);

export interface MonthCashFlow {
  in: { rent_cash: number; smart_drive_net: number; other_income: number; total: number };
  out: { monthly_vehicle: number; workshop: number; other_vehicle: number; insurance: number; operation_fix: number; cash_flow_only: number; total: number };
  net: number;
}

/**
 * The month seen as cash rather than profit. Service claims are not cash, so they are left out on both sides; insurance
 * is the premium paid in the month instead of its monthly share; costs marked cash flow only (tax instalments) are in.
 * It is a view of the month's records, so it will not match the bank to the ringgit (deposits, timing, purchases).
 */
export function monthCashFlow(input: FinanceInput, report: FinanceReport): MonthCashFlow {
  const month = monthKey(input.month.finance_month);
  const rent_cash = cents(input.ehailing.reduce((sum, payment) => sum + payment.cash_amount, 0));
  const smart_drive_net = cents(input.smart_rows.reduce((sum, row) => sum + row.gross_revenue - row.commission, 0));
  const other_income = cents((input.other_income ?? [])
    .filter((row) => row.status === 'CONFIRMED' && !row.cancelled_at && monthKey(row.finance_month) === month)
    .reduce((sum, row) => sum + row.amount, 0));
  const insurance = cents(input.insurance.filter((policy) => !policy.cancelled_at).reduce((sum, policy) => {
    const outflow = insuranceCashOutflow(policy, input.calculation_version ?? 1);
    return outflow.date && monthKey(outflow.date) === month ? sum + outflow.amount : sum;
  }, 0));
  const cashIn = { rent_cash, smart_drive_net, other_income, total: cents(rent_cash + smart_drive_net + other_income) };
  const out = {
    monthly_vehicle: cents(report.totals.recurring),
    workshop: cents(report.totals.workshop),
    other_vehicle: cents(report.totals.direct_costs),
    insurance,
    operation_fix: cents(report.corporate_opex),
    cash_flow_only: cents(report.cash_flow_only ?? 0),
    total: 0,
  };
  out.total = cents(out.monthly_vehicle + out.workshop + out.other_vehicle + out.insurance + out.operation_fix + out.cash_flow_only);
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

export interface TrendRow { month: string; status: string; revenue: number; contribution: number; profit: number; margin: number | null }
export const trendRow = (month: string, status: string, report: FinanceReport): TrendRow => ({
  month,
  status,
  revenue: report.totals.revenue,
  contribution: report.totals.contribution,
  profit: report.management_profit,
  margin: report.totals.revenue ? report.management_profit / report.totals.revenue : null,
});

import type { FinanceTotals } from '../../types/finance';
import { round2 } from '../fmt.ts';

// Splits a business's direct cost into the parts shown on the P&L. Service and maintenance
// combines driver service claims with workshop billing; "other" is other vehicle costs plus commission.
export function directCostBreakdown(totals: FinanceTotals) {
  const monthly_vehicle = round2(totals.recurring);
  const service_maintenance = round2(totals.service_claim + totals.workshop);
  const insurance = round2(totals.insurance);
  const other = round2(totals.direct_costs + totals.commission);
  return { monthly_vehicle, service_maintenance, insurance, other, total: round2(monthly_vehicle + service_maintenance + insurance + other) };
}

export interface BusinessStatementColumn {
  business: string;
  label: string;
  revenue: number;
  owner_payout_loan: number;
  service: number;
  insurance: number;
  other: number;
  gross_profit: number;
  margin: number | null;
}

function statementColumn(business: string, label: string, totals: FinanceTotals): BusinessStatementColumn {
  const parts = directCostBreakdown(totals);
  return {
    business, label, revenue: round2(totals.revenue),
    owner_payout_loan: parts.monthly_vehicle, service: parts.service_maintenance, insurance: parts.insurance, other: parts.other,
    gross_profit: round2(totals.contribution), margin: totals.revenue ? round2(totals.contribution / totals.revenue * 10000) / 10000 : null,
  };
}

// Money → Vehicles gross profit by business: revenue less owner payout / loan, service, insurance and other car costs.
// Gross profit is the same number as Contribution on the P&L, before Operation Fix Cost. Businesses with nothing this
// month are left out; cars with no Vehicle Master entry get their own column so they are seen, never guessed.
export function businessStatement(businesses: Record<string, FinanceTotals>, totals: FinanceTotals) {
  const carries = (value: FinanceTotals) => [value.revenue, value.recurring, value.service_claim, value.workshop, value.insurance, value.direct_costs, value.commission].some((amount) => amount !== 0);
  const columns = Object.entries(businesses)
    .filter(([, value]) => carries(value))
    .sort(([left], [right]) => Number(left === 'UNMATCHED') - Number(right === 'UNMATCHED'))
    .map(([business, value]) => statementColumn(business, business === 'UNMATCHED' ? 'Unmatched cars' : business, value));
  return { columns, total: statementColumn('TOTAL', 'Total', totals), unmatched: columns.some((column) => column.business === 'UNMATCHED') };
}

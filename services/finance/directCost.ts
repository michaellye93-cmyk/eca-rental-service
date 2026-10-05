import type { FinanceTotals } from '../../types/finance';

const cents = (value: number) => Math.round(value * 100) / 100;

// Splits a business's direct cost into the parts shown on the P&L. Service and maintenance
// combines driver service claims with workshop billing; "other" is other vehicle costs plus commission.
export function directCostBreakdown(totals: FinanceTotals) {
  const monthly_vehicle = cents(totals.recurring);
  const service_maintenance = cents(totals.service_claim + totals.workshop);
  const insurance = cents(totals.insurance);
  const other = cents(totals.direct_costs + totals.commission);
  return { monthly_vehicle, service_maintenance, insurance, other, total: cents(monthly_vehicle + service_maintenance + insurance + other) };
}

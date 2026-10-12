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
